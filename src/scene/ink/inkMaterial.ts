import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
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
import { RIPPLE_PROFILE } from './rippleProfile';

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
const SCOUR_DEPTH = 5.2;
const SETTLE_HEIGHT = 3.4;

/**
 * The relief that rides on the body itself.
 *
 * Small relative to the cut, because this is the *shoulder* rather than the
 * channel: it is what gives the pigment's outer reaches a surface to catch, so the
 * 70% layer is not a flat decal on a flat plane. Without it the composition's
 * largest area is its flattest, which is the exact failure the previous stage's
 * own review brief named as its main remaining risk.
 */
const BODY_RELIEF = 1.6;

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
const BEDDING_COUNT = 19;
const BEDDING_SHEAR = 5.4;
const BEDDING_RATE = 0.038;

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
const BEDDING_COLOUR = 0.30;
const BEDDING_SHADE = 0.28;

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
  /*
   * This used to be opaque because the scene contained several independently generated
   * corridor and basin meshes. That topology is gone: there is now one hero surface and one
   * atmospheric veil, with explicit render order. Keeping the obsolete opaque treatment made
   * the grid's rectangular extent the largest shape in every frame, regardless of what the
   * density field was doing.
   *
   * The surface now blends out through a field-derived coverage below. Depth writing is off so
   * fragments whose ink has dispersed cannot occlude the veil or the background. There is no
   * transparent-surface intersection to sort any more, so the old seam risk no longer exists.
   */
  material.transparent = true;
  material.depthWrite = false;
  // Direct manipulation can briefly fold the density sheet past a grazing view.
  // It is a membrane, not solid terrain: culling its reverse face creates a black
  // portal-shaped hole exactly where the visitor expects a continuous ripple.
  material.side = DoubleSide;
  material.toneMapped = false;

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
  const flowTangent = fluvial.xy;
  const flowNormal = vec2(flowTangent.y.negate(), flowTangent.x);
  const routePresence = smoothstep(float(0.025), float(0.72), speed);

  /*
   * Optical density, not decorative grain. These folds are evaluated before the
   * colour ramps because they decide where suspended pigment actually exists. A
   * uniform high-density corridor is a ribbon regardless of how softly it is
   * shaded; multiplying the density by two coherent scales creates transparent
   * pockets, heavy blooms and torn margins inside that same course.
   */
  const inkFold = mx_fractal_noise_float(
    vec3(positionLocal.x, positionLocal.z, u.uFlowPhase.mul(0.045)).mul(0.0052),
    3,
    2.0,
    0.52,
  )
    .mul(0.5)
    .add(0.5);
  const edgeNoise = mx_fractal_noise_float(
    vec3(positionLocal.x, positionLocal.z, u.uFlowPhase.mul(0.018)).mul(0.013),
    4,
    2.08,
    0.54,
  )
    .mul(0.5)
    .add(0.5);

  /*
   * The optical body is intentionally wider than the simulation body.
   *
   * A river advects along a narrow numerical corridor so the state stays stable. Rendering that
   * exact sample made the computation look like a ribbon mesh. These four broad taps are the
   * suspended pigment around that corridor: the simulation remains precise, while its visible
   * medium diffuses laterally like ink in water. The centre sample keeps the shape coherent and
   * the neighbours soften it without inventing a second route.
   */
  const innerTap = float(0.018);
  const outerTap = float(0.058);
  const tangentTap = float(0.022);
  /*
   * The wash must not be a Gaussian blur of the route. Symmetric taps preserve the
   * corridor's silhouette exactly, so even a very soft result still reads as a tube.
   * This slowly varying bias gives each reach a windward and a lee side. The taps
   * remain samples of the same advected field, but their reach and contribution are
   * deliberately unequal: pigment blooms into shelves and then thins back into the
   * course instead of producing two parallel banks.
   */
  const plumeBias = along
    .mul(8.5)
    .add(seedNoise.mul(5.8))
    .sub(u.uFlowPhase.mul(0.035))
    .sin()
    .mul(0.5)
    .add(0.5);
  const bodyInner = body
    .mul(0.44)
    .add(texture(ink.sampleTexture, coord.add(flowNormal.mul(innerTap))).x.mul(0.20))
    .add(texture(ink.sampleTexture, coord.sub(flowNormal.mul(innerTap))).x.mul(0.20))
    .add(texture(ink.sampleTexture, coord.add(flowTangent.mul(tangentTap))).x.mul(0.08))
    .add(texture(ink.sampleTexture, coord.sub(flowTangent.mul(tangentTap))).x.mul(0.08));
  const leftReach = outerTap.mul(plumeBias.mul(0.82).add(0.74));
  const rightReach = outerTap.mul(plumeBias.oneMinus().mul(0.82).add(0.74));
  const leftOuter = texture(
    ink.sampleTexture,
    coord.add(flowNormal.mul(leftReach)).add(flowTangent.mul(outerTap.mul(0.26))),
  ).x;
  const rightOuter = texture(
    ink.sampleTexture,
    coord.sub(flowNormal.mul(rightReach)).sub(flowTangent.mul(outerTap.mul(0.18))),
  ).x;
  const leftPlume = texture(
    ink.sampleTexture,
    coord
      .add(flowNormal.mul(outerTap.mul(1.72)))
      .sub(flowTangent.mul(outerTap.mul(0.34))),
  ).x;
  const rightPlume = texture(
    ink.sampleTexture,
    coord
      .sub(flowNormal.mul(outerTap.mul(1.54)))
      .add(flowTangent.mul(outerTap.mul(0.42))),
  ).x;
  const bodyMist = bodyInner
    .mul(0.36)
    .add(leftOuter.mul(plumeBias.mul(0.13).add(0.14)))
    .add(rightOuter.mul(plumeBias.oneMinus().mul(0.13).add(0.14)))
    .add(leftPlume.mul(plumeBias.mul(0.09).add(0.035)))
    .add(rightPlume.mul(plumeBias.oneMinus().mul(0.09).add(0.035)))
    .add(texture(ink.sampleTexture, coord.add(flowTangent.mul(outerTap.mul(0.78)))).x.mul(0.05))
    .add(texture(ink.sampleTexture, coord.sub(flowTangent.mul(outerTap.mul(0.64)))).x.mul(0.04));
  const opticalFold = inkFold
    .mul(0.58)
    .add(edgeNoise.mul(0.28))
    .add(plumeBias.mul(0.14));
  const opticalBody = bodyInner.mul(opticalFold.mul(0.92).add(0.12));
  const opticalMist = bodyMist.mul(opticalFold.mul(1.08).add(0.06));

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

  /*
   * A soft support around the primary core.
   *
   * The static speed field is intentionally narrow enough to identify the primary route, but
   * drawing that one sample directly produced a bright raster-width tube. Four neighbouring
   * samples turn the same semantic route into an optical density: the centre remains precise,
   * while its energy can disperse into the surrounding medium. Secondary routes stay excluded
   * because every tap still uses the primary-only speed threshold.
   */
  const coreTap = float(0.012);
  const primaryHalo = primaryCore
    .add(
      smoothstep(
        float(PRIMARY_CORE_INNER),
        float(PRIMARY_CORE_OUTER),
        texture(ink.fluvialTexture, coord.add(vec2(coreTap, 0))).z,
      ),
    )
    .add(
      smoothstep(
        float(PRIMARY_CORE_INNER),
        float(PRIMARY_CORE_OUTER),
        texture(ink.fluvialTexture, coord.sub(vec2(coreTap, 0))).z,
      ),
    )
    .add(
      smoothstep(
        float(PRIMARY_CORE_INNER),
        float(PRIMARY_CORE_OUTER),
        texture(ink.fluvialTexture, coord.add(vec2(0, coreTap))).z,
      ),
    )
    .add(
      smoothstep(
        float(PRIMARY_CORE_INNER),
        float(PRIMARY_CORE_OUTER),
        texture(ink.fluvialTexture, coord.sub(vec2(0, coreTap))).z,
      ),
    )
    .div(5);
  const primaryRim = primaryHalo.sub(primaryCore.mul(0.58)).clamp(0, 1);

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
  const pressureGradX = texture(ink.sampleTexture, coord.add(vec2(offset, 0))).w;
  const pressureGradZ = texture(ink.sampleTexture, coord.add(vec2(0, offset))).w;
  const pressureEdge = smoothstep(
    float(0.003),
    float(0.07),
    vec2(pressureGradX.sub(pressure), pressureGradZ.sub(pressure)).length(),
  );

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
  const pigment = smoothstep(float(0.035), float(0.84), opticalBody).mul(scrollPigment);
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
  const pigmentWide = smoothstep(float(0.006), pigmentWideEdge, opticalMist)
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
  const pigmentColour = mix(
    mix(
      mix(u.uInk, u.uHaze, pigmentWide.pow(0.72).mul(0.82)),
      u.uDeep,
      pigment.mul(0.48),
    ),
    u.uCobalt,
    pigment.pow(1.38).mul(0.50).add(pigmentWide.mul(0.22)).min(1),
  );
  // The primary course is a cut through luminous suspension, not a coloured road.
  // Darkening its centre and reserving light for the displaced rims gives it depth
  // without returning to a tube or a white spline.
  const coreChannel = primaryCore.mul(pigment).pow(0.82);
  const baseColour = mix(
    mix(pigmentColour, u.uSpectral, routePresence.mul(0.055)),
    u.uInk,
    coreChannel.mul(0.18),
  );
  const ambient = mix(u.uDeep, u.uHaze, pigment.mul(0.64));

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
  const flowFilament = smoothstep(float(0.70), float(0.96), bedding)
    .mul(beddingMask.pow(1.15))
    .mul(scrollBedding);

  /*
   * Two hues alternating across the layers.
   *
   * Bone against grey-violet rather than bone against blue: the sediment's own
   * colour is warm and neutral, and putting a neutral against the cobalt is what
   * gives the frame its `near-grey` share — the baseline measured 0.04%, which is a
   * picture with no neutral material anywhere in it.
   */
  const bedColour = mix(u.uGreyViolet, u.uSpectral, bedding.pow(1.8).mul(0.72));
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
  const coloured = mix(withBedding, u.uPalePink, settleTerm.mul(0.14).mul(options.gain)).mul(
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

  const pressureTerm = pressure
    .mul(pressureEdge.pow(0.45))
    .mul(0.58)
    .mul(options.gain);
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
  const shade = clamp(response.mul(0.10).add(0.86), 0.72, 0.98);

  /*
   * Low-frequency folds, evaluated on the GPU in world space.
   *
   * These are not decorative noise laid over the frame. They only modulate density that is
   * already present and therefore travel with the same river, deposits and region bodies as the
   * rest of the material. Their scale is deliberately much larger than a simulation texel: the
   * result is the slow clouding and feathering of suspended ink, not grain.
   */
  const basinDistance = vec2(positionLocal.x, positionLocal.z)
    .sub(vec2(u.uBasinCentre.x, u.uBasinCentre.z))
    .length();
  const basinAura = smoothstep(float(55), float(360), basinDistance)
    .oneMinus()
    .mul(body.pow(0.62));
  const basinPhase = inkFold
    .mul(0.72)
    .add(edgeNoise.mul(0.28))
    .add(seedNoise.mul(0.16));
  const basinInterference = smoothstep(
    float(0.63),
    float(0.91),
    basinPhase,
  )
    .mul(basinAura.pow(1.28))
    .mul(scrollBedding.mul(0.6).add(0.4));

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
   * The emission, as four named terms and their sum.
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
  const pigmentEmission = pigmentGlow
    .mul(ambient)
    .mul(0.64)
    .add(
      mix(u.uDeep, u.uCobalt, inkFold.mul(0.46))
        .mul(pigmentWide.pow(0.78))
        .mul(inkFold.mul(0.24).add(0.18)),
    )
    .add(
      mix(u.uDeep, u.uSpectral, bedding.pow(1.7))
        .mul(beddingTerm.pow(1.35))
        .mul(0.16),
    )
    .add(
      mix(u.uCobalt, u.uSpectral, bedding)
        .mul(flowFilament.pow(1.5))
        .mul(routePresence.pow(0.72))
        .mul(0.15),
    )
    .add(mix(u.uDeep, u.uHaze, inkFold).mul(basinAura).mul(0.16))
    .add(
      mix(u.uSpectral, u.uPalePink, inkFold.mul(0.18))
        .mul(basinInterference)
        .mul(0.26),
    );

  /*
   * The primary route is a flow inside ink, not a self-luminous pipe.
   *
   * `coreDrift` never turns the route off; it only moves a restrained intensity envelope down
   * its length. The wider halo carries cobalt/spectral energy continuously, while a much smaller
   * inner response is allowed to approach bone for a moment. This keeps direction legible without
   * breaking the route into beads or spending the frame's brightest value along its entire span.
   */
  const coreDrift = along
    .mul(17)
    .sub(u.uFlowPhase.mul(0.12))
    .add(seedNoise.sub(0.5).mul(1.8))
    .sin()
    .mul(0.5)
    .add(0.5);
  const coreBreath = coreDrift.mul(0.24).add(0.76);
  const coreGlint = smoothstep(float(0.72), float(0.98), coreDrift)
    .mul(primaryCore.pow(1.8))
    .mul(sharpness);
  const sharpnessEmission = mix(u.uSpectral, u.uFlow, coreBreath.mul(0.58))
    .mul(primaryRim.pow(0.72))
    .mul(coreBreath)
    .mul(0.14)
    .add(mix(u.uFlow, u.uBone, float(0.12)).mul(coreGlint).mul(0.18));
  const settleEmission = u.uPalePink
    .mul(settleTerm.mul(0.26))
    .mul(u.uActivity.mul(0.4).add(0.5));
  const pressureWave = pressure
    .mul(RIPPLE_PROFILE.phaseFrequency)
    .sub(u.uFlowPhase.mul(RIPPLE_PROFILE.phaseRate))
    .sin()
    .mul(0.5)
    .add(0.5);
  const pressureEnvelope = smoothstep(float(0.008), float(0.34), pressure).pow(0.52);
  // Break the pressure wave against the same granular tissue that shapes the river.
  // A perfectly closed contour reads as a synthetic ring; this uneven mask leaves a
  // calligraphic compression front with gaps, forks and softer trailing fragments.
  const rippleTexture = edgeNoise.pow(1.7).mul(0.64).add(0.18);
  const rippleCrest = smoothstep(
    float(RIPPLE_PROFILE.crestStart),
    float(RIPPLE_PROFILE.crestEnd),
    pressureWave,
  )
    .mul(pressureEnvelope)
    .mul(opticalFold.pow(1.35).mul(0.68).add(0.12))
    .mul(rippleTexture);
  const rippleRebound = smoothstep(
    float(RIPPLE_PROFILE.reboundStart),
    float(RIPPLE_PROFILE.reboundEnd),
    pressureWave.oneMinus(),
  )
    .mul(pressureEnvelope.pow(1.18))
    .mul(pressureEdge.mul(0.28).oneMinus())
    .mul(opticalFold.mul(0.52).add(0.30))
    .mul(rippleTexture.mul(0.72));
  const leadingColour = mix(u.uFlow, u.uSpectral, float(RIPPLE_PROFILE.leadingHueMix));
  const trailingColour = mix(
    u.uCobalt,
    u.uPalePink,
    float(RIPPLE_PROFILE.trailingHueMix),
  );
  const interactionEmission = mix(u.uFlow, leadingColour, pressureEdge.mul(0.72))
    .mul(pressure.pow(0.58))
    .mul(pressureEdge.pow(0.65))
    .mul(RIPPLE_PROFILE.edgeEmissionGain)
    .add(leadingColour.mul(rippleCrest).mul(RIPPLE_PROFILE.chromaticGain))
    .add(trailingColour.mul(rippleRebound).mul(RIPPLE_PROFILE.chromaticGain * 0.38))
    .add(
      mix(u.uDeep, leadingColour, float(RIPPLE_PROFILE.interiorHueMix))
        .mul(pressure.pow(0.88))
        .mul(opticalFold.mul(0.30).add(0.70))
        .mul(RIPPLE_PROFILE.interiorGain),
    );

  const emission = pigmentEmission
    .add(sharpnessEmission)
    .add(settleEmission)
    .add(interactionEmission);

  const shadedSurface = coloured
    .mul(lit)
    // Granules *cut* as well as light: a deposit is broken material, so it should read as
    // interruption in the surface rather than as more brightness on top of it.
    .mul(float(1).sub(granuleTerm.mul(0.45)))
    .mul(options.gain)
    .mul(2.28)
    .add(emission.mul(options.gain))
    .add(u.uBone.mul(granuleTerm).mul(0.18));
  const surface = shadedSurface.add(
    mix(u.uCobalt, leadingColour, float(0.72))
      .mul(pressureEnvelope.pow(0.84))
      // The broad membrane fill must remain continuous. Granular modulation is
      // reserved for the wave crests; cutting the fill with it turns the dense
      // brush centre into a black capsule against a bright rim.
      .mul(opticalFold.mul(0.24).add(0.76))
      .mul(RIPPLE_PROFILE.surfaceTintGain),
  );

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
   * Field coverage: the geometry remains one watertight grid, but only the part of that grid
   * carrying computation is optically present. This is the missing distinction between a
   * continuous simulation domain and a visible rectangular plate.
   *
   * The primary halo contributes enough coverage to keep the hero route continuous even where
   * advection has made `body` temporarily thin. Everything else must earn opacity from body,
   * erosion, deposition or live pressure. A UV feather is a final guard against exposing the
   * finite simulation boundary when the camera sees the world's corners.
   */
  const fieldPresence = routePresence
    .mul(0.055)
    .add(opticalMist.mul(0.62))
    .add(opticalBody.mul(0.035))
    .add(settle.mul(0.045))
    .add(scour.mul(0.035))
    .add(primaryHalo.mul(0.025))
    .add(basinAura.mul(0.065));
  const erodedPresence = fieldPresence.add(edgeNoise.sub(0.5).mul(0.16));
  const densityCoverage = smoothstep(float(0.018), float(0.86), erodedPresence).pow(1.08);
  const cloudGate = smoothstep(
    float(0.24),
    float(0.78),
    opticalFold.add(opticalMist.mul(0.12)),
  );
  const edgeDistance = coord.x
    .min(coord.y)
    .min(float(1).sub(coord.x))
    .min(float(1).sub(coord.y));
  const worldFeather = smoothstep(float(0), float(0.055), edgeDistance);
  const ambientCoverage = densityCoverage
    .mul(worldFeather)
    .mul(depthFade.pow(0.35))
    .mul(opticalFold.mul(0.82).add(0.16))
    .mul(cloudGate.mul(0.78).add(0.22))
    .mul(pigment.mul(0.12).add(0.78))
    .clamp(0, 0.54);
  /*
   * Direct manipulation has its own optical presence. Previously pressure was
   * added before the idle cloud gate and then multiplied by that gate, so a drag
   * over dark water was simulated correctly but made optically invisible. The
   * visitor's disturbance is allowed to reveal dormant field: it still comes from
   * the same pressure channel, diffusion and decay, but it does not need authored
   * pigment underneath it to exist on screen.
   */
  // Pressure never changes the base sheet's opacity. Ordinary alpha blending
  // made its soft edge brighter than its centre and therefore drew a dark oval
  // even when every pressure colour term was blue. The additive ripple material
  // below owns the visitor response; this surface remains the river underneath.
  const coverage = ambientCoverage;

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
  resolved = mix(
    resolved,
    pigmentEmission
      .add(sharpnessEmission)
      .add(interactionEmission)
      .mul(options.gain)
      .mul(depthFade),
    modeIs(10),
  );
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
  // Diagnostic modes describe scalar fields over the complete simulation domain. They bypass
  // the shipping coverage so an empty channel cannot become indistinguishable from no geometry.
  const diagnostic = smoothstep(float(0.5), float(1), u.uDebugMode);
  material.opacityNode = mix(coverage, float(1), diagnostic);

  // --- Displacement -------------------------------------------------------------
  //
  // The surface, moved by the same channels the fragment stage is reading. In the
  // vertex stage the field is sampled with the vertex's own world UV, so the mesh
  // and the shading agree about the shape by construction — there is no second
  // height function for them to disagree about.
  const vertexAdvected = texture(ink.sampleTexture, coord);
  const vertexPressure = vertexAdvected.w.min(1);
  const vertexPressureEnvelope = smoothstep(float(0.008), float(0.34), vertexPressure).pow(0.62);
  // Only the moving front displaces the sheet. Raising the complete pressure
  // body makes a convex oval which occludes the river and reads as a portal.
  const vertexPressureFront = vertexPressureEnvelope.mul(pressureEdge.pow(0.72));
  const vertexElasticWave = vertexPressure
    .mul(RIPPLE_PROFILE.phaseFrequency)
    .sub(u.uFlowPhase.mul(RIPPLE_PROFILE.phaseRate))
    .sin()
    .mul(vertexPressureFront)
    .mul(RIPPLE_PROFILE.reboundAmplitude);
  const vertexHeight = vertexAdvected.z
    .mul(SETTLE_HEIGHT)
    .sub(vertexAdvected.y.mul(SCOUR_DEPTH))
    .add(vertexAdvected.x.pow(2).mul(BODY_RELIEF))
    // Capped at one, independently of the channel ceiling. The lift is the term that
    // produced visible spikes, and a spike is the kind of failure the eye finds instantly
    // while a merely-too-large value is one nobody notices until it is drawn.
    .add(vertexPressureFront.mul(RIPPLE_PROFILE.pressureLift))
    .add(vertexElasticWave);
  material.positionNode = positionLocal.add(vec3(0, vertexHeight, 0));

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}

/**
 * The direct-manipulation crest, separated from the river's alpha.
 *
 * Additive blending is a structural choice here: a pressure response may add a
 * blue-violet compression front, but it can never write a black centre into the
 * river. The main material still receives the advected body/scour/settle changes;
 * this pass contributes only the thin optical event on top of that physical wake.
 */
export function createRippleMaterial(
  uniforms: FieldUniforms,
  ink: InkField,
): InkMaterial {
  const u = uniforms.uniforms;
  const material = new MeshBasicNodeMaterial();
  material.name = 'ink-ripple-front';
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;
  material.toneMapped = false;

  const coord = uv();
  const advected = texture(ink.sampleTexture, coord);
  const pressure = advected.w.min(1);
  const offset = float(GRADIENT_EPSILON);
  const pressureDx = texture(ink.sampleTexture, coord.add(vec2(offset, 0))).w.sub(pressure);
  const pressureDz = texture(ink.sampleTexture, coord.add(vec2(0, offset))).w.sub(pressure);
  const pressureGradient = vec2(pressureDx, pressureDz);
  const pressureEdge = smoothstep(float(0.003), float(0.07), pressureGradient.length());
  const envelope = smoothstep(float(0.008), float(0.34), pressure).pow(0.58);

  const fluvial = texture(ink.fluvialTexture, coord);
  const tangent = fluvial.xy;
  const signedFront = pressureGradient.x.mul(tangent.x).add(pressureGradient.y.mul(tangent.y));
  const leading = smoothstep(float(-0.018), float(0.045), signedFront)
    .mul(0.78)
    .add(0.22);
  const torn = mx_fractal_noise_float(
    vec3(positionLocal.x, positionLocal.z, u.uFlowPhase.mul(0.025)).mul(0.021),
    3,
    2.05,
    0.52,
  )
    .mul(0.5)
    .add(0.5)
    .pow(1.35)
    .mul(0.82)
    .add(0.08);
  const wave = pressure
    .mul(RIPPLE_PROFILE.phaseFrequency)
    .sub(u.uFlowPhase.mul(RIPPLE_PROFILE.phaseRate))
    .sin()
    .mul(0.5)
    .add(0.5);
  // The crest changes hue slowly along its length, like thin-film colour in a
  // moving sheet. This is intentionally not another outline: it modulates one
  // pressure front, so the gesture keeps a single calligraphic silhouette.
  const spectralDrift = positionLocal.x
    .mul(0.0105)
    .sub(positionLocal.z.mul(0.0075))
    .add(fluvial.w.mul(4.2))
    .sub(u.uFlowPhase.mul(0.07))
    .sin()
    .mul(0.5)
    .add(0.5);
  const crest = smoothstep(
    float(RIPPLE_PROFILE.crestStart),
    float(RIPPLE_PROFILE.crestEnd),
    wave,
  )
    .mul(envelope)
    .mul(pressureEdge.pow(0.52))
    .mul(leading)
    .mul(torn);
  const rebound = smoothstep(
    float(RIPPLE_PROFILE.reboundStart),
    float(RIPPLE_PROFILE.reboundEnd),
    wave.oneMinus(),
  )
    .mul(envelope.pow(1.12))
    .mul(pressureEdge.pow(0.72))
    .mul(leading.oneMinus().mul(0.52).add(0.08))
    .mul(torn);

  const leadingHue = float(RIPPLE_PROFILE.leadingHueMix).add(
    spectralDrift
      .sub(0.5)
      .mul(RIPPLE_PROFILE.spectralVariation),
  );
  const leadingColour = mix(u.uFlow, u.uSpectral, leadingHue);
  const trailingColour = mix(
    u.uCobalt,
    u.uPalePink,
    float(RIPPLE_PROFILE.trailingHueMix),
  );
  material.colorNode = leadingColour
    .mul(crest)
    .mul(1.15)
    .add(trailingColour.mul(rebound).mul(RIPPLE_PROFILE.reboundGain));
  material.opacityNode = crest
    .mul(RIPPLE_PROFILE.coverageGain)
    .add(rebound.mul(RIPPLE_PROFILE.coverageGain * RIPPLE_PROFILE.reboundGain))
    .clamp(0, 0.32);

  const height = advected.z
    .mul(SETTLE_HEIGHT)
    .sub(advected.y.mul(SCOUR_DEPTH))
    .add(advected.x.pow(2).mul(BODY_RELIEF))
    .add(crest.mul(0.12))
    .add(0.32);
  material.positionNode = positionLocal.add(vec3(0, height, 0));

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

  const veilTap = float(0.035);
  const bodyMist = body
    .mul(0.40)
    .add(texture(ink.sampleTexture, coord.add(vec2(veilTap, 0))).x.mul(0.15))
    .add(texture(ink.sampleTexture, coord.sub(vec2(veilTap, 0))).x.mul(0.15))
    .add(texture(ink.sampleTexture, coord.add(vec2(0, veilTap))).x.mul(0.15))
    .add(texture(ink.sampleTexture, coord.sub(vec2(0, veilTap))).x.mul(0.15));

  // The veil's own copy of the pigment ramp, narrower than the ground's and squared,
  // because the veil's whole risk is flooding the frame: at a wide ramp its opacity
  // floor reached everywhere the field was even slightly non-zero, which is most of
  // the picture, and the negative space the composition depends on disappeared under
  // a uniform wash.
  const wash = smoothstep(float(0.035), float(0.72), bodyMist).pow(1.38);
  const colour = mix(
    mix(u.uDeep, u.uGreyViolet, wash.mul(0.22)),
    u.uCobalt,
    wash.mul(0.28),
  );

  const edgeDistance = coord.x
    .min(coord.y)
    .min(float(1).sub(coord.x))
    .min(float(1).sub(coord.y));
  const worldFeather = smoothstep(float(0), float(0.075), edgeDistance);

  material.colorNode = colour.mul(options.gain);
  // Opacity is the wash itself, squared, so the veil is invisible over black ground
  // and present over the river. A veil with a floor of opacity would grey the whole
  // frame, which is precisely the uniformly-lit failure the baseline measured at a
  // lit fraction of 1.00 — and it would be reached here from the atmospheric side
  // rather than the emissive one.
  // Halved. The veil covers the entire world extent, so its gain is a statement about how
  // bright the *whole frame* is, not about a feature in it. At 0.42 it was doing what the
  // brief forbids by name: a uniform wash over everything.
  material.opacityNode = wash
    .pow(1.9)
    .mul(worldFeather)
    .mul(options.gain)
    .mul(0.10);
  // A density-shaped height offset turns the veil into a suspended membrane rather than a
  // parallel copy of the ground. It remains one expression of the same field and introduces no
  // independent animation or geometry system.
  material.positionNode = positionLocal.add(
    vec3(0, bodyMist.pow(1.25).mul(18).add(options.height), 0),
  );

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}
