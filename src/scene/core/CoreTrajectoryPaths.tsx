'use client';

import type { JSX } from 'react';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import { createResourceLease, disposeAll } from './coreResourceLifecycle';
import { deriveCoreTrajectoryActivation } from './coreTrajectories';
import type { CoreTrajectory, CoreTrajectoryActivation } from './coreTrajectories';
import type { CoreVisualInput } from './coreTypes';

export type CoreTrajectoryViewProps = {
  readonly trajectories: readonly CoreTrajectory[];
  readonly visualInput: CoreVisualInput;
  readonly reducedMotion: boolean;
  readonly activeSignalBudget?: number;
};

export type CoreTrajectoryResources = {
  readonly passiveGeometry: THREE.BufferGeometry;
  readonly passiveLine: THREE.LineSegments;
  readonly passiveMaterial: THREE.LineBasicMaterial;
  readonly activeGeometry: THREE.BufferGeometry;
  readonly activeLine: THREE.LineSegments;
  readonly activeMaterial: THREE.LineBasicMaterial;
  readonly activePositionAttribute: THREE.Float32BufferAttribute;
  readonly trajectoriesById: ReadonlyMap<number, CoreTrajectory>;
};

function segmentCountFor(trajectory: CoreTrajectory): number {
  return Math.max(0, trajectory.points.length - 1);
}

function totalSegmentCount(trajectories: readonly CoreTrajectory[]): number {
  let count = 0;
  for (const trajectory of trajectories) count += segmentCountFor(trajectory);
  return count;
}

function writeSegment(
  positions: Float32Array,
  vertexIndex: number,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
): void {
  const offset = vertexIndex * 3;
  positions[offset] = start[0];
  positions[offset + 1] = start[1];
  positions[offset + 2] = start[2];
  positions[offset + 3] = end[0];
  positions[offset + 4] = end[1];
  positions[offset + 5] = end[2];
}

function visibleSegmentCount(trajectory: CoreTrajectory, fraction: number): number {
  const total = segmentCountFor(trajectory);
  if (total === 0 || !Number.isFinite(fraction) || fraction <= 0) return 0;

  return Math.min(total, Math.max(1, Math.ceil(total * Math.min(1, fraction))));
}

export function createCoreTrajectoryResources(
  trajectories: readonly CoreTrajectory[],
): CoreTrajectoryResources {
  const capacity = Math.max(totalSegmentCount(trajectories), 1);
  const passivePositionAttribute = new THREE.Float32BufferAttribute(new Float32Array(capacity * 6), 3);
  const activePositionAttribute = new THREE.Float32BufferAttribute(new Float32Array(capacity * 6), 3);
  let passiveVertexCount = 0;

  for (const trajectory of trajectories) {
    for (let index = 0; index < trajectory.points.length - 1; index += 1) {
      const start = trajectory.points[index];
      const end = trajectory.points[index + 1];
      if (!start || !end) continue;
      writeSegment(passivePositionAttribute.array as Float32Array, passiveVertexCount, start, end);
      passiveVertexCount += 2;
    }
  }

  passivePositionAttribute.needsUpdate = true;
  const passiveGeometry = new THREE.BufferGeometry();
  passiveGeometry.setAttribute('position', passivePositionAttribute);
  passiveGeometry.setDrawRange(0, passiveVertexCount);
  const passiveMaterial = new THREE.LineBasicMaterial({
    color: CORE_COLORS.quiet,
    depthWrite: false,
    opacity: 0.28,
    transparent: true,
  });
  const passiveLine = new THREE.LineSegments(passiveGeometry, passiveMaterial);
  passiveLine.frustumCulled = false;

  const activeGeometry = new THREE.BufferGeometry();
  activeGeometry.setAttribute('position', activePositionAttribute);
  activeGeometry.setDrawRange(0, 0);
  const activeMaterial = new THREE.LineBasicMaterial({
    color: CORE_COLORS.topologyActive,
    depthWrite: false,
    opacity: 0.88,
    transparent: true,
  });
  const activeLine = new THREE.LineSegments(activeGeometry, activeMaterial);
  activeLine.frustumCulled = false;

  return {
    passiveGeometry,
    passiveLine,
    passiveMaterial,
    activeGeometry,
    activeLine,
    activeMaterial,
    activePositionAttribute,
    trajectoriesById: new Map(trajectories.map((trajectory) => [trajectory.id, trajectory])),
  };
}

export function updateCoreTrajectoryResources(
  resources: CoreTrajectoryResources,
  activation: CoreTrajectoryActivation,
  reducedMotion: boolean,
): void {
  const positions = resources.activePositionAttribute.array as Float32Array;
  let vertexCount = 0;
  const fraction = reducedMotion
    ? Math.min(activation.activeSegmentFraction, 0.58)
    : activation.activeSegmentFraction;

  for (const id of activation.activeTrajectoryIds) {
    const trajectory = resources.trajectoriesById.get(id);
    if (!trajectory) continue;

    const segmentCount = visibleSegmentCount(trajectory, fraction);
    for (let index = 0; index < segmentCount; index += 1) {
      const start = trajectory.points[index];
      const end = trajectory.points[index + 1];
      if (!start || !end) continue;
      writeSegment(positions, vertexCount, start, end);
      vertexCount += 2;
    }
  }

  resources.activePositionAttribute.needsUpdate = true;
  resources.activeGeometry.setDrawRange(0, vertexCount);
  resources.activeMaterial.opacity = vertexCount > 0 ? (reducedMotion ? 0.68 : 0.88) : 0;
}

export function disposeCoreTrajectoryResources(resources: CoreTrajectoryResources): void {
  disposeAll([
    resources.passiveGeometry,
    resources.passiveMaterial,
    resources.activeGeometry,
    resources.activeMaterial,
  ]);
}

/**
 * Merged, open trajectory lines. State changes rewrite only the bounded active
 * prefix of a reusable position buffer; the full faint path layer preserves
 * intentional gaps and never forms a closed orbital system.
 */
export function CoreTrajectories({
  trajectories,
  visualInput,
  reducedMotion,
}: CoreTrajectoryViewProps): JSX.Element {
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
    () => deriveCoreTrajectoryActivation(trajectories, visualInput),
    [trajectories, visualInput],
  );
  const resources = useMemo(() => createCoreTrajectoryResources(trajectories), [trajectories]);
  const lease = useMemo(
    () => createResourceLease(() => disposeCoreTrajectoryResources(resources)),
    [resources],
  );
  const effectiveReducedMotion = reducedMotion || inputReducedMotion;

  useLayoutEffect(() => lease.retain(), [lease]);

  useLayoutEffect(() => {
    updateCoreTrajectoryResources(resources, activation, effectiveReducedMotion);
  }, [
    activation,
    effectiveReducedMotion,
    focusX,
    focusY,
    focusZ,
    intensity,
    pointerX,
    pointerY,
    resources,
    visualState,
  ]);

  return (
    <group>
      <primitive object={resources.passiveLine} dispose={null} />
      <primitive object={resources.activeLine} dispose={null} />
    </group>
  );
}
