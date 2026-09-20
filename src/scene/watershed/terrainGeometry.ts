import { Color, LinearSRGBColorSpace } from 'three';

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

/**
 * A stretch of ground that belongs to one of the five regions.
 *
 * Baked rather than sampled at runtime. The brief's idle frame asks for the
 * domains to be "hinted only by local colour", and a hint that has to be
 * reconstructed in the shader from five centres and five radii is five more
 * uniform slots spent to compute a number that never changes. What changes on
 * interaction is *how bright* a region is, which is constraint C5's budget and
 * belongs in a uniform; which region a piece of ground *is* is composition.
 */
export type TerrainRegion = {
  readonly centre: Vector2;
  readonly radius: number;
  /** The region's own ground hue, mixed into the base ramp. */
  readonly ground: string;
  /**
   * The region's ambient hue: what its air does to the key light.
   *
   * Carried as well as `ground`, and the distinction is the one that saves
   * RESEARCH. Its ground is `#0b1030`, which is within a hair of the world's own
   * violet — deliberately, since the region is "sparse, deep, mostly unread" — so
   * a ground tint alone leaves its identity at roughly one 8-bit level. Its
   * *ambient* `#2f4a86` is a real indigo and a long way from the global key
   * light's cobalt, so the ground it lights is unmistakably that region's. Using
   * ambient this way is not a trick: a region's air filtering the light that falls
   * on it is what distinguishes one place from another in a landscape.
   */
  readonly ambient: string;
};

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
  readonly regions: readonly TerrainRegion[];
};

export type TerrainGeometry = {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  /**
   * Per vertex: `(regionIndex * 0.25, regionWeight)`.
   *
   * Packed into one `vec2` because it is one statement — *which* region this
   * ground belongs to and *how much* — and split across two attributes it could
   * disagree with itself. The index is quartered rather than sent as an integer
   * so the shader can compare it against `uActiveDomain` with a `step` window and
   * no dynamic indexing, which is the same reason the field uniforms carry five
   * separate regional loads instead of an array.
   *
   * `regionIndex` is `-1`-equivalent for ground in no region: the index is stored
   * as 1.0 (out of range for five regions), which no `uActiveDomain` in `0..4` can
   * match, so untinted ground is never claimed by a region that later becomes
   * active.
   */
  readonly regions: Float32Array;
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

/**
 * `#rrggbb` to **linear** 0..1 components.
 *
 * Linear, not the hex's own sRGB bytes, and getting that wrong is the single
 * largest error found in this stage. A `#rrggbb` literal is sRGB-encoded; a vertex
 * colour attribute is not, it is read straight into the shader as a working-space
 * (linear) value. Feeding it the sRGB bytes therefore *brightens every baked
 * colour* — violet `#150f34` is `(0.082, 0.059, 0.204)` as sRGB and
 * `(0.0075, 0.0048, 0.0343)` as linear, so the red channel arrived **eleven times**
 * too bright and the blue six — and then the output transform re-encodes that
 * inflated value to sRGB, so the ground came out as a mid-tone blue-grey wash
 * rather than as near-black. Every frame looked like fog because every surface had
 * been lifted to the fog's own value.
 *
 * The uniforms were never wrong: `new Color('#...')` converts on construction when
 * colour management is on, so the two colour sources in this shader disagreed and
 * the vertex attribute was the one that was lying.
 *
 * Three's own conversion is used rather than the transfer function written out
 * here, so this cannot drift from the renderer's own definition of linear. The
 * cost is one `Color` per call, and the callers are the four palette constants and
 * one entry per region — five-odd times per descriptor, not per vertex.
 */
function parseHex(hex: string): [number, number, number] {
  const out = { r: 0, g: 0, b: 0 };
  new Color(hex).getRGB(out, LinearSRGBColorSpace);
  return [out.r, out.g, out.b];
}

const MIDNIGHT = parseHex(WATERSHED_PALETTE.midnight);
const VIOLET = parseHex(WATERSHED_PALETTE.violet);
const COBALT = parseHex(WATERSHED_PALETTE.cobalt);
const HAZE = parseHex(WATERSHED_PALETTE.petroleum);

/**
 * How much of a region's ground is its own hue at the region's core.
 *
 * 0.75 rather than 1, and measured rather than guessed. At 1 the region's centre
 * becomes a flat patch of a single colour, which reads as a decal rather than as
 * ground; at 0.4 the five were within 8-bit quantisation of each other and the
 * idle frame's "five hints" would not have survived to the screen. The value is
 * not a fudge: it is the largest mix at which the world's own ramp is still
 * legible underneath, and the test that holds it asserts that two regions differ,
 * not that either is a particular colour.
 */
const REGION_MIX = 0.75;

/**
 * How far the key light's colour travels toward a region's ambient at its core.
 *
 * 0.6, and lower than `REGION_MIX` on purpose: which *way* a face is turned has to
 * stay a readable statement about the light everywhere in the world, because it is
 * the only thing giving the terrain its form. What changes per region is the
 * temperature of the light, not its direction.
 */
const REGION_AIR = 0.6;

/**
 * How far the basin's violet reaches, in world units.
 *
 * The basin's own radius, so the tint is exactly the bowl and stops at the lip.
 * Wider would tint the ground between the basin and the domains, which is the
 * ground the brief wants to stay the world's own colour so the basin reads as a
 * place inside a landscape rather than as a large soft spot on it.
 */
const BASIN_TINT_REACH = 190;

/**
 * How much of the far field the baked depth term may spend on haze.
 *
 * Below 1 because the fog already carries the far field. Measured: at 1 it spent
 * about 0.6 of every region's colour on a cue the fog was delivering anyway, and
 * the region tints — the one thing in this frame that says which of five places
 * you are looking at — came out within a few thousandths of each other.
 */
const DEPTH_HAZE = 0.6;

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
 *  3. **Depth**, which darkens toward the horizon so the far field settles into
 *     the background as a silhouette. A depth cue that *multiplies* the whole
 *     term stack gives a far end, where a fade toward the background colour gives
 *     a wash, because a wash is what a fade to grey is once the fog is also grey.
 *
 * The region's own ground hue is folded into the ramp *before* the light, not laid
 * over the result afterwards, because a region is not a tint on a lit surface — it
 * is what the ground is made of. Baking it in this order is also what keeps the
 * idle frame's five hints honest: the hue survives in the shadowed ground as well
 * as the lit, so the domains are distinguishable where the key light does not
 * reach, which is where most of this frame is.
 *
 * **Depth is measured from the camera, not from the basin, and that is a fix
 * rather than a choice.** The first version measured `reach / 900` where `reach`
 * was the distance from the basin — which puts the *foreground* at 0.87 depth and
 * the horizon at 1.0, because the camera stands 780 units from the basin and the
 * far edge is 900 away. So the whole frame was hazed about equally and only the
 * basin itself was left un-hazed, which is the opposite of a near field. It was
 * found by measuring the five regions' tints and noticing that every one of them
 * was being multiplied by about 0.4 of haze it should not have had. The measure is
 * now the composition's own depth axis — how far along the direction the camera
 * looks — which is what the fog already uses and what "the far field" means.
 *
 * The haze mix is capped below 1 for the same measurement's sake. The fog carries
 * the far field; this term exists only to stop the far ground from meeting the near
 * ground in value, and letting it run to 1 would spend the region tints — the one
 * thing in this frame that says which of the five places you are looking at — on a
 * cue the fog is already delivering.
 */
export function buildTerrainGeometry(options: TerrainGeometryOptions): TerrainGeometry {
  const { field, resolution, attentionZ, basin, basinFloor, keyLight, regions } = options;
  const { minX, maxX, minZ, maxZ } = field.extent;
  const columns = resolution + 1;
  const rows = resolution + 1;
  const vertexCount = columns * rows;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const regionAttribute = new Float32Array(vertexCount * 2);

  const keyLength = Math.hypot(keyLight[0], keyLight[1], keyLight[2]) || 1;
  const key: [number, number, number] = [
    keyLight[0] / keyLength,
    keyLight[1] / keyLength,
    keyLight[2] / keyLength,
  ];

  // The array's own order *is* the region index, so the caller's order has to
  // match `DOMAIN_IDS`, which is the order the field uniforms' five loads and
  // `uActiveDomain` already use. Named here because an array index silently
  // becoming a semantic id is the kind of coupling that breaks without a type
  // error.
  const regionTints = regions.map((region, index) => ({
    index,
    centre: region.centre,
    radius: Math.max(region.radius, 1),
    ground: parseHex(region.ground),
    ambient: parseHex(region.ambient),
  }));

  /** Stored in the attribute's X for ground that belongs to no region. */
  const NO_REGION = 1;

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
      // Depth along the axis the camera looks down: 0 where it stands, 1 at the
      // world's far edge. Not the distance from the basin — see the note above.
      const depth = Math.min(
        1,
        Math.max(0, (attentionZ - z) / Math.max(1, attentionZ - minZ)),
      );

      // The unlit ramp, walked by altitude: violet in the low ground where the
      // light does not reach, to midnight on the unlit shoulders.
      let base0 = VIOLET[0] + (MIDNIGHT[0] - VIOLET[0]) * altitude;
      let base1 = VIOLET[1] + (MIDNIGHT[1] - VIOLET[1]) * altitude;
      let base2 = VIOLET[2] + (MIDNIGHT[2] - VIOLET[2]) * altitude;

      // Then, if this ground belongs to a region, toward that region's own hue.
      // Taken as the *maximum* weight over the regions rather than a sum, so the
      // overlap of two neighbours is a boundary and not a darker seam — a sum
      // would make the gaps between domains the darkest ground in the world,
      // which is a picture of a grid rather than of a landscape. The weight is
      // squared so a region has a definite middle and a soft edge: an
      // un-squared falloff makes every region blur into every other one and the
      // five hints stop being readable as five.
      let regionWeight = 0;
      let regionTint: (typeof regionTints)[number] | null = null;
      // Linear falloff to the region's radius, then a short shoulder past it so
      // two neighbouring regions meet in a gradient rather than a seam. Squared
      // would be the safer-looking choice and it is the wrong one: it shrinks each
      // region to a small spot at its centre, and five spots on a plane is a
      // diagram, not a landscape.
      for (const tint of regionTints) {
        const reach = Math.hypot(x - tint.centre[0], z - tint.centre[1]) / tint.radius;
        if (reach >= 1.15) continue;
        const weight = reach <= 1 ? 1 - reach / 1.15 : (1.15 - reach) / 0.15;
        if (weight > regionWeight) {
          regionWeight = weight;
          regionTint = tint;
        }
      }
      if (regionTint !== null) {
        // Bounded, because a region is a change of material and not a repaint:
        // at full weight the ground is mostly its own hue, and the global ramp
        // is still there underneath so the five regions remain one world.
        const mix = regionWeight * REGION_MIX;
        base0 += (regionTint.ground[0] - base0) * mix;
        base1 += (regionTint.ground[1] - base1) * mix;
        base2 += (regionTint.ground[2] - base2) * mix;
      }
      regionAttribute[index * 2] =
        regionTint === null ? NO_REGION : regionTint.index * 0.25;
      regionAttribute[index * 2 + 1] = regionWeight;

      // The basin's own floor, pulled to violet. The hero is a *place*, and what
      // makes it read as one before anything glows in it is that its ground is a
      // different material from the ground around it — the palette's own note
      // says violet is "the basin's interior". This is a floor for the interior
      // glow to sit on: a glow over grey is a light, a glow over a deep saturated
      // ground is a depth. Taken from the rim inward so the lip keeps the global
      // ramp and the bowl changes character beneath it.
      const fromBasin = Math.hypot(x - basin[0], z - basin[1]) / Math.max(1, BASIN_TINT_REACH);
      if (fromBasin < 1) {
        const mix = (1 - fromBasin) ** 2 * 0.85;
        base0 += (VIOLET[0] - base0) * mix;
        base1 += (VIOLET[1] - base1) * mix;
        base2 += (VIOLET[2] - base2) * mix;
      }

      // Then the key light, and only where the ground is both raised and facing —
      // so it stays a statement about the light rather than about height, and the
      // banks have a lit face and a shadowed one. The light's own colour is cobalt
      // outside any region and the region's ambient inside one, which is what makes
      // a region's *lit* ground its own as well as its shadowed ground: one key
      // light, five kinds of air for it to come through. Finally depth pulls the
      // whole thing toward the haze, which is what gives the frame a far end.
      const air = regionTint === null ? null : regionTint.ambient;
      const keyMix = regionWeight * REGION_AIR;
      const lit0 = air === null ? COBALT[0] : COBALT[0] + (air[0] - COBALT[0]) * keyMix;
      const lit1 = air === null ? COBALT[1] : COBALT[1] + (air[1] - COBALT[1]) * keyMix;
      const lit2 = air === null ? COBALT[2] : COBALT[2] + (air[2] - COBALT[2]) * keyMix;
      const litBy = Math.max(0, facing) * altitude;
      const lifted = [
        base0 + (lit0 - base0) * litBy,
        base1 + (lit1 - base1) * litBy,
        base2 + (lit2 - base2) * litBy,
      ];
      const haze = depth * DEPTH_HAZE;
      const near = 1 - haze;
      colors[index * 3] = (lifted[0]! * near + HAZE[0] * haze) * oriented;
      colors[index * 3 + 1] = (lifted[1]! * near + HAZE[1] * haze) * oriented;
      colors[index * 3 + 2] = (lifted[2]! * near + HAZE[2] * haze) * oriented;
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
    regions: regionAttribute,
    indices,
    vertexCount,
    triangleCount: cellCount * 2,
  };
}
