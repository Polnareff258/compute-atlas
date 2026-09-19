'use client';

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';

import { createSurfaceMaterial } from './materials/surfaceMaterial';
import { buildStructureGeometry } from './materials/structureGeometry';
import { deriveAtmosphereDescriptor } from './atmosphereDescriptor';

/**
 * Depth behind the composition.
 *
 * Three large depth-separated planes in the machine's recessed tier, merged into
 * one mass and graded by the scene fog. This replaces the previous constellation
 * of thin traces and stray points: a backdrop that reads as distance and scale,
 * with nothing in it that could be mistaken for a signal.
 *
 * It takes no backend, and neither does anything else now: every structural
 * surface in the scene takes one path on both renderers. See the note in
 * `surfaceMaterial.ts` for the measurement that forced it.
 */
export function Atmosphere(): JSX.Element {
  const descriptor = useMemo(() => deriveAtmosphereDescriptor(), []);
  const geometry = useMemo(() => buildStructureGeometry(descriptor.parts), [descriptor]);
  const material = useMemo(
    () =>
      createSurfaceMaterial({
        role: 'volume',
        color: '#ffffff',
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    // The backdrop carries no activity of its own: it is the one surface in the
    // scene that is not allowed to move.
    material.updateInput({ activity: 0, focus: 0 });
  }, [material]);

  return (
    <mesh
      geometry={geometry.solid}
      material={material.material}
      name="scene-atmosphere"
      renderOrder={-1}
    />
  );
}
