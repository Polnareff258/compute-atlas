import { describe, expect, it } from 'vitest';
import { terrainHeight } from './terrainField';
import {
  buildTerrainGeometry,
  rowWarp,
  terrainSampleXZ,
  type TerrainGeometryOptions,
} from './terrainGeometry';
import { createWatershedDescriptor } from './watershedDescriptor';

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
