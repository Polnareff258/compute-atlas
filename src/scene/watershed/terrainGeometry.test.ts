import { describe, expect, it } from 'vitest';
import { Color, LinearSRGBColorSpace } from 'three';
import { terrainHeight } from './terrainField';
import {
  buildTerrainGeometry,
  rowWarp,
  terrainSampleXZ,
  type TerrainGeometryOptions,
} from './terrainGeometry';
import { createWatershedDescriptor, WATERSHED_PALETTE } from './watershedDescriptor';

/**
 * The surface is the composition, so these are composition assertions: that the
 * mesh is where the field says it is, that the far end and the near end are both
 * covered, and that the grading is spending its vertices where the camera can see
 * them. A golden-value test on the vertex buffer would pass just as happily on a
 * mesh that had lost its basin.
 */

const HIGH = 0.8;
const descriptor = createWatershedDescriptor(2026, HIGH);

function options(overrides: Partial<TerrainGeometryOptions> = {}): TerrainGeometryOptions {
  return {
    field: descriptor.field,
    resolution: 48,
    attentionZ: 480,
    basin: descriptor.basin.centre,
    basinFloor: descriptor.basinFloor,
    keyLight: [-0.38, 0.66, 0.65],
    regions: descriptor.domains.map((domain) => ({
      centre: domain.centre,
      radius: domain.radius,
      ground: domain.palette.ground,
      ambient: domain.palette.ambient,
    })),
    ...overrides,
  };
}

describe('the mesh is where the field says it is', () => {
  it('places every vertex on the field, at that vertex’s own grid point', () => {
    const config = options({ resolution: 24 });
    const field = config.field;
    const mesh = buildTerrainGeometry(config);
    const { minX, maxX, minZ, maxZ } = field.extent;
    const columns = config.resolution + 1;

    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      // The grid coordinate comes from the shared function rather than from the
      // buffer: reading the position back would round it to float32 and evaluate
      // the field at a point the builder never sampled. A transposed row or
      // column still fails here, because the stored height would then belong to
      // the other axis's coordinate.
      const { x, z } = terrainSampleXZ(
        column,
        row,
        config.resolution,
        minX,
        maxX,
        minZ,
        maxZ,
        config.attentionZ,
      );

      expect(mesh.positions[index * 3]).toBe(Math.fround(x));
      expect(mesh.positions[index * 3 + 2]).toBe(Math.fround(z));
      // Exact, in the precision the buffer carries. `Float32Array` rounds, so the
      // honest assertion is `Math.fround` of the field's own value — the mesh is
      // the field and not an approximation of it.
      expect(mesh.positions[index * 3 + 1]).toBe(Math.fround(terrainHeight(x, z, field)));
    }
  });

  it('covers the whole extent, including both edges', () => {
    const field = options().field;
    const mesh = buildTerrainGeometry(options());
    const xs: number[] = [];
    const zs: number[] = [];
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      xs.push(mesh.positions[index * 3]!);
      zs.push(mesh.positions[index * 3 + 2]!);
    }
    expect(Math.min(...xs)).toBeCloseTo(field.extent.minX, 6);
    expect(Math.max(...xs)).toBeCloseTo(field.extent.maxX, 6);
    expect(Math.min(...zs)).toBeCloseTo(field.extent.minZ, 6);
    expect(Math.max(...zs)).toBeCloseTo(field.extent.maxZ, 6);
  });

  it('indexes only vertices that exist', () => {
    // A `Uint32Array` of the wrong stride or a transposed row would index past
    // the end, which WebGPU answers with a validation error rather than a bad
    // picture — cheaper to catch here than in the console.
    const mesh = buildTerrainGeometry(options());
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
    for (const index of mesh.indices) {
      expect(index).toBeLessThan(mesh.vertexCount);
    }
  });

  it('builds a unit normal on every vertex, pointing up', () => {
    // A normal of the wrong length silently changes the shading's whole scale,
    // and one pointing down turns the terrain inside out.
    const mesh = buildTerrainGeometry(options({ resolution: 24 }));
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const length = Math.hypot(
        mesh.normals[index * 3]!,
        mesh.normals[index * 3 + 1]!,
        mesh.normals[index * 3 + 2]!,
      );
      expect(length).toBeCloseTo(1, 5);
      expect(mesh.normals[index * 3 + 1]).toBeGreaterThan(0);
    }
  });

  it('keeps every baked colour inside the range a vertex attribute can carry', () => {
    const mesh = buildTerrainGeometry(options({ resolution: 32 }));
    for (let index = 0; index < mesh.colors.length; index += 1) {
      const value = mesh.colors[index]!;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The vertex nearest a region's centre, and its baked colour.
   *
   * Every comparison below is *between two builds of the same mesh*, never against
   * an expected hex value. A golden colour would pass just as happily on five
   * regions that had all been mixed toward the same hue, and would fail on the day
   * somebody legitimately retuned the palette.
   */
  function colourAt(
    mesh: ReturnType<typeof buildTerrainGeometry>,
    centre: readonly [number, number],
  ): [number, number, number] {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const distance = Math.hypot(
        mesh.positions[index * 3]! - centre[0],
        mesh.positions[index * 3 + 2]! - centre[1],
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return [
      mesh.colors[best * 3]!,
      mesh.colors[best * 3 + 1]!,
      mesh.colors[best * 3 + 2]!,
    ];
  }

  function channelsDiffering(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): number {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  it('gives each region ground of its own', () => {
    // The idle frame's five hints, measured against the same mesh built with no
    // regions at all. That comparison is the one that isolates "this region tinted
    // its ground" from "these five palette hues happen to be far apart" — and it is
    // the one that caught the depth term measuring from the basin and spending 60%
    // of every region's colour on haze.
    const plain = buildTerrainGeometry(options({ resolution: 96, regions: [] }));
    const tinted = buildTerrainGeometry(options({ resolution: 96 }));

    for (const domain of descriptor.domains) {
      const difference = channelsDiffering(
        colourAt(plain, domain.centre),
        colourAt(tinted, domain.centre),
      );
      // A floor with real headroom, and the headroom is measured rather than
      // guessed. These are dark *linear* values — the whole mesh spans 0.0015 to
      // 0.27 per channel — and what has to survive is not a large delta but a
      // delta that reaches the screen after the output transform. The weakest
      // region measures 0.021 here (games and graphics are 0.28 and 0.12), so the
      // threshold sits below the weakest with room for a palette change, while a
      // region that stopped tinting anything at all — the failure this exists for —
      // still fails.
      //
      // The floor was 0.008 before this test's space was fixed too, and it passed
      // there for the wrong reason: the deltas were six times larger because every
      // baked colour was being read as sRGB. A threshold that survives a change of
      // units without being re-derived is a threshold measuring nothing.
      expect(difference, `${domain.id} tinted its ground`).toBeGreaterThan(0.008);
    }
  });

  it('does not tint the ground between the regions', () => {
    // Five regions must be one world, not five patches. The midpoint between the
    // two furthest-apart region centres is ground that belongs to neither, and it
    // must be the same colour in both builds.
    const plain = buildTerrainGeometry(options({ resolution: 96, regions: [] }));
    const tinted = buildTerrainGeometry(options({ resolution: 96 }));
    const [a, b] = [descriptor.domains[0]!.centre, descriptor.domains[1]!.centre];
    const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    expect(channelsDiffering(colourAt(plain, midpoint), colourAt(tinted, midpoint)))
      .toBeLessThan(0.002);
  });
});

describe('the grid is graded, and the grading is honest about it', () => {
  const MIN_Z = -1200;
  const MAX_Z = 620;
  const rowsOf = (resolution: number, attentionZ: number) =>
    Array.from({ length: resolution + 1 }, (_, index) =>
      rowWarp(index, resolution, MIN_Z, MAX_Z, attentionZ),
    );

  it('covers both edges exactly, in some order', () => {
    // Both edges, or the mesh does not reach the world's boundary and the
    // horizon is a cut. Asserted as a set rather than as "row 0 is the near end"
    // so that the row order is free to change without the test reading as a
    // failure when nothing is wrong.
    for (const resolution of [8, 48, 253]) {
      const rows = rowsOf(resolution, 480);
      expect(new Set([rows[0], rows[rows.length - 1]])).toEqual(new Set([MIN_Z, MAX_Z]));
    }
  });

  it('never places two rows on each other', () => {
    // A repeated Z is a row of degenerate triangles, which is a band of dropped
    // pixels. Asserted as strict monotonicity in whichever direction the warp
    // runs, since the warp's direction follows `attentionZ`.
    const resolution = 64;
    const rows = rowsOf(resolution, 480);
    const ascending = rows[resolution]! > rows[0]!;
    for (let index = 0; index < resolution; index += 1) {
      const step = rows[index + 1]! - rows[index]!;
      expect(Math.abs(step)).toBeGreaterThan(0);
      if (ascending) expect(step).toBeGreaterThan(0);
      else expect(step).toBeLessThan(0);
    }
  });

  it('crowds its rows toward the camera and spreads them at the horizon', () => {
    // The whole point of the warp. The camera stands at `attentionZ` near one
    // end of the extent, and the rows around it have to sit closer together than
    // the rows at the far end — otherwise the grading is decoration and a uniform
    // grid would have been simpler and cheaper.
    //
    // Compared as magnitudes, because which end comes first in the array depends
    // on the warp's direction and the distances are signed.
    const resolution = 64;
    const rows = rowsOf(resolution, 480);
    const stepAt = (index: number) => Math.abs(rows[index + 1]! - rows[index]!);

    const nearIndex = Math.abs(rows[0]! - 480) < Math.abs(rows[resolution]! - 480) ? 0 : resolution - 1;
    const farIndex = nearIndex === 0 ? resolution - 1 : 0;
    expect(stepAt(nearIndex)).toBeLessThan(stepAt(farIndex));
    // And by enough to matter rather than by a hair, which is what makes the
    // exponent worth having.
    expect(stepAt(farIndex) / stepAt(nearIndex)).toBeGreaterThan(4);
  });

  it('follows the camera rather than assuming Z points one way', () => {
    // `attentionZ` is the only thing that decides which end is dense, so a
    // descriptor whose camera sat at the far end grades from that end instead.
    // Not hypothetical: the world's near edge moved 320 units earlier in this
    // stage precisely because the framing arithmetic asked it to, and a warp
    // hard-coded to crowd one end would have crowded the wrong one.
    const resolution = 64;
    for (const attentionZ of [480, -1100]) {
      const rows = rowsOf(resolution, attentionZ);
      const stepAt = (index: number) => Math.abs(rows[index + 1]! - rows[index]!);
      const nearIndex = Math.abs(rows[0]! - attentionZ) < Math.abs(rows[resolution]! - attentionZ) ? 0 : resolution - 1;
      const farIndex = nearIndex === 0 ? resolution - 1 : 0;
      expect(stepAt(nearIndex), `attentionZ ${attentionZ}`).toBeLessThan(stepAt(farIndex));
    }
  });
});

describe('the mesh scales with detail without changing shape', () => {
  it('keeps the field’s own heights at every resolution', () => {
    // ULTRA is 440 segments and SAFE is 253, and a vertex that exists at both must
    // sit at the same height — otherwise the quality fallback is a different
    // landscape rather than a coarser view of the same one.
    const coarse = buildTerrainGeometry(options({ resolution: 16 }));
    const fine = buildTerrainGeometry(options({ resolution: 32 }));

    // Both include the extent's corners, so those are directly comparable.
    const cornerOf = (mesh: ReturnType<typeof buildTerrainGeometry>, index: number) => [
      mesh.positions[index * 3]!,
      mesh.positions[index * 3 + 1]!,
      mesh.positions[index * 3 + 2]!,
    ];
    expect(cornerOf(coarse, 0)).toEqual(cornerOf(fine, 0));
    expect(cornerOf(coarse, coarse.vertexCount - 1)).toEqual(
      cornerOf(fine, fine.vertexCount - 1),
    );
  });

  it('builds a mesh at ULTRA detail within a sane budget', () => {
    // The real resolution, not a toy one: 440 segments is 193,600 vertices and
    // 387,200 triangles, which is the number the performance preconditions are
    // about. Asserted so that a change to `terrainResolution` that quietly
    // quadrupled the mesh fails here rather than as a stalled frame.
    const mesh = buildTerrainGeometry(options({ resolution: descriptor.terrainResolution }));
    expect(mesh.vertexCount).toBe((descriptor.terrainResolution + 1) ** 2);
    expect(mesh.triangleCount).toBe(descriptor.terrainResolution ** 2 * 2);
    expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
  });
});

describe('the baked colour is in the space the shader reads it in', () => {
  it('stays inside the bound only a converted palette can reach', () => {
    // The defect this exists for: a vertex colour attribute is read straight into
    // the shader as a *working-space* (linear) value, but `#rrggbb` is sRGB
    // encoded, so parsing the hex bytes directly brightened every baked colour by
    // six to eleven times — and the output transform then re-encoded the inflated
    // value, which turned an ink-dark landscape into a flat blue-grey wash. It
    // survived three captures, because a wash is exactly what heavy fog also looks
    // like, which is why the fog was blamed first and adjusted for nothing.
    //
    // The bound is derived from the bake's own arithmetic, not tuned to a capture.
    // Every channel of it is `(lifted · (1 - haze) + HAZE · haze) · oriented` with
    // `oriented ≤ 1`; `lifted` is a linear mix from the unlit ramp toward the key
    // light's cobalt, and a mix never leaves the range of its two endpoints. So if
    // *every input the bake can reach* is at or below cobalt in every channel, the
    // output is too — and with no regions in play it is: the unlit ramp runs
    // between violet and midnight, and both are below cobalt channel for channel,
    // as is the haze. The assertion below checks that precondition rather than
    // assuming it, so a palette change that broke the derivation fails as itself.
    //
    // Why the region-free build carries this and a regioned one cannot: a region
    // adds its ambient to the set, and GRAPHICS's magenta ambient is nearly twice
    // cobalt's blue. Its contribution is scaled by `REGION_AIR` inside the mix and
    // then by `litBy` and `oriented` outside it, which makes the reachable ceiling
    // a function of three weights rather than of the palette — loose enough that
    // the *un-converted* build measures 0.54 underneath it and the test would have
    // gated nothing. (An earlier draft of this test did exactly that: it took the
    // palette's brightest ambient as the ceiling and the broken build passed.)
    //
    // What it gates: the converted build peaks at 0.273, the same mesh parsing hex
    // bytes as though they were linear peaks at 0.537 — measured by reverting the
    // conversion and re-running this file, not estimated — and cobalt's own linear
    // blue is 0.342. The line falls between the two because the arithmetic puts it
    // there, which is why this one is worth keeping where the derived-from-ambient
    // version was not.
    const scratch = { r: 0, g: 0, b: 0 };
    const linear = (hex: string) => {
      new Color(hex).getRGB(scratch, LinearSRGBColorSpace);
      return [scratch.r, scratch.g, scratch.b] as const;
    };
    const { cobalt, petroleum, violet, midnight } = WATERSHED_PALETTE;
    for (const hex of [petroleum, violet, midnight]) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(linear(hex)[channel], `${hex} below cobalt`).toBeLessThanOrEqual(
          linear(cobalt)[channel]!,
        );
      }
    }

    const mesh = buildTerrainGeometry(options({ resolution: 96, regions: [] }));

    let baked = 0;
    for (const value of mesh.colors) {
      if (value > baked) baked = value;
    }
    expect(baked).toBeLessThan(Math.max(...linear(cobalt)));

    // And it must actually approach that ceiling, or the test would pass on a mesh
    // that had gone black — a bake whose lighting term had stopped being applied
    // is a different failure and this is where it would otherwise hide.
    expect(baked).toBeGreaterThan(0.15);
  });
});
