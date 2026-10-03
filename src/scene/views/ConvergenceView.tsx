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
import type { InkField } from '../ink/inkField';

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
  readonly visualMode?: 'relief' | 'ink';
  readonly ink?: InkField;
};

export function ConvergenceView({
  descriptor,
  uniforms,
  quality,
  visualMode = 'relief',
  ink,
}: ConvergenceViewProps) {
  const radius = descriptor.basin.radius;
  const tier = CONVERGENCE_TIERS[quality];
  const layers = useMemo(() => resolveConvergenceLayers(quality).map((layer) =>
    visualMode === 'relief' ? {
      ...layer,
      // Raised ink is a soft overlapping wash, not six tilted architectural plates.
      tilt: layer.tilt * 0.35,
      scale: [layer.scale[0], layer.scale[1] * 1.35, layer.scale[2]] as const,
      gain: layer.gain * (layer.kind === 'filament' ? 0.65 : 0.85),
    } : layer,
  ), [quality, visualMode]);
  const geometries = useMemo(
    () => ({
      membrane: createConvergenceGeometry(radius, 'membrane', tier.segments.membrane, visualMode),
      filament: createConvergenceGeometry(radius, 'filament', tier.segments.filament, visualMode),
    }),
    // `tier` is a member of the frozen table, so its identity is stable per
    // quality and keying on it is keying on the tier rather than on an object
    // rebuilt every render.
    [radius, tier, visualMode],
  );
  const materials = useMemo(
    () =>
      layers.map((layer) =>
        createConvergenceMaterial(uniforms, {
          kind: layer.kind,
          phase: layer.phase,
          gain: layer.gain,
          currentGain: layer.currentGain,
          displacement: layer.displacement,
          visualMode,
          ...(ink ? { ink } : {}),
        }),
      ),
    [uniforms, layers, visualMode, ink],
  );

  useEffect(
    () => () => {
      geometries.membrane.dispose();
      geometries.filament.dispose();
    },
    [geometries],
  );
  useEffect(
    () => () => {
      for (const material of materials) material.dispose();
    },
    [materials],
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
