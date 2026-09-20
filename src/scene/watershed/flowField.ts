import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

import { distanceToSpine, type DepositShape, type TerrainFieldOptions, type Vector2 } from './terrainField';

/**
 * The world's flow, as a texture.
 *
 * The spec's technique table names flow-map terrain interaction, and this is it:
 * one RGBA texture over the extent, in which each texel says how much water is
 * here and what it is doing. The terrain material reads it in the vertex stage to
 * erode and deposit, and in the fragment stage to decide where the ground is wet,
 * glowing or compressed; the river material reads the same texture so the two
 * agree about where the water is.
 *
 * **Why a texture rather than a vertex attribute or a shader function.** Three
 * options were on the table:
 *
 *  - *Bake it per terrain vertex.* The most obvious, and the one that couples the
 *    flow to the mesh: the flow would then exist only where the terrain resolution
 *    put a vertex, so SAFE's mesh would lose the rivers that SAFE is required to
 *    keep. It would also spend a spine-to-point distance per vertex per river, and
 *    the terrain build is already the one long block before the first paint.
 *  - *Compute it in the shader from the river spines.* Nineteen spines is a
 *    uniform array nobody can size, and per-fragment polyline distance is the
 *    most expensive thing in this module by two orders of magnitude.
 *  - *A texture.* Fixed cost, resolution decoupled from both the mesh and the
 *    screen, sampled by any material that wants it, and — the reason that decides
 *    it — the *same* field for the terrain and the water, so "the ground is eroded
 *    here" and "the water flows here" cannot drift apart.
 *
 * **What the four channels mean.** All four are gauges in `0..1`, which is why
 * 8 bits each is enough and why the texture is `RGBA8` rather than float: `RGBA8`
 * filters with bilinear sampling on every backend without an extension, and at a
 * megabyte it is not worth an extension to avoid.
 *
 * | Channel | Meaning |
 * |---|---|
 * | `R` erosion | How hard the water works this ground. 1 at a river's centre. |
 * | `G` along   | Where along its river this stretch sits, `0..1` from source to mouth. |
 * | `B` rate    | The winning river's own `flowRate`. Not a distance — a speed. |
 * | `A` deposit | How much sediment has settled here. 1 at a deposit's centre. |
 *
 * `G` and `B` are deliberately *the winning river's*, not a sum over all of them:
 * a texel belongs to the river it is nearest, which is the only assignment that
 * makes `along` mean one thing at a texel. Where two rivers overlap, the stronger
 * one wins, which is also what the confluence looks like.
 *
 * **8 bits is enough for `G` because the band that reads it is large.** The
 * travelling highlight on a river repeats a handful of times over its whole
 * length, so 255 steps cover a repeat many times over. It would not be enough for
 * a fine scrolling detail, and the fine detail is therefore procedural in the
 * material rather than stored here — which is the right division anyway, because
 * a procedural term can be authored and a stored one can only be resampled.
 */

export type FlowSource = {
  readonly spine: readonly Vector2[];
  /** The river's half-width at full strength, in world units. */
  readonly width: number;
  readonly flowRate: number;
};

export type FlowFieldOptions = {
  readonly field: TerrainFieldOptions;
  readonly rivers: readonly FlowSource[];
  readonly deposits: readonly DepositShape[];
  /** Texels per axis. `descriptor.flowResolution`. */
  readonly resolution: number;
};

export type FlowField = {
  readonly texture: DataTexture;
  readonly resolution: number;
  /** The world rectangle the texture covers, so a shader can map XZ into UV. */
  readonly extent: TerrainFieldOptions['extent'];
  dispose(): void;
};

/**
 * How far a river's influence reaches, as a multiple of its half-width.
 *
 * The carve in `terrainField` uses the same idea with its own width, and the two
 * being *close* matters more than the two being equal: the flow field is what the
 * material erodes by, so a material erosion reach much wider than the geometric
 * carve would cut a valley the silhouette does not have, and much narrower would
 * leave the carved trough with dry walls.
 */
const EROSION_REACH = 2.6;

/**
 * How the ends of a river fade.
 *
 * A river that began at full strength would cut a step at its source, and a
 * texture full of steps is a texture full of visible lines across the ground.
 * Fading over the first and last six percent is short enough that the river still
 * reads as reaching the basin.
 */
const END_FADE = 0.06;

/** Per-river bounds, computed once, so a texel outside them is rejected by four comparisons. */
type RiverBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

function boundsOf(spine: readonly Vector2[]): RiverBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of spine) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** On the count rather than in it, because the texture's own resolution varies by tier. */
function fadeAtEnds(along: number): number {
  if (along < END_FADE) return along / END_FADE;
  if (along > 1 - END_FADE) return (1 - along) / END_FADE;
  return 1;
}

export function createFlowField(options: FlowFieldOptions): FlowField {
  const { field, rivers, deposits, resolution } = options;
  const { minX, maxX, minZ, maxZ } = field.extent;
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;

  const data = new Uint8Array(resolution * resolution * 4);

  const sources = rivers.map((river) => ({
    river,
    bounds: boundsOf(river.spine),
    reach: Math.max(river.width, 1) * EROSION_REACH,
  }));

  const depositSites = deposits.map((deposit) => ({
    centre: deposit.centre,
    reach: Math.max(deposit.radius, 1),
  }));

  for (let row = 0; row < resolution; row += 1) {
    // Texel centres, not corners: sampling at a corner puts the first and last
    // rows half a texel outside the extent and shifts the whole field by half a
    // texel against the terrain it is eroding.
    const z = minZ + (spanZ * (row + 0.5)) / resolution;

    for (let column = 0; column < resolution; column += 1) {
      const x = minX + (spanX * (column + 0.5)) / resolution;

      let erosion = 0;
      let along = 0;
      let rate = 0;

      for (const source of sources) {
        const { river, bounds, reach } = source;
        // Exact rejection: the distance to a polyline is never less than the
        // distance to the box that contains it, so a texel outside the box grown
        // by the reach is a texel this river cannot touch.
        if (
          x < bounds.minX - reach ||
          x > bounds.maxX + reach ||
          z < bounds.minZ - reach ||
          z > bounds.maxZ + reach
        ) {
          continue;
        }

        const { distance, along: progress } = distanceToSpine(x, z, river.spine);
        if (distance >= reach) continue;

        // Linear in distance to the centre, so the erosion has a core and a
        // shoulder rather than a uniform disc — the same gaussian-versus-linear
        // distinction the previous composition's corridor learned the hard way.
        const proximity = 1 - distance / reach;
        const strength = proximity * proximity * fadeAtEnds(progress) * river.flowRate;
        if (strength <= erosion) continue;

        erosion = strength;
        along = progress;
        rate = river.flowRate;
      }

      let deposit = 0;
      for (const site of depositSites) {
        const dx = x - site.centre[0];
        const dz = z - site.centre[1];
        if (Math.abs(dx) >= site.reach || Math.abs(dz) >= site.reach) continue;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance >= site.reach) continue;
        const proximity = 1 - distance / site.reach;
        const value = proximity * proximity;
        if (value > deposit) deposit = value;
      }

      const offset = (row * resolution + column) * 4;
      data[offset] = toByte(erosion);
      data[offset + 1] = toByte(along);
      data[offset + 2] = toByte(rate);
      data[offset + 3] = toByte(deposit);
    }
  }

  const texture = new DataTexture(
    data,
    resolution,
    resolution,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // The channels are gauges, not colour. A colour space conversion here would
  // bend a linear 0..1 mask into something nobody can reason about, and the
  // failure looks like "the erosion is darker than it should be" rather than like
  // a colour space bug.
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    resolution,
    extent: field.extent,
    dispose() {
      texture.dispose();
    },
  };
}

function toByte(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 255;
  return Math.round(value * 255);
}
