import type { Vector2 } from '../watershed/terrainField';

/**
 * The composition's one surface.
 *
 * ## What this replaces, and why the thing it replaces was wrong
 *
 * The previous version built a separate graded corridor along each river and deleted the quads
 * that belonged to another river, on the theory that the survivors formed a partition with no
 * two surfaces over the same ground. That theory was wrong in a way that produced the frame's
 * worst visible defect.
 *
 * A partition requires the pieces to *tile*: every quad given up by one corridor has to be
 * present in another, at the same place. These corridors were independently generated grids
 * along independently curved spines, so no such correspondence exists. A quad dropped by the
 * creek was simply **not replaced** by anything, and the world acquired a hole along every
 * midline between two rivers — with the further damage that the basin used a third covering
 * rule again, so its boundary could not be complementary with the corridors either. The large
 * black gaps and detached polygons in the render are those holes.
 *
 * The lesson is worth keeping, and it is not "the partition was implemented badly": it is that
 * **a coverage rule expressed through topology cannot be made robust when the topology is
 * generated per feature.** Two independently generated meshes have no shared notion of a
 * location, so no rule written over them can promise anything about their union.
 *
 * ## What is here instead
 *
 * One grid over the world. Every quad exists, so the surface is continuous by construction, and
 * the river, the basin and the five regions are differences in the *field* rather than gaps in
 * the mesh — which is where they always belonged, because that is what they are. The material
 * already reads a density field sampled by world position; a feature is a place where that
 * field has a value, and it never needed a mesh of its own.
 *
 * The cost is vertices spent on ground that draws black, and on a high-end desktop target that
 * is the right trade: the brief asks for "a large-scale highly subdivided river surface or a
 * continuous compute domain", and a continuous domain cannot be assembled from pieces that do
 * not know about each other. The quality ladder spends that budget honestly — the tiers change
 * the resolution and nothing else, so a lower tier is the same world through a coarser grid
 * rather than a different construction.
 */

export type WorldExtent = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type InkSurfaceOptions = {
  readonly extent: WorldExtent;
  /** Vertices along the longer axis at detail 1. */
  readonly resolution: number;
  /** `0`..`1`. Scales the resolution; never the surface's extent. */
  readonly detail: number;
};

export type InkSurface = {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
};

/**
 * The floor and ceiling on the resolution, in vertices along the long axis.
 *
 * The floor exists because a grid coarser than the density field's own texel spacing cannot
 * express the field it is sampling: the relief aliases into noise and the surface becomes a
 * worse description of the world than the texture it is reading. The ceiling exists because
 * beyond it the grid is finer than the simulation can answer for, and every extra vertex costs
 * build time and bandwidth to interpolate between samples that are already smooth.
 */
const MIN_RESOLUTION = 192;
const MAX_RESOLUTION = 1024;

export function buildInkSurface(options: InkSurfaceOptions): InkSurface {
  const { extent } = options;
  const spanX = extent.maxX - extent.minX;
  const spanZ = extent.maxZ - extent.minZ;

  const detail = Math.max(0.2, Math.min(1, options.detail));
  const longAxis = Math.max(
    MIN_RESOLUTION,
    Math.min(MAX_RESOLUTION, Math.round(options.resolution * detail)),
  );

  const longerIsX = spanX >= spanZ;
  const columns = longerIsX ? longAxis : Math.max(8, Math.round((longAxis * spanX) / spanZ));
  const rows = longerIsX ? Math.max(8, Math.round((longAxis * spanZ) / spanX)) : longAxis;
  const stride = columns + 1;

  const vertexCount = stride * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const z = extent.minZ + v * spanZ;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const vertex = row * stride + column;
      positions[vertex * 3] = extent.minX + u * spanX;
      positions[vertex * 3 + 1] = 0;
      positions[vertex * 3 + 2] = z;
      // The world UV, and the only parameterisation in the ink system: the material samples the
      // field by it, the displacement is the field evaluated there, and the shading gradient is
      // taken in it. A grid-local UV would put the mesh and the shading in two coordinate
      // systems that drift apart wherever the grid is not the world.
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
    }
  }

  /*
   * Two triangles per quad, wound counter-clockwise seen from above.
   *
   * There is no `normal` attribute. The surface is displaced per-vertex by the density field and
   * the material reads that field's own gradient in the fragment stage, so a baked normal would
   * be a statement about the undisplaced grid that the displacement immediately falsifies — it
   * would cost bandwidth and be wrong everywhere the field is doing anything.
   */
  const quadCount = columns * rows;
  const indices = new Uint32Array(quadCount * 6);
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * stride + column;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[index] = a;
      indices[index + 1] = c;
      indices[index + 2] = b;
      indices[index + 3] = b;
      indices[index + 4] = c;
      indices[index + 5] = d;
      index += 6;
    }
  }

  return { positions, uvs, indices, vertexCount, triangleCount: quadCount * 2 };
}

export type VeilOptions = {
  readonly extent: WorldExtent;
  readonly subdivisions: number;
};

/**
 * The veil: a translucent sheet above the ground, carrying the same field.
 *
 * It is not part of the solid topology, and that is why it is allowed to be a second mesh after
 * everything above argues for one. It sits ninety-six world units *above* the ground and is
 * drawn translucent, so it is never coincident with anything and cannot z-fight; and it is a
 * derived expression of the same density field, which is what the brief permits a membrane to
 * be.
 *
 * Its job is parallax. In a frame with no horizon, a single surface at a single height gives the
 * eye no way to tell a near feature from a far one once the camera starts moving, and the veil
 * sliding across the ground at a different rate is the only depth cue available.
 */
export function buildInkVeil(options: VeilOptions): InkSurface {
  const { extent } = options;
  const spanX = extent.maxX - extent.minX;
  const spanZ = extent.maxZ - extent.minZ;
  const n = Math.max(4, Math.round(options.subdivisions));
  const stride = n + 1;

  const vertexCount = stride * stride;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let row = 0; row <= n; row += 1) {
    const v = row / n;
    for (let column = 0; column <= n; column += 1) {
      const u = column / n;
      const vertex = row * stride + column;
      positions[vertex * 3] = extent.minX + u * spanX;
      positions[vertex * 3 + 1] = 0;
      positions[vertex * 3 + 2] = extent.minZ + v * spanZ;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
    }
  }

  const indices = new Uint32Array(n * n * 6);
  let index = 0;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const a = row * stride + column;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[index] = a;
      indices[index + 1] = c;
      indices[index + 2] = b;
      indices[index + 3] = b;
      indices[index + 4] = c;
      indices[index + 5] = d;
      index += 6;
    }
  }

  return { positions, uvs, indices, vertexCount, triangleCount: n * n * 2 };
}

/** A course, as the hero framing still needs it. Nothing builds geometry from one any more. */
export type CorridorCourse = {
  readonly spine: readonly Vector2[];
  readonly width: number;
};
