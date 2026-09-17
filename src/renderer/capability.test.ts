import { describe, expect, it } from 'vitest';

import { detectRendererCapabilities } from './capability';

describe('detectRendererCapabilities', () => {
  it('prefers WebGPU when an adapter and WebGL2 are available', async () => {
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => ({ name: 'Test WebGPU Adapter' }),
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
    });

    expect(report).toEqual({
      webgpu: true,
      webgl2: true,
      preferredBackend: 'webgpu',
      adapterName: 'Test WebGPU Adapter',
    });
  });

  it('falls back to WebGL2 when WebGPU is unavailable', async () => {
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
    });

    expect(report).toEqual({
      webgpu: false,
      webgl2: true,
      preferredBackend: 'webgl2',
    });
  });

  it('keeps WebGL2 available when the WebGPU probe throws', async () => {
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => {
        throw new Error('adapter request failed');
      },
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
    });

    expect(report).toEqual({
      webgpu: false,
      webgl2: true,
      preferredBackend: 'webgl2',
      reason: 'WebGPU probe failed: adapter request failed',
    });
  });

  it('reports an unavailable renderer when neither backend can be created', async () => {
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => null,
    });

    expect(report).toEqual({
      webgpu: false,
      webgl2: false,
      preferredBackend: 'unavailable',
      reason: 'WebGPU and WebGL2 are unavailable',
    });
  });
});
