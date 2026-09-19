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
 * It takes no backend: the backdrop is the one surface in the scene whose
 * material path does not branch on one (see below).
 */
export function Atmosphere(): JSX.Element {
  const descriptor = useMemo(() => deriveAtmosphereDescriptor(), []);
  const geometry = useMemo(() => buildStructureGeometry(descriptor.parts), [descriptor]);
  const material = useMemo(
    () =>
      createSurfaceMaterial({
        role: 'volume',
        color: '#ffffff',
        // Nearly head-on and far away, so the view-edge term is barely asked for.
        edgeResponse: 0.18,
        // Deliberately the standard path on both backends, and not a fallback.
        //
        // The backdrop is the one surface in the scene that never moves and never
        // responds, so the node path buys it nothing — and on WebGPU the node path
        // draws this mesh black. Measured on the same frame, at the frame centre:
        // node path (2,3,3), standard path (26,33,33), and the scene's own
        // background colour is (5,6,9). So on WebGL2 the backdrop showed exactly
        // as authored while WebGPU rendered a frame that was already at or below
        // the clear colour, meaning the backdrop was contributing nothing there.
        // The standard path draws it identically on both backends, so the static
        // backdrop takes that path until the node path is understood.
        webgpuPreferred: false,
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
    material.updateInput({ activity: 0, focus: 0, reducedMotion: true });
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
