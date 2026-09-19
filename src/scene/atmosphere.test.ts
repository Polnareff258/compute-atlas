import { describe, expect, it } from 'vitest';

import { deriveAtmosphereDescriptor } from './atmosphereDescriptor';

describe('deriveAtmosphereDescriptor', () => {
  it('creates a sparse deterministic depth field behind the processing scene', () => {
    const first = deriveAtmosphereDescriptor();
    const second = deriveAtmosphereDescriptor();

    expect(first).toEqual(second);
    expect(first.traces.length).toBeGreaterThanOrEqual(4);
    expect(first.traces.length).toBeLessThanOrEqual(8);
    expect(first.traces.every((trace) => trace.points.length >= 3 && trace.opacity <= 0.18)).toBe(true);
    expect(first.traces.flatMap((trace) => trace.points).every((point) =>
      point.every(Number.isFinite) && point[2] <= -3.5,
    )).toBe(true);
  });
});
