'use client';

import { createRoot, type ReconcilerRoot } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';

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
import { RendererStatus } from '../ui/RendererStatus';
import { SystemMasthead } from '../ui/SystemMasthead';

const INITIAL_RUNTIME_STATE: RendererRuntimeState = {
  status: 'idle',
  backend: 'unavailable',
  rendererName: null,
  adapterName: null,
  quality: 'ultra',
  error: null,
  startedAt: null,
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown renderer host error';
}

export function RendererHost() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [runtimeState, setRuntimeState] = useState(INITIAL_RUNTIME_STATE);

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

    const startRenderer = async () => {
      const nextState = await runtime.start();

      if (disposed) {
        runtime.stop();
        return;
      }

      setRuntimeState(nextState);

      if (nextState.status !== 'ready' && nextState.status !== 'fallback') {
        return;
      }

      if (!rendererRef.current) {
        setRuntimeState({
          ...nextState,
          status: 'degraded',
          backend: 'unavailable',
          rendererName: null,
          adapterName: null,
          error: 'Renderer initialized without a canvas handle',
          startedAt: null,
        });
        runtime.stop();
        return;
      }

      root = createRoot(canvas);
      await root.configure({
        camera: { fov: 48, position: [0, 0, 6] },
        dpr: [1, getQualityProfile('ultra').maxDpr],
        gl: rendererRef.current,
      });
      root.render(<SceneHost />);
    };

    void startRenderer().catch((error: unknown) => {
      if (disposed) {
        return;
      }

      setRuntimeState({
        ...runtime.getState(),
        status: 'degraded',
        backend: 'unavailable',
        rendererName: null,
        adapterName: null,
        error: getErrorMessage(error),
        startedAt: null,
      });
      runtime.stop();
    });

    return () => {
      disposed = true;
      root?.unmount();
      runtime.stop();
    };
  }, []);

  return (
    <section className="renderer-host" aria-label="Graphics runtime">
      <canvas ref={canvasRef} className="renderer-host__canvas" aria-hidden="true" />
      <div className="renderer-host__vignette" aria-hidden="true" />
      <SystemMasthead />
      <RendererStatus state={runtimeState} />
    </section>
  );
}
