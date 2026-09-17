import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';

describe('getCoreParameters', () => {
  it('derives deterministic budgets from the renderer quality profile', () => {
    const ultra = getCoreParameters('ultra');
    const high = getCoreParameters('high');
    const medium = getCoreParameters('medium');
    const safe = getCoreParameters('safe');

    expect(ultra.particleBudget).toBeGreaterThan(high.particleBudget);
    expect(high.particleBudget).toBeGreaterThan(medium.particleBudget);
    expect(medium.particleBudget).toBeGreaterThan(safe.particleBudget);
    expect(ultra.cageSegments).toBeGreaterThan(safe.cageSegments);
    expect(ultra.orbitalCount).toBeGreaterThan(safe.orbitalCount);
    expect(ultra.fieldResolution).toBeGreaterThan(safe.fieldResolution);
    expect(ultra.allowBloom).toBe(true);
    expect(safe.allowBloom).toBe(false);
    expect(getCoreParameters('ultra')).toEqual(getCoreParameters('ultra'));
  });

  it('keeps every budget finite and positive', () => {
    for (const profile of ['ultra', 'high', 'medium', 'safe'] as const) {
      const parameters = getCoreParameters(profile);

      expect(Number.isFinite(parameters.particleBudget)).toBe(true);
      expect(parameters.particleBudget).toBeGreaterThan(0);
      expect(parameters.cageSegments).toBeGreaterThan(0);
      expect(parameters.orbitalCount).toBeGreaterThan(0);
      expect(parameters.fieldResolution).toBeGreaterThan(0);
      expect(parameters.shellRadius).toBeGreaterThan(0);
    }
  });
});