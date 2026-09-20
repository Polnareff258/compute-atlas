'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from '../ink/inkField';
import { createInkMaterial } from '../ink/inkMaterial';
import { buildInkSurface } from '../ink/inkSurface';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The world: one continuous surface.
 *
 * This is the whole of the solid composition — the meander, its cut banks, its point bars, the
 * basin, the five regions and the black they all decay into. There is no second mesh for any of
 * them, because there is no second *thing*: every one of those is a value of one density field
 * at a place, and a feature that is a value does not need a surface of its own.
 *
 * **What replaced what, and why it matters beyond this file.** This used to mount one graded
 * corridor per river, each with the quads belonging to another river deleted. That construction
 * is gone because it could not work: the corridors were independently generated grids with no
 * shared notion of a location, so a quad one gave up was never replaced by another, and the
 * world was left with a hole along every midline between two rivers. One grid cannot have that
 * failure, because there is no rule over it that could omit anything.
 *
 * **Why there is no `normal` attribute.** The surface is displaced per-vertex by the density
 * field and the material reads that field's own gradient in the fragment stage. A baked normal
 * would be a statement about the *undisplaced* grid, which the displacement immediately
 * falsifies — an attribute that costs bandwidth and is wrong everywhere the field is doing
 * anything.
 */

export type RiverViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  readonly ink: InkField;
  /** `0`..`1`. Scales the grid's resolution; never its extent. */
  readonly detail: number;
};

/**
 * Vertices along the world's long axis, at detail 1.
 *
 * Seven hundred and sixty-eight over a two-thousand-unit world is a vertex every 2.6 units,
 * against a density field simulated at about four units per texel — so the mesh resolves the
 * field rather than the other way round, which is the correct relationship for a surface whose
 * job is to show a texture rather than to be one.
 *
 * The floor in `inkSurface` keeps the SAFE tier from dropping below the field's own spacing, so
 * the lowest tier is the same world through a coarser grid rather than a different construction.
 */
const SURFACE_RESOLUTION = 768;

export function RiverView({ descriptor, uniforms, ink, detail }: RiverViewProps) {
  const geometry = useMemo(() => {
    const built = buildInkSurface({
      extent: descriptor.field.extent,
      resolution: SURFACE_RESOLUTION,
      detail,
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setAttribute('uv', new BufferAttribute(built.uvs, 2));
    // `Uint32Array` indices have to be declared as such: a `Uint16Array`-typed index buffer at
    // this vertex count truncates silently and the failure is a soup of triangles rather than an
    // error. 32-bit indices are core in WebGL2 via `OES_element_index_uint`.
    result.setIndex(new BufferAttribute(built.indices, 1));
    result.computeBoundingSphere();
    return result;
  }, [descriptor, detail]);

  const { material, dispose } = useMemo(
    () => createInkMaterial(uniforms, ink, { gain: 1, hero: true }),
    [uniforms, ink],
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
