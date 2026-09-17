'use client';

import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import { createResourceLease, disposeAll } from './coreResourceLifecycle';
import type { CoreStructuralViewProps } from './CoreNucleus';
import { deriveCoreTopologyActivation } from './coreTopology';
import type { CoreTopology as CoreTopologyData } from './coreTopology';

type CoreTopologyResources = {
  readonly edgeMesh: THREE.LineSegments;
  readonly edgeGeometry: THREE.BufferGeometry;
  readonly edgeMaterial: THREE.LineBasicMaterial;
  readonly edgePositionAttribute: THREE.Float32BufferAttribute;
  readonly edgesById: ReadonlyMap<number, CoreTopologyData['edges'][number]>;
  readonly nodesById: ReadonlyMap<number, CoreTopologyData['nodes'][number]>;
  readonly nodeMesh: THREE.InstancedMesh;
  readonly nodeGeometry: THREE.BufferGeometry;
  readonly nodeMaterial: THREE.MeshBasicMaterial;
  readonly transform: THREE.Object3D;
  readonly activeColor: THREE.Color;
};

export function createTopologyResources(topology: CoreTopologyData): CoreTopologyResources {
  const edgePositionAttribute = new THREE.Float32BufferAttribute(
    new Float32Array(Math.max(topology.edges.length, 1) * 6),
    3,
  );
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', edgePositionAttribute);
  edgeGeometry.setDrawRange(0, 0);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: CORE_COLORS.topologyActive,
    depthWrite: false,
    opacity: 0.78,
    transparent: true,
  });
  const edgeMesh = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edgeMesh.frustumCulled = false;

  const nodeGeometry = new THREE.OctahedronGeometry(0.085, 0);
  const nodeMaterial = new THREE.MeshBasicMaterial({
    depthWrite: false,
    opacity: 0.72,
    transparent: true,
    vertexColors: true,
  });
  const nodeMesh = new THREE.InstancedMesh(
    nodeGeometry,
    nodeMaterial,
    Math.max(topology.nodes.length, 1),
  );
  nodeMesh.count = 0;
  nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(Math.max(topology.nodes.length, 1) * 3),
    3,
  );
  nodeMesh.frustumCulled = false;

  return {
    edgeMesh,
    edgeGeometry,
    edgeMaterial,
    edgePositionAttribute,
    edgesById: new Map(topology.edges.map((edge) => [edge.id, edge])),
    nodesById: new Map(topology.nodes.map((node) => [node.id, node])),
    nodeMesh,
    nodeGeometry,
    nodeMaterial,
    transform: new THREE.Object3D(),
    activeColor: new THREE.Color(CORE_COLORS.topologyActive),
  };
}

export function updateTopologyResources(
  resources: CoreTopologyResources,
  activeEdgeIds: readonly number[],
  activeNodeIds: readonly number[],
  reducedMotion: boolean,
): void {
  const positions = resources.edgePositionAttribute.array as Float32Array;
  let vertexCount = 0;

  for (const edgeId of activeEdgeIds) {
    const edge = resources.edgesById.get(edgeId);
    if (!edge) {
      continue;
    }

    const source = resources.nodesById.get(edge.source);
    const target = resources.nodesById.get(edge.target);
    if (!source || !target) {
      continue;
    }

    const offset = vertexCount * 3;
    positions[offset] = source.position[0];
    positions[offset + 1] = source.position[1];
    positions[offset + 2] = source.position[2];
    positions[offset + 3] = target.position[0];
    positions[offset + 4] = target.position[1];
    positions[offset + 5] = target.position[2];
    vertexCount += 2;
  }

  resources.edgePositionAttribute.needsUpdate = true;
  resources.edgeGeometry.setDrawRange(0, vertexCount);
  resources.edgeMaterial.opacity = reducedMotion ? 0.66 : 0.78;

  let instanceCount = 0;
  for (const nodeId of activeNodeIds) {
    const node = resources.nodesById.get(nodeId);
    if (!node || instanceCount >= resources.nodeMesh.instanceMatrix.count) {
      continue;
    }

    const transform = resources.transform;
    const nodeScale = node.weight * (node.region === 'anchor' ? 0.17 : 0.15);
    transform.position.set(...node.position);
    transform.rotation.set(
      node.position[1] * 0.35,
      node.position[0] * 0.2,
      node.position[2] * 0.18,
    );
    transform.scale.setScalar(nodeScale);
    transform.updateMatrix();
    resources.nodeMesh.setMatrixAt(instanceCount, transform.matrix);
    resources.nodeMesh.setColorAt(instanceCount, resources.activeColor);
    instanceCount += 1;
  }

  resources.nodeMesh.count = instanceCount;
  resources.nodeMesh.instanceMatrix.needsUpdate = true;
  if (resources.nodeMesh.instanceColor) {
    resources.nodeMesh.instanceColor.needsUpdate = true;
  }
}

export function disposeTopologyResources(resources: CoreTopologyResources): void {
  disposeAll([
    resources.edgeGeometry,
    resources.edgeMaterial,
    resources.nodeMesh,
    resources.nodeGeometry,
    resources.nodeMaterial,
  ]);
}

/** Data-driven structural nodes and active path buffers. */
export function CoreTopology({ topology, visualInput, reducedMotion }: CoreStructuralViewProps) {
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
  const resources = useMemo(() => createTopologyResources(topology), [topology]);
  const lease = useMemo(
    () => createResourceLease(() => disposeTopologyResources(resources)),
    [resources],
  );

  useLayoutEffect(() => lease.retain(), [lease]);

  useLayoutEffect(() => {
    updateTopologyResources(
      resources,
      activation.activeEdgeIds,
      activation.activeNodeIds,
      reducedMotion,
    );
  }, [activation, reducedMotion, resources]);

  return (
    <group>
      <primitive object={resources.edgeMesh} dispose={null} />
      <primitive object={resources.nodeMesh} dispose={null} />
    </group>
  );
}
