'use client';

import { events, createRoot, type ReconcilerRoot } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createBootCoordinator } from '../boot/bootCoordinator';
import { BootExperience } from '../boot/BootExperience';
import { createInitialBootState } from '../boot/bootMachine';
import type { BootState } from '../boot/types';
import type { CommandBus } from '../commands/bus';
import { deriveEffectiveDpr, getQualityProfile } from '../config/quality';
import { createBrowserCapabilityProbe } from './capability';
import {
  createCanvasRendererAdapters,
  type CanvasRenderer,
} from './canvasAdapters';
import {
  createRendererRuntime,
  type RendererRuntimeState,
} from './runtime';
import { useReducedMotionPreference } from './reducedMotion';
import {
  BOOTSTRAP_CAMERA_POSITION,
  CAMERA_FOV_DEGREES,
} from '../scene/camera/cameraController';
import { SceneHost } from '../scene/SceneHost';
import type { QualityProfile } from './types';
import type { RendererTelemetrySnapshot } from '../telemetry/rendererTelemetry';
import { RendererStatus } from '../ui/RendererStatus';
import { SystemMasthead } from '../ui/SystemMasthead';

function isQualityProfile(value: unknown): value is QualityProfile {
  return (
    value === 'ultra' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'safe'
  );
}
const INITIAL_RUNTIME_STATE: RendererRuntimeState = {
  status: 'idle',
  backend: 'unavailable',
  rendererName: null,
  adapterName: null,
  quality: 'ultra',
  capability: null,
  error: null,
  startedAt: null,
};

export function RendererHost() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordinatorRef = useRef<ReturnType<typeof createBootCoordinator> | null>(
    null,
  );
  const commandBusRef = useRef<CommandBus | null>(null);
  const latestTelemetryRef = useRef<RendererTelemetrySnapshot | null>(null);
  const lastTelemetryLogRef = useRef(0);
  const [runtimeState, setRuntimeState] = useState(INITIAL_RUNTIME_STATE);
  const prefersReducedMotion = useReducedMotionPreference();
  // Read by the once-created `renderScene` closure, so it is synced in an effect
  // rather than written during render.
  const prefersReducedMotionRef = useRef(prefersReducedMotion);
  const renderSceneRef = useRef<(() => void) | null>(null);
  const handleTelemetry = useCallback((snapshot: RendererTelemetrySnapshot) => {
    latestTelemetryRef.current = snapshot;

    if (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('telemetry') === '1'
    ) {
      const now = performance.now();
      if (now - lastTelemetryLogRef.current >= 1_000) {
        lastTelemetryLogRef.current = now;
        console.info('[POLNAREFF TELEMETRY]', snapshot);
      }
    }
  }, []);
  const [bootState, setBootState] = useState<BootState>(() =>
    createInitialBootState(),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const rendererRef: { current: CanvasRenderer | null } = { current: null };
    const runtime = createRendererRuntime({
      capabilityProbe: createBrowserCapabilityProbe(),
      adapters: createCanvasRendererAdapters(canvas, rendererRef),
      initialQuality: 'ultra',
    });
    let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
    let sceneStore: ReturnType<ReconcilerRoot<HTMLCanvasElement>['render']> | null = null;
    let disposed = false;

    const renderScene = (nextState: RendererRuntimeState): void => {
      if (!root) {
        return;
      }

      sceneStore = root.render(
        <SceneHost
          quality={nextState.quality}
          backend={nextState.backend}
          reducedMotion={prefersReducedMotionRef.current}
          onTelemetry={handleTelemetry}
          onCommandBusReady={(bus) => {
            commandBusRef.current = bus;
          }}
          onQualityChange={(profile) => {
            runtime.setQuality(profile);
            const updatedState = runtime.getState();
            sceneStore?.getState().setDpr(
              deriveEffectiveDpr(
                window.devicePixelRatio,
                getQualityProfile(updatedState.quality),
              ),
            );
            setRuntimeState(updatedState);
            renderScene(updatedState);
          }}
        />,
      );
    };

    /**
     * Keeps the drawing buffer the size of the element the canvas sits in.
     *
     * **Why this is not R3F's job here, though it is R3F's job in a normal app.**
     * `configure()` measures the container exactly once — `computeInitialSize`, at
     * the moment the root is configured — and the `ResizeObserver` that keeps that
     * measurement current lives in the `<Canvas>` component, which this page does
     * not use. R3F is driven imperatively here through `createRoot(canvas)`, so
     * nobody observes anything: after a window resize the canvas keeps the pixel
     * size it was born with and writes it back as an inline style.
     *
     * **What that looked like, because it is not a subtle failure.** The page was
     * captured at 2560x1440 for the first time and came back with a 1920x1080
     * picture in the corner of a 2560x1440 file: the viewport had grown, the
     * container had grown, and the canvas had not. Measured from the page, the
     * three numbers were `window: [2560,1440]`, `host: [2560,1440]`,
     * `canvas: [1920,1080]`. A visitor who resizes their window gets the same
     * thing — the landscape occupying the top-left of a black field — and the shot
     * plan is calibrated against `useThree().size`, so the framing would be
     * computed for a viewport that is not the one on screen.
     *
     * The store's own `setSize` is the right lever rather than `gl.setSize` directly:
     * it updates `size` and `viewport` together, the render loop's own size check
     * then resizes the renderer and rewrites the inline style, and `updateCamera`
     * runs from the same place — so the aspect the shot plan reads and the aspect
     * the projection matrix uses cannot drift apart.
     */
    let containerObserver: ResizeObserver | null = null;

    const observeContainerSize = (): void => {
      const host = canvas.parentElement;
      if (host === null || typeof ResizeObserver === 'undefined') {
        return;
      }

      containerObserver = new ResizeObserver(() => {
        const store = sceneStore?.getState();
        if (store === undefined) {
          return;
        }
        // `floor`, and never zero: the store's size is what the shot plan divides
        // by, and a one-pixel element during a collapse would otherwise reach it as
        // a zero aspect.
        const width = Math.max(1, Math.floor(host.clientWidth));
        const height = Math.max(1, Math.floor(host.clientHeight));
        if (store.size.width === width && store.size.height === height) {
          return;
        }
        store.setSize(width, height, 0, 0);
      });
      // The container, not the canvas: the canvas's own style is written by this
      // very mechanism, so observing it would be a loop.
      containerObserver.observe(host);
    };

    const coordinator = createBootCoordinator({
      runtime,
      onStateChange: setBootState,
      onRendererInitialized: async (nextState) => {
        setRuntimeState(nextState);

        if (
          nextState.status !== 'ready' &&
          nextState.status !== 'fallback'
        ) {
          return;
        }

        if (!rendererRef.current) {
          runtime.stop();
          throw new Error('Renderer initialized without a canvas handle');
        }

        root = createRoot(canvas);
        await root.configure({
          // R3F otherwise installs ACES filmic tone mapping, whose shadow toe
          // returns about an eighth of its input below mid-grey. The machine
          // palette is authored display-referred and its whole hierarchy lives in
          // that range, so the default silently flattens every recessed tier and
          // the far half of the composition into the background. The scene lights
          // itself by baking orientation luminance, so it wants its authored
          // values on screen rather than a film response curve applied to them.
          flat: true,
          camera: {
            fov: CAMERA_FOV_DEGREES,
            // Where the camera stands for the one frame before `SceneHost` snaps
            // the rig to the entry's approach pose. Outside the world on purpose,
            // so that frame is dark sky rather than the inside of a hill — the
            // previous form of this line was a rift-era distance that put the
            // watershed's camera underground.
            position: [BOOTSTRAP_CAMERA_POSITION[0], BOOTSTRAP_CAMERA_POSITION[1], BOOTSTRAP_CAMERA_POSITION[2]],
          },
          events: (store) => {
            const manager = events(store);
            return {
              ...manager,
              connect: (target) => {
                manager.connect?.(canvas.parentElement ?? target);
              },
            };
          },
          dpr: deriveEffectiveDpr(
            window.devicePixelRatio,
            getQualityProfile(nextState.quality),
          ),
          gl: rendererRef.current,
        });
        renderScene(nextState);
        renderSceneRef.current = () => renderScene(runtime.getState());
        observeContainerSize();
      },
    });

    coordinatorRef.current = coordinator;

    const devQualityEvent = 'compute-atlas:dev-quality';
    const handleDevQuality = (event: Event) => {
      if (process.env.NODE_ENV !== 'development') {
        return;
      }

      const profile = (event as CustomEvent<unknown>).detail;
      if (!isQualityProfile(profile)) {
        return;
      }

      commandBusRef.current?.dispatch({
        type: 'SET_QUALITY',
        source: 'system',
        profile,
      });
    };
    if (process.env.NODE_ENV === 'development') {
      window.addEventListener(devQualityEvent, handleDevQuality);
    }

    void coordinator.start().catch((error: unknown) => {
      if (disposed) {
        return;
      }

      runtime.stop();
      setRuntimeState({
        ...runtime.getState(),
        status: 'degraded',
        backend: 'unavailable',
        rendererName: null,
        adapterName: null,
        capability: null,
        error: error instanceof Error ? error.message : 'Bootstrap failed',
        startedAt: null,
      });
    });

    return () => {
      disposed = true;
      containerObserver?.disconnect();
      containerObserver = null;
      coordinator.dispose();
      coordinatorRef.current = null;
      commandBusRef.current = null;
      if (process.env.NODE_ENV === 'development') {
        window.removeEventListener(devQualityEvent, handleDevQuality);
      }
      sceneStore = null;
      renderSceneRef.current = null;
      root?.unmount();
      runtime.stop();
    };
  }, [handleTelemetry]);

  // A preference change is a semantic scene input, not a canvas opacity tweak.
  // The ref is updated first so the scene it re-renders already sees the new
  // value, and so nothing writes a ref during render.
  useEffect(() => {
    prefersReducedMotionRef.current = prefersReducedMotion;
    renderSceneRef.current?.();
  }, [prefersReducedMotion]);

  return (
    <section className="renderer-host" aria-label="Graphics runtime">
      <canvas ref={canvasRef} className="renderer-host__canvas" aria-hidden="true" />
      <div className="renderer-host__vignette" aria-hidden="true" />
      <SystemMasthead />
      <RendererStatus state={runtimeState} />
      <BootExperience
        state={bootState}
        onEnter={() => coordinatorRef.current?.requestEnter()}
      />
    </section>
  );
}