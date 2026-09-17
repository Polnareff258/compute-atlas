'use client';

import { events, createRoot, type ReconcilerRoot } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createBootCoordinator } from '../boot/bootCoordinator';
import { BootExperience } from '../boot/BootExperience';
import { createInitialBootState } from '../boot/bootMachine';
import type { BootState } from '../boot/types';
import { getQualityProfile } from '../config/quality';
import { createBrowserCapabilityProbe } from './capability';
import {
  createCanvasRendererAdapters,
  type CanvasRenderer,
} from './canvasAdapters';
import {
  createRendererRuntime,
  type RendererRuntimeState,
} from './runtime';
import { SceneHost } from '../scene/SceneHost';
import type { RendererTelemetrySnapshot } from '../telemetry/rendererTelemetry';
import { RendererStatus } from '../ui/RendererStatus';
import { SystemMasthead } from '../ui/SystemMasthead';

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
  const latestTelemetryRef = useRef<RendererTelemetrySnapshot | null>(null);
  const lastTelemetryLogRef = useRef(0);
  const [runtimeState, setRuntimeState] = useState(INITIAL_RUNTIME_STATE);
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
    let disposed = false;

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
          camera: { fov: 48, position: [0, 0, 6] },
          events: (store) => {
            const manager = events(store);
            return {
              ...manager,
              connect: (target) => {
                manager.connect?.(canvas.parentElement ?? target);
              },
            };
          },
          dpr: [1, getQualityProfile(nextState.quality).maxDpr],
          gl: rendererRef.current,
        });
        root.render(
          <SceneHost
            quality={nextState.quality}
            backend={nextState.backend}
            onTelemetry={handleTelemetry}
          />,
        );
      },
    });

    coordinatorRef.current = coordinator;

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
      coordinator.dispose();
      coordinatorRef.current = null;
      root?.unmount();
      runtime.stop();
    };
  }, [handleTelemetry]);

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