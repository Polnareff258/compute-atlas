'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from '../ink/inkField';
import { buildInkBasin } from '../ink/inkBasin';
import { createInkMaterial } from '../ink/inkMaterial';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';
import type { RiverCourse } from './RiverView';

/**
 * The Convergence Basin: where the story arrives.
 *
 * **What replaced what.** This view used to mount a stack of transparent sheets over the
 * bowl — the `membraneMaterial` strata — which was the previous composition's way of making
 * the basin read as layered. It is the wrong instrument here for the same reason the ribbon
 * was wrong for the river: a sheet is a *surface placed in* the world, and this composition's
 * whole method is that the world's structure comes from one density field read in different
 * places. A sheet drawn over the basin says "here is a thing"; the field read at its densest
 * says "here is where everything arrived", which is what the brief asks the basin to be.
 *
 * So the basin is the **same material on the same field**, at a higher gain — the ground's own
 * shading, on ground where `settle` is highest. Nothing about it is special except where it
 * is, and that is the point: it is the same phenomenon at its maximum rather than a second
 * one.
 *
 * **The ownership pass is what makes it mountable at all.** The rivers run into the basin, so
 * their corridors already cover much of it, and two surfaces over the same ground are exactly
 * coincident here — every surface is displaced by the same field sampled by world position.
 * `buildInkBasin` therefore emits only the quads no corridor already owns, and the two meshes
 * partition the world between them. Without that, this view would reintroduce the z-fighting
 * that a previous capture read as shattered geometry.
 *
 * **Mounted last, and deliberately.** It is the destination, so it draws after the water that
 * arrives at it; and it is opaque, so drawing it first would let the corridors' own triangles
 * punch through it along the ownership seam.
 */

export type BasinViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  readonly ink: InkField;
  /** The same courses the corridor uses, so the two agree about what each one covers. */
  readonly courses: readonly RiverCourse[];
  /** The same reach multiple the corridor was built with. */
  readonly reachMultiple: number;
  readonly detail: number;
};

/**
 * How much brighter the basin is than the ground around it.
 *
 * Above one, and rationed. The brief allows exactly one region to be the frame's highlight at
 * a time, and at the end of the story the basin is that region — it is where the visitor has
 * been travelling for the whole scroll, and a destination that looked like the road would be
 * a scroll with no arrival.
 */
const BASIN_GAIN = 1.35;

export function BasinView({
  descriptor,
  uniforms,
  ink,
  courses,
  reachMultiple,
  detail,
}: BasinViewProps) {
  const geometry = useMemo(() => {
    const built = buildInkBasin({
      centre: descriptor.basin.centre,
      radius: descriptor.basin.radius,
      extent: descriptor.field.extent,
      courses,
      reachMultiple,
      rings: 40,
      segments: 128,
      // Far enough past the rim that the disc's own edge sits where the field has already
      // decayed, so the boundary is unfindable for the same reason the corridor's is.
      rimMargin: 2.6,
      detail,
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setAttribute('uv', new BufferAttribute(built.uvs, 2));
    result.setIndex(new BufferAttribute(built.indices, 1));
    result.computeBoundingSphere();
    return result;
  }, [descriptor, courses, reachMultiple, detail]);

  const { material, dispose } = useMemo(
    // `hero: false` withholds the narrative sharpness budget. The brief allows one crisp
    // structure in the frame and the ground corridor already spends it; a basin that drew its
    // own crest would be a second subject competing with the river that leads to it.
    () => createInkMaterial(uniforms, ink, { gain: BASIN_GAIN, hero: false }),
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
