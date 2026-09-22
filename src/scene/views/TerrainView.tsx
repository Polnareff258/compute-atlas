'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from '../ink/inkField';
import { createVeilMaterial } from '../ink/inkMaterial';
import { buildInkVeil } from '../ink/inkSurface';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The air: the same density field, lifted and drawn translucent.
 *
 * **What this view is now, and why it is not the old terrain.** It used to mount a
 * displaced heightfield with strata, channels and terraces — a landscape seen from
 * the ground. The composition no longer has a horizon: the camera looks down at the
 * river from an oblique height, and what a near-top-down frame lacks is not detail
 * but *depth*, which is the one thing a single surface at one height cannot supply.
 * So this mount now carries the veil — one large sheet above the ground, reading the
 * same field at the same UV, drifting at a slightly different rate.
 *
 * **Why that is not a second effect.** The veil has no terms of its own beyond a
 * gain and a height; it cannot see anything the ground cannot. The brief permits
 * membranes that are a derived expression of the density field and forbids the
 * alternative, and that is kept here by construction rather than by intention:
 * `createVeilMaterial` takes the same `InkField` and the same uniforms, and there is
 * nothing else for it to read.
 *
 * It is mounted *after* the ground, because it is translucent and sits above it. A
 * veil drawn first would composite behind the surface it is meant to hang over.
 */

export type TerrainViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  readonly ink: InkField;
  /** World Y the sheet floats at, above the ground's own relief. */
  readonly height: number;
  /** `0`..`1`. How much of the veil exists at this tier. */
  readonly presence: number;
};

/*
 * One high, faint dispersion sheet.
 *
 * Three copies of the same contour did not become volume; they became three visible bands and
 * made the entire system read as stacked ribbons. The hero surface now owns the structure. This
 * sheet only supplies a delayed atmospheric echo at a different depth.
 */
const VEIL_LAYERS = [
  { height: 1.18, gain: 0.20 },
] as const;

export function TerrainView({
  descriptor,
  uniforms,
  ink,
  height,
  presence,
}: TerrainViewProps) {
  const geometry = useMemo(() => {
    const built = buildInkVeil({
      extent: descriptor.field.extent,
      // Coarse, and it can be: the veil carries a low-frequency wash whose finest
      // feature is measured in tens of world units, so ninety-six subdivisions
      // across a two-thousand-unit world is already finer than anything it can
      // show. It is also why the veil is cheap enough to keep at every tier.
      subdivisions: 96,
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setAttribute('uv', new BufferAttribute(built.uvs, 2));
    result.setIndex(new BufferAttribute(built.indices, 1));
    result.computeBoundingSphere();
    return result;
  }, [descriptor]);

  const layers = useMemo(
    () =>
      VEIL_LAYERS.map((layer) =>
        createVeilMaterial(uniforms, ink, {
          height: height * layer.height,
          gain: presence * layer.gain,
        }),
      ),
    [uniforms, ink, height, presence],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      for (const layer of layers) layer.dispose();
    },
    [geometry, layers],
  );

  // Not mounted at all at a tier where the veil does not exist, rather than mounted
  // with a gain of zero: an invisible transparent surface still costs fill rate and
  // still has to be sorted, and a tier's answer for the veil is allowed to be that
  // there is none.
  if (presence <= 0) return null;

  return (
    <>
      {layers.map((layer, index) => (
        <mesh
          key={index}
          geometry={geometry}
          material={layer.material}
          renderOrder={2 + index}
        />
      ))}
    </>
  );
}
