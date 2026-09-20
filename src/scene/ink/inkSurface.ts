import type { Vector2 } from '../watershed/terrainField';

/**
 * The hero surface: a graded corridor along each river's course.
 *
 * ## Why the mesh is wide, and why that is the whole point
 *
 * A mesh whose outline is a river shape is a ribbon, however it is shaded, and the brief
 * forbids the ribbon twice over. This corridor is therefore built **many times wider than
 * the channel** — far past where the density field has already decayed to nothing — so
 * that every edge of the geometry sits in a region whose value is zero. The silhouette a
 * viewer sees is the density field's, and the mesh's own boundary is somewhere they cannot
 * find. That is the difference between "a river with soft banks" and "a soft field that
 * happens to have a river in it", and only the second one is what the brief asks for.
 *
 * The cost is vertices spent on ground that draws black. The grading below pays for it:
 * samples are pulled toward the spine by a power curve, so the middle of the corridor —
 * where all the structure is — is fine and the outer three quarters are coarse.
 *
 * ## Ownership, and the bug that made this necessary
 *
 * **Every corridor is displaced by the same density field, sampled by world position.** So
 * where two corridors overlap they do not merely cross: they are *exactly coincident
 * surfaces*, at every point, by construction. Two opaque surfaces at identical depth is
 * the worst case the depth buffer has, and the result is not a subtle artefact — it is a
 * frame that reads as shattered, jagged, disconnected fragments, which is precisely how
 * the vision pass described it when the corridor reach was raised and the overlap grew.
 * It is worth being exact about the magnitude: this was reported as "a graphical glitch or
 * a broken simulation", and it was one.
 *
 * The fix is that no two corridors may cover the same ground. Each quad is assigned to the
 * course whose spine is nearest its centre, and a quad belonging to another course is not
 * emitted. The union is then a partition — no overlap, and no gaps either, because every
 * quad in the world belongs to exactly one course.
 *
 * The partition boundary is approximated coarsely, and that is a deliberate saving rather
 * than a shortcut: the boundary between two courses lies where *both* are far from their
 * spines, which is to say in the black. A boundary placed slightly wrong moves a seam
 * between two regions that are both drawing zero, and since the two surfaces also have
 * identical height wherever they meet, even an exactly-wrong line produces no crack. A
 * stride of four spine samples is therefore indistinguishable from an exact test, at a
 * quarter of the cost, on a build that runs inside the page's load.
 */

/** One river, as the corridor builder needs it. */
export type CorridorCourse = {
  readonly spine: readonly Vector2[];
  readonly width: number;
};

export type InkCorridorOptions = {
  readonly courses: readonly CorridorCourse[];
  readonly extent: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
  /** World units between samples *along* the course, before detail scaling. */
  readonly alongStep: number;
  /**
   * How far the corridor reaches from the spine, as a multiple of the river's own width.
   *
   * Twenty-two, against a density field whose own reach is three and a half. The ratio
   * between this and the field's reach is the composition's margin of invisibility, and it
   * is deliberately large: at two-to-one the field's faintest tail would still be legible
   * at the mesh edge and the edge would reappear as a rim. Raising it is now safe because
   * the ownership partition above removes the overlap that made it dangerous.
   */
  readonly reachMultiple: number;
  /** Across-corridor sample count, at detail 1. */
  readonly acrossCount: number;
  /** `0`..`1`. Scales the along-corridor sample count and the across count. */
  readonly detail: number;
};

export type InkCorridor = {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
};

/**
 * The exponent pulling across-corridor samples toward the spine.
 *
 * `|t|^1.9` over `t` in `-1..1` maps the outer half of the parameter range onto the outer
 * fifth of the corridor, so half of the across-samples land inside about twenty per cent
 * of the width — the region where the pigment actually has a gradient. A linear
 * distribution would spend sixty per cent of its vertices on ground that is uniformly
 * black, and the channel's own edge — the one place the eye looks for detail — would be
 * the coarsest part of the mesh.
 */
const ACROSS_GRADING = 1.9;

/**
 * How close two consecutive spine samples may be, in world units.
 *
 * A floor rather than a target: the descriptor's spines vary in length by an order of
 * magnitude, and a step that suited the longest would put four vertices across a creek's
 * whole meander. Small enough to follow the tightest bend the descriptor can generate.
 */
const MIN_ALONG_STEP = 3;

/**
 * How often a spine sample is kept for the ownership test.
 *
 * See the module note: the boundary this decides lies in the black, so four is
 * indistinguishable from one and a quarter of the work.
 */
const OWNERSHIP_STRIDE = 4;

/** A course, resampled and ready. */
type PreparedCourse = {
  readonly points: readonly Vector2[];
  /** A strided copy, used only by the ownership test. */
  readonly coarse: readonly Vector2[];
};

export function buildInkCorridor(options: InkCorridorOptions): InkCorridor {
  const { extent, detail } = options;
  const spanX = extent.maxX - extent.minX;
  const spanZ = extent.maxZ - extent.minZ;

  const alongStep = Math.max(MIN_ALONG_STEP, options.alongStep / Math.max(0.35, detail));
  const acrossCount = Math.max(6, Math.round(options.acrossCount * Math.max(0.35, detail)));

  const prepared: PreparedCourse[] = [];
  for (const course of options.courses) {
    if (course.spine.length < 2) continue;
    const points = resample(course.spine, alongStep);
    if (points.length < 2) continue;
    const coarse: Vector2[] = [];
    for (let index = 0; index < points.length; index += OWNERSHIP_STRIDE) {
      coarse.push(points[index]!);
    }
    // The endpoint is always kept, so a course shorter than one stride still has a
    // representative sample and cannot end up owning nothing.
    const last = points[points.length - 1]!;
    if (coarse[coarse.length - 1] !== last) coarse.push(last);
    prepared.push({ points, coarse });
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let courseIndex = 0; courseIndex < prepared.length; courseIndex += 1) {
    const course = prepared[courseIndex]!;
    const points = course.points;
    const reach = Math.max(1, (options.courses[courseIndex]?.width ?? 8) * options.reachMultiple / 2);
    const base = positions.length / 3;

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]!;
      const before = points[Math.max(0, i - 1)]!;
      const after = points[Math.min(points.length - 1, i + 1)]!;
      const dx = after[0] - before[0];
      const dz = after[1] - before[1];
      const length = Math.hypot(dx, dz) || 1;
      // `forward × up`, in XZ: the corridor's cross direction.
      const normalX = -dz / length;
      const normalZ = dx / length;

      for (let j = 0; j < acrossCount; j += 1) {
        const t = (j / (acrossCount - 1)) * 2 - 1;
        const offset = Math.sign(t) * Math.pow(Math.abs(t), ACROSS_GRADING) * reach;
        const x = point[0] + normalX * offset;
        const z = point[1] + normalZ * offset;
        positions.push(x, 0, z);
        // The world UV. This is the only parameterisation anywhere in the ink system:
        // the material samples the field by it, the displacement is the field evaluated
        // there, and the shading gradient is taken in it.
        uvs.push((x - extent.minX) / spanX, (z - extent.minZ) / spanZ);
      }
    }

    /*
     * Two triangles per quad, wound counter-clockwise seen from above, emitted only where
     * this course owns the ground.
     *
     * Ownership is decided per *quad* rather than per vertex. Per-vertex would leave
     * orphaned corners and a ragged boundary with holes in it; per-quad gives a partition
     * in which every piece of ground belongs to exactly one course, which is the property
     * that removes the coincident surfaces.
     *
     * There is no `normal` attribute: the surface is displaced per-vertex by the field and
     * the material reads the field's own gradient in the fragment stage, so a baked normal
     * would be a statement about the undisplaced mesh that the displacement immediately
     * falsifies.
     */
    for (let i = 0; i < points.length - 1; i += 1) {
      for (let j = 0; j < acrossCount - 1; j += 1) {
        const a = base + i * acrossCount + j;
        const centreX = (positions[a * 3]! + positions[(a + 1) * 3]! + positions[(a + acrossCount) * 3]! + positions[(a + acrossCount + 1) * 3]!) / 4;
        const centreZ = (positions[a * 3 + 2]! + positions[(a + 1) * 3 + 2]! + positions[(a + acrossCount) * 3 + 2]! + positions[(a + acrossCount + 1) * 3 + 2]!) / 4;
        if (ownerOf(centreX, centreZ, prepared) !== courseIndex) continue;

        const b = a + 1;
        const c = a + acrossCount;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
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

/**
 * Which course's spine is nearest a point.
 *
 * Squared distances throughout, and no square root at the end: this only ever compares
 * one distance against another, so the root would be taken and thrown away.
 */
function ownerOf(x: number, z: number, prepared: readonly PreparedCourse[]): number {
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let courseIndex = 0; courseIndex < prepared.length; courseIndex += 1) {
    const samples = prepared[courseIndex]!.coarse;
    for (let index = 0; index < samples.length; index += 1) {
      const point = samples[index]!;
      const dx = point[0] - x;
      const dz = point[1] - z;
      const squared = dx * dx + dz * dz;
      if (squared < best) {
        best = squared;
        bestIndex = courseIndex;
      }
    }
  }
  return bestIndex;
}

/**
 * Resamples a polyline to uniform arc length, never emitting fewer than two points.
 *
 * Deliberately near-identical to the density bake's own resampler rather than shared with
 * it, because the two have different jobs and a shared version would need options neither
 * wants: the bake resamples at half a river's width to place distance queries, and this
 * resamples at a world step to place vertices. Sharing them would tie the mesh's vertex
 * count to the texture's texel size, a coupling discovered the first time someone changed
 * one of them.
 */
function resample(spine: readonly Vector2[], step: number): Vector2[] {
  let total = 0;
  for (let index = 1; index < spine.length; index += 1) {
    total += Math.hypot(
      spine[index]![0] - spine[index - 1]![0],
      spine[index]![1] - spine[index - 1]![1],
    );
  }
  if (total < 1e-6) return [spine[0]!];

  const count = Math.max(2, Math.min(2048, Math.ceil(total / step) + 1));
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

export type VeilOptions = {
  readonly extent: InkCorridorOptions['extent'];
  readonly subdivisions: number;
};

/**
 * The veil: a large, undisplaced, translucent sheet above the ground.
 *
 * This carries the composition's 70% layer where the ground cannot — out beyond the
 * corridor, and *above* it, where a second surface parallaxes differently from the one
 * under it. That parallax is the only depth cue available in a frame with no horizon and
 * no fog band, and it is what stops a near-top-down composition from reading as a flat map.
 *
 * It is a *derivative* of the density field and nothing else: the same field, the same UV,
 * sampled at a height, drifting at its own slightly slower rate. The brief permits exactly
 * this and forbids the alternative — a sheet with its own separate effect — and the
 * distinction is kept by the veil having no terms of its own beyond a gain.
 */
export function buildInkVeil(options: VeilOptions): InkCorridor {
  const { extent } = options;
  const spanX = extent.maxX - extent.minX;
  const spanZ = extent.maxZ - extent.minZ;
  const n = Math.max(4, Math.round(options.subdivisions));

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const u = i / n;
      const v = j / n;
      positions.push(extent.minX + u * spanX, 0, extent.minZ + v * spanZ);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
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
