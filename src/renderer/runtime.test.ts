import { describe, expect, it } from 'vitest';

import type {
  CapabilityProbe,
  RendererCapabilityReport,
} from './capability';
import {
  createRendererRuntime,
  type RendererAdapter,
} from './runtime';
import { createRendererRuntimeStore } from './runtimeStore';

function createProbe(report: RendererCapabilityReport): CapabilityProbe {
  return {
    requestWebGpuAdapter: async () =>
      report.webgpu ? { name: report.adapterName ?? 'Test Adapter' } : null,
    createWebGl2Context: () =>
      report.webgl2 ? ({} as WebGL2RenderingContext) : null,
  };
}

function createAdapter(
  backend: 'webgpu' | 'webgl2',
  options: { fail?: string; onDispose?: () => void } = {},
): RendererAdapter {
  return {
    initialize: async () => {
      if (options.fail) {
        throw new Error(options.fail);
      }

      return {
        backend,
        rendererName: backend === 'webgpu' ? 'Test WebGPU' : 'Test WebGL2',
        adapterName: backend === 'webgpu' ? 'Test Adapter' : null,
        dispose: options.onDispose ?? (() => undefined),
      };
    },
  };
}

describe('createRendererRuntime', () => {
  it('starts idle with an unavailable backend and the requested quality', () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: false,
        preferredBackend: 'unavailable',
      }),
      adapters: {},
      initialQuality: 'high',
    });

    expect(runtime.getState()).toEqual({
      status: 'idle',
      backend: 'unavailable',
      rendererName: null,
      adapterName: null,
      quality: 'high',
      error: null,
      startedAt: null,
    });
  });

  it('initializes WebGPU when it is the preferred backend', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: true,
        webgl2: true,
        preferredBackend: 'webgpu',
        adapterName: 'Test Adapter',
      }),
      adapters: { webgpu: createAdapter('webgpu') },
      now: () => 123,
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: 'ready',
      backend: 'webgpu',
      rendererName: 'Test WebGPU',
      adapterName: 'Test Adapter',
      startedAt: 123,
    });
  });

  it('falls back to WebGL2 and preserves the WebGPU failure reason', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: true,
        webgl2: true,
        preferredBackend: 'webgpu',
        adapterName: 'Test Adapter',
      }),
      adapters: {
        webgpu: createAdapter('webgpu', { fail: 'device init failed' }),
        webgl2: createAdapter('webgl2'),
      },
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: 'fallback',
      backend: 'webgl2',
      rendererName: 'Test WebGL2',
      error: 'WebGPU initialization failed: device init failed',
    });
  });

  it('reports degraded when no backend is available', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: false,
        preferredBackend: 'unavailable',
      }),
      adapters: {},
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: 'degraded',
      backend: 'unavailable',
      error: 'WebGPU and WebGL2 are unavailable',
    });
  });

  it('changes quality without replacing the runtime', () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: false,
        preferredBackend: 'unavailable',
      }),
      adapters: {},
    });

    runtime.setQuality('medium');

    expect(runtime.getState().quality).toBe('medium');
  });

  it('disposes an initialized adapter once when stop is called repeatedly', async () => {
    let disposeCount = 0;
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: true,
        preferredBackend: 'webgl2',
      }),
      adapters: {
        webgl2: createAdapter('webgl2', {
          onDispose: () => {
            disposeCount += 1;
          },
        }),
      },
    });

    await runtime.start();
    runtime.stop();
    runtime.stop();

    expect(disposeCount).toBe(1);
    expect(runtime.getState()).toMatchObject({
      status: 'stopped',
      backend: 'unavailable',
    });
  });

  it('keeps the Zustand snapshot in sync with runtime actions', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: true,
        preferredBackend: 'webgl2',
      }),
      adapters: { webgl2: createAdapter('webgl2') },
    });
    const store = createRendererRuntimeStore(runtime);

    await store.getState().start();

    expect(store.getState()).toMatchObject({
      status: 'ready',
      backend: 'webgl2',
    });
  });
});
