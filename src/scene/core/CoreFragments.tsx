'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import type { CoreStructuralViewProps } from './CoreNucleus';
import { deriveCoreTopologyActivation } from './coreTopology';
import type { CoreTopology as CoreTopologyData } from './coreTopology';

function createFragmentMembranes(
  topology: CoreTopologyData,
  activeNodeIds: readonly number[],
  reducedMotion: boolean,
): THREE.LineSegments {
  const activeNodeSet = new Set(activeNodeIds);
  const positions: number[] = [];
  const span = reducedMotion ? 0.13 : 0.17;

  for (const node of topology.nodes) {
    if (node.region === 'anchor' || !activeNodeSet.has(node.id)) {
      continue;
    }

    const [x, y, z] = node.position;
    const centerX = x * 1.14 + z * 0.035;
    const centerY = y * 1.14;
    const centerZ = z * 1.14 - x * 0.035;
    const incline = node.id % 2 === 0 ? 1 : -1;

    for (let row = -1; row <= 1; row += 1) {
      const vertical = row * 0.055;
      const depth = row * 0.022 * incline;
      positions.push(
        centerX - span,
        centerY + vertical,
        centerZ - depth,
        centerX + span,
        centerY + vertical + 0.018 * incline,
        centerZ + depth,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: CORE_COLORS.fragment,
    depthWrite: false,
    opacity: 0.52,
    transparent: true,
  });
  return new THREE.LineSegments(geometry, material);
}

/** Short offset line membranes reveal the currently active structural branch. */
export function CoreFragments({ topology, visualInput, reducedMotion }: CoreStructuralViewProps) {
  const activation = useMemo(
    () => deriveCoreTopologyActivation(topology, visualInput),
    [topology, visualInput],
  );
  const membranes = useMemo(
    () => createFragmentMembranes(topology, activation.activeNodeIds, reducedMotion),
    [topology, activation.activeNodeIds, reducedMotion],
  );

  useEffect(
    () => () => {
      membranes.geometry.dispose();
      (membranes.material as THREE.Material).dispose();
    },
    [membranes],
  );

  return <primitive object={membranes} />;
}
