import { describe, expect, it } from 'vitest';

import { sampleRendererTelemetry } from './rendererTelemetry';

describe('sampleRendererTelemetry', () => {
  it('reports measured renderer counters and frame timing', () => {
    const snapshot = sampleRendererTelemetry({
      renderer: {
        info: {
          // `calls` is present and much larger, and it must not be the one that
          // is read: it is cumulative since page load, not a frame's cost.
          render: { calls: 41_902, drawCalls: 7, triangles: 1_240 },
          memory: { geometries: 5, textures: 2 },
        },
      },
      backend: 'webgpu',
      quality: 'ultra',
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
      // Derived from `renderedFieldSamples` rather than supplied, so the two
      // names for one number cannot drift apart.
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
