'use client';

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';

import { createSurfaceMaterial } from './materials/surfaceMaterial';
import {
  buildStructureGeometry,
  usedSurfaceClasses,
} from './materials/structureGeometry';
import { deriveAtmosphereDescriptor } from './atmosphereDescriptor';

/**
 * Depth behind the composition.
 *
 * Seven nested depth-separated plates plus a rear fill, in the `backdrop` tier,
 * merged into one mass and graded by the scene fog. This replaces the previous
 * constellation of thin traces and stray points: a backdrop that reads as
 * distance and scale, with nothing in it that could be mistaken for a signal.
 * `deriveAtmosphereDescriptor` owns the stack; this file only mounts it.
 *
 * It takes no backend, and neither does anything else now: every structural
 * surface in the scene takes one path on both renderers. See the note in
 * `surfaceMaterial.ts` for the measurement that forced it.
 */
export function Atmosphere(): JSX.Element {
  const descriptor = useMemo(() => deriveAtmosphereDescriptor(), []);
  const geometry = useMemo(() => buildStructureGeometry(descriptor.parts), [descriptor]);
  const classes = useMemo(() => usedSurfaceClasses(descriptor.parts), [descriptor]);
  const materials = useMemo(
    () =>
      classes.map((surface) =>
        createSurfaceMaterial({ role: surface, color: '#ffffff' }),
      ),
    [classes],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
    [geometry, materials],
  );

  useEffect(() => {
    // The backdrop carries no activity of its own: it is the one surface in the
    // scene that is not allowed to move.
    for (const material of materials) material.updateInput({ activity: 0, focus: 0 });
  }, [materials]);

  return (
    <group name="scene-atmosphere">
      {classes.map((surface, index) => {
        const material = materials[index];
        if (!material) return null;
        return (
          <mesh
            geometry={geometry.surfaces[surface]}
            key={surface}
            material={material.material}
            renderOrder={-1}
          />
        );
      })}
    </group>
  );
}
