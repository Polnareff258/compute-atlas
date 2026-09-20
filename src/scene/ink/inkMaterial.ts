import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  float,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from './inkField';

/**
 * The hero material: an advected ink-density field, shaded.
 *
 * Every number below is a reading of one thing — the density field — and the
 * discipline this file has to keep is that the *four* outputs the brief asks to
 * move together genuinely do. Displacement, opacity, normal response and emitted
 * intensity are all functions of `body`, `scour`, `settle`, `pressure` and the
 * flow direction, and nothing here has a term whose input is not one of those.
 * That is what makes the picture read as one phenomenon; the moment one output
 * starts responding to something the others cannot see, the frame becomes a stack
 * of effects again, which is the failure the previous composition was measured
 * against.
 *
 * ## The 70 / 20 / 10 hierarchy, as three terms
 *
 * **70% — the pigment.** `body`, through a wide `smoothstep`, mixed from the ink
 * base into midnight and then into a desaturated cobalt-grey. Its whole job is
 * area and softness: the ramp is over most of the field's range, so there is no
 * value in the frame at which the pigment stops abruptly, and the boundary the eye
 * reads is its own contrast threshold rather than a line the shader drew.
 *
 * **20% — the bedding.** Directional layering carried by `along`, the arc-length
 * coordinate the bake wrote down, plus a lateral shear across the flow. The brief
 * asks for "slow shear, width variation, layer displacement" and those are three
 * different modulations of one phase: the shear is the lateral term, the width
 * variation is the flow-speed term, and the displacement is the time term. All
 * three are the same sine, which is why they agree.
 *
 * **10% — the narrative sharpness.** Two things, and only two. The thalweg — the
 * narrow band where `body` is near its maximum, which is the meander's own line of
 * motion and the one crisp structure the idle frame is composed around — and the
 * pointer's `pressure`, which is the only thing in the frame allowed to be sharp
 * anywhere else. The brief reserves this budget explicitly; spending it on a third
 * element is how a frame with a clear subject becomes a frame with none.
 *
 * ## Why there is no lighting model
 *
 * There are no lights in this scene and there never have been: the previous
 * composition baked orientation luminance into vertex colours, and this one reads
 * a density gradient instead. `response` below is that gradient dotted into a key
 * direction — a normal perturbation evaluated in the fragment stage rather than
 * carried as an attribute, because the field changes every frame and an attribute
 * would have to be rebuilt every frame to stay true to it. It is a shading *term*
 * driven by the same field, not a light, and calling it one would be the kind of
 * small inaccuracy that later becomes a bug report about shadows that do not move.
 */

/**
 * How far the surface is cut and built, in world units.
 *
 * These are the numbers that make erosion and deposition *physical* rather than
 * merely coloured. The brief asks that the river be "formed by erosion, deposition,
 * diffusion and computation density", and three of those four are visible only if
 * the surface actually moves: a cut that is drawn but not displaced is a texture,
 * and the first thing a viewer does with a landscape is look for its silhouette.
 *
 * The cut exceeds the build, which is the geology: a channel is deeper than the bar
 * beside it is high, and a world where they were equal would be a world of ripples
 * with no course.
 */
const SCOUR_DEPTH = 26;
const SETTLE_HEIGHT = 17;

/**
 * The relief that rides on the body itself.
 *
 * Small relative to the cut, because this is the *shoulder* rather than the
 * channel: it is what gives the pigment's outer reaches a surface to catch, so the
 * 70% layer is not a flat decal on a flat plane. Without it the composition's
 * largest area is its flattest, which is the exact failure the previous stage's
 * own review brief named as its main remaining risk.
 */
const BODY_RELIEF = 9.5;

/**
 * The primary-core band.
 *
 * This selects the composition's one crisp structure, and it does so from the *static* fluvial
 * speed rather than from the advected composite body. That distinction is the whole fix: a band
 * over the composite is not a centreline, because by the time the composite is assembled it holds
 * the rivers, the pigment veil and five regions' contributions, and it therefore fires wherever
 * that sum happens to be high. Measured, the old form lit 84% of the frame above luma 64 and was
 * the frame's base illumination rather than its highlight.
 *
 * The band is narrow because the rates it separates are close — primary 0.95 against secondary
 * 0.80, with everything else at 0.67 and below — so it holds the first and excludes the second by
 * four hundredths. There is deliberately no gain constant here any more: the quantity is already
 * `0..1`, and a gain on top of it is precisely how the response came to exceed one.
 */
const PRIMARY_CORE_INNER = 0.84;
const PRIMARY_CORE_OUTER = 0.95;

/** The bedding: how many layers along the course, and how fast they travel. */
const BEDDING_COUNT = 46;
const BEDDING_SHEAR = 9.0;
const BEDDING_RATE = 0.062;

/**
 * How strongly the bedding shows, and how much of it is colour versus shading.
 *
 * Split, because the two do different jobs. The colour contribution is what puts a
 * second and third hue into the frame — bone and grey-violet against the cobalt —
 * and the shading contribution is what gives the layering a direction the eye can
 * read as *flowing* rather than as striped. A bedding term that only recoloured
 * would read as a pattern laid on the water; one that only shaded would read as
 * corrugation. The brief's "directional bedding expressed through slow shear,
 * width variation and layer displacement" is both at once.
 */
const BEDDING_COLOUR = 0.34;
const BEDDING_SHADE = 0.30;

/**
 * The pale-pink deposition and the violet cut, as gains on the settle and scour
 * channels.
 *
 * Pink is the frame's only warm hue and it is rationed to point bars — the inside
 * of a bend, where material actually comes to rest. That rationing is the whole
 * reason it reads: a warm accent that appears wherever the field happens to be
 * high would be a tint, and the reference works all use their second hue in three
 * or four small places rather than as a gradient across the picture.
 */
const SETTLE_GAIN = 1.25;
const SCOUR_GAIN = 0.95;

/** How far the surface is pushed by the pointer's pressure channel, in world units. */
const PRESSURE_LIFT = 7.5;

/**
 * Distance over which the surface gives up its detail, and how much survives.
 *
 * The far field has to arrive at true black or the frame has no negative space —
 * the baseline measured a lit fraction of 1.00, which is what a frame with no
 * negative space looks like as a number. This is not a fade to the background
 * colour: it multiplies the whole term stack, so a distant feature settles into the
 * dark as a silhouette rather than washing out to grey.
 */
const DEPTH_FADE_NEAR = 620;
const DEPTH_FADE_FAR = 4200;

/** The gradient tap used for the normal response, in uv. One simulation texel is finer. */
const GRADIENT_EPSILON = 0.0035;

export type InkMaterialOptions = {
  /**
   * How much of the full term stack this surface carries.
   *
   * `1` is the hero corridor. The outer bed runs well under it, and this is the
   * knob that does it — a scalar on the whole response rather than a second material,
   * because the bed and the corridor have to agree about the field they are reading
   * or the two surfaces will disagree about where the water is at exactly the join
   * where the eye is looking.
   */
  readonly gain: number;
  /** Whether this surface is the hero. The bed never spends the narrative budget. */
  readonly hero: boolean;
};

export type InkMaterial = {
  readonly material: MeshBasicNodeMaterial;
  dispose(): void;
};

export function createInkMaterial(
  uniforms: FieldUniforms,
  ink: InkField,
  options: InkMaterialOptions,
): InkMaterial {
  const u = uniforms.uniforms;
  const material = new MeshBasicNodeMaterial();

  material.vertexColors = false;
  // Opaque. The negative space in this composition is *black surface* rather than
  // absence of surface, and that is a decision worth stating: a transparent corridor
  // would have to be sorted against the bed and the basin every frame, and the
  // sorting is what produces a visible seam where two alpha-tested sheets cross.
  // A surface whose colour goes to ink at the edges has no seam because there is
  // nothing to blend.
  material.transparent = false;
  material.depthWrite = true;

  // The world UV. `inkSurface` writes the world XZ normalised to the field's extent
  // into the mesh's uv attribute, so every sample below is a world sample and no
  // view or camera term can move the river.
  const coord = uv();

  // --- The field ---------------------------------------------------------------
  const advected = texture(ink.sampleTexture, coord);
  const body = advected.x;
  const scour = advected.y;
  const settle = advected.z;
  const pressure = advected.w;

  const authored = texture(ink.baseTexture, coord);
  const along = authored.w;

  const fluvial = texture(ink.fluvialTexture, coord);
  const speed = fluvial.z;
  const seedNoise = fluvial.w;

  /*
   * The primary river core, as a `0..1` mask.
   *
   * `speed` is `fluvial.z`, the static channel the bake writes before the regions, the basin and
   * the pigment veil are mixed in. Unlike the composite body it is a property of the rivers and
   * it cannot drift with the advection, and its value at a channel centre is essentially that
   * river's own flow rate - so the separated rates make it a usable selector. The live rates are
   * primary 0.95, secondary 0.80, then 0.67 and below; the band holds the first and excludes the
   * second by four hundredths.
   *
   * It is named for what it is. It encodes the *primary* course and nothing else, so it could not
   * be used to select an arbitrary route, and nothing should later assume it can.
   *
   * Defined here rather than beside the diagnostic that first proposed it, because the shipping
   * thalweg and the mode-13 view have to read the same node - two copies of one expression is how
   * a diagnostic and a frame come to disagree.
   */
  const primaryCore = smoothstep(
    float(PRIMARY_CORE_INNER),
    float(PRIMARY_CORE_OUTER),
    speed,
  );

  /**
   * The lateral coordinate.
   *
   * There is no across-the-channel UV, and inventing one would mean the geometry
   * had to know where the channel was — which is the ribbon this composition exists
   * to replace. `1 - body` is monotone in the distance from the channel's centre by
   * construction, so it *is* the lateral coordinate, expressed in the field's own
   * terms. Everything cross-channel in this file uses it, and none of it had to be
   * told where the water is.
   */
  const lateral = float(1).sub(body);

  /*
   * The normal response, from the field's own gradient.
   *
   * Four taps in the fragment stage rather than a normal attribute, because the
   * field changes every frame: an attribute would have to be rebuilt every frame to
   * stay true to it, which is a per-frame vertex sweep over a quarter of a million
   * vertices to compute something four texture fetches already know. The taps are
   * wider than one simulation texel so the normals describe the *pigment's* surface
   * rather than the simulation's grid — sampling at a texel would pick up the
   * diffusion kernel and the frame would look quilted.
   */
  /*
   * The scroll's four layer weights.
   *
   * This is the brief's act three made literal. As the story descends, the same density
   * field stops presenting itself as one surface and starts presenting itself as *material*:
   * the wide pigment, the directional bedding, the deposit granules and the narrative crest
   * each fade in and out on their own weight, so what the visitor sees is one field being
   * read four ways rather than four effects cross-fading.
   *
   * The alternative — swapping in different geometry, or spawning membranes partway down —
   * is explicitly what the brief forbids, and it is worth saying why it fails: a second
   * surface appearing is an *event*, and an event has a moment it starts. A weight changing
   * continuously has none.
   */
  const scrollLayers = u.uScrollLayers;
  const scrollPigment = scrollLayers.x;
  const scrollBedding = scrollLayers.y;
  const scrollSharpness = scrollLayers.z;
  const scrollGranules = scrollLayers.w;

  const offset = float(GRADIENT_EPSILON);
  const gradX = texture(ink.sampleTexture, coord.add(vec2(offset, 0))).x;
  const gradZ = texture(ink.sampleTexture, coord.add(vec2(0, offset))).x;
  const slopeRaw = vec2(gradX.sub(body), gradZ.sub(body)).div(offset);

  /*
   * The gradient, normalised to a unit direction.
   *
   * **This is a correction, and the failure it fixes was the frame's worst.** The
   * first version dotted `slopeRaw` straight into the key direction and clamped the
   * result. `slopeRaw` is a density difference divided by a 0.0035 UV offset, so its
   * magnitude is in the hundreds wherever the field has any gradient at all — which
   * is everywhere the composition lives. The dot product therefore exceeded the
   * clamp's ceiling on essentially every fragment, and `shade` sat at its maximum
   * across the entire picture. The measurable consequences were exactly what a
   * saturated constant predicts: the frame's value hierarchy came from the field
   * alone rather than from its shape, the pigment reached full cobalt everywhere
   * instead of only where the water is deepest, and the hue map came back one
   * unbroken cyan family at a mean saturation of 0.67.
   *
   * Normalising throws away the magnitude, which is right for a *lighting* term: what
   * a directional response needs is which way the surface turns, not how steep it is.
   * Steepness is already carried by the displacement and by the pigment ramp, and
   * counting it twice was what put the whole frame at one value.
   */
  const slopeMagnitude = slopeRaw.length().add(float(1e-4));
  const slope = slopeRaw.div(slopeMagnitude);

  // --- The 70% layer: pigment --------------------------------------------------
  //
  // A wide ramp and nothing sharp anywhere in it. `PIGMENT_RAMP` is the entire
  // reason the frame has soft boundaries: over this range of `body` the value moves
  // through the whole of its range, so the eye is given no contour to lock onto
  // until the thalweg below.
  // The ramp widened to the field it reads. It reached full pigment at a body of 0.62,
  // which is below where most of the world now sits, so the pigment term was saturated over
  // the majority of the frame and contributed nothing but a wash. Full pigment is now
  // reached only near the top of the range, which leaves the term somewhere to *do*.
  const pigment = smoothstep(float(0.06), float(0.92), body).mul(scrollPigment);
  /*
   * The wide layer *widens* with its weight rather than only brightening.
   *
   * The edge is a node, so the ramp's own threshold moves: at the hero's weight it reaches
   * to a density of 0.30 and at the decomposition's to 0.52, which is most of the field.
   * Brightening alone would make the wash brighter without making it broader, and
   * broadness is what the brief means by "wide pigment, blurred boundaries" — the failure
   * mode of a wash that is merely brighter is a frame that glows uniformly, which is the
   * measured failure of the baseline.
   */
  const pigmentWideEdge = float(0.3).add(scrollPigment.mul(0.22));
  const pigmentWide = smoothstep(float(0.0), pigmentWideEdge, body)
    .mul(0.55)
    .mul(scrollPigment.mul(0.45).add(0.55));

  /*
   * The base, from ink through cobalt into bone.
   *
   * `uInk` is the page's darkest value and the composition's floor. The ramp climbs out
   * of it into midnight, then reaches grey-violet and cobalt together, and only its last
   * fifth arrives at bone.
   *
   * **Two corrections are recorded here, in opposite directions, and the pair is the
   * whole reason the balance is written out rather than tuned silently.** The first
   * version took the densest pigment straight to cobalt with no neutral anywhere; the
   * captured frame came back one unbroken cyan family. The second took the densest
   * pigment to bone instead and cut cobalt's emission to a fifth; that frame came back
   * as greys and whites with no colour in it at all — the opposite failure, and the
   * vision pass named it in those words. What is below is the middle: cobalt owns the
   * *body* of the water, which is what the brief means by "restrained cobalt", and bone
   * is spent only on the thalweg and the bedding's lit faces — a small area, which is
   * the only way a neutral reads as substance rather than as a photograph of metal.
   */
  const baseColour = mix(
    mix(
      mix(mix(u.uInk, u.uMidnight, pigmentWide), u.uGreyViolet, pigment.mul(0.35)),
      u.uCobalt,
      pigment.mul(0.5).add(pigmentWide.mul(0.35)).min(1),
    ),
    u.uBone,
    smoothstep(float(0.82), float(1.0), pigment).mul(0.45),
  );
  const ambient = mix(u.uCobalt, u.uGreyViolet, pigment.mul(0.35));

  // --- The 20% layer: bedding ------------------------------------------------
  //
  // One phase, three modulations, all of them the brief's own list. `along` is the
  // arc-length coordinate, so the layers run *downstream* and keep their shape
  // through a bend; the lateral term shears them across the channel, which is the
  // helical secondary flow the simulation also models; and the speed term widens
  // them where the river runs fast, so a creek and an artery never show the same
  // pattern at the same scale.
  const shear = lateral.mul(BEDDING_SHEAR);
  const phase = along
    .mul(BEDDING_COUNT)
    .add(shear)
    .sub(u.uFlowPhase.mul(BEDDING_RATE).mul(speed.mul(2.4).add(0.6)));
  const bedding = phase.sin().mul(0.5).add(0.5);
  // Only inside the water. A bedding term that reached the dry ground would draw
  // the channel's edge as a contour, which is the one thing the 70% layer exists to
  // avoid.
  const beddingMask = smoothstep(float(0.10), float(0.52), body).mul(options.gain);
  const beddingTerm = bedding.mul(beddingMask).mul(scrollBedding);

  /*
   * Two hues alternating across the layers.
   *
   * Bone against grey-violet rather than bone against blue: the sediment's own
   * colour is warm and neutral, and putting a neutral against the cobalt is what
   * gives the frame its `near-grey` share — the baseline measured 0.04%, which is a
   * picture with no neutral material anywhere in it.
   */
  const bedColour = mix(u.uGreyViolet, u.uBone, bedding.pow(1.6));
  const withBedding = mix(
    baseColour,
    bedColour,
    beddingTerm.mul(BEDDING_COLOUR),
  );

  // --- Deposition and erosion, as colour ---------------------------------------
  //
  // The point bars and the cut banks. These are the same split the bake made when it
  // decided which bank of each bend each channel belonged on; here they are simply
  // spent, pink on the inside and violet-dark on the outside.
  const settleTerm = smoothstep(float(0.05), float(0.55), settle.mul(SETTLE_GAIN));
  const scourTerm = smoothstep(float(0.05), float(0.70), scour.mul(SCOUR_GAIN));
  const coloured = mix(withBedding, u.uPalePink, settleTerm.mul(0.30).mul(options.gain)).mul(
    float(1).sub(scourTerm.mul(0.34).mul(options.gain)),
  );

  // --- The 10% layer: the thalweg ----------------------------------------------
  //
  // `hero` gates this, and the gate is the point. The brief budgets one crisp
  // structure for the whole frame; a bed that also drew a thalweg would be a second
  // and third one wherever two rivers' corridors overlap, and a frame with three
  // crisp lines has none.
  const thalweg = options.hero
    // The primary core, and nothing else. It used to read the composite `body`, which is not a
    // centreline: it fires wherever the river, the veil and five regions together happen to be
    // high, which measured as 84% of the frame.
    ? primaryCore
    : float(0);

  /*
   * The pointer's pressure, the only other thing allowed to be sharp.
   *
   * Multiplied into the thalweg's own term rather than added beside it, so a drag
   * *intensifies the line that is already there* instead of drawing a second one.
   * That is the difference between a river answering the pointer and a highlight
   * being pasted over it.
   */
  /*
   * The deposit granules.
   *
   * A fine, high-frequency break-up of the settled areas only — gated on `settle` *and* on
   * the body, so it appears where material has actually come to rest rather than as a noise
   * texture over the whole frame. This is the brief's third decomposition element and the
   * one it warns about most directly: "a large number of evenly distributed particles" is
   * forbidden, and a granule field that were uniform in space would be exactly that however
   * small its dots. Gating it on deposition is what makes it a *deposit* rather than a
   * particle system.
   */
  const granule = mx_fractal_noise_float(
    vec3(positionLocal.x, positionLocal.z, u.uFlowPhase.mul(0.05)).mul(0.42),
    2,
    2.0,
    0.5,
  )
    .mul(0.5)
    .add(0.5);
  const granuleTerm = granule
    .mul(settleTerm)
    .mul(body)
    .mul(scrollGranules)
    .mul(0.55);

  const pressureTerm = pressure.mul(0.85).mul(options.gain);
  // The crest keeps a floor rather than scaling to zero: a scroll that removed it
  // entirely would leave the decomposition with no subject, because the thalweg is the
  // only thing in the frame that says which way the water runs.
  const sharpness = thalweg
    .mul(scrollSharpness.mul(0.7).add(0.3))
    .add(pressureTerm.mul(0.75))
    // Clamped before the power. Pressure is still free to shape a drag front, but it can no
    // longer push the total past the authored range - and it was the absence of this bound,
    // together with a gain of 1.45, that let a term meant to be a narrow highlight become the
    // frame's base illumination.
    .clamp(0, 1);

  // --- The shading response ----------------------------------------------------
  //
  // The field's gradient against a key direction. `seedNoise` supplies the slow
  // cross-channel tilt, which is what keeps the response from being a pure
  // north-light: a landscape lit from exactly one direction is readable, and one lit
  // from a direction that drifts with its own pigment is *sculptural*.
  const keyX = float(-0.86);
  const keyZ = float(0.24);
  const tilt = seedNoise.sub(0.5).mul(1.6);
  const response = slope.x.mul(keyX).add(slope.y.mul(keyZ.add(tilt)));
  // A unit direction dotted with a unit key direction is in -1..1, so this is a
  // genuine ±0.5 swing about 0.75 rather than a clamp that everything reaches. The
  // floor keeps a surface turned fully away from the key readable as a shape rather
  // than as a hole, which is the same trade the previous composition's baked
  // orientation luminance made.
  const shade = clamp(response.mul(0.5).add(0.75), 0.25, 1.25);

  /*
   * The bedding's shading contribution.
   *
   * Signed, so the layers have a lit face and a shadowed one, which is what makes
   * them read as *layer displacement* rather than as stripes. A symmetric
   * `sin`-squared term would give the frame a corrugated texture with no direction,
   * and direction is the whole content of the 20% layer.
   */
  const bedShade = float(1).add(bedding.sub(0.5).mul(BEDDING_SHADE).mul(beddingMask));
  const lit = shade.mul(bedShade);

  // --- Emission ----------------------------------------------------------------
  //
  // Where the picture actually gets its light. Everything above is what the surface
  // *is*; this is what it sends back, and it is stacked from the wide pigment up to
  // the narrow crest so that the frame's value hierarchy is built from the same
  // field as everything else.
  //
  // `sharpness` is applied last and hardest, because the 10% is meant to be worth
  // ten percent: a crest that was merely a little brighter than the wash would not
  // be a crest.
  const pigmentGlow = pigment.pow(1.25).mul(u.uActivity.mul(0.35).add(0.30));

  /*
   * The emission, as three named terms and their sum.
   *
   * **These are split out for the diagnostic, and the split has to be the only place the
   * formulas live.** The first version of the debug views re-typed the expressions instead of
   * referencing them, and immediately drifted: the view for "emission without settle" was
   * written with a pigment gain of 0.4 while the shipping emission had moved to 0.3, so a view
   * whose entire purpose was to be a term-for-term difference from the real frame was quietly
   * measuring a different formula. Nothing failed, because a re-typed expression that is
   * slightly wrong still renders a plausible picture - which is exactly the kind of error the
   * instrument exists to prevent, and it was in the instrument.
   *
   * So the rule for anything added here is that `emission` is the sum of these three and that
   * every view references them. A view may scale, mask or reinterpret a term; it may not restate
   * one.
   */
  const pigmentEmission = pigmentGlow.mul(ambient).mul(0.3);
  const sharpnessEmission = u.uBone.mul(sharpness.pow(1.35));
  const settleEmission = u.uPalePink
    .mul(settleTerm.mul(1.15))
    .mul(u.uActivity.mul(0.4).add(0.5));

  const emission = pigmentEmission.add(sharpnessEmission).add(settleEmission);

  const surface = coloured
    .mul(lit)
    // Granules *cut* as well as light: a deposit is broken material, so it should read as
    // interruption in the surface rather than as more brightness on top of it.
    .mul(float(1).sub(granuleTerm.mul(0.45)))
    .mul(options.gain)
    .add(emission.mul(options.gain))
    .add(u.uBone.mul(granuleTerm).mul(0.18));

  // --- Depth -------------------------------------------------------------------
  //
  // Multiplied through the whole stack rather than applied as a mix toward a
  // background colour, so a distant feature keeps its contrast against its own
  // neighbourhood while the neighbourhood itself goes dark. A fade toward a single
  // colour flattens everything at range into one value, which is what makes a far
  // field look fogged rather than deep.
  const distance = positionLocal.sub(cameraPosition).length();
  const depthFade = smoothstep(float(DEPTH_FADE_NEAR), float(DEPTH_FADE_FAR), distance)
    .oneMinus()
    // Raised from 0.12 for a world that was half clipped, then lowered back once the far
    // plane was fixed and the far field began actually being drawn. The floor is what
    // decides whether the distance settles into ink or into grey, and grey at the frame
    // edges is what removes the negative space the whole composition is built on.
    .mul(0.86)
.add(0.14);

  /*
   * The diagnostic views.
   *
   * Two of these exist because the frame is bright and the cause has to be bisected rather
   * than argued: `surface without emission` and `emission only`, against `final`, separate the
   * shaded body of the material from what it emits. Two more separate the emission into its
   * settle part and the rest, because the settle term is the strongest remaining suspect and
   * it is used twice — once in the base colour and once in the emission.
   */
  const modeIs = (n: number) =>
    u.uDebugMode.sub(float(n)).abs().lessThan(float(0.5)).select(float(1), float(0));

  // The shaded surface with the emission removed, reconstructed rather than stored, so this
  // view and the real one cannot drift apart: if the surface expression changes, this changes
  // with it or fails to compile.
  const surfaceNoEmission = coloured
    .mul(lit)
    .mul(float(1).sub(granuleTerm.mul(0.45)))
    .mul(options.gain)
    .add(u.uBone.mul(granuleTerm).mul(0.18));

  /*
   * Every contribution view is scaled by the same `gain` and the same `depthFade` the real
   * frame applies, and that is not cosmetic: without them a view would be a different picture
   * from `final` for reasons that have nothing to do with the term under examination, and the
   * comparison the bisection rests on would not hold.
   */

  let resolved = surface.mul(depthFade);
  resolved = mix(resolved, vec3(body).mul(options.gain).mul(depthFade), modeIs(1));
  resolved = mix(resolved, vec3(scour).mul(options.gain).mul(depthFade), modeIs(2));
  resolved = mix(resolved, vec3(settle).mul(options.gain).mul(depthFade), modeIs(3));
  resolved = mix(resolved, vec3(pressure).mul(options.gain).mul(depthFade), modeIs(4));
  resolved = mix(resolved, coloured.mul(options.gain).mul(depthFade), modeIs(5));
  resolved = mix(resolved, emission.mul(options.gain).mul(depthFade), modeIs(6));
  resolved = mix(resolved, surfaceNoEmission.mul(depthFade), modeIs(7));
  resolved = mix(resolved, settleEmission.mul(options.gain).mul(depthFade), modeIs(8));
  resolved = mix(resolved, vec3(depthFade), modeIs(9));
  // Referenced, never restated: see the note on the emission terms for what happened the first
  // time this was written out by hand.
  resolved = mix(resolved, pigmentEmission.add(sharpnessEmission).mul(options.gain).mul(depthFade), modeIs(10));
  resolved = mix(resolved, pigmentEmission.mul(options.gain).mul(depthFade), modeIs(11));
  resolved = mix(resolved, sharpnessEmission.mul(options.gain).mul(depthFade), modeIs(12));

  /*
   * Mode 13 - the primary-core band.
   *
   * This is the node the shipping thalweg reads: `primaryCore` is defined once, beside the
   * fluvial sample, and both this view and the material's own 10% layer take it from there. The
   * view exists to check the *candidate* in isolation - one continuous primary path, no large
   * regions lit, no second highlight on the secondary - and it stays after the replacement
   * because that check remains worth being able to repeat.
   */
  resolved = mix(resolved, vec3(primaryCore).mul(depthFade), modeIs(13));

  material.colorNode = resolved;

  // --- Displacement -------------------------------------------------------------
  //
  // The surface, moved by the same channels the fragment stage is reading. In the
  // vertex stage the field is sampled with the vertex's own world UV, so the mesh
  // and the shading agree about the shape by construction — there is no second
  // height function for them to disagree about.
  const vertexAdvected = texture(ink.sampleTexture, coord);
  const vertexHeight = vertexAdvected.z
    .mul(SETTLE_HEIGHT)
    .sub(vertexAdvected.y.mul(SCOUR_DEPTH))
    .add(vertexAdvected.x.pow(2).mul(BODY_RELIEF))
    // Capped at one, independently of the channel ceiling. The lift is the term that
    // produced visible spikes, and a spike is the kind of failure the eye finds instantly
    // while a merely-too-large value is one nobody notices until it is drawn.
    .add(vertexAdvected.w.min(1).mul(PRESSURE_LIFT));
  material.positionNode = positionLocal.add(vec3(0, vertexHeight, 0));

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}

/**
 * The veil: the same field, read as atmosphere.
 *
 * A second surface carrying the *same* density, lifted above the ground and drawn
 * translucent, so the composition gains a depth cue that a single near-top-down
 * surface cannot have. When the camera moves — and during the scroll it moves a
 * long way — the veil slides across the ground at a different rate, and that
 * difference is the only parallax available in a frame with no horizon.
 *
 * It is deliberately built from the same field and the same UV as the ground, with
 * no term of its own except a gain and a height. The brief permits membranes that
 * are "a derived expression of the density field" and forbids the alternative; the
 * way that distinction is kept is by making this function unable to see anything
 * the ground cannot. If a future revision gives the veil a term of its own, the two
 * surfaces stop agreeing about the world and the frame becomes two effects again.
 */
export type VeilMaterialOptions = {
  /** World Y the sheet floats at. */
  readonly height: number;
  readonly gain: number;
};

export function createVeilMaterial(
  uniforms: FieldUniforms,
  ink: InkField,
  options: VeilMaterialOptions,
): InkMaterial {
  const u = uniforms.uniforms;
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  // Depth *testing* stays on so the ground occludes the veil where the ground is
  // nearer; depth *writing* is off because two translucent sheets must not punch
  // holes in each other.
  material.depthWrite = false;
  material.toneMapped = false;

  const coord = uv();
  const advected = texture(ink.sampleTexture, coord);
  const body = advected.x;

  // The veil's own copy of the pigment ramp, narrower than the ground's and squared,
  // because the veil's whole risk is flooding the frame: at a wide ramp its opacity
  // floor reached everywhere the field was even slightly non-zero, which is most of
  // the picture, and the negative space the composition depends on disappeared under
  // a uniform wash.
  const wash = smoothstep(float(0.10), float(0.92), body).pow(1.6);
  const colour = mix(
    mix(u.uInk, u.uGreyViolet, wash.mul(0.40)),
    u.uBone,
    wash.mul(0.14),
  );

  material.colorNode = colour.mul(options.gain);
  // Opacity is the wash itself, squared, so the veil is invisible over black ground
  // and present over the river. A veil with a floor of opacity would grey the whole
  // frame, which is precisely the uniformly-lit failure the baseline measured at a
  // lit fraction of 1.00 — and it would be reached here from the atmospheric side
  // rather than the emissive one.
  // Halved. The veil covers the entire world extent, so its gain is a statement about how
  // bright the *whole frame* is, not about a feature in it. At 0.42 it was doing what the
  // brief forbids by name: a uniform wash over everything.
  material.opacityNode = wash.pow(1.7).mul(options.gain).mul(0.2);
  material.positionNode = positionLocal.add(vec3(0, options.height, 0));

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}
