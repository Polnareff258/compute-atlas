import { describe, expect, it } from 'vitest';

import { createBootCoordinator } from './bootCoordinator';
import type {
  RendererRuntime,
  RendererRuntimeState,
} from '../renderer/runtime';

function createRuntime(
  state: RendererRuntimeState,
): RendererRuntime {
  return {
    start: async () => state,
    stop: () => undefined,
    setQuality: () => undefined,
    getState: () => state,
  };
}

const readyState: RendererRuntimeState = {
  status: 'ready',
  backend: 'webgpu',
  rendererName: 'Three.js WebGPURenderer',
  adapterName: 'Test Adapter',
  quality: 'ultra',
  capability: {
    webgpu: true,
    webgl2: true,
    preferredBackend: 'webgpu',
    adapterName: 'Test Adapter',
  },
  error: null,
  startedAt: 20,
};

describe('createBootCoordinator', () => {
  it('mounts the renderer before declaring the scene ready and supports skip mode', async () => {
    const published: string[] = [];
    let initialized = false;
    const coordinator = createBootCoordinator({
      runtime: createRuntime(readyState),
      mode: 'skip',
      now: () => 100,
      onStateChange: (state) => published.push(state.phase),
      onRendererInitialized: () => {
        initialized = true;
      },
    });

    const finalState = await coordinator.start();

    expect(initialized).toBe(true);
    expect(finalState.phase).toBe('complete');
    expect(published).toContain('constructing_scene');
    expect(published.at(-1)).toBe('complete');

    coordinator.dispose();
  });

  it('keeps a renderer failure in an explicit degraded phase', async () => {
    const degradedState: RendererRuntimeState = {
      ...readyState,
      status: 'degraded',
      backend: 'unavailable',
      rendererName: null,
      adapterName: null,
      error: 'No renderer backend could be initialized',
    };
    const coordinator = createBootCoordinator({
      runtime: createRuntime(degradedState),
      mode: 'full',
      now: () => 100,
      onStateChange: () => undefined,
      onRendererInitialized: () => undefined,
    });

    const finalState = await coordinator.start();

    expect(finalState.phase).toBe('degraded');
    expect(finalState.error).toBe('No renderer backend could be initialized');

    coordinator.dispose();
  });
});