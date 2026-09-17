'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { createCameraController } from '../camera/cameraController';
import { sampleRendererTelemetry } from '../../telemetry/rendererTelemetry';
import type { RendererTelemetrySnapshot } from '../../telemetry/rendererTelemetry';
import type {
  QualityProfile,
  RendererBackend,
} from '../../renderer/types';
import { getCoreParameters } from './coreParameters';
import { CoreCage } from './CoreCage';
import { CoreEnergyField } from './CoreEnergyField';
import { CoreOrbitals } from './CoreOrbitals';
import { CoreParticleShell } from './CoreParticleShell';
import { CoreSeed } from './CoreSeed';
import type { ComputeCoreVisualState } from './coreTypes';

export type ComputeCoreProps = {
  readonly quality: QualityProfile;
  readonly backend: RendererBackend;
  readonly reducedMotion?: boolean;
  readonly onTelemetry?: (snapshot: RendererTelemetrySnapshot) => void;
};

export function ComputeCore({
  quality,
  backend,
  reducedMotion = false,
  onTelemetry,
}: ComputeCoreProps) {
  const parameters = useMemo(() => getCoreParameters(quality), [quality]);
  const controller = useMemo(
    () => createCameraController({ reducedMotion }),
    [reducedMotion],
  );
  const groupRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const lastTelemetryRef = useRef(0);
  const visualStateRef = useRef<ComputeCoreVisualState>('awakening');
  const { camera: sceneCamera, gl } = useThree();
  const cameraRef = useRef(sceneCamera);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      const x = (event.clientX / width) * 2 - 1;
      const y = 1 - (event.clientY / height) * 2;
      controller.setPointerTarget(x, y);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [controller]);

  useFrame((_, delta) => {
    const safeDelta = Math.min(Math.max(delta, 0), 0.1);
    elapsedRef.current += safeDelta;

    if (elapsedRef.current > 2.2) {
      visualStateRef.current = 'idle';
    }
    controller.setVisualState(visualStateRef.current);
    controller.update(safeDelta);

    const response = controller.getResponseStrength();
    const pointerX = controller.getPointerX();
    const pointerY = controller.getPointerY();

    const camera = cameraRef.current;
    camera.position.x = pointerX * 0.13 * response;
    camera.position.y = pointerY * 0.1 * response;
    camera.rotation.y = -pointerX * 0.018 * response;
    camera.rotation.x = pointerY * 0.014 * response;

    if (groupRef.current) {
      const awakeningProgress = reducedMotion
        ? 1
        : Math.min(elapsedRef.current / 1.8, 1);
      const targetScale = 0.84 + awakeningProgress * 0.16;
      groupRef.current.scale.setScalar(targetScale);
      groupRef.current.rotation.y += safeDelta * (0.018 + Math.abs(pointerX) * 0.012);
      groupRef.current.rotation.x = Math.sin(elapsedRef.current * 0.24) * 0.025;
      groupRef.current.rotation.z = pointerX * 0.012;
    }

    if (
      onTelemetry !== undefined &&
      elapsedRef.current - lastTelemetryRef.current > 0.25
    ) {
      lastTelemetryRef.current = elapsedRef.current;
      onTelemetry(
        sampleRendererTelemetry({
          renderer: gl,
          backend,
          quality,
          particleCount: parameters.particleBudget,
          deltaSeconds: safeDelta,
          sampledAt: performance.now(),
        }),
      );
    }
  });

  return (
    <group ref={groupRef}>
      <CoreEnergyField
        radius={1.94}
        resolution={parameters.fieldResolution}
        reducedMotion={reducedMotion}
      />
      <CoreParticleShell
        parameters={parameters}
        reducedMotion={reducedMotion}
      />
      <CoreOrbitals
        count={parameters.orbitalCount}
        reducedMotion={reducedMotion}
      />
      <CoreCage detail={parameters.cageSegments} />
      <CoreCage detail={Math.max(1, parameters.cageSegments - 1)} radius={1.54} />
      <CoreSeed reducedMotion={reducedMotion} />
    </group>
  );
}