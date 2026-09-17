import type { RendererRuntimeState } from '../renderer/runtime';

export type RendererStatusTone = 'ready' | 'fallback' | 'degraded' | 'pending';

export type RendererStatusCopy = {
  readonly label: string;
  readonly detail: string;
  readonly tone: RendererStatusTone;
};

export function getRendererStatusCopy(
  state: RendererRuntimeState,
): RendererStatusCopy {
  if (state.status === 'ready' && state.backend === 'webgpu') {
    return {
      label: 'WEBGPU READY',
      detail: state.rendererName ?? 'WebGPU renderer',
      tone: 'ready',
    };
  }

  if (state.status === 'ready' && state.backend === 'webgl2') {
    return {
      label: 'WEBGL2 READY',
      detail: state.rendererName ?? 'WebGL2 renderer',
      tone: 'ready',
    };
  }
  if (state.status === 'fallback' && state.backend === 'webgl2') {
    return {
      label: 'WEBGL2 FALLBACK',
      detail: state.rendererName ?? 'WebGL2 renderer',
      tone: 'fallback',
    };
  }

  if (state.status === 'degraded') {
    return {
      label: 'GRAPHICS DEGRADED',
      detail: state.error ?? 'Renderer unavailable',
      tone: 'degraded',
    };
  }

  return {
    label: 'INITIALIZING GRAPHICS',
    detail: state.status === 'stopped' ? 'Renderer stopped' : 'Probing local backend',
    tone: 'pending',
  };
}
