import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  mx_fractal_noise_float,
  normalWorld,
  positionWorld,
  saturate,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';

/**
 * The one shading model every solid surface in the scene uses.
 *
 * The rift, the far shelves, the deep plates and the domains' shells all run
 * this material with different constants. They do not run *different* materials,
 * and that is deliberate: a scene assembled from several unrelated shading
 * models reads as several unrelated scenes. One model with a shared uniform
 * block is what makes the whole frame one event.
 *
 * What it does not do is light anything. The geometry is baked with orientation
 * luminance and depth darkening already in its vertex colours — that work was
 * done on the CPU at build time and it is what gives a large form its mass
 * without a light rig. What this material adds is everything that has to move:
 *
 * - **Fresnel rim.** The one term that is genuinely a function of the view. It
 *   is what makes a cut edge read as a cut edge, and it is why the mass keeps a
 *   silhouette against a backdrop of nearly its own value.
 * - **Procedural veins.** Ridged fractal noise, evaluated in world space so the
 *   pattern is welded to the structure rather than sliding across it as the
 *   camera moves. They are emissive and rationed: at rest they are barely above
 *   the surface, and they only become visible where the field is working.
 * - **Corridor proximity.** How close this fragment is to the line between the
 *   signal's origin and its target. This is the mechanism by which the *route*
 *   lights the *structure* — a manifold lights where the flow actually is, and
 *   nothing lights anywhere else.
 * - **Activation wave.** A slow band travelling along the rift's spine, driven
 *   by the operation phase rather than by a free-running clock, so it says
 *   "something is in progress" rather than "something is animating".
 * - **Compression peak and anomaly.** Hot white at the target end as an
 *   operation completes, and the result hue when something was interrupted or
 *   failed. Both are local and both are rationed.
 *
 * The whole model is authored once, in TSL, and runs unchanged on WebGPU and on
 * the WebGL2 backend of the node renderer. That was not true before this stage
 * — see the note in `canvasAdapters.ts` — and it is the reason the two backends
 * can now be held to the same art direction instead of merely resembling it.
 */
export type EnergySurfaceConfig = {
  readonly uniforms: FieldUniforms;
  /** World-space scale of the vein lattice. Lower is finer. */
  readonly veinScale?: number;
  /** How much of the baked vertex colour survives at rest. */
  readonly baseGain?: number;
  readonly rimGain?: number;
  readonly veinGain?: number;
  readonly corridorGain?: number;
  /** Adds a deep ultraviolet term on faces turned away from the viewer. */
  readonly deepGain?: number;
  /** The travelling band's speed along world +y. */
  readonly waveSpeed?: number;
  readonly waveGain?: number;
  /**
   * What fraction of the term stack survives past `DEPTH_FADE_FAR`.
   *
   * Zero for everything in the machine, because a member of the machine that is
   * thirty-four units from its centre is behind the far shelf and should not be
   * drawn at all. Non-zero for exactly one caller: the far field, which is
   * *entirely* outside that radius and would otherwise resolve to black. The far
   * field is the reason the frame has a far end, and a far end drawn at zero is
   * the same frame as no far end — which is the state this scene was in before
   * the backdrop moved out of the hero and got its own material.
   */
  readonly depthFadeFloor?: number;
};

export type EnergySurfaceMaterial = {
  readonly material: MeshBasicNodeMaterial;
  readonly dispose: () => void;
};

/**
 * How near the noise's own zero crossing a fragment has to be to read as vein.
 *
 * The band is *centred on zero*, and that is the whole trick. The previous
 * revision took the noise's magnitude and kept everything above a floor, which
 * selects the regions where the noise is *far* from zero — and those regions are
 * blobs. The set of points where a smooth field is far from its mean is a set of
 * blobs; the set of points where it *crosses* its mean is a set of curves. Veins
 * are curves, and the fourth capture of this scene showed the blobs.
 *
 * So the term is one minus the normalised distance to zero, and the result is a
 * thin bright isolation line running along every zero crossing of the fractal
 * field — which is what a vein is.
 */
const VEIN_WIDTH = 0.05;

/**
 * The corridor's two radii, in world units, before the signal gain.
 *
 * This started at a single radius of 4.2, and at 4.2 a corridor forty-six units
 * long is a tube of radius four the entire length of the composition —
 * comfortably containing the whole hero. Every surface in the frame therefore
 * received corridor light, at gains up to 1.6, in cyan. That is why the fourth
 * and fifth captures resolved to one hue corner to corner and why the machine
 * had no value range in it: the corridor was not a channel through the hero, it
 * *was* the hero's lighting.
 *
 * The single radius was then cut to 1.7, which fixed the hue and broke something
 * that took a measurement to see. The rift's cavity has half-extents of 6.4 by
 * 2.9 by 2.6, so its own walls stand two and a half to six units off the axis —
 * and a gaussian of radius 1.7 is down to a tenth of its value at 2.6 and a
 * thousandth at 6.4. The throat, which is the one thing in the frame the whole
 * composition exists to show, was receiving no corridor light at all. The
 * eighth capture measured a peak luminance of 0.70 over the entire frame, with
 * nothing above 0.75 anywhere: a machine with no light source in it, whose
 * brightest surface was its own flat shading.
 *
 * So the falloff is two terms rather than one, and they are the two things a lit
 * channel in a cavity actually has. `CORE_RADIUS` is the filament: narrow, at
 * full strength, and the only thing that saturates. `SPILL_RADIUS` is the halo
 * that reaches the walls at a fraction of the strength — enough to model them
 * and to carry the colour, far too little to light the machine. The ratio
 * between the two is what produces a value *range* along the throat instead of a
 * stripe, and the range is what the frame was missing.
 */
const CORRIDOR_CORE_RADIUS = 1.6;
const CORRIDOR_SPILL_RADIUS = 6.2;
/** How much of the corridor's strength survives out at the spill radius. */
const CORRIDOR_SPILL_GAIN = 0.22;

/**
 * The vein lattice's scale is a property of the composition, not of a finish.
 *
 * Each finish's `veinScale` is a *relative* setting — the sampling sheets want a
 * finer lattice than the systems buses — and this is the absolute scale all of
 * them are relative to. It exists because the previous composition was half this
 * size: at the old numbers, a hero twenty-six units long carried six cells of
 * noise across its whole length, and six cells of ridged noise is not a vein
 * lattice, it is a set of large soft blotches. That is what the first capture of
 * this scene showed, and the blotches were the single most visible thing in the
 * frame.
 */
const VEIN_SCALE_GAIN = 1.15;

/**
 * Where the machine starts and stops sinking into the dark, in world units from
 * the rift's own centre.
 *
 * A frozen foundry has no atmospheric perspective and no depth: every member
 * reads at one value regardless of how far away it is, which is what makes a
 * large object look like a small one that has been scaled up. The falloff is the
 * cheapest possible fix and the most effective — it is one distance and one
 * multiply, and it is the difference between a frame with a near side and a
 * frame with a pile of parts.
 */
const DEPTH_FADE_NEAR = 7;
const DEPTH_FADE_FAR = 34;

/**
 * Broad world-space variation in how much of the baked value a surface keeps.
 *
 * A baked orientation luminance is a property of a *member*, not of a point on
 * it: the large flat sweeps take one value across their whole extent, and the
 * frame this scene has shown in every capture since the composition was
 * steepened is dominated by exactly that — a pale unbroken wedge sweeping across
 * the bottom of the frame, correct in every other respect and lit like a slab.
 *
 * The brief asks a surface to respond to "视角度、深度、法线朝向、场密度、路径活跃度、
 * 到活动信号的距离、区域状态", and of those seven the machine only ever answered
 * four, because five of the seven are functions of *where on the surface you
 * are* and the baked term is not. This is the missing one, and it is deliberately
 * the cheapest possible version of it: one low-frequency sample of the same
 * fractal field the veins use, at a scale an order of magnitude broader, so it
 * varies across a member rather than within a finger's width of it.
 *
 * It multiplies `lit` rather than adding to it, so it darkens as well as
 * brightens and cannot lift the composition's floor. The range is held well
 * inside a stop either way: enough that no plane reads as one value, not enough
 * that the machine looks like it is made of cloud.
 */
const SURFACE_DENSITY_SCALE = 0.04;
const SURFACE_DENSITY_DEPTH = 0.75;
const SURFACE_DENSITY_FLOOR = 0.58;

/**
 * A second octave of the same field, at member scale rather than at body scale.
 *
 * The broad term alone does not do the job it was added for, and a measurement
 * says why: at a scale of 0.04 the field's features are twenty-five world units
 * across, and the near massif's inner sweep — the largest face in the frame, and
 * the one the whole term exists to break up — is about thirty. So the member
 * samples the field roughly once and takes, again, one value across its whole
 * area. Widening the broad term's own amplitude would not help; it would only
 * make the whole machine darker at one end than the other.
 *
 * What a surface needs is variation at the scale of the *thing you are looking
 * at*, so this is the same noise sampled an order of magnitude finer, at a
 * third of the amplitude. The two together read as one field with structure at
 * both scales, which is what a real surface has: a body-wide falloff and a
 * panel-by-panel difference on top of it.
 */
const SURFACE_DENSITY_FINE_SCALE = 0.19;
const SURFACE_DENSITY_FINE_DEPTH = 0.24;
const SURFACE_DENSITY_FINE_FLOOR = 0.76;

export function createEnergySurfaceMaterial(
  config: EnergySurfaceConfig,
): EnergySurfaceMaterial {
  const {
    uniforms,
    veinScale = 0.42,
    baseGain = 0.86,
    rimGain = 0.5,
    veinGain = 0.3,
    corridorGain = 0.85,
    deepGain = 0.22,
    waveSpeed = 0.85,
    waveGain = 0.16,
    depthFadeFloor = 0,
  } = config;

  const u = uniforms.uniforms;

  // --- View term ------------------------------------------------------------
  const toCamera = cameraPosition.sub(positionWorld);
  const viewLength = toCamera.dot(toCamera).max(0.0001).sqrt();
  const view = toCamera.div(viewLength);
  const normal = normalWorld.normalize();
  const facing = saturate(normal.dot(view).abs());
  const grazing = facing.oneMinus();
  const fresnel = grazing.mul(grazing).mul(grazing);

  // --- Corridor term --------------------------------------------------------
  // Projection of this fragment onto the signal segment, then the perpendicular
  // distance to it. A gaussian rather than a falloff, because a corridor has a
  // soft edge and a linear falloff has a visible one.
  const span = u.uSignalTarget.sub(u.uSignalOrigin);
  const spanLengthSq = span.dot(span).max(0.0001);
  const toFragment = positionWorld.sub(u.uSignalOrigin);
  const along = saturate(toFragment.dot(span).div(spanLengthSq));
  const nearest = u.uSignalOrigin.add(span.mul(along));
  const offset = positionWorld.sub(nearest);
  const radiusSq = offset.dot(offset);
  const core = radiusSq
    .div(CORRIDOR_CORE_RADIUS * CORRIDOR_CORE_RADIUS)
    .negate()
    .exp();
  const spill = radiusSq
    .div(CORRIDOR_SPILL_RADIUS * CORRIDOR_SPILL_RADIUS)
    .negate()
    .exp()
    .mul(CORRIDOR_SPILL_GAIN);
  const corridor = core.add(spill).mul(u.uSignalStrength);

  // --- Veins ----------------------------------------------------------------
  // Ridged fractal noise in world space. `abs` of a signed noise field produces
  // the crease lines that read as veins rather than as blobs.
  // Four octaves held up at a diminish of 0.68 rather than the default three at
  // 0.5, and the reason is what the isolation line traces rather than how it
  // looks. A fractal noise whose energy sits almost entirely in its base octave
  // has a zero set that follows that octave: a few long, closed, wandering
  // curves. On a large flat member — which is most of the hero's surface area —
  // that is a topographic contour map, and the focus capture showed exactly one
  // such island looping across the near blade. Raising the energy of the higher
  // octaves does not make the pattern finer in the sense of a smaller texture; it
  // makes it *branch*. The zero set of a field with comparable energy at several
  // scales is a network of short segments meeting at junctions, which is what a
  // vein is and what a contour is not.
  const veinField = mx_fractal_noise_float(
    positionWorld.mul(veinScale * VEIN_SCALE_GAIN).add(vec3(0, u.uTime.mul(0.035), 0)),
    4,
    2.1,
    0.68,
  );
  // One minus the distance to zero: bright *on* the noise's zero crossing, dark
  // either side. See `VEIN_WIDTH`.
  // The power is what decides whether the result reads as a vein or as a
  // contour map. At 1.6 the isolation line is soft enough to keep a visible
  // skirt either side of the crossing, and a surface covered in soft lines of
  // even width is a drawing on a slab — which is exactly what the twelfth
  // capture showed across the near massif, a violet island outline wandering
  // over a plane. At 2.4 the line is narrow and the surface between the veins is
  // genuinely surface, so a vein is a seam in a material rather than a mark on
  // one.
  const vein = saturate(veinField.abs().div(VEIN_WIDTH).oneMinus()).pow(2.4);

  // --- Depth ----------------------------------------------------------------
  // How far this fragment is from the machine's own centre, resolved to a
  // brightness multiplier. Nothing here is a fade to the background colour: it
  // multiplies the whole term stack, so a member far from the rift loses its
  // veins and its rim together and settles into the dark as a silhouette rather
  // than washing out to grey.
  const toCentre = positionWorld.sub(u.uRiftCentre);
  const depthReach = saturate(
    toCentre
      .dot(toCentre)
      .max(0.0001)
      .sqrt()
      .sub(DEPTH_FADE_NEAR)
      .div(DEPTH_FADE_FAR - DEPTH_FADE_NEAR)
      .oneMinus(),
  );
  // With the default floor of zero this is `depthReach` unchanged, so nothing in
  // the machine is affected by the floor existing.
  const depthFade = depthReach
    .mul(1 - depthFadeFloor)
    .add(depthFadeFloor);

  // --- Travelling band ------------------------------------------------------
  // Driven by `uPhase` as well as time, so the band's position says where in the
  // operation the machine is rather than merely that time is passing.
  const bandPhase = positionWorld.y
    .mul(0.62)
    .sub(u.uTime.mul(waveSpeed))
    .sub(u.uPhase.mul(6.2831853));
  // A triangle wave: cheaper than a sine and, more importantly, it produces one
  // narrow band per period rather than a smooth gradient across the whole body.
  const triangle = bandPhase
    .div(6.2831853)
    .fract()
    .sub(0.5)
    .abs()
    .mul(2);
  const band = saturate(triangle.oneMinus().pow(6)).mul(u.uActivity);

  // --- Composition ----------------------------------------------------------
  const baked = attribute('color', 'vec3');
  // Slow drift through the field, so the variation is a property of the machine
  // and not a texture stuck to it. It breathes at a rate far below anything the
  // eye tracks: the point is that two frames a second apart differ, not that a
  // visitor sees a moving pattern.
  const density = mx_fractal_noise_float(
    positionWorld
      .mul(SURFACE_DENSITY_SCALE)
      .add(vec3(u.uTime.mul(0.012), u.uTime.mul(-0.008), 0)),
    3,
  );
  const fineDensity = mx_fractal_noise_float(
    positionWorld
      .mul(SURFACE_DENSITY_FINE_SCALE)
      .add(vec3(u.uTime.mul(-0.021), u.uTime.mul(0.015), u.uTime.mul(0.009))),
    2,
  );
  const surfaceDensity = saturate(
    density.mul(SURFACE_DENSITY_DEPTH).add(SURFACE_DENSITY_FLOOR),
  ).mul(
    saturate(
      fineDensity.mul(SURFACE_DENSITY_FINE_DEPTH).add(SURFACE_DENSITY_FINE_FLOOR),
    ),
  );
  const lit = baked
    .mul(saturate(u.uActivity.mul(0.24).add(baseGain).add(corridor.mul(0.3))))
    .mul(surfaceDensity);

  // The rim's floor is deliberately low. A large flat member seen at a grazing
  // angle has a fresnel term near one across its whole area, so a rim with a
  // generous resting floor turns every plate in the composition white — which is
  // exactly what the first capture of this scene looked like. The rim is a
  // response to being looked at, and at rest the machine is not being looked at.
  // The rim takes the same surface density as the base does, and that is not a
  // second helping of the same idea — it is the fix for the one term that could
  // not be fixed any other way. A rim is a function of the view angle, and on a
  // large flat member seen at a grazing angle the view angle is the *same* all
  // the way across it, so the term resolves to one value over the member's whole
  // area. That is the mechanism behind the pale unbroken wedge in the bottom-left
  // of every recent capture: not a brightness setting that was too high, but a
  // term that is structurally incapable of varying across the surface it is on.
  // Multiplying it by a field sampled in world space gives it the one thing it
  // cannot derive from the geometry — a reason to differ from one end of a plane
  // to the other.
  const rimTerm = u.uRim.mul(fresnel)
    .mul(rimGain)
    .mul(u.uActivity.mul(0.85).add(0.1))
    .mul(surfaceDensity);
  // The veins are ultraviolet and the corridor is cyan, and that split is the
  // whole of the scene's colour argument in two lines.
  //
  // Both terms used to be cyan, which is why the fourth capture of this scene was
  // one hue from corner to corner: every surface's texture and every lit channel
  // resolved to the same blue-green, so a large structure read as a solid object
  // in one colour rather than as a machine with different things happening in
  // different places. Colour is the cheapest way to say *these two surfaces are
  // doing different work*, and a scene that spends its entire palette on one
  // meaning has thrown that away.
  //
  // Ultraviolet is the deep compute: it belongs on the surfaces of things that
  // are working but not being looked at, which is what a vein is. Cyan is the
  // main flow: it belongs where the machine's energy is *going*, which is the
  // corridor and nothing else.
  const veinTerm = u.uDeep.mul(vein).mul(veinGain).mul(u.uActivity.add(0.12));
  // The corridor takes the surface density as well, and finding that out was the
  // end of a long search. The pale unbroken wedge in the bottom-left of the frame
  // survived ribbed geometry, a per-facet bake and a two-scale density field on
  // `lit` and the rim, and the reason is that the wedge is not lit by either of
  // them: it is cyan, and the only cyan term is this one. A corridor is a
  // two-scale gaussian about the signal segment, so its falloff is smooth by
  // construction and a large face sitting inside the spill radius takes very
  // nearly one value across its whole area — the same structural problem as the
  // rim, on the term that happens to be the brightest.
  //
  // Sampling the corridor's own light through the same field is what the brief
  // asks for anyway, and it asks for it in these words: 高密度语义流束 — a
  // *bundle*, not a wash. A channel that lights every square metre of the
  // structure it passes through at the same strength is a lamp; one whose light
  // breaks across the surface it falls on is a flow with density in it.
  const corridorTerm = u.uFlow.mul(corridor).mul(corridorGain).mul(surfaceDensity);
  const deepTerm = u.uDeep.mul(grazing).mul(u.uFocus).mul(deepGain);
  const peakTerm = u.uPeak.mul(corridor.mul(corridor)).mul(u.uProgress).mul(0.9);
  const anomalyTerm = u.uAnomaly.mul(corridor).mul(u.uCongestion).mul(0.55);
  const bandTerm = u.uFlow.mul(band).mul(waveGain);
  // The chest: hot white where the corridor is at its densest, always on. The
  // brief asks for compression peaks in hot white and for a frame whose bright
  // areas have force; without a term that is lit at rest the machine has no
  // centre and the corridor is a uniform stripe rather than a channel with a
  // throat in it.
  //
  // The gain is near one and the exponent is three, and both are answers to the
  // same measurement. The eighth capture of this scene put the brightest pixel in
  // a 1280x720 frame at 0.70 and left the top four histogram bins empty — a
  // machine with no light in it, whose brightest surface was its own flat
  // shading. Bloom is thresholded at 0.72, so a frame peaking at 0.70 is
  // *literally* unable to bloom no matter what the post settings say. The cubic
  // is what keeps the fix local: at the core the term is at full gain and the
  // throat clips to white, and at the spill radius it is one percent of that and
  // the walls are merely modelled. A linear term at this gain would have lifted
  // the whole machine.
  //
  // It is built from `core` rather than from `corridor`, and that distinction is
  // the whole reason the term could not do its job before. `corridor` carries
  // `uSignalStrength`, which is `IDLE_CORRIDOR` — 0.4 — whenever nothing is
  // bound, and a *cubic* of 0.4 is 0.064. The gain was raised from 0.55 to 0.95
  // and the frame still peaked at 0.79 with a tenth of a percent of its pixels
  // above the bloom threshold, because the term was being multiplied by a
  // sixteenth on the way in. A signal-scaled term describes light the *request*
  // brings; the throat is lit by the machine's own spine, which is on whether or
  // not anything is being asked of it, and the brief's idle frame is explicit
  // that the rift is a lit channel at rest. Hover and focus add on top through
  // `corridor`; they were never what turned this on.
  const chestTerm = u.uPeak.mul(core.mul(core).mul(core)).mul(0.95);

  const colorNode = lit
    .add(rimTerm)
    .add(veinTerm)
    .add(corridorTerm)
    .add(deepTerm)
    .add(peakTerm)
    .add(anomalyTerm)
    .add(bandTerm)
    .add(chestTerm)
    .mul(depthFade);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = colorNode;
  material.fog = true;
  // Vertex colours are read explicitly above through `attribute('color', 'vec3')`, so
  // the material must not multiply them in a second time. That double-multiply
  // is not hypothetical: it is the defect that cost the previous stage a full
  // backend divergence, and it is why this flag is written down here.
  material.vertexColors = false;

  return {
    material,
    dispose: () => material.dispose(),
  };
}
