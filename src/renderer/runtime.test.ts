import { describe, expect, it, vi } from 'vitest';

import type {
  CapabilityProbe,
  RendererCapabilityReport,
} from './capability';
import { resolveInkTargetFormat } from './capability';
import type { QualitySettings } from './types';
import {
  createRendererRuntime,
  type RendererAdapter,
  type RendererHandle,
} from './runtime';
import { createRendererRuntimeStore } from './runtimeStore';

function createProbe(
  report: RendererCapabilityReport,
  halfFloat = true,
): CapabilityProbe {
  return {
    requestWebGpuAdapter: async () =>
      report.webgpu ? { name: report.adapterName ?? 'Test Adapter' } : null,
    createWebGl2Context: () =>
      report.webgl2 ? ({} as WebGL2RenderingContext) : null,
    probeHalfFloatRenderTarget: () =>
      halfFloat ? { ok: true } : { ok: false, reason: 'no half-float target' },
    releaseWebGl2Context: () => undefined,
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
        setQuality: () => undefined,
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
        webgl2HalfFloatTarget: false,
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
      capability: null,
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
        webgl2HalfFloatTarget: true,
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
        webgl2HalfFloatTarget: true,
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

  it('does not quietly drop a tier when a backend fails over', async () => {
    // The fallback is a different backend, not a different art direction. A
    // runtime that responded to a failed WebGPU init by also stepping the
    // quality down would be making an art decision out of a capability fact,
    // and every frame in the capture matrix would be filed under a tier it was
    // not drawn at.
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: true,
        webgl2: true,
        preferredBackend: 'webgpu',
        webgl2HalfFloatTarget: true,
      }),
      adapters: {
        webgpu: createAdapter('webgpu', { fail: 'device init failed' }),
        webgl2: createAdapter('webgl2'),
      },
      initialQuality: 'ultra',
    });

    const state = await runtime.start();

    expect(state.quality).toBe('ultra');
    expect(state.capability?.preferredBackend).toBe('webgpu');
    expect(resolveInkTargetFormat(state.backend, state.capability!)).toBe('rgba16f');
  });

  it('publishes the byte fallback only when the context refused half float', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe(
        {
          webgpu: false,
          webgl2: true,
          preferredBackend: 'webgl2',
          webgl2HalfFloatTarget: false,
        },
        false,
      ),
      adapters: { webgl2: createAdapter('webgl2') },
    });

    const state = await runtime.start();

    expect(state.status).toBe('ready');
    expect(resolveInkTargetFormat(state.backend, state.capability!)).toBe('rgba8');
    // Still a working scene at the tier that was asked for.
    expect(state.quality).toBe('ultra');
  });

  it('reports a fallback when the adapter succeeded but built another backend', async () => {
    // Three.js catches a failed WebGPU device itself and resolves `init()` with a
    // WebGL2 backend installed, so this is not a rejection for the runtime to
    // catch — it is a handle that says what it built. Filing it as `ready` would
    // put `WebGPU` on screen over a picture WebGL2 drew.
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: true,
        webgl2: true,
        preferredBackend: 'webgpu',
        adapterName: 'Test Adapter',
        webgl2HalfFloatTarget: true,
      }),
      adapters: {
        webgpu: {
          initialize: async () => ({
            backend: 'webgl2' as const,
            rendererName: 'Three.js WebGPURenderer (WebGL2 backend)',
            adapterName: null,
            fallbackReason: 'WebGPU reported no usable device',
            setQuality: () => undefined,
            dispose: () => undefined,
          }),
        },
        webgl2: createAdapter('webgl2'),
      },
    });

    const state = await runtime.start();

    expect(state).toMatchObject({
      status: 'fallback',
      backend: 'webgl2',
      rendererName: 'Three.js WebGPURenderer (WebGL2 backend)',
      error: 'WebGPU reported no usable device',
    });
  });

  it('says something when a silent adapter swaps backends without a reason', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: true,
        webgl2: true,
        preferredBackend: 'webgpu',
        webgl2HalfFloatTarget: true,
      }),
      adapters: {
        webgpu: {
          initialize: async () => ({
            backend: 'webgl2' as const,
            rendererName: 'Three.js WebGPURenderer (WebGL2 backend)',
            adapterName: null,
            setQuality: () => undefined,
            dispose: () => undefined,
          }),
        },
      },
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: 'fallback',
      backend: 'webgl2',
      error: 'WebGPU built webgl2 instead',
    });
  });

  it('reports degraded when no backend is available', async () => {
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: false,
        preferredBackend: 'unavailable',
        webgl2HalfFloatTarget: false,
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
        webgl2HalfFloatTarget: false,
      }),
      adapters: {},
    });

    runtime.setQuality('medium');

    expect(runtime.getState().quality).toBe('medium');
  });

  it('applies quality settings to the active renderer handle', async () => {
    const applied: QualitySettings[] = [];
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: true,
        preferredBackend: 'webgl2',
        webgl2HalfFloatTarget: true,
      }),
      adapters: {
        webgl2: {
          initialize: async () => ({
            backend: 'webgl2' as const,
            rendererName: 'Test WebGL2',
            adapterName: null,
            setQuality: (quality: QualitySettings) => applied.push(quality),
            dispose: () => undefined,
          }),
        },
      },
    });

    await runtime.start();
    runtime.setQuality('safe');

    expect(applied).toHaveLength(1);
    expect(applied[0]?.maxDpr).toBe(1);
    expect(runtime.getState().quality).toBe('safe');
  });
  it('disposes an initialized adapter once when stop is called repeatedly', async () => {
    let disposeCount = 0;
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe({
        webgpu: false,
        webgl2: true,
        preferredBackend: 'webgl2',
        webgl2HalfFloatTarget: true,
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
        webgl2HalfFloatTarget: true,
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

/**
 * Stopping while a backend is still coming up.
 *
 * `stop()` is not a request to stop later: it is the host saying it is done with
 * this runtime, and it happens on unmount and on teardown while `start()` may
 * still be waiting on a capability probe or on a renderer being constructed.
 * Neither await is cancellable, so the only question is what happens to their
 * results — and the answer has to be "nothing", because a runtime that adopts a
 * renderer after it was stopped publishes a live backend over a dead one, and
 * the renderer it adopted is holding GPU resources that no owner will ever
 * release.
 *
 * These are the tests that were written **before** the fix, and they fail against
 * a runtime with no generation check: the late handle is adopted, the state goes
 * back to `ready`, and nothing is disposed.
 */
function createDeferred<T>() {
  let settle: (value: T) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
}

function createTrackedHandle(
  backend: 'webgpu' | 'webgl2',
  name: string,
  disposed: string[],
): RendererHandle {
  return {
    backend,
    rendererName: name,
    adapterName: null,
    setQuality: () => undefined,
    dispose: () => {
      disposed.push(name);
    },
  };
}

describe('createRendererRuntime — stop during initialization', () => {
  const bothBackends: RendererCapabilityReport = {
    webgpu: true,
    webgl2: true,
    preferredBackend: 'webgpu',
    webgl2HalfFloatTarget: true,
  };

  it('rejects a renderer that finished initializing after stop', async () => {
    const gate = createDeferred<RendererHandle>();
    const disposed: string[] = [];
    let entered = false;
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe(bothBackends),
      adapters: {
        webgpu: {
          initialize: () => {
            entered = true;
            return gate.promise;
          },
        },
      },
    });

    const started = runtime.start();
    // Wait until the adapter is genuinely in flight, so this is the race it is
    // named for rather than a stop that landed before initialization began.
    await vi.waitFor(() => expect(entered).toBe(true));
    runtime.stop();

    gate.resolve(createTrackedHandle('webgpu', 'Late WebGPU', disposed));
    const resolved = await started;

    expect(runtime.getState()).toMatchObject({
      status: 'stopped',
      backend: 'unavailable',
      rendererName: null,
      startedAt: null,
    });
    // And the state the *caller* was handed says the same thing, because the
    // boot coordinator decides what to mount from this value.
    expect(resolved).toMatchObject({ status: 'stopped', backend: 'unavailable' });
    // The handle owns a device and a swapchain that nothing will ever draw with.
    expect(disposed).toEqual(['Late WebGPU']);
  });

  it('rejects a capability report that arrived after stop', async () => {
    const gate = createDeferred<{ name: string } | null>();
    const runtime = createRendererRuntime({
      capabilityProbe: {
        requestWebGpuAdapter: () => gate.promise,
        createWebGl2Context: () => null,
        probeHalfFloatRenderTarget: () => ({ ok: true }),
        releaseWebGl2Context: () => undefined,
      },
      adapters: {},
    });

    const started = runtime.start();
    runtime.stop();
    gate.resolve({ name: 'Late Adapter' });
    await started;

    expect(runtime.getState()).toMatchObject({
      status: 'stopped',
      backend: 'unavailable',
      capability: null,
      error: null,
    });
  });

  it('lets a restart supersede a start that was cancelled by the stop', async () => {
    // stop() then start() has to produce a real start. Handing back the promise
    // from the cancelled one would leave a runtime that reports nothing and
    // never begins, which is worse than either outcome on its own.
    const first = createDeferred<RendererHandle>();
    const second = createDeferred<RendererHandle>();
    const disposed: string[] = [];
    let calls = 0;
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe(bothBackends),
      adapters: {
        webgpu: {
          initialize: () => {
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
          },
        },
      },
    });

    const firstStart = runtime.start();
    await vi.waitFor(() => expect(calls).toBe(1));
    runtime.stop();

    const secondStart = runtime.start();
    await vi.waitFor(() => expect(calls).toBe(2));
    second.resolve(createTrackedHandle('webgpu', 'Second', disposed));
    await expect(secondStart).resolves.toMatchObject({ status: 'ready' });

    // The first start's handle arrives late and must not disturb the live one.
    first.resolve(createTrackedHandle('webgpu', 'First', disposed));
    await firstStart;

    expect(runtime.getState()).toMatchObject({
      status: 'ready',
      rendererName: 'Second',
    });
    expect(disposed).toEqual(['First']);
  });

  it('still disposes exactly once when a stopped runtime is never restarted', async () => {
    const gate = createDeferred<RendererHandle>();
    const disposed: string[] = [];
    let entered = false;
    const runtime = createRendererRuntime({
      capabilityProbe: createProbe(bothBackends),
      adapters: {
        webgpu: {
          initialize: () => {
            entered = true;
            return gate.promise;
          },
        },
      },
    });

    const started = runtime.start();
    await vi.waitFor(() => expect(entered).toBe(true));
    runtime.stop();
    runtime.stop();
    runtime.stop();

    gate.resolve(createTrackedHandle('webgpu', 'Late WebGPU', disposed));
    await started;

    expect(disposed).toEqual(['Late WebGPU']);
  });
});
