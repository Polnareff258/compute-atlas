import { describe, expect, it } from 'vitest';

import { getRendererStatusCopy } from './statusCopy';
import type { RendererRuntimeState } from '@/renderer/runtime';

function createState(
  overrides: Partial<RendererRuntimeState> = {},
): RendererRuntimeState {
  return {
    status: 'idle',
    backend: 'unavailable',
    rendererName: null,
    adapterName: null,
    quality: 'ultra',
    capability: null,
    error: null,
    startedAt: null,
    ...overrides,
  };
}

describe('getRendererStatusCopy', () => {
  it('describes a ready WebGPU renderer without inventing hardware metrics', () => {
    expect(
      getRendererStatusCopy(
        createState({
          status: 'ready',
          backend: 'webgpu',
          rendererName: 'Three.js WebGPURenderer',
        }),
      ),
    ).toEqual({
      label: 'WEBGPU READY',
      detail: 'Three.js WebGPURenderer',
      tone: 'ready',
    });
  });

  it('makes a WebGL2 fallback explicit', () => {
    expect(
      getRendererStatusCopy(
        createState({
          status: 'fallback',
          backend: 'webgl2',
          rendererName: 'Three.js WebGLRenderer',
          error: 'WebGPU initialization failed: device lost',
        }),
      ),
    ).toEqual({
      label: 'WEBGL2 FALLBACK',
      detail: 'Three.js WebGLRenderer',
      tone: 'fallback',
    });
  });

  it('reports a degraded shell when no renderer is available', () => {
    expect(
      getRendererStatusCopy(
        createState({
          status: 'degraded',
          error: 'WebGPU and WebGL2 are unavailable',
        }),
      ),
    ).toEqual({
      label: 'GRAPHICS DEGRADED',
      detail: 'WebGPU and WebGL2 are unavailable',
      tone: 'degraded',
    });
  });
});
