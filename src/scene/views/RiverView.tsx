'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from '../ink/inkField';
import { buildInkCorridor } from '../ink/inkSurface';
import { createInkMaterial } from '../ink/inkMaterial';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The hero: the world's ground, as one graded corridor per river.
 *
 * One draw call, one material, one geometry. Everything the composition is made of is
 * in this mesh — the meander, its cut banks, its point bars, the pigment that spreads
 * off it and the black it decays into — because all of those are readings of one
 * density field, and splitting them across meshes would be splitting one phenomenon
 * into four draw calls that have to be kept in agreement by hand.
 *
 * **What replaced what.** This view used to mount a ribbon exactly as wide as the
 * water, laid into a channel that `TerrainView` had cut. The brief names that
 * construction twice in its forbidden list — "clearly closed river banks" and "sharp
 * transparent ribbons" — and the reason is structural rather than stylistic: a ribbon
 * has an outline, and an outline is the one thing this composition cannot have. See
 * `inkSurface` for what is here instead, and why its edges cannot be found.
 *
 * **Why there is no `normal` attribute.** The surface is displaced per-vertex by the
 * density field and the material reads that field's own gradient in the fragment stage.
 * A baked normal would be a statement about the *undisplaced* mesh, which the
 * displacement immediately falsifies — so it would be an attribute that costs bandwidth
 * and is wrong everywhere the field is doing anything.
 */

export type RiverCourse = {
  /**
   * Readonly tuples, not `[number, number]`.
   *
   * `Vector2` from the terrain field is a readonly pair, and a mutable tuple type here
   * would reject every spine in the project — the error is a compile-time one, which is
   * the good case, but the temptation is to cast at the call site and lose the check
   * that nothing downstream mutates a course out from under the mesh.
   */
  readonly spine: readonly (readonly [number, number])[];
  readonly width: number;
};

export type RiverViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  readonly ink: InkField;
  /**
   * The courses the corridor follows.
   *
   * Handed in rather than derived from `descriptor.rivers` here, because the bake, this
   * mesh and the hero framing all have to run the *same* curve: `meanderCourse` offsets
   * a spine laterally, and three consumers each computing it separately would be three
   * chances to disagree about where the water is. The scene host owns the one call.
   */
  readonly courses: readonly RiverCourse[];
  /** `0`..`1`. Scales the corridor's sample counts, never its extent. */
  /** The corridor's reach, shared with the basin so the two partition the world. */
  readonly reachMultiple: number;
  readonly detail: number;
};

export function RiverView({
  descriptor,
  uniforms,
  ink,
  courses,
  reachMultiple,
  detail,
}: RiverViewProps) {
  /*
   * `ink` identity is the maintenance point, and it replaced a `generation` counter.
   *
   * A quality change now *reconstructs* the field rather than mutating it in place, so
   * the object the memo depends on is a different object and this rebuilds for the
   * ordinary reason. The counter was the first design and it was worse for a specific,
   * checkable reason: a TSL graph captures the textures it was built against, so a field
   * that swapped its targets in place left every consumer holding a graph that sampled a
   * disposed one — a failure that renders as a field which has stopped moving rather
   * than as an error. Making the field immutable per tier removes the possibility
   * instead of documenting it.
   */
  const geometry = useMemo(() => {
    const built = buildInkCorridor({
      courses,
      extent: descriptor.field.extent,
      alongStep: 7.5,
      // Raised from 14. At fourteen the corridor's own edge landed inside the frame at
      // the resting eye height, so a band of the picture was background rather than
      // ground — visible in the first capture's luminance map as a large flat region the
      // field never reached. The margin over the density field's own reach is what keeps
      // the mesh boundary unfindable, and this is the number that buys it.
      reachMultiple,
      acrossCount: 56,
      detail,
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setAttribute('uv', new BufferAttribute(built.uvs, 2));
    // `Uint32Array` indices have to be declared as such: a `Uint16Array`-typed index
    // buffer at this vertex count truncates silently and the failure is a soup of
    // triangles rather than an error. 32-bit indices are core in WebGL2 via
    // `OES_element_index_uint`.
    result.setIndex(new BufferAttribute(built.indices, 1));
    result.computeBoundingSphere();
    return result;
  }, [descriptor, courses, reachMultiple, detail]);

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
