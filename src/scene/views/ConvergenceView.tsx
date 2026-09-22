'use client';

import { useEffect, useMemo } from 'react';

import type { FieldUniforms } from '../field/fieldUniforms';
import { createConvergenceGeometry } from '../ink/convergenceGeometry';
import { createConvergenceMaterial } from '../ink/convergenceMaterial';
import {
  CONVERGENCE_TIERS,
  resolveConvergenceLayers,
} from '../ink/convergenceProfile';
import type { QualityProfile } from '../../renderer/types';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

export type ConvergenceViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  /**
   * The tier whose segmentation and layer count this view draws at.
   *
   * A prop rather than a module constant, because "which tier is running" is
   * `RendererRuntime`'s answer and the convergence should not be the one system
   * in the scene that guesses it separately. Everything the tiers do *not*
   * change — the planes' placements, their scales, their rotations, the colours —
   * is still the profile's, and is identical at all four.
   */
  readonly quality: QualityProfile;
};

export function ConvergenceView({
  descriptor,
  uniforms,
  quality,
}: ConvergenceViewProps) {
  const radius = descriptor.basin.radius;
  const tier = CONVERGENCE_TIERS[quality];
  const layers = useMemo(() => resolveConvergenceLayers(quality), [quality]);
  const geometries = useMemo(
    () => ({
      membrane: createConvergenceGeometry(radius, 'membrane', tier.segments.membrane),
      filament: createConvergenceGeometry(radius, 'filament', tier.segments.filament),
    }),
    // `tier` is a member of the frozen table, so its identity is stable per
    // quality and keying on it is keying on the tier rather than on an object
    // rebuilt every render.
    [radius, tier],
  );
  const materials = useMemo(
    () =>
      layers.map((layer) =>
        createConvergenceMaterial(uniforms, {
          kind: layer.kind,
          phase: layer.phase,
          gain: layer.gain,
          displacement: layer.displacement,
        }),
      ),
    [uniforms, layers],
  );

  useEffect(
    () => () => {
      geometries.membrane.dispose();
      geometries.filament.dispose();
      for (const material of materials) material.dispose();
    },
    [geometries, materials],
  );

  return (
    <>
      {layers.map((layer, index) => (
        <mesh
          key={layer.id}
          geometry={geometries[layer.kind]}
          material={materials[index]!}
          position={[
            descriptor.basin.centre[0] + layer.offset[0],
            layer.height,
            descriptor.basin.centre[1] + layer.offset[1],
          ]}
          rotation={[-Math.PI / 2 + layer.tilt, 0, layer.rotation]}
          scale={layer.scale}
          renderOrder={layer.renderOrder}
          frustumCulled={false}
        />
      ))}
    </>
  );
}
