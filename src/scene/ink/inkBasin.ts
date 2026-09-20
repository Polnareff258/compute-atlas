import type { Vector2 } from '../watershed/terrainField';

/**
 * The Convergence Basin: the place everything in the world arrives at.
 *
 * ## What it is, in this composition's terms
 *
 * The brief calls it a region rather than an object — "it is not an object and has no surface
 * of its own: it is a region of the terrain, defined by the layered surfaces, the incoming
 * rivers, the volumetric density and the interior glow where flow compresses". The ink
 * composition already has all four of those in one density field, so the basin does not need
 * a structure built for it. It needs the field to be *read* differently there, and a surface
 * to read it on.
 *
 * This builds that surface: a disc of concentric rings over the basin, graded so the centre
 * is dense and the rim is coarse. It carries the same material as the ground, sampling the
 * same field at the same world UV, so the basin is not a second thing placed in the world —
 * it is the same world, seen where its density is highest.
 *
 * ## Ownership, again, and why it is not optional here
 *
 * Every corridor is displaced by the same field sampled by world position, so any two
 * surfaces over the same ground are *exactly coincident* and z-fight — the failure that made
 * an earlier capture read as shattered geometry. The basin overlaps the corridors by
 * construction: the rivers run into it. So the same rule applies, from the other side: a
 * basin quad is emitted only where **no corridor already owns the ground**. The two meshes
 * then partition the world between them, and there is no ground with two surfaces on it.
 *
 * The test is against each course's own reach rather than against the nearest spine, because
 * a corridor is not a set of points — it is a band of a particular width, and a quad outside
 * a creek's spine may still be inside its band.
 */

export type BasinCourses = {
  readonly spine: readonly Vector2[];
  readonly width: number;
};

export type InkBasinOptions = {
  readonly centre: Vector2;
  readonly radius: number;
  readonly extent: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
  /** The courses whose corridors already cover ground, so this may not cover it again. */
  readonly courses: readonly BasinCourses[];
  /** The same multiple `buildInkCorridor` used, so the two agree about where a band ends. */
  readonly reachMultiple: number;
  /** Ring count from centre to rim, at detail 1. */
  readonly rings: number;
  /** Samples around the circumference, at detail 1. */
  readonly segments: number;
  /** How far past its own radius the basin reaches, so its edge is in the black. */
  readonly rimMargin: number;
  readonly detail: number;
};

export type InkBasin = {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
};

/**
 * The radial grading, applied to the normalised radius.
 *
 * Pulls rings toward the rim, so the outer, emptier part of the basin gets fewer vertices
 * than the middle where the strata and the confluence are. `r^0.72` is gentler than the
 * corridor's own grading because a disc's area already grows with radius — grading it as
 * hard as a band would leave the centre over-tessellated *and* the rim under-tessellated.
 */
const RADIAL_GRADING = 0.72;

/** How close two spine samples may be for the ownership test, in world units. */
const OWNERSHIP_SPACING = 26;

export function buildInkBasin(options: InkBasinOptions): InkBasin {
  const { extent, detail } = options;
  const spanX = extent.maxX - extent.minX;
  const spanZ = extent.maxZ - extent.minZ;
  const detailScale = Math.max(0.35, detail);

  const rings = Math.max(3, Math.round(options.rings * detailScale));
  const segments = Math.max(8, Math.round(options.segments * detailScale));
  const outer = Math.max(1, options.radius * options.rimMargin);

  // The corridors, coarsely resampled once and reused for every quad. See the module note:
  // the boundary this decides is a seam between two surfaces that would otherwise be
  // coincident, so it only has to be right to within a quad, and a stride of this size is
  // four times cheaper than testing every sample.
  const bands = options.courses.map((course) => ({
    samples: coarseSamples(course.spine),
    reach: Math.max(1, course.width * options.reachMultiple / 2),
  }));

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const radius = Math.pow(t, RADIAL_GRADING) * outer;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = options.centre[0] + Math.cos(angle) * radius;
      const z = options.centre[1] + Math.sin(angle) * radius;
      positions.push(x, 0, z);
      uvs.push((x - extent.minX) / spanX, (z - extent.minZ) / spanZ);
    }
  }

  const indexAt = (ring: number, segment: number) => ring * segments + (segment % segments);

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = indexAt(ring, segment);
      const b = indexAt(ring, segment + 1);
      const c = indexAt(ring + 1, segment);
      const d = indexAt(ring + 1, segment + 1);

      /*
       * The ownership test, on the quad's own centre.
       *
       * Per-quad rather than per-vertex, for the reason the corridor builder gives: per-vertex
       * leaves orphan corners and a ragged boundary with holes, while per-quad gives a clean
       * partition where every piece of ground belongs to exactly one surface.
       */
      const centreX = (positions[a * 3]! + positions[c * 3]!) / 2;
      const centreZ = (positions[a * 3 + 2]! + positions[c * 3 + 2]!) / 2;
      if (coveredByCorridor(centreX, centreZ, bands)) continue;

      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

type Band = { readonly samples: readonly Vector2[]; readonly reach: number };

/** True when any corridor's band already covers this ground. */
function coveredByCorridor(x: number, z: number, bands: readonly Band[]): boolean {
  for (const band of bands) {
    const limit = band.reach * band.reach;
    for (let index = 0; index < band.samples.length; index += 1) {
      const point = band.samples[index]!;
      const dx = point[0] - x;
      const dz = point[1] - z;
      if (dx * dx + dz * dz <= limit) return true;
    }
  }
  return false;
}

/** A spine resampled at a fixed world spacing, for the ownership test only. */
function coarseSamples(spine: readonly Vector2[]): Vector2[] {
  if (spine.length < 2) return spine.length === 1 ? [spine[0]!] : [];
  const samples: Vector2[] = [];
  let carry = 0;
  for (let index = 1; index < spine.length; index += 1) {
    const a = spine[index - 1]!;
    const b = spine[index]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-6) continue;
    let travelled = carry;
    while (travelled <= length) {
      const t = travelled / length;
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      travelled += OWNERSHIP_SPACING;
    }
    carry = travelled - length;
  }
  const last = spine[spine.length - 1]!;
  if (samples.length === 0 || samples[samples.length - 1]![0] !== last[0]) samples.push(last);
  return samples;
}
