import { describe, expect, it } from 'vitest';

import {
  readFrameCounters,
  sampleRendererTelemetry,
} from './rendererTelemetry';

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

/**
 * The frame boundary.
 *
 * These are small assertions about an ordering, and the ordering is the whole
 * fix: the counters have to be *read* while they still hold the frame that just
 * finished, and *cleared* before the next one starts drawing. Clearing first
 * reports a frame that has not been drawn; not clearing reports the session.
 *
 * The defect this pins was not catchable by a type and not visible in a
 * screenshot — it produced numbers, and the numbers looked like measurements.
 */
describe('readFrameCounters', () => {
  function createCounters(initial: { drawCalls: number; triangles: number }) {
    const calls = { ...initial };
    const owner = {
      info: {
        reset: () => {
          calls.drawCalls = 0;
          calls.triangles = 0;
        },
      },
    };
    return { owner, calls };
  }

  it('reads the finished frame before clearing the counters', () => {
    const { owner, calls } = createCounters({ drawCalls: 21, triangles: 2_400 });

    const read = readFrameCounters(owner, () => ({ ...calls }));

    expect(read).toEqual({ drawCalls: 21, triangles: 2_400 });
    // And the frame about to be drawn starts from zero, which is the half that
    // was missing and made every report a total from page load.
    expect(calls).toEqual({ drawCalls: 0, triangles: 0 });
  });

  it('returns whatever the read produced, untouched', () => {
    const { owner } = createCounters({ drawCalls: 1, triangles: 1 });
    const value = { fps: 60, nested: { deep: true } };

    expect(readFrameCounters(owner, () => value)).toBe(value);
  });

  it('clears even when the read throws', () => {
    // The important one. A read that threw and left the counters alone would
    // turn the next report into a total again — exactly the failure being fixed,
    // arriving through the error path instead of through the happy one.
    const { owner, calls } = createCounters({ drawCalls: 33, triangles: 900 });

    expect(() =>
      readFrameCounters(owner, () => {
        throw new Error('sampling failed');
      }),
    ).toThrow('sampling failed');

    expect(calls).toEqual({ drawCalls: 0, triangles: 0 });
  });

  it('does not let two reads in a row report the same frame twice', () => {
    const { owner, calls } = createCounters({ drawCalls: 12, triangles: 100 });

    const first = readFrameCounters(owner, () => ({ ...calls }));
    calls.drawCalls = 9;
    const second = readFrameCounters(owner, () => ({ ...calls }));

    expect(first.drawCalls).toBe(12);
    expect(second.drawCalls).toBe(9);
  });
});
