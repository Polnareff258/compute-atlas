'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { createCameraController } from '../camera/cameraController';
import type { CameraController } from '../camera/cameraController';
import { sampleRendererTelemetry } from '../../telemetry/rendererTelemetry';
import type { RendererTelemetrySnapshot } from '../../telemetry/rendererTelemetry';
import type {
  QualityProfile,
  RendererBackend,
} from '../../renderer/types';
import {
  deriveCoreTelemetryParticleCount,
  deriveCoreVisualInput,
  getCoreParameters,
} from './coreParameters';
import { CoreNucleus } from './CoreNucleus';
import { CoreTopology } from './CoreTopologyView';
import { CoreFragments } from './CoreFragments';
import { CoreFlowField } from './CoreFlowField';
import { CoreTrajectories } from './CoreTrajectoryPaths';
import { CoreSignals } from './CoreSignals';
import { deriveCoreTopology } from './coreTopology';
import { deriveCoreField } from './coreField';
import { deriveCoreTrajectories } from './coreTrajectories';
import type { ComputeCoreVisualState, CoreVisualInput } from './coreTypes';

const CORE_SEED = 17;
const VIEW_SAMPLE_INTERVAL = 1 / 30;

export type ComputeCoreProps = {
  readonly quality: QualityProfile;
  readonly backend: RendererBackend;
  readonly reducedMotion?: boolean;
  readonly onTelemetry?: (snapshot: RendererTelemetrySnapshot) => void;
  readonly cameraController?: CameraController;
  readonly visualState?: ComputeCoreVisualState | null;
};

export function ComputeCore({
  quality,
  backend,
  reducedMotion = false,
  onTelemetry,
  cameraController,
  visualState,
}: ComputeCoreProps) {
  const parameters = useMemo(() => getCoreParameters(quality), [quality]);
  const topology = useMemo(() => deriveCoreTopology(parameters, CORE_SEED), [parameters]);
  const field = useMemo(() => deriveCoreField(parameters, CORE_SEED), [parameters]);
  const trajectories = useMemo(() => deriveCoreTrajectories(parameters, CORE_SEED), [parameters]);
  const localController = useMemo(
    () => createCameraController({ reducedMotion }),
    [reducedMotion],
  );
  const activeController = cameraController ?? localController;
  const groupRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const lastTelemetryRef = useRef(0);
  const visualStateRef = useRef<ComputeCoreVisualState>('awakening');
  const [viewInput, setViewInput] = useState<CoreVisualInput>(() => deriveCoreVisualInput({
    pointerX: 0, pointerY: 0, focusX: 0, focusY: 0, focusZ: 0,
    intensity: 0.72, visualState: visualState ?? 'awakening', reducedMotion,
  }));
  const publishedInputRef = useRef(viewInput);
  const lastViewSampleRef = useRef(0);
  const { camera: sceneCamera, gl } = useThree();
  const cameraRef = useRef(sceneCamera);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      const x = (event.clientX / width) * 2 - 1;
      const y = 1 - (event.clientY / height) * 2;
      activeController.setPointerTarget(x, y);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [activeController]);

  useFrame((_, delta) => {
    const safeDelta = Math.min(Math.max(delta, 0), 0.1);
    elapsedRef.current += safeDelta;

    visualStateRef.current =
      visualState ?? (elapsedRef.current > 2.2 ? 'idle' : 'awakening');
    activeController.setVisualState(visualStateRef.current);
    activeController.update(safeDelta);

    const response = activeController.getResponseStrength();
    const pointerX = activeController.getPointerX();
    const pointerY = activeController.getPointerY();
    const focusX = activeController.getFocusX();
    const focusY = activeController.getFocusY();
    const focusZ = activeController.getFocusZ();
    const focusMagnitude = Math.min(Math.hypot(focusX, focusY, focusZ), 1);

    // React views own their resources. Publish only changed scalar snapshots,
    // capped at 30 Hz; semantic transitions bypass the cap on the next frame.
    const previousInput = publishedInputRef.current;
    if (
      previousInput.visualState !== visualStateRef.current ||
      previousInput.reducedMotion !== reducedMotion ||
      elapsedRef.current - lastViewSampleRef.current >= VIEW_SAMPLE_INTERVAL
    ) {
      lastViewSampleRef.current = elapsedRef.current;
      const nextInput = deriveCoreVisualInput({
        pointerX, pointerY, focusX, focusY, focusZ,
        intensity: response, visualState: visualStateRef.current, reducedMotion,
      });
      if (
        nextInput.visualState !== previousInput.visualState ||
        nextInput.reducedMotion !== previousInput.reducedMotion ||
        Math.abs(nextInput.pointerX - previousInput.pointerX) > 0.001 ||
        Math.abs(nextInput.pointerY - previousInput.pointerY) > 0.001 ||
        Math.abs(nextInput.focusX - previousInput.focusX) > 0.001 ||
        Math.abs(nextInput.focusY - previousInput.focusY) > 0.001 ||
        Math.abs(nextInput.focusZ - previousInput.focusZ) > 0.001 ||
        nextInput.intensity !== previousInput.intensity
      ) {
        publishedInputRef.current = nextInput;
        setViewInput(nextInput);
      }
    }

    const camera = cameraRef.current;
    camera.position.x = pointerX * 0.13 * response + focusX * 0.08;
    camera.position.y = pointerY * 0.1 * response + focusY * 0.05;
    camera.position.z = 6 + focusZ * 0.08;
    camera.rotation.y = -pointerX * 0.018 * response - focusX * 0.32;
    camera.rotation.x = pointerY * 0.014 * response + focusY * 0.16;

    if (groupRef.current) {
      const awakeningProgress = reducedMotion
        ? 1
        : Math.min(elapsedRef.current / 1.8, 1);
      const interactionLift =
        visualStateRef.current === 'hover_response' ? 0.012 : 0;
      const targetScale =
        (0.84 + awakeningProgress * 0.16 + interactionLift) *
        (1 - focusMagnitude * 0.035);
      groupRef.current.scale.setScalar(targetScale);
      groupRef.current.position.set(-focusX * 0.06, -focusY * 0.04, -focusZ * 0.04);
      // Keep the open composition oriented; bounded tilt replaces V1 rotation.
      groupRef.current.rotation.y = reducedMotion ? 0 : pointerX * 0.025;
      groupRef.current.rotation.x = reducedMotion ? 0 : pointerY * 0.018;
      groupRef.current.rotation.z = reducedMotion ? 0 : pointerX * 0.012;
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
          particleCount: deriveCoreTelemetryParticleCount(parameters),
          deltaSeconds: safeDelta,
          sampledAt: performance.now(),
        }),
      );
    }
  });

  return (
    <group ref={groupRef}>
      <CoreNucleus topology={topology} visualInput={viewInput} reducedMotion={reducedMotion} />
      <CoreTopology topology={topology} visualInput={viewInput} reducedMotion={reducedMotion} />
      <CoreFragments topology={topology} visualInput={viewInput} reducedMotion={reducedMotion} />
      <CoreFlowField descriptor={field} parameters={parameters} visualInput={viewInput} backend={backend} />
      <CoreTrajectories trajectories={trajectories} visualInput={viewInput} reducedMotion={reducedMotion} />
      <CoreSignals trajectories={trajectories} visualInput={viewInput} reducedMotion={reducedMotion} />
    </group>
  );
}
