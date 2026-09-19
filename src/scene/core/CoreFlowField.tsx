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
import type { RendererBackend } from '../../renderer/types';

export type CoreFlowFieldProps = {
  readonly descriptor: CoreFieldDescriptor;
  readonly parameters: CoreParameters;
  readonly visualInput: CoreVisualInput;
  readonly backend: RendererBackend;
};

export type CoreFlowFieldIndex = {
  readonly indices: Uint16Array | Uint32Array;
  readonly streamOffsets: Uint32Array;
};

type CoreFlowFieldResources = {
  readonly geometry: THREE.BufferGeometry;
  readonly fieldIndex: CoreFlowFieldIndex;
  readonly materialHandle: ReturnType<typeof createCoreFlowMaterial>;
  readonly points: THREE.Points;
};

export function deriveCoreFlowFieldIndex(descriptor: CoreFieldDescriptor): CoreFlowFieldIndex {
  const sampleCount = descriptor.attributes.phase.length;
  const streamCount = Math.max(
    1,
    Math.floor(Number.isFinite(descriptor.streamCount) ? descriptor.streamCount : 1),
  );
  const visibleByStream = new Uint32Array(streamCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const weight = descriptor.attributes.weight[sample] ?? 0;
    if (Number.isFinite(weight) && weight > 0) {
      const streamIndex = sample % streamCount;
      visibleByStream[streamIndex] = (visibleByStream[streamIndex] ?? 0) + 1;
    }
  }

  const streamOffsets = new Uint32Array(streamCount + 1);
  for (let stream = 0; stream < streamCount; stream += 1) {
    streamOffsets[stream + 1] = (streamOffsets[stream] ?? 0) + (visibleByStream[stream] ?? 0);
  }

  const visibleCount = streamOffsets[streamCount] ?? 0;
  const IndexArray = sampleCount > 65_535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(visibleCount);
  let writeIndex = 0;

  for (let stream = 0; stream < streamCount; stream += 1) {
    for (let sample = stream; sample < sampleCount; sample += streamCount) {
      const weight = descriptor.attributes.weight[sample] ?? 0;
      if (Number.isFinite(weight) && weight > 0) {
        indices[writeIndex] = sample;
        writeIndex += 1;
      }
    }
  }

  return { indices, streamOffsets };
}

export function deriveCoreFlowFieldDrawCount(
  index: CoreFlowFieldIndex,
  activeStreamCount: number,
): number {
  const streamCount = index.streamOffsets.length - 1;
  const requestedStreams = Number.isFinite(activeStreamCount)
    ? Math.floor(activeStreamCount)
    : 0;
  const selectedStreams = Math.max(0, Math.min(streamCount, requestedStreams));

  return index.streamOffsets[selectedStreams] ?? 0;
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
  backend: RendererBackend,
): CoreFlowFieldResources {
  const { attributes } = descriptor;
  const fieldIndex = deriveCoreFlowFieldIndex(descriptor);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(attributes.positions, 3));
  geometry.setAttribute('coreDrift', new THREE.Float32BufferAttribute(attributes.drift, 3));
  geometry.setAttribute('corePhase', new THREE.Float32BufferAttribute(attributes.phase, 1));
  geometry.setAttribute('coreRegion', new THREE.Float32BufferAttribute(attributes.region, 1));
  geometry.setAttribute('coreWeight', new THREE.Float32BufferAttribute(attributes.weight, 1));
  geometry.setAttribute('coreCompression', new THREE.Float32BufferAttribute(attributes.compression, 1));
  geometry.setAttribute('coreZone', new THREE.Float32BufferAttribute(attributes.zone, 1));
  geometry.setAttribute('coreDepthBias', new THREE.Float32BufferAttribute(attributes.depthBias, 1));
  geometry.setIndex(new THREE.BufferAttribute(fieldIndex.indices, 1));
  geometry.setDrawRange(0, deriveCoreFlowFieldDrawCount(fieldIndex, 1));

  const materialHandle = createCoreFlowMaterial({
    color: CORE_COLORS.flow,
    pointSize,
    webgpuPreferred: backend === 'webgpu',
  });
  const points = new THREE.Points(geometry, materialHandle.material);
  points.frustumCulled = false;

  return { geometry, fieldIndex, materialHandle, points };
}

export function disposeCoreFlowFieldResources(resources: CoreFlowFieldResources): void {
  disposeAll([resources.geometry, resources.materialHandle]);
}

/**
 * Static GPU attribute field with state-selected stream draw ranges. Attribute
 * content is immutable after construction; the frame loop updates only the
 * material's scalar visual input and elapsed time.
 */
export function CoreFlowField({
  backend,
  descriptor,
  parameters,
  visualInput,
}: CoreFlowFieldProps): JSX.Element {
  const pointSize = pointSizeFor(parameters);
  const fieldState = useMemo(
    () => deriveCoreFieldState(descriptor, visualInput),
    [descriptor, visualInput],
  );
  const resources = useMemo(
    () => createCoreFlowFieldResources(descriptor, pointSize, backend),
    [backend, descriptor, pointSize],
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
      targetZone: fieldState.targetZone,
      activeZoneCount: fieldState.activeZoneCount,
    };
    resources.geometry.setDrawRange(
      0,
      deriveCoreFlowFieldDrawCount(resources.fieldIndex, fieldState.activeStreamCount),
    );
    resources.materialHandle.updateInput(frameInputRef.current, 0);
  }, [fieldState, resources, visualInput.reducedMotion, visualInput.visualState]);

  useFrame((state) => {
    resources.materialHandle.updateInput(frameInputRef.current, state.clock.elapsedTime);
  });

  return <primitive object={resources.points} dispose={null} />;
}
