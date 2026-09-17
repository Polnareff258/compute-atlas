'use client';

import { extend } from '@react-three/fiber';
import type { ComponentProps } from 'react';
import * as THREE from 'three';

import type {
  QualityProfile,
  RendererBackend,
} from '../renderer/types';
import { ComputeCore } from './core/ComputeCore';

extend({
  BufferAttribute: THREE.BufferAttribute,
  BufferGeometry: THREE.BufferGeometry,
  Color: THREE.Color,
  FogExp2: THREE.FogExp2,
  Group: THREE.Group,
  IcosahedronGeometry: THREE.IcosahedronGeometry,
  Mesh: THREE.Mesh,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  Points: THREE.Points,
  PointsMaterial: THREE.PointsMaterial,
  TorusGeometry: THREE.TorusGeometry,
});

export type SceneHostProps = {
  readonly quality: QualityProfile;
  readonly backend: RendererBackend;
  readonly reducedMotion?: boolean;
  readonly onTelemetry?: ComponentProps<typeof ComputeCore>['onTelemetry'];
};

export function SceneHost({
  quality,
  backend,
  reducedMotion = false,
  onTelemetry,
}: SceneHostProps) {
  return (
    <>
      <color attach="background" args={['#050609']} />
      <fogExp2 attach="fog" args={['#050609', 0.035]} />
      {onTelemetry ? (
        <ComputeCore
          quality={quality}
          backend={backend}
          reducedMotion={reducedMotion}
          onTelemetry={onTelemetry}
        />
      ) : (
        <ComputeCore
          quality={quality}
          backend={backend}
          reducedMotion={reducedMotion}
        />
      )}
    </>
  );
}