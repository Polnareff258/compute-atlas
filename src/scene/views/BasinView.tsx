'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import { createMembraneMaterial } from '../materials/membraneMaterial';
import { buildStrataGeometry } from '../watershed/strataGeometry';
import type { FieldUniforms } from '../field/fieldUniforms';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The Convergence Basin: the frame's subject, as a stack of levels.
 *
 * **What it draws, and what it deliberately does not.** Only the sheets — the
 * layered surfaces the brief puts at the centre of the composition. The bowl they
 * sit in is the terrain's, the flow bundles entering it are the rivers', and the
 * density around it is the fog's. This view exists for the one element none of
 * those three can carry, and keeping it to that one element is what keeps it a
 * third of a draw call per frame rather than a second landscape.
 *
 * **Why the geometry carries two attributes and no normals.** Every sheet is a
 * horizontal level, so its normal is up everywhere and a per-vertex copy of that
 * would be 4,612 copies of one vector. What the fragment stage actually cannot
 * derive is which sheet it is standing on — the mesh holds all four — so the
 * radius and the stack position travel per vertex and nothing else does.
 */

export type BasinViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
};

export function BasinView({ descriptor, uniforms }: BasinViewProps) {
  const geometry = useMemo(() => {
    const built = buildStrataGeometry({
      strata: descriptor.strata,
      centre: descriptor.basin.centre,
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setAttribute('aSheetRadius', new BufferAttribute(built.sheetRadius, 1));
    result.setAttribute('aSheetT', new BufferAttribute(built.sheetT, 1));
    result.setIndex(new BufferAttribute(built.indices, 1));
    // Bounded by the widest sheet, which is the honest bound: the stack is
    // concentric, so the union of the discs is the largest one.
    result.computeBoundingSphere();
    result.computeBoundingBox();
    return result;
  }, [descriptor]);

  const { material, dispose } = useMemo(() => createMembraneMaterial(uniforms), [uniforms]);

  useEffect(
    () => () => {
      geometry.dispose();
      dispose();
    },
    [geometry, dispose],
  );

  return <mesh geometry={geometry} material={material} />;
}
