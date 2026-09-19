'use client';

import { useFrame } from '@react-three/fiber';
import type { JSX } from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import { createResourceLease, disposeAll } from './coreResourceLifecycle';
import { deriveCoreTrajectoryActivation } from './coreTrajectories';
import type { CoreTrajectory, CoreTrajectoryActivation } from './coreTrajectories';
import type { CoreTrajectoryViewProps } from './CoreTrajectoryPaths';

export type CoreSignalResources = {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.PointsMaterial;
  readonly points: THREE.Points;
  readonly positionAttribute: THREE.Float32BufferAttribute;
  readonly trajectoriesById: ReadonlyMap<number, CoreTrajectory>;
};

function signalPoint(
  points: CoreTrajectory['points'],
  progress: number,
  target: Float32Array,
  offset: number,
): void {
  const segmentCount = Math.max(0, points.length - 1);
  if (segmentCount === 0) return;

  const boundedProgress = Math.max(0, Math.min(0.999_999, progress));
  const scaled = boundedProgress * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
  const local = scaled - segmentIndex;
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return;

  target[offset] = start[0] + (end[0] - start[0]) * local;
  target[offset + 1] = start[1] + (end[1] - start[1]) * local;
  target[offset + 2] = start[2] + (end[2] - start[2]) * local;
}

function boundedElapsed(elapsedTime: number): number {
  return Number.isFinite(elapsedTime) ? Math.max(0, elapsedTime) : 0;
}

export function createCoreSignalResources(
  trajectories: readonly CoreTrajectory[],
  activeSignalBudget = trajectories.length,
): CoreSignalResources {
  const signalCapacity = Number.isFinite(activeSignalBudget)
    ? Math.max(0, Math.min(trajectories.length, Math.floor(activeSignalBudget)))
    : 0;
  const positionAttribute = new THREE.Float32BufferAttribute(
    new Float32Array(Math.max(signalCapacity, 1) * 3),
    3,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({
    color: CORE_COLORS.nucleusAccent,
    depthWrite: false,
    opacity: 0.94,
    size: 0.095,
    sizeAttenuation: true,
    transparent: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    geometry,
    material,
    points,
    positionAttribute,
    trajectoriesById: new Map(trajectories.map((trajectory) => [trajectory.id, trajectory])),
  };
}

/**
 * Updates a fixed point buffer. Every point is sampled from an existing open
 * descriptor path, so multi-signal activity reveals propagation without
 * allocating particles or introducing a closed orbit.
 */
export function updateCoreSignalResources(
  resources: CoreSignalResources,
  activation: CoreTrajectoryActivation,
  elapsedTime: number,
  reducedMotion: boolean,
): void {
  const positions = resources.positionAttribute.array as Float32Array;
  const elapsed = reducedMotion ? 0 : boundedElapsed(elapsedTime);
  const signalSpeed = reducedMotion ? 0 : activation.signalSpeed;
  let visibleCount = 0;

  for (const id of activation.signalTrajectoryIds) {
    const trajectory = resources.trajectoriesById.get(id);
    if (!trajectory || trajectory.points.length < 2 || visibleCount >= resources.positionAttribute.count) {
      continue;
    }

    const progress = (elapsed * signalSpeed + visibleCount * 0.173 + trajectory.activationRank * 0.071) % 1;
    signalPoint(trajectory.points, progress, positions, visibleCount * 3);
    visibleCount += 1;
  }

  resources.positionAttribute.needsUpdate = true;
  resources.geometry.setDrawRange(0, visibleCount);
  resources.material.opacity = visibleCount > 0 ? (reducedMotion ? 0.7 : 0.94) : 0;
}

export function disposeCoreSignalResources(resources: CoreSignalResources): void {
  disposeAll([resources.geometry, resources.material]);
}

/** Bounded multi-route signal accents rendered as one reusable Points batch. */
export function CoreSignals({
  trajectories,
  visualInput,
  reducedMotion,
  activeSignalBudget,
}: CoreTrajectoryViewProps): JSX.Element {
  const activation = useMemo(
    () => deriveCoreTrajectoryActivation(trajectories, visualInput),
    [trajectories, visualInput],
  );
  const signalBudget = activeSignalBudget ?? trajectories.length;
  const resources = useMemo(
    () => createCoreSignalResources(trajectories, signalBudget),
    [trajectories, signalBudget],
  );
  const lease = useMemo(
    () => createResourceLease(() => disposeCoreSignalResources(resources)),
    [resources],
  );
  const activationRef = useRef<CoreTrajectoryActivation>(activation);
  const reducedMotionRef = useRef(reducedMotion || visualInput.reducedMotion);

  useLayoutEffect(() => lease.retain(), [lease]);

  useLayoutEffect(() => {
    activationRef.current = activation;
    reducedMotionRef.current = reducedMotion || visualInput.reducedMotion;
    updateCoreSignalResources(resources, activation, 0, reducedMotionRef.current);
  }, [activation, reducedMotion, resources, visualInput.reducedMotion]);

  useFrame((state) => {
    updateCoreSignalResources(
      resources,
      activationRef.current,
      state.clock.elapsedTime,
      reducedMotionRef.current,
    );
  });

  return <primitive object={resources.points} dispose={null} />;
}
