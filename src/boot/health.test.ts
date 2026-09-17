import { describe, expect, it } from 'vitest';

import { aggregateHealth } from './health';
import type { BootRendererSnapshot } from './types';

const renderer: BootRendererSnapshot = {
  status: 'ready',
  backend: 'webgpu',
  rendererName: 'Three.js WebGPURenderer',
  adapterName: null,
  quality: 'ultra',
  error: null,
  startedAt: 10,
};

const manifest = {
  status: 'ready' as const,
  detail: 'Project manifest verified',
  checkedAt: 20,
};

describe('aggregateHealth', () => {
  it('keeps future gateways explicit without degrading the current visual shell', () => {
    const health = aggregateHealth({
      renderer,
      manifest,
      checkedAt: 20,
    });

    expect(health.overall).toBe('ready');
    expect(health.backend.status).toBe('not_initialized');
    expect(health.agent.status).toBe('not_initialized');
    expect(health.projectManifest.status).toBe('ready');
  });

  it('marks the aggregate degraded when the renderer is degraded', () => {
    const health = aggregateHealth({
      renderer: {
        ...renderer,
        status: 'degraded',
        backend: 'unavailable',
        error: 'No renderer backend could be initialized',
      },
      manifest,
      checkedAt: 20,
    });

    expect(health.overall).toBe('degraded');
    expect(health.backend.status).toBe('not_initialized');
  });

  it('does not invent an adapter or hardware health value', () => {
    const health = aggregateHealth({
      renderer: {
        ...renderer,
        adapterName: null,
        rendererName: null,
      },
      manifest,
      checkedAt: 20,
    });

    expect(health.agent.detail).toContain('not initialized');
    expect(health.projectManifest.detail).toBe('Project manifest verified');
  });
});