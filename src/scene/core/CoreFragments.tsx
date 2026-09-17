'use client';

import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import type { CoreStructuralViewProps } from './CoreNucleus';
import { deriveCoreTopologyActivation } from './coreTopology';
import type { CoreTopology as CoreTopologyData } from './coreTopology';

type CoreFragmentResources = {
  readonly mesh: THREE.LineSegments;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.LineBasicMaterial;
  readonly positionAttribute: THREE.Float32BufferAttribute;
  readonly nodesById: ReadonlyMap<number, CoreTopologyData['nodes'][number]>;
};

function createFragmentResources(topology: CoreTopologyData): CoreFragmentResources {
  const maximumSegments = Math.max(topology.nodes.length, 1) * 3;
  const positionAttribute = new THREE.Float32BufferAttribute(
    new Float32Array(maximumSegments * 6),
    3,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color: CORE_COLORS.fragment,
    depthWrite: false,
    opacity: 0.52,
    transparent: true,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    geometry,
    material,
    positionAttribute,
    nodesById: new Map(topology.nodes.map((node) => [node.id, node])),
  };
}

function updateFragmentResources(
  resources: CoreFragmentResources,
  activeNodeIds: readonly number[],
  reducedMotion: boolean,
): void {
  const positions = resources.positionAttribute.array as Float32Array;
  const span = reducedMotion ? 0.13 : 0.17;
  let vertexCount = 0;

  for (const nodeId of activeNodeIds) {
    const node = resources.nodesById.get(nodeId);
    if (!node || node.region === 'anchor') {
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
      const offset = vertexCount * 3;
      positions[offset] = centerX - span;
      positions[offset + 1] = centerY + vertical;
      positions[offset + 2] = centerZ - depth;
      positions[offset + 3] = centerX + span;
      positions[offset + 4] = centerY + vertical + 0.018 * incline;
      positions[offset + 5] = centerZ + depth;
      vertexCount += 2;
    }
  }

  resources.positionAttribute.needsUpdate = true;
  resources.geometry.setDrawRange(0, vertexCount);
}

function disposeFragmentResources(resources: CoreFragmentResources): void {
  resources.mesh.dispose();
  resources.geometry.dispose();
  resources.material.dispose();
}

/** Short offset line membranes reveal the active structural branch. */
export function CoreFragments({ topology, visualInput, reducedMotion }: CoreStructuralViewProps) {
  const {
    focusX,
    focusY,
    focusZ,
    intensity,
    pointerX,
    pointerY,
    reducedMotion: inputReducedMotion,
    visualState,
  } = visualInput;
  const activation = useMemo(
    () =>
      deriveCoreTopologyActivation(topology, {
        focusX,
        focusY,
        focusZ,
        intensity,
        pointerX,
        pointerY,
        reducedMotion: inputReducedMotion,
        visualState,
      }),
    [topology, focusX, focusY, focusZ, intensity, inputReducedMotion, pointerX, pointerY, visualState],
  );
  const resources = useMemo(() => createFragmentResources(topology), [topology]);

  useLayoutEffect(() => {
    updateFragmentResources(resources, activation.activeNodeIds, reducedMotion);
  }, [activation, reducedMotion, resources]);

  useEffect(
    () => () => disposeFragmentResources(resources),
    [resources],
  );

  return <primitive object={resources.mesh} dispose={null} />;
}
