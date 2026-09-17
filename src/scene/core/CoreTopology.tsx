'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import type { CoreStructuralViewProps } from './CoreNucleus';
import { deriveCoreTopologyActivation } from './coreTopology';
import type { CoreTopology as CoreTopologyData } from './coreTopology';

function edgeSegments(
  topology: CoreTopologyData,
  edgeIds: ReadonlySet<number>,
  color: string,
  opacity: number,
): THREE.LineSegments {
  const positions: number[] = [];
  const nodes = new Map(topology.nodes.map((node) => [node.id, node]));

  for (const edge of topology.edges) {
    if (!edgeIds.has(edge.id)) {
      continue;
    }

    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      continue;
    }

    positions.push(...source.position, ...target.position);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    depthWrite: false,
    opacity,
    transparent: true,
  });
  return new THREE.LineSegments(geometry, material);
}

function createEdgeGroup(
  topology: CoreTopologyData,
  activeEdgeIds: readonly number[],
  reducedMotion: boolean,
): THREE.Group {
  const activeSet = new Set(activeEdgeIds);
  const passiveSet = new Set(
    topology.edges.filter((edge) => !activeSet.has(edge.id)).map((edge) => edge.id),
  );
  const group = new THREE.Group();

  group.add(edgeSegments(topology, passiveSet, CORE_COLORS.topology, reducedMotion ? 0.13 : 0.1));
  group.add(edgeSegments(topology, activeSet, CORE_COLORS.topologyActive, 0.78));
  return group;
}

function createNodeMesh(
  topology: CoreTopologyData,
  activeNodeIds: readonly number[],
): THREE.InstancedMesh {
  const geometry = new THREE.OctahedronGeometry(0.085, 0);
  const material = new THREE.MeshBasicMaterial({
    depthWrite: false,
    opacity: 0.72,
    transparent: true,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(topology.nodes.length, 1));
  const activeSet = new Set(activeNodeIds);
  const transform = new THREE.Object3D();
  const activeColor = new THREE.Color(CORE_COLORS.topologyActive);
  const passiveColor = new THREE.Color(CORE_COLORS.topologyNode);

  for (const [index, node] of topology.nodes.entries()) {
    const active = activeSet.has(node.id);
    const nodeScale = node.weight * (active ? 0.15 : 0.08);
    transform.position.set(...node.position);
    transform.rotation.set(node.position[1] * 0.35, node.position[0] * 0.2, node.position[2] * 0.18);
    transform.scale.setScalar(nodeScale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, active ? activeColor : passiveColor);
  }

  mesh.count = topology.nodes.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  return mesh;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

/** Data-driven structural nodes and explicit active/passive path subsets. */
export function CoreTopology({ topology, visualInput, reducedMotion }: CoreStructuralViewProps) {
  const activation = useMemo(
    () => deriveCoreTopologyActivation(topology, visualInput),
    [topology, visualInput],
  );
  const edgeGroup = useMemo(
    () => createEdgeGroup(topology, activation.activeEdgeIds, reducedMotion),
    [topology, activation.activeEdgeIds, reducedMotion],
  );
  const nodeMesh = useMemo(
    () => createNodeMesh(topology, activation.activeNodeIds),
    [topology, activation.activeNodeIds],
  );

  useEffect(
    () => () => {
      disposeObject(edgeGroup);
      nodeMesh.geometry.dispose();
      (nodeMesh.material as THREE.Material).dispose();
    },
    [edgeGroup, nodeMesh],
  );

  return (
    <group>
      <primitive object={edgeGroup} />
      <primitive object={nodeMesh} />
    </group>
  );
}
