'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { createCameraController, deriveCameraFraming } from '../camera/cameraController';
import type { CameraController } from '../camera/cameraController';
import type { RendererBackend } from '../../renderer/types';
import { RouteDashes } from '../routing/RouteDashes';
import type { RouteFlowState } from '../routing/routeDash';
import { CoreStructureView } from './CoreStructureView';
import { sanitizeCoreVisualInput } from './coreParameters';
import type { CoreCirculation } from './coreCirculation';
import type { CoreStructure } from './coreStructure';
import type { CoreParameters, ComputeCoreVisualState, CoreVisualInput } from './coreTypes';

const AWAKENING_SECONDS = 2.2;

export type ComputeCoreProps = {
  readonly parameters: CoreParameters;
  readonly backend: RendererBackend;
  /**
   * The hero structure and its internal circulation. Both are derived by the
   * integration boundary rather than here, because routing has to leave from the
   * Core's real ports and because the scene's telemetry has to be able to
   * describe the interior without inspecting a view — and this is the direction
   * the dependency is allowed to run, not the other way round.
   */
  readonly structure: CoreStructure;
  readonly circulation: CoreCirculation;
  /**
   * The scene's one signal-language state, owned by the integration boundary.
   *
   * The Core's interior writes into the same object as the Graph routes, which is
   * what makes its circulation and its outbound routes one effect instead of two
   * effects that happen to resemble each other.
   */
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly reducedMotion?: boolean;
  readonly cameraController?: CameraController;
  readonly visualState?: ComputeCoreVisualState | null;
};

export function ComputeCore({
  parameters,
  backend,
  structure,
  circulation,
  flowRef,
  reducedMotion = false,
  cameraController,
  visualState,
}: ComputeCoreProps) {
  const localController = useMemo(
    () => createCameraController({ reducedMotion }),
    [reducedMotion],
  );
  const activeController = cameraController ?? localController;
  const groupRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const visualStateRef = useRef<ComputeCoreVisualState>('awakening');

  /**
   * The single live visual input.
   *
   * One object, refreshed in place every frame: the structure view reads it
   * through a ref, so continuous scalars reach materials without re-rendering a
   * subtree and without allocating a fresh input per frame.
   */
  const visualRef = useRef<CoreVisualInput>({
    pointerX: 0,
    pointerY: 0,
    focusX: 0,
    focusY: 0,
    focusZ: 0,
    intensity: 0.72,
    visualState: visualState ?? 'awakening',
    reducedMotion,
  });

  const { camera: sceneCamera, size } = useThree();
  const cameraRef = useRef(sceneCamera);
  const aspect = size.height > 0 ? size.width / size.height : 16 / 9;

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
      visualState ?? (elapsedRef.current > AWAKENING_SECONDS ? 'idle' : 'awakening');
    activeController.setVisualState(visualStateRef.current);
    activeController.update(safeDelta);

    const response = activeController.getResponseStrength();
    const pointerX = activeController.getPointerX();
    const pointerY = activeController.getPointerY();
    const focusX = activeController.getFocusX();
    const focusY = activeController.getFocusY();
    const focusZ = activeController.getFocusZ();

    const visual = visualRef.current;
    visual.pointerX = pointerX;
    visual.pointerY = pointerY;
    visual.focusX = focusX;
    visual.focusY = focusY;
    visual.focusZ = focusZ;
    visual.intensity = response;
    visual.visualState = visualStateRef.current;
    visual.reducedMotion = reducedMotion;
    sanitizeCoreVisualInput(visual);

    // Framing is a translate-and-dolly rig: the camera moves and pulls back, and
    // never turns toward the target, so the Core is seen from one angle
    // throughout and only its place in the frame changes.
    const camera = cameraRef.current;
    const framing = deriveCameraFraming({
      pointerX,
      pointerY,
      focusX,
      focusY,
      focusZ,
      focusDistance: activeController.getFocusDistance(),
      response,
      amplitudeScale: activeController.getAmplitudeScale(),
      aspect,
    });
    camera.position.set(framing.positionX, framing.positionY, framing.positionZ);
    camera.rotation.set(framing.pitch, framing.yaw, 0);

    if (groupRef.current) {
      const awakeningProgress = reducedMotion
        ? 1
        : Math.min(elapsedRef.current / AWAKENING_SECONDS, 1);
      const interactionLift = visualStateRef.current === 'hover_response' ? 0.012 : 0;
      // A little scale relief as the reframe commits, so the widened frame is
      // not carrying the same mass at the same size.
      const targetScale =
        (1.08 + awakeningProgress * 0.07 + interactionLift) *
        (1 - framing.focus * 0.035);
      groupRef.current.scale.setScalar(targetScale);
      groupRef.current.rotation.y = reducedMotion ? 0 : pointerX * 0.025;
      groupRef.current.rotation.x = reducedMotion ? 0 : pointerY * 0.018;
      groupRef.current.rotation.z = reducedMotion ? 0 : pointerX * 0.012;
    }
  });

  return (
    <group ref={groupRef}>
      <CoreStructureView structure={structure} visualRef={visualRef} />
      <RouteDashes
        backend={backend === 'webgpu' ? 'webgpu' : 'webgl2'}
        curves={circulation.curves}
        detail={parameters.structureDetail}
        flowRef={flowRef}
        lanes={parameters.routeLanes}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}
