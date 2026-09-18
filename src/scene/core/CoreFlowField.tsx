'use client';

import { useFrame } from '@react-three/fiber';
import type { JSX } from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';
import { deriveCoreFieldState } from './coreField';
import { createCoreFlowMaterial } from './coreFlowMaterial';
import { createResourceLease, disposeAll } from './coreResourceLifecycle';
import type { CoreFieldDescriptor } from './coreField';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreFlowFieldProps = {
  readonly descriptor: CoreFieldDescriptor;
  readonly parameters: CoreParameters;
  readonly visualInput: CoreVisualInput;
};

type CoreFlowFieldResources = {
  readonly geometry: THREE.BufferGeometry;
  readonly materialHandle: ReturnType<typeof createCoreFlowMaterial>;
  readonly points: THREE.Points;
};

function createStreamOrder(sampleCount: number, streamCount: number): Uint16Array | Uint32Array {
  const IndexArray = sampleCount > 65_535 ? Uint32Array : Uint16Array;
  const order = new IndexArray(sampleCount);
  let writeIndex = 0;

  for (let stream = 0; stream < streamCount; stream += 1) {
    for (let sample = stream; sample < sampleCount; sample += streamCount) {
      order[writeIndex] = sample;
      writeIndex += 1;
    }
  }

  return order;
}

function activeSampleCount(
  sampleCount: number,
  streamCount: number,
  activeStreamCount: number,
): number {
  const selectedStreams = Math.max(1, Math.min(streamCount, activeStreamCount));
  let count = 0;

  for (let stream = 0; stream < selectedStreams; stream += 1) {
    if (stream < sampleCount) {
      count += Math.floor((sampleCount - stream - 1) / streamCount) + 1;
    }
  }

  return count;
}

function pointSizeFor(parameters: CoreParameters): number {
  const resolution = Number.isFinite(parameters.fieldResolution)
    ? parameters.fieldResolution
    : 24;

  return THREE.MathUtils.clamp(0.7 + resolution / 56, 0.7, 1.65);
}

export function createCoreFlowFieldResources(
  descriptor: CoreFieldDescriptor,
  pointSize: number,
): CoreFlowFieldResources {
  const { attributes } = descriptor;
  const sampleCount = attributes.phase.length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(attributes.positions, 3));
  geometry.setAttribute('coreDrift', new THREE.Float32BufferAttribute(attributes.drift, 3));
  geometry.setAttribute('corePhase', new THREE.Float32BufferAttribute(attributes.phase, 1));
  geometry.setAttribute('coreRegion', new THREE.Float32BufferAttribute(attributes.region, 1));
  geometry.setAttribute('coreWeight', new THREE.Float32BufferAttribute(attributes.weight, 1));
  geometry.setIndex(new THREE.BufferAttribute(createStreamOrder(sampleCount, descriptor.streamCount), 1));
  geometry.setDrawRange(0, activeSampleCount(sampleCount, descriptor.streamCount, 1));

  const materialHandle = createCoreFlowMaterial({
    color: CORE_COLORS.flow,
    pointSize,
    webgpuPreferred: true,
  });
  const points = new THREE.Points(geometry, materialHandle.material);
  points.frustumCulled = false;

  return { geometry, materialHandle, points };
}

export function disposeCoreFlowFieldResources(resources: CoreFlowFieldResources): void {
  disposeAll([resources.geometry, resources.materialHandle]);
}

/**
 * Static GPU attribute field with state-selected stream draw ranges. Attribute
 * content is immutable after construction; the frame loop updates only the
 * material's scalar visual input and elapsed time.
 */
export function CoreFlowField({ descriptor, parameters, visualInput }: CoreFlowFieldProps): JSX.Element {
  const pointSize = useMemo(() => pointSizeFor(parameters), [parameters]);
  const fieldState = useMemo(
    () => deriveCoreFieldState(descriptor, visualInput),
    [descriptor, visualInput],
  );
  const resources = useMemo(
    () => createCoreFlowFieldResources(descriptor, pointSize),
    [descriptor, pointSize],
  );
  const lease = useMemo(
    () => createResourceLease(() => disposeCoreFlowFieldResources(resources)),
    [resources],
  );
  const frameInputRef = useRef<CoreVisualInput>(visualInput);

  useLayoutEffect(() => lease.retain(), [lease]);

  useLayoutEffect(() => {
    const [biasX, biasY, biasZ] = fieldState.directionalBias;
    frameInputRef.current = {
      pointerX: biasX,
      pointerY: biasY,
      focusX: biasX,
      focusY: biasY,
      focusZ: biasZ,
      intensity: fieldState.activity,
      visualState: visualInput.visualState,
      reducedMotion: visualInput.reducedMotion,
    };
    resources.geometry.setDrawRange(
      0,
      activeSampleCount(
        descriptor.attributes.phase.length,
        descriptor.streamCount,
        fieldState.activeStreamCount,
      ),
    );
    resources.materialHandle.updateInput(frameInputRef.current, 0);
  }, [descriptor, fieldState, resources, visualInput.reducedMotion, visualInput.visualState]);

  useFrame((state) => {
    resources.materialHandle.updateInput(frameInputRef.current, state.clock.elapsedTime);
  });

  return <primitive object={resources.points} dispose={null} />;
}
