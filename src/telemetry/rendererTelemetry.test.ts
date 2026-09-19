import { describe, expect, it } from 'vitest';

import { sampleRendererTelemetry } from './rendererTelemetry';

describe('sampleRendererTelemetry', () => {
  it('reports measured renderer counters and frame timing', () => {
    const snapshot = sampleRendererTelemetry({
      renderer: {
        info: {
          render: { calls: 7, triangles: 1_240 },
          memory: { geometries: 5, textures: 2 },
        },
      },
      backend: 'webgpu',
      quality: 'ultra',
      particleCount: 72_000,
      configuredFieldBudget: 72_000,
      renderedFieldSamples: 8_640,
      activeSignalSamples: 18,
      deltaSeconds: 1 / 60,
      sampledAt: 500,
    });

    expect(snapshot).toEqual({
      fps: 60,
      frameTimeMs: 16.67,
      drawCalls: 7,
      triangles: 1_240,
      geometries: 5,
      textures: 2,
      particleCount: 8_640,
      configuredFieldBudget: 72_000,
      renderedFieldSamples: 8_640,
      activeSignalSamples: 18,
      backend: 'webgpu',
      quality: 'ultra',
      sampledAt: 500,
    });
  });

  it('uses null for metrics the browser renderer does not expose', () => {
    const snapshot = sampleRendererTelemetry({
      renderer: {},
      backend: 'unavailable',
      quality: 'safe',
      particleCount: 6_000,
      configuredFieldBudget: 6_000,
      renderedFieldSamples: 0,
      activeSignalSamples: 0,
      deltaSeconds: 0,
      sampledAt: 800,
    });

    expect(snapshot.fps).toBeNull();
    expect(snapshot.frameTimeMs).toBeNull();
    expect(snapshot.drawCalls).toBeNull();
    expect(snapshot.triangles).toBeNull();
    expect(snapshot.geometries).toBeNull();
    expect(snapshot.textures).toBeNull();
  });
});
