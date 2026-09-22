import { describe, expect, it } from 'vitest';

import {
  bootReducer,
  createInitialBootState,
} from './bootMachine';
import type {
  BootRendererSnapshot,
  BootState,
} from './types';

const capability = {
  webgpu: true,
  webgl2: true,
  preferredBackend: 'webgpu' as const,
  adapterName: 'Test Adapter',
  webgl2HalfFloatTarget: true,
};

const renderer: BootRendererSnapshot = {
  status: 'ready',
  backend: 'webgpu',
  rendererName: 'Three.js WebGPURenderer',
  adapterName: 'Test Adapter',
  quality: 'ultra',
  error: null,
  startedAt: 22,
};

function advanceToSceneReady(): BootState {
  let state = createInitialBootState(0);

  state = bootReducer(state, {
    type: 'BOOT_BEGIN',
    at: 10,
    minimumDurationMs: 2_400,
    reducedMotion: false,
  });
  state = bootReducer(state, {
    type: 'GRAPHICS_PROBED',
    at: 20,
    capability,
  });
  state = bootReducer(state, {
    type: 'RENDERER_INITIALIZED',
    at: 30,
    renderer,
  });
  state = bootReducer(state, {
    type: 'SYSTEMS_CHECKED',
    at: 40,
    health: {
      overall: 'ready',
      backend: {
        status: 'not_initialized',
        detail: 'Local backend gateway not initialized',
        checkedAt: 40,
      },
      agent: {
        status: 'not_initialized',
        detail: 'Local Ollama gateway not initialized',
        checkedAt: 40,
      },
      projectManifest: {
        status: 'ready',
        detail: 'Project manifest verified',
        checkedAt: 40,
      },
    },
  });
  state = bootReducer(state, {
    type: 'SCENE_CONSTRUCTED',
    at: 50,
  });

  return state;
}

describe('bootReducer', () => {
  it('advances through the real bootstrap phases and gates completion on presentation time', () => {
    const ready = advanceToSceneReady();

    expect(ready.phase).toBe('ready');
    expect(ready.health?.agent.status).toBe('not_initialized');

    const entering = bootReducer(ready, {
      type: 'ENTER_REQUESTED',
      at: 60,
    });

    expect(entering.phase).toBe('entering');

    const tooSoon = bootReducer(entering, {
      type: 'TRANSITION_COMPLETE',
      at: 100,
    });
    expect(tooSoon.phase).toBe('entering');

    const complete = bootReducer(entering, {
      type: 'TRANSITION_COMPLETE',
      at: 2_410,
    });
    expect(complete.phase).toBe('complete');
    expect(complete.events.at(-1)?.kind).toBe('complete');
  });

  it('preserves WebGPU capability facts when the renderer falls back to WebGL2', () => {
    let state = createInitialBootState(0);
    state = bootReducer(state, {
      type: 'BOOT_BEGIN',
      at: 1,
      minimumDurationMs: 0,
      reducedMotion: true,
    });
    state = bootReducer(state, {
      type: 'GRAPHICS_PROBED',
      at: 2,
      capability,
    });
    state = bootReducer(state, {
      type: 'RENDERER_INITIALIZED',
      at: 3,
      renderer: {
        ...renderer,
        status: 'fallback',
        backend: 'webgl2',
        rendererName: 'Three.js WebGLRenderer',
        error: 'WebGPU initialization failed: device lost',
      },
    });

    expect(state.phase).toBe('checking_systems');
    expect(state.capability?.preferredBackend).toBe('webgpu');
    expect(state.renderer?.backend).toBe('webgl2');
    expect(state.renderer?.error).toContain('device lost');
  });

  it('keeps a degraded shell instead of throwing when no renderer is available', () => {
    let state = createInitialBootState(0);
    state = bootReducer(state, {
      type: 'BOOT_BEGIN',
      at: 1,
      minimumDurationMs: 0,
      reducedMotion: false,
    });
    state = bootReducer(state, {
      type: 'BOOT_DEGRADED',
      at: 2,
      error: 'WebGPU and WebGL2 are unavailable',
    });

    expect(state.phase).toBe('degraded');
    expect(state.error).toBe('WebGPU and WebGL2 are unavailable');
  });

  it('allows skip to remove presentation delay without claiming readiness early', () => {
    let state = createInitialBootState(0);
    state = bootReducer(state, {
      type: 'BOOT_BEGIN',
      at: 1,
      minimumDurationMs: 2_400,
      reducedMotion: false,
    });
    state = bootReducer(state, {
      type: 'SKIP_REQUESTED',
      at: 2,
    });

    expect(state.skipRequested).toBe(true);
    expect(state.minimumDurationMs).toBe(0);
    expect(state.phase).toBe('probing_graphics');
  });

  it('ignores illegal transitions and remains JSON serializable', () => {
    const initial = createInitialBootState(123);
    const unchanged = bootReducer(initial, {
      type: 'SCENE_CONSTRUCTED',
      at: 200,
    });

    expect(unchanged).toEqual(initial);
    expect(() => JSON.stringify(unchanged)).not.toThrow();
  });
});