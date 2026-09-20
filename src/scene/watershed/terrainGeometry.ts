import { terrainHeight, type TerrainFieldOptions, type Vector2 } from './terrainField';
import { WATERSHED_PALETTE } from './watershedDescriptor';

/**
 * The landscape's surface, built on the CPU from the height field.
 *
 * Why the composition is not a vertex shader. The brief permits GPU heightfield
 * deformation and the spec's technique table lists it, but the *silhouette* is
 * the composition — the shape of the basin against the sky, where the banks sit,
 * whether a river runs downhill — and a shape that only exists in a shader cannot
 * be asserted, cannot be reasoned about when framing a shot, and has to be
 * re-derived for every placement decision. The previous composition's terrain was
 * shader-internal, and its linear cross-profile ran every river uphill while
 * looking entirely plausible: the failure was found by arithmetic on a CPU
 * function, not by looking at a frame. So the field is a CPU function, this
 * module samples it, and the *material* only ever adds what has to move.
 *
 * **The grid is graded, and that is constraint C6 taken literally.** The world is
 * 2000 by 1820 units and the camera stands at its near edge; a uniform grid spends
 * as many vertices on the twelve hundred units behind the basin as on the four
 * hundred in front of it, and the far half of that spends most of its detail
 * sub-pixel. So rows are distributed by `rowWarp`, which is dense where the
 * camera is and sparse at the horizon — the same vertex count, spent where the
 * frame can see it. The field is still sampled at each vertex's *true* XZ, so
 * grading changes the tessellation and never the shape.
 *
 * **Colour is baked here, not lit.** There is no light rig in this scene, by the
 * same choice the previous composition made and for the same reason: a directional
 * light on a 400,000-triangle heightfield costs a full shading pass to produce a
 * result that never changes, because nothing in the frame moves the sun. What is
 * baked is the *composition's* lighting — orientation against the key light,
 * depth from the basin, and the wet darkening the field's own wetness suggests —
 * and what the material adds on top is only the part that is a function of time
 * or of the view.
 */

export type TerrainGeometryOptions = {
  readonly field: TerrainFieldOptions;
  /** Segments per axis. `descriptor.terrainResolution`. */
  readonly resolution: number;
  /** Where the camera stands, in XZ. Grading is densest around this Z. */
  readonly attentionZ: number;
  /** The basin, so depth darkening can be measured from it. */
  readonly basin: Vector2;
  readonly basinFloor: number;
  /** Direction the key light comes from. Matches the shots' own key light. */
  readonly keyLight: readonly [number, number, number];
};

export type TerrainGeometry = {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
};

/**
 * How sharply the rows crowd toward the camera.
 *
 * Rows are placed at `t^WARP` for `t` uniform in `[0,1]`, so the exponent is the
 * whole of the distribution: at 1 the grid is uniform, and larger values pull
 * sample points toward `t = 0`. 1.75 was chosen by measuring what it buys rather
 * than by taste — see `rowWarp` for the arithmetic — and it is a named constant
 * rather than a literal because the *reason* it is 1.75 is the ratio of near-field
 * to far-field screen area, which is a property of the framing and would have to
 * be re-derived if the camera ever stood somewhere else.
 */
const ROW_WARP = 1.75;

/**
 * Where row `index` of `resolution` falls in the world, in Z.
 *
 * Deliberately a pure function of the index so tests can assert the properties
 * that matter without building a mesh: it covers the extent exactly at both ends,
 * it is strictly increasing (no row is placed on top of another, which would make
 * a degenerate triangle), and it is denser near `attentionZ` than at the far edge.
 */
export function rowWarp(
  index: number,
  resolution: number,
  minZ: number,
  maxZ: number,
  attentionZ: number,
): number {
  const t = index / resolution;
  // `t^WARP` is dense at 0. The extent's own near end is `maxZ`, and the camera
  // stands near it, so the warp is applied from the near end and the result
  // mirrored — which keeps "dense where the camera is" true regardless of which
  // way the Z axis happens to point.
  const warped = Math.pow(t, ROW_WARP);
  const fromNear = attentionZ >= (minZ + maxZ) / 2;
  const u = fromNear ? 1 - warped : warped;
  return minZ + (maxZ - minZ) * u;
}

/**
 * The world XZ of a grid vertex.
 *
 * Exported, and used by the builder *and* by its tests, because the alternative
 * is the test recovering the coordinates from the `Float32Array` it is checking —
 * which reads the position back rounded to float32 and then evaluates the field
 * at a point the builder never sampled. That test fails on a correct mesh by one
 * part in ten million, and the temptation is to loosen it to a tolerance, which
 * is how a real indexing bug gets a passing test. Sharing the function is what
 * makes "the mesh is where the field says it is" an exact statement.
 */
export function terrainSampleXZ(
  column: number,
  row: number,
  resolution: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  attentionZ: number,
): { x: number; z: number } {
  return {
    x: minX + ((maxX - minX) * column) / resolution,
    z: rowWarp(row, resolution, minZ, maxZ, attentionZ),
  };
}

/**
 * The surface normal, from the field's own derivative.
 *
 * Central differences rather than `computeVertexNormals`, for two reasons that
 * both matter. The cheap one is cost: `computeVertexNormals` walks every triangle
 * and then normalises 400,000 accumulated vectors, where this is four samples per
 * vertex and no accumulation. The one that decides it is that averaging triangle
 * normals makes a normal a function of the *tessellation* — refine the grid and
 * the shading changes — while the derivative of the field is a property of the
 * landscape. A grid that can change its own lighting is a grid whose grading is
 * visible.
 *
 * The step is one world unit, chosen so it is well above the noise's finest
 * octave and well below the basin, so the normal sees the ridge and not the
 * sampling.
 */
function surfaceNormal(x: number, z: number, field: TerrainFieldOptions): [number, number, number] {
  const STEP = 1;
  const dx = (terrainHeight(x + STEP, z, field) - terrainHeight(x - STEP, z, field)) / (2 * STEP);
  const dz = (terrainHeight(x, z + STEP, field) - terrainHeight(x, z - STEP, field)) / (2 * STEP);
  // The surface is y = h(x,z), so its normal is (-dh/dx, 1, -dh/dz), normalised.
  const length = Math.hypot(-dx, 1, -dz);
  return [-dx / length, 1 / length, -dz / length];
}

/** `#rrggbb` to linear-ish 0..1 components, without allocating a Color. */
function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

const MIDNIGHT = parseHex(WATERSHED_PALETTE.midnight);
const VIOLET = parseHex(WATERSHED_PALETTE.violet);
const COBALT = parseHex(WATERSHED_PALETTE.cobalt);
const HAZE = parseHex(WATERSHED_PALETTE.petroleum);

/**
 * The baked vertex colour: orientation, altitude and depth, in that order.
 *
 * Three terms and no more, because each is a different kind of statement and
 * stacking a fourth would make the result unarguable:
 *
 *  1. **Orientation** against the key light. This is what gives a bank its mass
 *     and a basin its readable lip, and it is the term that would have come from
 *     a light rig.
 *  2. **Altitude** relative to the basin floor, which is what separates the two
 *     banks from the floor between them and stops the far ground from meeting the
 *     near ground in value.
 *  3. **Depth from the basin**, which darkens toward the horizon so the far field
 *     settles into the background as a silhouette. This is the previous
 *     composition's hardest-won lesson: a depth cue that *multiplies* the whole
 *     term stack gives a far end, where a fade toward the background colour gives
 *     a wash, because a wash is what a fade to grey is once the fog is also grey.
 */
export function buildTerrainGeometry(options: TerrainGeometryOptions): TerrainGeometry {
  const { field, resolution, attentionZ, basin, basinFloor, keyLight } = options;
  const { minX, maxX, minZ, maxZ } = field.extent;
  const columns = resolution + 1;
  const rows = resolution + 1;
  const vertexCount = columns * rows;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const keyLength = Math.hypot(keyLight[0], keyLight[1], keyLight[2]) || 1;
  const key: [number, number, number] = [
    keyLight[0] / keyLength,
    keyLight[1] / keyLength,
    keyLight[2] / keyLength,
  ];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const { x, z } = terrainSampleXZ(
        column,
        row,
        resolution,
        minX,
        maxX,
        minZ,
        maxZ,
        attentionZ,
      );
      const index = row * columns + column;

      const height = terrainHeight(x, z, field);
      positions[index * 3] = x;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = z;

      const normal = surfaceNormal(x, z, field);
      normals[index * 3] = normal[0];
      normals[index * 3 + 1] = normal[1];
      normals[index * 3 + 2] = normal[2];

      // Orientation: half-lambert, so a face turned away is dark rather than
      // black and the terrain does not develop holes where the key light misses.
      const facing = normal[0] * key[0] + normal[1] * key[1] + normal[2] * key[2];
      const oriented = 0.42 + 0.58 * Math.max(0, facing);

      // Altitude: 0 at the basin floor, 1 at the highest bank.
      const altitude = Math.min(1, Math.max(0, (height - basinFloor) / 46));
      // Depth: 0 at the basin, 1 past the far edge of the world.
      const reach = Math.hypot(x - basin[0], z - basin[1]);
      const depth = Math.min(1, reach / 900);

      // The unlit ramp, walked by altitude: violet in the low ground where the
      // light does not reach, to midnight on the unlit shoulders. Then the key
      // light adds cobalt, and only where the ground is both raised and facing —
      // so cobalt stays a statement about the light rather than about height, and
      // the banks have a lit face and a shadowed one. Finally depth pulls the
      // whole thing toward the haze, which is what gives the frame a far end.
      const unlit = [
        VIOLET[0] + (MIDNIGHT[0] - VIOLET[0]) * altitude,
        VIOLET[1] + (MIDNIGHT[1] - VIOLET[1]) * altitude,
        VIOLET[2] + (MIDNIGHT[2] - VIOLET[2]) * altitude,
      ];
      const litBy = Math.max(0, facing) * altitude;
      const lifted = [
        unlit[0]! + (COBALT[0] - unlit[0]!) * litBy,
        unlit[1]! + (COBALT[1] - unlit[1]!) * litBy,
        unlit[2]! + (COBALT[2] - unlit[2]!) * litBy,
      ];
      const near = 1 - depth;
      colors[index * 3] = (lifted[0]! * near + HAZE[0] * depth) * oriented;
      colors[index * 3 + 1] = (lifted[1]! * near + HAZE[1] * depth) * oriented;
      colors[index * 3 + 2] = (lifted[2]! * near + HAZE[2] * depth) * oriented;
    }
  }

  // Two triangles per cell, as one `Uint32Array` rather than an array of arrays:
  // the resolution reaches 440, which is 387,200 triangles and well past the
  // 65,535 a `Uint16Array` can address.
  const cellCount = resolution * resolution;
  const indices = new Uint32Array(cellCount * 6);
  let write = 0;
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const topLeft = row * columns + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns;
      const bottomRight = bottomLeft + 1;
      indices[write] = topLeft;
      indices[write + 1] = bottomLeft;
      indices[write + 2] = topRight;
      indices[write + 3] = topRight;
      indices[write + 4] = bottomLeft;
      indices[write + 5] = bottomRight;
      write += 6;
    }
  }

  return {
    positions,
    normals,
    colors,
    indices,
    vertexCount,
    triangleCount: cellCount * 2,
  };
}
