import { terrainHeight, type TerrainFieldOptions, type Vector2 } from './terrainField';

/**
 * The water's surface, as ribbons laid along the rivers' own courses.
 *
 * **Why a ribbon per river rather than one sheet over the world.** The obvious
 * build is a single grid across the extent whose material fades out wherever the
 * flow field says there is no water — one draw call, no per-river geometry, and it
 * needs no knowledge of the spines at all. It was rejected on fill rate and on
 * resolution, and both objections are real:
 *
 *  - *Fill rate.* The extent is 2000 by 1820 world units and the rivers cross most
 *    of it, so a sheet covering the world is a full-screen transparent pass that
 *    is almost entirely zero-alpha. Everything it draws where there is no water is
 *    a fragment that samples the flow texture, evaluates a fade and writes nothing.
 *  - *Resolution.* The water has to follow a channel whose lateral profile is the
 *    whole point of it — dense core, soft shoulder — and a uniform grid spends its
 *    density everywhere equally. To resolve the nine-unit probe the grid would have
 *    to be fine enough to resolve all of it, which is the same cost as the terrain
 *    mesh, for water.
 *
 * A ribbon solves both by construction: it is exactly as wide as the water can be,
 * it is laid *across* the flow so its lateral samples land where the profile is,
 * and there is no geometry anywhere the water is not. The cost is that it has to
 * know the spine, which is a thing the descriptor already publishes.
 *
 * **Why `y` comes from the height field and not from the spine.** A vertex here is
 * placed at `terrainHeight(x, z)`, which is the same function the terrain mesh
 * samples, so the ribbon's own `positionLocal` is the same value the ground mesh
 * would have at that point. That matters because both materials evaluate their
 * displacement from `positionLocal` — including a 3D noise for the relief — so two
 * meshes whose vertices sit at the same `(x, y, z)` displace to the same place, and
 * the water cannot end up inside the hill it is supposed to be flowing down. A
 * ribbon whose `y` came from somewhere else, or from zero, would displace against
 * a different noise field and float.
 *
 * **What is deliberately not here.** No normals, no colours, no UVs. The ribbon is
 * a canvas for the flow field: everything that makes it look like water is a
 * function of where it is, and the material derives that from XZ exactly the way
 * the ground's does. Adding an attribute would be a second source for a fact the
 * flow texture already holds.
 */

/**
 * How far a river's influence reaches, as a multiple of its half-width.
 *
 * The same figure as `flowField`'s `EROSION_REACH`, and it has to be: this is how
 * wide the ribbon is drawn, and the flow field is how wide it says the water is.
 * A ribbon narrower than the field would cut the water off at its own edge, with
 * the alpha still high where it was clipped — a river ending in a straight line,
 * which is the one thing a river does not do.
 */
export const EROSION_REACH = 2.6;

/**
 * Where the ribbon puts its lateral samples, as a fraction of the reach.
 *
 * Dense in the middle and sparse at the rim, which is where the information is:
 * the erosion profile is `(1 - d/reach)²`, so the core is where it changes fastest
 * and the outer half is where it is nearly flat and nearly zero. Evenly spaced
 * samples would spend half the ribbon describing the part that is invisible, and
 * the part that carries the river would be three columns wide.
 *
 * The extremes are exactly ±1 — the edge of the reach, where the flow field's own
 * erosion has fallen to zero — so the outermost column is guaranteed to be a
 * zero-alpha edge rather than a guess at where the water stops.
 */
const LATERAL = [0, 0.08, 0.18, 0.3, 0.45, 0.65, 1] as const;

/** The lateral positions in order, mirrored about the centre line. */
const COLUMNS: readonly number[] = [
  ...LATERAL.slice(1).map((value) => -value).reverse(),
  ...LATERAL,
];

export type RiverRibbon = {
  readonly spine: readonly Vector2[];
  /** Half-width of the flowing body at full strength, in world units. */
  readonly width: number;
};

export type RiverGeometry = {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
};

export type RiverGeometryOptions = {
  readonly field: TerrainFieldOptions;
  readonly rivers: readonly RiverRibbon[];
};

/**
 * The unit vector perpendicular to the spine at one point.
 *
 * Taken from the *neighbours* rather than from the segment ahead, so the ribbon
 * turns smoothly: a normal taken from one segment only would rotate in a step at
 * every spine point, and the four columns on either side of that step would fan
 * out and cross. At the ends the one-sided difference is used, because a river's
 * source and mouth are points and there is no neighbour beyond them.
 *
 * Returned as `(-tz, tx)`, which is the tangent turned a quarter turn. The sign
 * decides which lateral column is first, and therefore the winding — see
 * `buildRiverGeometry`'s note on facing.
 */
function perpendicularAt(spine: readonly Vector2[], index: number): Vector2 {
  const previous = spine[Math.max(0, index - 1)]!;
  const next = spine[Math.min(spine.length - 1, index + 1)]!;
  const dx = next[0] - previous[0];
  const dz = next[1] - previous[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [1, 0];
  return [-dz / length, dx / length];
}

export function buildRiverGeometry(options: RiverGeometryOptions): RiverGeometry {
  const { field, rivers } = options;

  const positions: number[] = [];
  const indices: number[] = [];

  for (const river of rivers) {
    if (river.spine.length < 2) continue;

    const reach = Math.max(river.width, 1) * EROSION_REACH;
    const base = positions.length / 3;

    for (let index = 0; index < river.spine.length; index += 1) {
      const point = river.spine[index]!;
      const [nx, nz] = perpendicularAt(river.spine, index);

      for (const column of COLUMNS) {
        const x = point[0] + nx * column * reach;
        const z = point[1] + nz * column * reach;
        positions.push(x, terrainHeight(x, z, field), z);
      }
    }

    // Two triangles per cell, wound counter-clockwise seen from above so the
    // ribbon is front-facing under the default `FrontSide`.
    //
    // This is not a formality and the terrain mesh is the proof: it was wound the
    // other way for a whole stage, and a height field wound backwards is not a
    // slightly wrong surface, it is a surface that is *not drawn* — every triangle
    // is culled and the world renders as a handful of ribbons over the sky. The
    // order below is `(a, c, b)` and `(b, c, d)` rather than the `(a, b, c)` and
    // `(b, c, d)` that reads more naturally, and `riverGeometry.test.ts` checks the
    // facing directly rather than leaving it to whoever edits this next.
    const stride = COLUMNS.length;
    const rows = river.spine.length;
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < stride - 1; column += 1) {
        const a = base + row * stride + column;
        const b = base + (row + 1) * stride + column;
        const c = base + row * stride + column + 1;
        const d = base + (row + 1) * stride + column + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
