'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';

import { MACHINE_PALETTE } from '../materials/machinePalette';
import { createSurfaceMaterial } from '../materials/surfaceMaterial';
import type { RendererAdapterBackend } from '../../renderer/runtime';
import {
  buildCoreStructureGeometry,
  buildPortGeometry,
} from './coreStructureGeometry';
import {
  deriveCorePortActivation,
  type CoreStructure,
} from './coreStructure';
import type { CoreVisualInput } from './coreTypes';

export type CoreStructureViewProps = {
  readonly structure: CoreStructure;
  /**
   * Continuous visual scalars live here, not in React state: the hero updates its
   * material state every frame without re-rendering a single component.
   */
  readonly visualRef: React.RefObject<CoreVisualInput>;
  readonly backend: RendererAdapterBackend;
};

/**
 * The hero Compute Core.
 *
 * One diagonal spine, one cut processing volume with a real void between its
 * halves, secondary assemblies, layered membranes and viewport-clipped
 * foreground slices — merged into a solid mass and a membrane set, so it reads
 * as a single asymmetric computing structure rather than a pile of boxes.
 *
 * Ports are drawn separately because routing leaves from them, and the source
 * port has to brighten on its own when a domain is targeted.
 */
export function CoreStructureView({
  structure,
  visualRef,
  backend,
}: CoreStructureViewProps) {
  const webgpu = backend === 'webgpu';
  const geometry = useMemo(() => buildCoreStructureGeometry(structure), [structure]);
  const portGeometries = useMemo(
    () => structure.ports.map((port) => buildPortGeometry(port)),
    [structure],
  );

  const materials = useMemo(
    () => ({
      solid: createSurfaceMaterial({
        role: 'volume',
        color: '#ffffff',
        edgeResponse: 0.42,
        webgpuPreferred: webgpu,
      }),
      membrane: createSurfaceMaterial({
        role: 'membrane',
        color: MACHINE_PALETTE.membrane,
        baseFade: 0.34,
        edgeResponse: 0.5,
        webgpuPreferred: webgpu,
      }),
    }),
    [webgpu],
  );

  const portMaterials = useMemo(
    () =>
      structure.ports.map((port) =>
        createSurfaceMaterial({
          role: 'port',
          color: port.rank % 2 === 0 ? MACHINE_PALETTE.port : MACHINE_PALETTE.portQuiet,
          edgeResponse: 0.6,
          webgpuPreferred: webgpu,
        }),
      ),
    [structure, webgpu],
  );

  // The last published activation, so a static frame still reads correctly even
  // before the first animation frame lands.
  const appliedRef = useRef('');

  useEffect(
    () => () => {
      geometry.dispose();
      for (const portGeometry of portGeometries) portGeometry.dispose();
      materials.solid.dispose();
      materials.membrane.dispose();
      for (const portMaterial of portMaterials) portMaterial.dispose();
    },
    [geometry, materials, portGeometries, portMaterials],
  );

  useFrame(() => {
    const input = visualRef.current;
    if (!input) return;

    const activation = deriveCorePortActivation(structure, input);
    const reducedMotion = input.reducedMotion;
    const activity = input.intensity;
    const focus = input.visualState === 'focusing' ? 1 : input.visualState === 'hover_response' ? 0.55 : 0;

    // Structural material state only changes when the semantic state does, so a
    // frame that changes nothing writes nothing.
    const key = `${input.visualState}:${reducedMotion ? 'r' : 'f'}:${Math.round(activity * 64)}`;
    if (key !== appliedRef.current) {
      appliedRef.current = key;
      materials.solid.updateInput({ activity, focus, reducedMotion });
      materials.membrane.updateInput({
        activity: activity * 0.7,
        focus,
        reducedMotion,
      });
    }

    for (let index = 0; index < portMaterials.length; index += 1) {
      const port = structure.ports[index];
      const handle = portMaterials[index];
      if (!port || !handle) continue;
      const isSource = port.id === activation.sourcePortId;
      const authority = activation.routingAuthority;
      handle.updateInput({
        activity: isSource ? 0.35 + 0.65 * authority : 0.1 * authority,
        focus,
        reducedMotion,
      });
    }
  });

  return (
    <group name="core-structure">
      <mesh
        geometry={geometry.solid}
        material={materials.solid.material}
        renderOrder={0}
      />
      <mesh
        geometry={geometry.membrane}
        material={materials.membrane.material}
        renderOrder={3}
      />
      {structure.ports.map((port, index) => {
        const portGeometry = portGeometries[index];
        const portMaterial = portMaterials[index];
        if (!portGeometry || !portMaterial) return null;
        return (
          <mesh
            geometry={portGeometry}
            key={port.id}
            material={portMaterial.material}
            renderOrder={4}
          />
        );
      })}
    </group>
  );
}