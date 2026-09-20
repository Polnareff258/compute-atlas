'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import { createRiverMaterial } from '../materials/riverMaterial';
import { buildRiverGeometry } from '../watershed/riverGeometry';
import type { FlowField } from '../watershed/flowField';
import type { FieldUniforms } from '../field/fieldUniforms';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The Data River: every river in the world as one mesh.
 *
 * One draw call, and it is the composition's line of motion — the thing the eye
 * follows from the near foreground into the basin, which is the job the brief gives
 * the idle frame. It is built here rather than folded into `TerrainView` because it
 * is a different surface with a different material and a different blend state; the
 * two meshes share the descriptor, the uniforms and the flow texture, and nothing
 * else.
 *
 * **Why the geometry is not one grid.** See `riverGeometry`: a sheet over the whole
 * extent is a full-screen transparent pass that is almost entirely empty, and it
 * spends its resolution evenly on a feature whose whole character is lateral. The
 * ribbon is exactly as wide as the water and dense across the channel.
 *
 * **What it costs.** At ULTRA the eight rivers are 2,200 vertices and 2,400
 * triangles — under two percent of the terrain mesh's 194,000 vertices for the
 * second-most-important surface in the frame. The cost that is real is fill rate:
 * the ribbon is transparent, so it blends, and it shades per pixel including a
 * fractal noise for the grain. That is why the geometry is a ribbon and not a
 * sheet, and why the grain is gated to the rivers fast enough to carry it.
 */
export type RiverViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  /** The same field the ground erodes by. Shared, not rebuilt — see `TerrainView`. */
  readonly flow: FlowField;
};

export function RiverView({ descriptor, uniforms, flow }: RiverViewProps) {
  const geometry = useMemo(() => {
    const built = buildRiverGeometry({
      field: descriptor.field,
      // The rivers' own bodies, matching what `TerrainView` hands the flow field.
      // A ribbon wider than the field erodes would hang water over dry ground; a
      // narrower one would cut the river off at a straight edge while the alpha was
      // still high. Both are the same mistake from either side.
      rivers: descriptor.rivers.map((river) => ({
        spine: river.spine,
        width: river.width,
      })),
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setIndex(new BufferAttribute(built.indices, 1));
    // One bounding sphere over every river. The mesh is a set of ribbons spread
    // across the world, so the sphere is large and the mesh is never culled — which
    // is correct, since where the camera can see a river is a question the shot
    // system answers and a sphere around all of them cannot.
    result.computeBoundingSphere();
    return result;
  }, [descriptor]);

  const { material, dispose } = useMemo(
    () => createRiverMaterial(uniforms, flow),
    [uniforms, flow],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      dispose();
    },
    [geometry, dispose],
  );

  return <mesh geometry={geometry} material={material} />;
}
