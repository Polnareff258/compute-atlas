import { AdditiveBlending, DoubleSide } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  mx_fractal_noise_float,
  saturate,
  varying,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';

/**
 * Semantic Data-Matter Reconfiguration.
 *
 * One instanced draw call. Every unit in it is a quad that is placed, oriented,
 * stretched and coloured entirely in the vertex shader from static per-instance
 * attributes plus the shared uniform block. The CPU writes no per-unit value on
 * any frame — it writes the uniform block once and the field re-derives itself.
 *
 * The units do not morph between *shapes*. They morph between configurations of
 * one shape — a streak whose direction, length, brightness and tint are all
 * functions of the local field — and the forms the brief asks for emerge from
 * that:
 *
 * - **Volumetric cloud** — low activity, low form: short, dim streaks pointing
 *   in uncorrelated directions.
 * - **Flowing filament** — the flow term dominates: long thin streaks that agree
 *   with their neighbours because they sample the same smooth field.
 * - **Compressed stream** — corridor proximity is high: the streaks align to the
 *   signal axis and shorten.
 * - **Luminous ribbon** — high activity with high form: long, closely-aligned
 *   streaks overlap and fuse into a continuous band.
 * - **Membrane surface** — the band squeeze term collapses the perpendicular
 *   position onto a plane, and units spread across it rather than through it.
 * - **Structural lattice** — regional load is high: units condense back onto
 *   their home loci and the density becomes granular instead of smooth.
 * - **Local computation pocket** — the same thing, scoped to one region.
 *
 * The distinction that matters is that *none of these is a separate system*.
 * They are all the same field at different points of its parameter space, which
 * is why the frame reads as one substance reconfiguring rather than as seven
 * effects layered over each other.
 *
 * What keeps it from reading as random starfield is that nothing here is
 * random after the seeds: every unit's motion is drawn from a smooth field it
 * shares with its neighbours, an axis it circulates around, and a semantic
 * corridor it is pulled toward. Direction, pressure, laminar structure and
 * convergence are all present in the maths before a single pixel is drawn —
 * which is the only way they can be present on screen.
 */

/** World-space scale of the large-scale flow field. Lower is broader. */
const FLOW_SCALE = 0.075;
const FLOW_TIME_X = 0.019;
const FLOW_TIME_Y = 0.016;

/**
 * How far the flow field displaces a unit, in world units, at full `form`.
 *
 * The flow sample is a normalised direction, so on its own it moves a unit by
 * about one unit whatever the volume it lives in is — and the volume it lives in
 * is fifty-one by thirty by twenty-seven. A field whose entire motion is three
 * percent of its own extent is not a moving substance: it is a set of fixed loci
 * with a shimmer on them, which is precisely the reading the brief rules out with
 * "画面不能像随机星尘" and "必须表现出方向、压力、层流、汇聚".
 *
 * The displacement has to be the same order as the structure for the field to
 * read as travelling along it, and that is what this constant buys. It is one
 * number rather than a rewrite because the flow term was already a genuine
 * vector field shared by neighbours — the laminae were in the maths and had no
 * room to be seen in.
 */
const FLOW_DISPLACEMENT = 4.4;

/** Radius, in world units, at which the corridor's pull falls to 1/e. */
const CORRIDOR_SIGMA = 1.9;
const CORRIDOR_SQUARED = CORRIDOR_SIGMA * CORRIDOR_SIGMA;

/**
 * Vapour is short and wide; filament is long and thin.
 *
 * These are world units, and they are set against the *projected* size of a unit
 * rather than against their own ratios: at the idle framing one world unit is
 * about sixty screen pixels, so after the activity multiplier a vapour unit is
 * roughly twenty by four screen pixels and a filament roughly eighty by two.
 * Both are small enough that a unit is an element rather than a shape, which is
 * what lets a hundred thousand of them build a volume instead of a surface.
 *
 * The three revisions either side of this one bracket the useful range. At 0.09
 * by 0.014 a unit covered well under a pixel and the field was invisible however
 * many of them there were. At 2.1 by 0.17 a unit covered two hundred pixels and
 * the field saturated into solid balls wherever it was dense. In between, at 0.14
 * by 0.12, the *low-form* unit — which is most of them — was wider than it was
 * long: four pixels by seven, a round dot. A hundred thousand round dots is the
 * one thing the brief names outright, "画面不能像随机星尘", and it is what the
 * ninth capture of this scene showed: the field was present and legible only as
 * fine speckle, with none of the direction, laminae or convergence the whole
 * module exists to produce. A streak has to be longer than it is wide at *every*
 * point of its range, not only at the end the composition is about.
 *
 * A particle system's apparent density is the product of its count, its area and
 * its alpha; only the count is ever checked against the frame, because only the
 * count is a number anybody thinks of as a design decision. The other two are
 * where the frame is actually decided.
 */
const STREAK_VAPOUR_LENGTH = 0.42;
const STREAK_FILAMENT_LENGTH = 1.6;
const STREAK_VAPOUR_WIDTH = 0.06;
const STREAK_FILAMENT_WIDTH = 0.028;

/**
 * Base opacity per unit, and the one number in this file that is arithmetic.
 *
 * A hundred and twenty thousand additive streaks, each covering `A` pixels at
 * alpha `α`, spread over a region of `R` pixels, produce a mean brightness of
 * `N·A·α/R` — and any value much above one half is not "bright matter", it is
 * white. At the idle framing a unit spans about sixty screen pixels, so vapour
 * at these dimensions is a twenty-two by four pixel element, `A ≈ 90`, and with
 * `R` the field's own footprint the ratio resolves to α of about two percent.
 *
 * This is a low number and it is meant to be. It is also the number that makes
 * the field legible: at the previous revision's 0.38 the field saturated
 * everywhere it was dense and the frame showed five solid glowing balls, with
 * every structural term in this shader — the corridor, the compression bands,
 * the regional condensation — hidden underneath the saturation. Structure in a
 * dense additive field is only visible in the *dynamic range*, and the dynamic
 * range is bought here.
 */
const BASE_ALPHA = 0.042;

/** How far the band squeeze may collapse the perpendicular radius. */
const BAND_SQUEEZE = 0.42;

/**
 * How far matter reaches from the rift's spine before it thins to nothing.
 *
 * Without this the field has no envelope: every unit in the buffer is equally
 * present wherever the flow has carried it, so the substance fills the frame
 * uniformly and the hero sits inside an even bath of it. That is what the
 * thirteenth capture showed — a vortex coating the whole rectangle, with the
 * machine as a shape in front of it rather than as the thing the substance is
 * coming out of. The brief's own words are "深色背景上... 方向、压力、层流、汇聚":
 * converging is a claim about density changing with position, and a field with
 * one density everywhere makes none of those claims however good its velocity
 * field is.
 *
 * The falloff is on the *perpendicular* distance from the spine rather than on
 * distance from the rift's centre, because the rift is a fault and not a ball:
 * matter is dense along its whole length and thins to its sides. It is applied
 * to alpha and not to position, so the units outside the envelope are still
 * there, still moving, and still catch light when the field is energised — they
 * are simply not visible until something asks for them.
 */
const FIELD_REACH = 24;

export type DataMatterMaterialConfig = {
  readonly uniforms: FieldUniforms;
  /** 0..1. Scales the per-unit alpha, not the unit count. */
  readonly density: number;
  /** How long a streak may get, in world units, at full activity. */
  readonly streakScale?: number;
};

export type DataMatterMaterial = {
  readonly material: MeshBasicNodeMaterial;
  readonly dispose: () => void;
};

export function createDataMatterMaterial(
  config: DataMatterMaterialConfig,
): DataMatterMaterial {
  const u = config.uniforms.uniforms;

  const corner = attribute('position', 'vec3').xy;
  const home = attribute('aHome', 'vec3');
  const kind = attribute('aKind', 'float');
  const form = attribute('aForm', 'float');
  const size = attribute('aScale', 'float');

  // --- Large-scale flow -----------------------------------------------------
  // Two offset ridged samples. One sample would be a scalar and could only move
  // units along a fixed direction; two give a genuine vector field, and taking
  // the difference of two samples of the same field is what makes neighbouring
  // units agree without any unit knowing about its neighbours.
  const sampleA = mx_fractal_noise_float(
    home.mul(FLOW_SCALE).add(vec3(u.uTime.mul(FLOW_TIME_X), 0, u.uTime.mul(FLOW_TIME_Y))),
    3,
  );
  const sampleB = mx_fractal_noise_float(
    home
      .mul(FLOW_SCALE)
      .add(vec3(4.7, 9.1, -2.3))
      .add(vec3(0, u.uTime.mul(FLOW_TIME_Y), u.uTime.mul(FLOW_TIME_X))),
    3,
  );
  const flow = vec3(
    sampleA.sub(0.5),
    sampleB.sub(0.5),
    sampleA.add(sampleB).mul(0.5).sub(0.5),
  )
    .add(vec3(0.0001, 0.0001, 0.0001))
    .normalize();

  // --- Circulation around the rift -----------------------------------------
  // The spine is the one structure in the scene the field is authored around, so
  // the slow rotation of the whole volume is a rotation about it rather than a
  // global spin. The falloff keeps the far shelf from orbiting like a disc.
  const radial = home.sub(u.uRiftCentre);
  const axisPos = radial.dot(u.uRiftAxis);
  const perpendicular = radial.sub(u.uRiftAxis.mul(axisPos));
  const around = u.uRiftAxis.cross(perpendicular);
  const radialSq = perpendicular.dot(perpendicular);
  const envelope = saturate(radialSq.sqrt().div(FIELD_REACH).oneMinus()).pow(1.7);
  const swirl = perpendicular
    .dot(perpendicular)
    .add(9)
    .sqrt()
    .reciprocal()
    .mul(1.35)
    .mul(FLOW_DISPLACEMENT);

  // --- Where this unit is ---------------------------------------------------
  // The displacement a unit is allowed. The `form` coefficient rose from 1.4 to
  // 2.4 for the same reason `IDLE_ACTIVITY` did: a unit's travel has to be
  // comparable to the volume it lives in, or the field is a set of fixed points
  // with a faint shimmer on them rather than a substance in motion. The units
  // that barely move are the low-`form` ones, and they are the ones that stay
  // near their loci and give the field its grain.
  const live = saturate(u.uActivity.mul(0.95).add(0.24));
  const dispersed = home.add(
    flow.mul(live.mul(form.mul(2.4).add(0.9))).mul(FLOW_DISPLACEMENT),
  );
  const swirled = dispersed.add(around.mul(swirl.mul(live)));

  // --- Travelling density bands --------------------------------------------
  // A slow wave along the spine. Where it passes, the perpendicular radius
  // collapses: matter is squeezed onto a sheet, which is what produces the
  // large flowing laminae rather than a uniformly thick volume.
  const band = saturate(
    axisPos
      .mul(0.34)
      .sub(u.uTime.mul(0.42))
      .sub(u.uPhase.mul(6.2831853))
      .sin()
      .mul(0.5)
      .add(0.5),
  );
  const squeeze = band.mul(u.uActivity).mul(BAND_SQUEEZE).oneMinus();
  const banded = u.uRiftCentre.add(u.uRiftAxis.mul(axisPos)).add(perpendicular.mul(squeeze));

  // --- Regional load --------------------------------------------------------
  // Which of the five regional loads applies, selected without indexing: five
  // `step` windows summed. Dynamic indexing of a uniform array is the classic
  // place a shader compiles on one backend and not the other, and this is
  // cheaper than the branch it replaces.
  const domainLoad = u.uLoadA
    .mul(saturate(kind.sub(0.75).abs().oneMinus()))
    .add(u.uLoadB.mul(saturate(kind.sub(1.75).abs().oneMinus())))
    .add(u.uLoadC.mul(saturate(kind.sub(2.75).abs().oneMinus())))
    .add(u.uLoadD.mul(saturate(kind.sub(3.75).abs().oneMinus())))
    .add(u.uLoadE.mul(saturate(kind.sub(4.75).abs().oneMinus())));
  const inRift = saturate(kind.mul(-1).add(0.75));
  const load = domainLoad.add(inRift.mul(u.uActivity));

  // Organisation pulls the unit off its dispersed drift and onto the banded
  // sheet. This is the term that turns a cloud into a structure, and the reason
  // it is scaled by `form` is grain: some units commit and some do not.
  const organisation = saturate(load.mul(form.mul(0.8).add(0.3)));
  // The displacement that reaches `positioned` is the *swirled* one. The swirl
  // term was computed and then dropped for one revision, which left the whole
  // circulation about the spine as an orientation-only effect: the streaks
  // pointed along the vortex while every unit sat exactly where the flow had
  // pushed it, so the field had a direction of travel it never travelled in. The
  // volume's slow rotation is the brief's "汇聚" made visible, and a vector that
  // only colours the frame is not a motion.
  const positioned = swirled.mul(organisation.oneMinus()).add(banded.mul(organisation));

  // --- The semantic corridor ------------------------------------------------
  const span = u.uSignalTarget.sub(u.uSignalOrigin);
  const spanLengthSq = span.dot(span).max(0.0001);
  const toUnit = positioned.sub(u.uSignalOrigin);
  const along = saturate(toUnit.dot(span).div(spanLengthSq));
  const nearest = u.uSignalOrigin.add(span.mul(along));
  const toLine = nearest.sub(positioned);
  const corridorPull = toLine
    .dot(toLine)
    .div(CORRIDOR_SQUARED)
    .negate()
    .exp()
    .mul(u.uSignalStrength)
    .mul(saturate(along.mul(0.6).add(0.4)));
  const position = positioned.add(
    toLine.mul(corridorPull.mul(form.mul(0.45).add(0.35))),
  );

  // --- Streak orientation ---------------------------------------------------
  // The streak points along the velocity the unit currently has, which is the
  // sum of everything acting on it. So a unit in the corridor points down the
  // corridor, a unit in the rift points along its own circulation, and a unit in
  // a working region points at the region's centre — without any of those three
  // being a special case in this code.
  const motion = flow
    .mul(0.55)
    .add(around.mul(swirl.mul(0.7)))
    .add(span.normalize().mul(corridorPull.mul(1.1)));
  const forward = motion.add(vec3(0.0001, 0.0001, 0.0001)).normalize();
  const toCamera = cameraPosition.sub(position);
  const side = forward.cross(toCamera).normalize();

  // --- Extent ---------------------------------------------------------------
  // Compression at the target end as an operation completes: matters shortens and
  // brightens, which is what "the field condenses" has to look like.
  const compression = u.uProgress.mul(corridorPull).mul(1.4);
  const streakLength = form
    .mul(STREAK_FILAMENT_LENGTH - STREAK_VAPOUR_LENGTH)
    .add(STREAK_VAPOUR_LENGTH)
    .mul(size)
    .mul(config.streakScale ?? 1)
    .mul(saturate(u.uActivity.mul(1.25).add(0.55)))
    .mul(compression.add(1).mul(0.85).max(0.35))
    .mul(saturate(u.uQuality.mul(0.5).add(0.62)));
  const streakWidth = form
    .oneMinus()
    .mul(STREAK_VAPOUR_WIDTH - STREAK_FILAMENT_WIDTH)
    .add(STREAK_FILAMENT_WIDTH)
    .mul(size)
    .mul(saturate(u.uQuality.mul(0.6).add(0.5)));

  const world = position
    .add(forward.mul(corner.x.mul(streakLength)))
    .add(side.mul(corner.y.mul(streakWidth)));

  // --- Fragment -------------------------------------------------------------
  const vCorner = varying(corner);
  const vForm = varying(form);
  const vCorridor = varying(corridorPull);
  const vLoad = varying(load);
  const vEnvelope = varying(envelope);

  const along2 = vCorner.x.abs();
  const across2 = vCorner.y.abs();
  // Soft tapered ends: the streak has to dissolve into the field at both tips or
  // it reads as a rectangle.
  const body = saturate(along2.mul(along2).oneMinus())
    .pow(1.05)
    .mul(saturate(across2.mul(2).oneMinus()).pow(1.35));

  const alpha = body
    .mul(BASE_ALPHA)
    .mul(config.density)
    .mul(saturate(vForm.mul(0.85).add(0.4)))
    .mul(saturate(vLoad.mul(0.7).add(0.35)))
    .mul(saturate(u.uActivity.mul(0.9).add(0.35)))
    .mul(vEnvelope);

  // Cyan is the bulk flow; ultraviolet is deep compute and only appears where
  // the field is *not* being pulled into the corridor, which is exactly the
  // matter still sitting in the depth of the rift.
  const deepWeight = saturate(vCorridor.oneMinus().mul(0.75));
  const tint = u.uFlow
    .mul(saturate(vCorridor.mul(0.9).add(0.45)))
    .add(u.uDeep.mul(deepWeight.mul(0.55)))
    .add(u.uPeak.mul(vCorridor.mul(vCorridor).mul(u.uProgress).mul(1.3)))
    .add(u.uAnomaly.mul(vCorridor.mul(u.uCongestion).mul(0.8)));

  const material = new MeshBasicNodeMaterial();
  material.positionNode = world;
  material.colorNode = tint.mul(saturate(u.uActivity.mul(0.7).add(0.4)));
  material.opacityNode = alpha;
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = DoubleSide;
  // Additive matter over a fogged scene has to be fogged too, or the far field
  // stays at full brightness and the depth of the frame collapses.
  material.fog = true;

  return {
    material,
    dispose: () => material.dispose(),
  };
}
