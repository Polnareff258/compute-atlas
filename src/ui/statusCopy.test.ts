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
  it('states backend and tier in one line and nothing else', () => {
    expect(
      getRendererStatusCopy(
        createState({
          status: 'ready',
          backend: 'webgpu',
          rendererName: 'Three.js WebGPURenderer',
        }),
      ),
    ).toEqual({ label: 'WebGPU — Ultra', detail: '', tone: 'ready' });
  });

  it('names the active tier rather than a fixed one', () => {
    expect(
      getRendererStatusCopy(
        createState({ status: 'ready', backend: 'webgpu', quality: 'safe' }),
      ).label,
    ).toBe('WebGPU — Safe');
  });

  it('describes a ready WebGL2 renderer when it is the available backend', () => {
    expect(
      getRendererStatusCopy(
        createState({ status: 'ready', backend: 'webgl2' }),
      ),
    ).toEqual({ label: 'WebGL2 — Ultra', detail: '', tone: 'ready' });
  });

  it('makes a WebGL2 fallback explicit', () => {
    const copy = getRendererStatusCopy(
      createState({
        status: 'fallback',
        backend: 'webgl2',
        error: 'WebGPU initialization failed: device lost',
      }),
    );

    expect(copy.label).toBe('WebGL2 fallback — Ultra');
    expect(copy.tone).toBe('fallback');
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
      label: 'Graphics unavailable',
      detail: 'WebGPU and WebGL2 are unavailable',
      tone: 'degraded',
    });
  });

  it('keeps a pending state legible to the readiness probe', () => {
    // The capture harness waits for the status to stop reading as initializing,
    // so the word itself is a contract rather than a wording choice.
    expect(getRendererStatusCopy(createState()).label).toMatch(/^Starting/);
    expect(getRendererStatusCopy(createState({ status: 'stopped' })).detail).toBe(
      'Renderer stopped',
    );
  });

  it('never claims hardware the runtime did not report', () => {
    for (const state of [
      createState({ status: 'ready', backend: 'webgpu' }),
      createState({ status: 'ready', backend: 'webgl2' }),
      createState({ status: 'fallback', backend: 'webgl2' }),
      createState({ status: 'degraded', error: 'no adapters' }),
      createState({ status: 'idle' }),
    ]) {
      const copy = getRendererStatusCopy(state);
      expect(copy.label).not.toMatch(/fps|frame|ms\b/i);
      expect(copy.detail).not.toMatch(/fps|frame|ms\b/i);
    }
  });
});
