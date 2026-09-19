'use client';

import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import { createResourceLease, disposeAll } from './coreResourceLifecycle';
import type { CoreStructuralViewProps } from './CoreNucleus';
import { deriveCoreTopologyActivation } from './coreTopology';
import type {
  CoreTopology as CoreTopologyData,
  CoreTopologyActivation,
  CoreTopologyRoute,
} from './coreTopology';

type EdgeLineGroup = {
  readonly mesh: THREE.LineSegments;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.LineBasicMaterial;
  readonly positionAttribute: THREE.Float32BufferAttribute;
  readonly route: Exclude<CoreTopologyRoute, 'primary'>;
};

type CoreTopologyResources = {
  readonly primaryMesh: THREE.InstancedMesh;
  readonly primaryGeometry: THREE.BoxGeometry;
  readonly primaryMaterial: THREE.MeshBasicMaterial;
  readonly secondaryMesh: THREE.LineSegments;
  readonly secondaryGeometry: THREE.BufferGeometry;
  readonly secondaryMaterial: THREE.LineBasicMaterial;
  readonly secondaryPositionAttribute: THREE.Float32BufferAttribute;
  readonly ambientMesh: THREE.LineSegments;
  readonly ambientGeometry: THREE.BufferGeometry;
  readonly ambientMaterial: THREE.LineBasicMaterial;
  readonly ambientPositionAttribute: THREE.Float32BufferAttribute;
  readonly signalMesh: THREE.LineSegments;
  readonly signalGeometry: THREE.BufferGeometry;
  readonly signalMaterial: THREE.LineBasicMaterial;
  readonly signalPositionAttribute: THREE.Float32BufferAttribute;
  readonly edgeGroups: readonly EdgeLineGroup[];
  readonly edgesById: ReadonlyMap<number, CoreTopologyData['edges'][number]>;
  readonly nodesById: ReadonlyMap<number, CoreTopologyData['nodes'][number]>;
  readonly nodeMesh: THREE.InstancedMesh;
  readonly nodeGeometry: THREE.BoxGeometry;
  readonly nodeMaterial: THREE.MeshBasicMaterial;
  readonly transform: THREE.Object3D;
  readonly activeColor: THREE.Color;
};

function createEdgeLineGroup(
  route: EdgeLineGroup['route'],
  capacity: number,
  color: string,
  opacity: number,
): EdgeLineGroup {
  const positionAttribute = new THREE.Float32BufferAttribute(new Float32Array(Math.max(capacity, 1) * 6), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({ color, depthWrite: false, opacity, transparent: true });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, geometry, material, positionAttribute, route };
}

export function createTopologyResources(topology: CoreTopologyData): CoreTopologyResources {
  const edgesById = new Map(topology.edges.map((edge) => [edge.id, edge]));
  const nodesById = new Map(topology.nodes.map((node) => [node.id, node]));
  const primaryGeometry = new THREE.BoxGeometry(1, 1, 1);
  const primaryMaterial = new THREE.MeshBasicMaterial({
    color: CORE_COLORS.topologyActive,
    depthWrite: false,
    opacity: 0.88,
    transparent: true,
  });
  const primaryMesh = new THREE.InstancedMesh(
    primaryGeometry,
    primaryMaterial,
    Math.max(topology.edges.filter((edge) => edge.route === 'primary').length, 1),
  );
  primaryMesh.count = 0;
  primaryMesh.frustumCulled = false;

  const secondary = createEdgeLineGroup(
    'secondary', topology.edges.filter((edge) => edge.route === 'secondary').length,
    CORE_COLORS.topologyActive, 0.58,
  );
  const ambient = createEdgeLineGroup(
    'ambient', topology.edges.filter((edge) => edge.route === 'ambient').length,
    CORE_COLORS.quiet, 0.22,
  );
  const signal = createEdgeLineGroup(
    'signal', topology.edges.filter((edge) => edge.route === 'signal').length,
    CORE_COLORS.nucleusAccent, 0.68,
  );

  const nodeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const nodeMaterial = new THREE.MeshBasicMaterial({
    depthWrite: false,
    opacity: 0.7,
    transparent: true,
    vertexColors: true,
  });
  const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, Math.max(topology.nodes.length, 1));
  nodeMesh.count = 0;
  nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(topology.nodes.length, 1) * 3), 3);
  nodeMesh.frustumCulled = false;

  return {
    primaryMesh, primaryGeometry, primaryMaterial,
    secondaryMesh: secondary.mesh, secondaryGeometry: secondary.geometry,
    secondaryMaterial: secondary.material, secondaryPositionAttribute: secondary.positionAttribute,
    ambientMesh: ambient.mesh, ambientGeometry: ambient.geometry,
    ambientMaterial: ambient.material, ambientPositionAttribute: ambient.positionAttribute,
    signalMesh: signal.mesh, signalGeometry: signal.geometry,
    signalMaterial: signal.material, signalPositionAttribute: signal.positionAttribute,
    edgeGroups: [secondary, ambient, signal], edgesById, nodesById,
    nodeMesh, nodeGeometry, nodeMaterial, transform: new THREE.Object3D(),
    activeColor: new THREE.Color(CORE_COLORS.topologyActive),
  };
}

function setPrimaryMembers(resources: CoreTopologyResources, edgeIds: readonly number[], reducedMotion: boolean): void {
  const transform = resources.transform;
  const axis = new THREE.Vector3(1, 0, 0);
  const direction = new THREE.Vector3();
  let instanceCount = 0;

  for (const edgeId of edgeIds) {
    const edge = resources.edgesById.get(edgeId);
    const source = edge && resources.nodesById.get(edge.source);
    const target = edge && resources.nodesById.get(edge.target);
    if (!edge || !source || !target || instanceCount >= resources.primaryMesh.instanceMatrix.count) continue;

    direction.set(
      target.position[0] - source.position[0],
      target.position[1] - source.position[1],
      target.position[2] - source.position[2],
    );
    const length = direction.length();
    if (length < 0.001) continue;
    transform.position.set(
      (source.position[0] + target.position[0]) * 0.5,
      (source.position[1] + target.position[1]) * 0.5,
      (source.position[2] + target.position[2]) * 0.5,
    );
    transform.quaternion.setFromUnitVectors(axis, direction.normalize());
    transform.scale.set(length, 0.075 + edge.importance * 0.06, 0.08);
    transform.updateMatrix();
    resources.primaryMesh.setMatrixAt(instanceCount, transform.matrix);
    instanceCount += 1;
  }

  resources.primaryMesh.count = instanceCount;
  resources.primaryMesh.instanceMatrix.needsUpdate = true;
  resources.primaryMaterial.opacity = reducedMotion ? 0.74 : 0.88;
}

function setLineGroup(
  resources: CoreTopologyResources,
  group: EdgeLineGroup,
  edgeIds: readonly number[],
  reducedMotion: boolean,
): void {
  const positions = group.positionAttribute.array as Float32Array;
  let vertexCount = 0;
  for (const edgeId of edgeIds) {
    const edge = resources.edgesById.get(edgeId);
    const source = edge && resources.nodesById.get(edge.source);
    const target = edge && resources.nodesById.get(edge.target);
    if (!edge || edge.route !== group.route || !source || !target) continue;
    const offset = vertexCount * 3;
    positions[offset] = source.position[0];
    positions[offset + 1] = source.position[1];
    positions[offset + 2] = source.position[2];
    positions[offset + 3] = target.position[0];
    positions[offset + 4] = target.position[1];
    positions[offset + 5] = target.position[2];
    vertexCount += 2;
  }
  group.positionAttribute.needsUpdate = true;
  group.geometry.setDrawRange(0, vertexCount);
  if (reducedMotion && group.route !== 'ambient') group.material.opacity = group.route === 'signal' ? 0.56 : 0.48;
}

export function updateTopologyResources(
  resources: CoreTopologyResources,
  activation: CoreTopologyActivation,
  reducedMotion: boolean,
): void {
  setPrimaryMembers(resources, activation.primaryEdgeIds, reducedMotion);
  setLineGroup(resources, resources.edgeGroups[0]!, activation.secondaryEdgeIds, reducedMotion);
  setLineGroup(resources, resources.edgeGroups[1]!, activation.ambientEdgeIds, reducedMotion);
  setLineGroup(resources, resources.edgeGroups[2]!, activation.signalEdgeIds, reducedMotion);

  let instanceCount = 0;
  for (const nodeId of activation.activeNodeIds) {
    const node = resources.nodesById.get(nodeId);
    if (!node || instanceCount >= resources.nodeMesh.instanceMatrix.count) continue;
    const transform = resources.transform;
    const nodeScale = node.weight * 0.19;
    transform.position.set(...node.position);
    transform.rotation.set(node.position[1] * 0.35, node.position[0] * 0.2, node.position[2] * 0.18);
    transform.scale.set(node.scale[0] * nodeScale, node.scale[1] * nodeScale, node.scale[2] * nodeScale);
    transform.updateMatrix();
    resources.nodeMesh.setMatrixAt(instanceCount, transform.matrix);
    resources.nodeMesh.setColorAt(instanceCount, resources.activeColor);
    instanceCount += 1;
  }
  resources.nodeMesh.count = instanceCount;
  resources.nodeMesh.instanceMatrix.needsUpdate = true;
  if (resources.nodeMesh.instanceColor) resources.nodeMesh.instanceColor.needsUpdate = true;
}

export function disposeTopologyResources(resources: CoreTopologyResources): void {
  disposeAll([
    resources.primaryMesh, resources.primaryGeometry, resources.primaryMaterial,
    ...resources.edgeGroups.flatMap((group) => [group.geometry, group.material]),
    resources.nodeMesh, resources.nodeGeometry, resources.nodeMaterial,
  ]);
}

/** Instanced primary processing spine plus quieter, independently updated routes. */
export function CoreTopology({ topology, visualInput, reducedMotion }: CoreStructuralViewProps) {
  const activation = useMemo(
    () => deriveCoreTopologyActivation(topology, visualInput),
    [topology, visualInput],
  );
  const resources = useMemo(() => createTopologyResources(topology), [topology]);
  const lease = useMemo(() => createResourceLease(() => disposeTopologyResources(resources)), [resources]);

  useLayoutEffect(() => lease.retain(), [lease]);
  useLayoutEffect(() => {
    updateTopologyResources(resources, activation, reducedMotion || visualInput.reducedMotion);
  }, [activation, reducedMotion, resources, visualInput.reducedMotion]);

  return (
    <group>
      <primitive object={resources.primaryMesh} dispose={null} />
      <primitive object={resources.secondaryMesh} dispose={null} />
      <primitive object={resources.ambientMesh} dispose={null} />
      <primitive object={resources.signalMesh} dispose={null} />
      <primitive object={resources.nodeMesh} dispose={null} />
    </group>
  );
}
