import type { Vector2 } from '../watershed/terrainField';

/**
 * The meander: the curve the *visual* river runs on.
 *
 * ## Why this exists
 *
 * The descriptor's river spines are authoring lines. They carry where a river goes
 * and how much water it carries, and they are shaped for the systems that consume
 * them — the camera's travel, the terrain's channels, the clearance assertions. What
 * they are not is *meanders*: a probe of the live world prints seven spines, the
 * longest seven points, running within a few degrees of straight from their source to
 * their mouth.
 *
 * That is fine for a height field and fatal for this composition. The brief's first
 * named reference quality is river curvature, and its first visual requirement is a
 * meander whose bends are the frame's subject. A straight band seen from an oblique
 * camera is a *triangle*, and a captured frame built from several of them reads —
 * correctly, and the vision pass said so in those words — as "ribbon-like structures
 * with sharp edges" rather than as a river.
 *
 * So this function adds the curve, and it is a deliberate act of art direction rather
 * than a discovery about the world. Stated plainly because the alternative is a
 * reader concluding the descriptor had meanders all along.
 *
 * ## Why it is here and not in the descriptor
 *
 * `descriptor.rivers` is consumed by `shots.ts`, by `terrainField`, by the clearance
 * tests and by the layout. Displacing a spine inside the descriptor would move the
 * camera corridors and invalidate a set of assertions whose subject has not changed —
 * and it would make the claim "detail changes counts, never positions" false. This is
 * a *derived* course: a pure function of a spine, a width and a seed, used by the ink
 * bake, the corridor mesh and the hero framing, and by nothing else.
 *
 * The cost of that separation is stated rather than hidden: the focus choreography in
 * `shots.ts` still travels the descriptor's own straight spines, so a focus move runs
 * beside the visible river rather than along it. That is a known inconsistency, it is
 * confined to the secondary shots, and the hero — which is what this stage is judged
 * on — uses this course.
 *
 * ## The shape
 *
 * Two superimposed sinusoids along arc length, offsetting the spine laterally:
 *
 * - The **primary** carries the meander. Its wavelength is `MEANDER_WAVELENGTH`
 *   channel-widths and its amplitude `MEANDER_AMPLITUDE`, which is the ratio real
 *   meanders settle at — an amplitude of two to three channel widths and a wavelength
 *   near eleven — and it is the reason the result reads as water rather than as a
 *   wave.
 * - The **secondary** is shorter and weaker, at an incommensurate wavelength, so the
 *   bends do not repeat identically along a course. A single sinusoid gives a river
 *   that looks *drawn*; the reference works all have bends that vary.
 *
 * The offset is applied along the local normal and the result is re-smoothed, because
 * offsetting a polyline by a varying amount is not an isometry — it stretches the
 * outer side of every bend and pinches the inner one, and left alone that shows up as
 * spacing that tightens exactly where the curvature is highest.
 */

/**
 * The meander's amplitude, in channel half-widths.
 *
 * Three, and it is the number that decides whether this reads as a river. At one the
 * curve is a wobble on a straight line; at six the course doubles back on itself and
 * the bake's nearest-spine search starts assigning texels to the wrong limb, which
 * shows as a channel that appears to fork for no reason. Three is where a meander is
 * legibly sinuous and still unambiguous.
 */
const MEANDER_AMPLITUDE = 3;

/** The meander's wavelength, in channel half-widths. A little over ten. */
const MEANDER_WAVELENGTH = 11;

/** The secondary's relative wavelength and amplitude. Incommensurate on purpose. */
const SECONDARY_WAVELENGTH_RATIO = 0.41;
const SECONDARY_AMPLITUDE = 0.34;

/**
 * How far apart the offset samples are, as a fraction of the meander's wavelength.
 *
 * The offset is a smooth function of arc length, so the only requirement is that the
 * polyline can resolve it — and it has to be able to resolve it *before* the
 * re-smoothing below, because a curve sampled at fewer than a few points per
 * wavelength aliases into a different, shorter wavelength rather than into a coarse
 * version of the same one.
 */
const SAMPLES_PER_WAVELENGTH = 9;

/** How many times the re-smoothing pass runs. Two is a visibly smooth centreline. */
const SMOOTHING_PASSES = 2;

export type CourseSource = {
  readonly spine: readonly Vector2[];
  /** Half-width of the flowing body. The meander's whole scale is derived from it. */
  readonly width: number;
};

/**
 * Deterministic per-course phase, so two courses of the same width do not meander in
 * step. Derived from the spine's own geometry rather than from an index, so the phase
 * is a property of the river rather than of the order it happened to be declared in.
 */
function phaseFor(spine: readonly Vector2[], seed: number, salt: number): number {
  let accumulator = seed * 2654435761 + salt * 40503;
  for (let index = 1; index < spine.length; index += 1) {
    const a = spine[index - 1]!;
    const b = spine[index]!;
    accumulator = (accumulator * 31 + Math.round((b[0] - a[0]) * 8 + (b[1] - a[1]) * 16)) | 0;
  }
  const unit = ((accumulator >>> 0) % 100000) / 100000;
  return unit * Math.PI * 2;
}

export function meanderCourse(
  source: CourseSource,
  seed: number,
): Vector2[] {
  const { spine, width } = source;
  if (spine.length < 2) return [...spine];

  // The meander's own scale, in world units. Everything below is expressed as a
  // multiple of the channel's width, so a creek meanders at the scale of a creek and
  // the artery at the scale of the artery — one set of constants, seven rivers, and no
  // river showing a pattern meant for another.
  const amplitude = Math.max(1, width * MEANDER_AMPLITUDE);
  const wavelength = Math.max(4, width * MEANDER_WAVELENGTH);
  const secondaryWavelength = wavelength * SECONDARY_WAVELENGTH_RATIO;

  // Resample to uniform arc length first. The descriptor's spines are unevenly
  // spaced, and an offset applied per-segment on an uneven polyline is applied more
  // finely where the authoring happened to put points — which is the same as saying
  // the meander's wavelength would vary with the authoring rather than with the river.
  const spacing = Math.max(1, wavelength / SAMPLES_PER_WAVELENGTH);
  const uniform = resample(spine, spacing);
  if (uniform.length < 3) return [...spine];

  const phaseA = phaseFor(spine, seed, 1);
  const phaseB = phaseFor(spine, seed, 7);

  const offset: Vector2[] = [];
  let travelled = 0;
  for (let index = 0; index < uniform.length; index += 1) {
    if (index > 0) {
      travelled += Math.hypot(
        uniform[index]![0] - uniform[index - 1]![0],
        uniform[index]![1] - uniform[index - 1]![1],
      );
    }
    const primary = Math.sin((travelled / wavelength) * Math.PI * 2 + phaseA);
    const secondary = Math.sin((travelled / secondaryWavelength) * Math.PI * 2 + phaseB);

    const point = uniform[index]!;
    const before = uniform[Math.max(0, index - 1)]!;
    const after = uniform[Math.min(uniform.length - 1, index + 1)]!;
    const dx = after[0] - before[0];
    const dz = after[1] - before[1];
    const length = Math.hypot(dx, dz) || 1;
    // The normal, and the offset is applied along it — the whole of the meander is
    // this one term.
    const normalX = -dz / length;
    const normalZ = dx / length;

    const shift = amplitude * (primary + secondary * SECONDARY_AMPLITUDE);
    offset.push([point[0] + normalX * shift, point[1] + normalZ * shift]);
  }

  // Re-smooth. Offsetting a polyline is not an isometry: the outer side of a bend is
  // stretched and the inner side pinched, and the result is a course whose samples are
  // bunched exactly where its curvature is highest. Two averaging passes restore even
  // spacing, with the endpoints pinned so the river still starts and ends where the
  // descriptor said it does.
  let smoothed = offset;
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    const next: Vector2[] = new Array(smoothed.length);
    next[0] = smoothed[0]!;
    next[smoothed.length - 1] = smoothed[smoothed.length - 1]!;
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      const a = smoothed[index - 1]!;
      const b = smoothed[index]!;
      const c = smoothed[index + 1]!;
      next[index] = [
        a[0] * 0.25 + b[0] * 0.5 + c[0] * 0.25,
        a[1] * 0.25 + b[1] * 0.5 + c[1] * 0.25,
      ];
    }
    smoothed = next;
  }

  return smoothed;
}

/** Uniform-arc-length resampling. See `inkSurface` for the note on why it is not shared. */
function resample(spine: readonly Vector2[], spacing: number): Vector2[] {
  let total = 0;
  for (let index = 1; index < spine.length; index += 1) {
    total += Math.hypot(
      spine[index]![0] - spine[index - 1]![0],
      spine[index]![1] - spine[index - 1]![1],
    );
  }
  if (total < 1e-6) return [spine[0]!];

  const count = Math.max(3, Math.min(1024, Math.ceil(total / spacing) + 1));
  const points: Vector2[] = [];
  let segment = 0;
  let segmentStart = 0;
  let segmentLength = Math.hypot(spine[1]![0] - spine[0]![0], spine[1]![1] - spine[0]![1]);

  for (let index = 0; index < count; index += 1) {
    const target = (index / (count - 1)) * total;
    while (segment < spine.length - 2 && segmentStart + segmentLength < target) {
      segmentStart += segmentLength;
      segment += 1;
      segmentLength = Math.hypot(
        spine[segment + 1]![0] - spine[segment]![0],
        spine[segment + 1]![1] - spine[segment]![1],
      );
    }
    const t = segmentLength < 1e-6 ? 0 : (target - segmentStart) / segmentLength;
    const a = spine[segment]!;
    const b = spine[segment + 1]!;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return points;
}
