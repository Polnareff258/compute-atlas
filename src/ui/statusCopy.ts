import type { RendererRuntimeState } from '../renderer/runtime';

export type RendererStatusTone = 'ready' | 'fallback' | 'degraded' | 'pending';

export type RendererStatusCopy = {
  /** Backend and active quality tier, e.g. `WEBGPU · ULTRA`. */
  readonly label: string;
  /** Only ever non-empty when something is wrong. */
  readonly detail: string;
  readonly tone: RendererStatusTone;
};

/**
 * One line of renderer status.
 *
 * The composition is the subject, so the HUD states what the scene is running on
 * and at what tier and nothing else. Adapter names, capability probes and frame
 * timings belong to a developer overlay that does not exist yet, and inventing a
 * place for them here would put diagnostics back in front of the work.
 */
export function getRendererStatusCopy(
  state: RendererRuntimeState,
): RendererStatusCopy {
  const quality = state.quality.toUpperCase();

  if (state.status === 'ready' && state.backend === 'webgpu') {
    return { label: `WEBGPU · ${quality}`, detail: '', tone: 'ready' };
  }

  if (state.status === 'ready' && state.backend === 'webgl2') {
    return { label: `WEBGL2 · ${quality}`, detail: '', tone: 'ready' };
  }

  // A fallback is still a working scene, but it is not the one that was asked
  // for, so the state stays visible rather than being folded into `ready`.
  if (state.status === 'fallback' && state.backend === 'webgl2') {
    return { label: `WEBGL2 FALLBACK · ${quality}`, detail: '', tone: 'fallback' };
  }

  if (state.status === 'degraded') {
    return {
      label: 'GRAPHICS UNAVAILABLE',
      detail: state.error ?? 'Renderer unavailable',
      tone: 'degraded',
    };
  }

  return {
    label: `INITIALIZING · ${quality}`,
    detail: state.status === 'stopped' ? 'Renderer stopped' : '',
    tone: 'pending',
  };
}
