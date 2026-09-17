import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';

describe('getCoreParameters', () => {
  it('derives deterministic V2 budgets from the renderer quality profile', () => {
    const ultra = getCoreParameters('ultra');
    const high = getCoreParameters('high');
    const medium = getCoreParameters('medium');
    const safe = getCoreParameters('safe');

    for (const key of [
      'particleBudget',
      'topologyNodeBudget',
      'topologyEdgeBudget',
      'fragmentBudget',
      'trajectoryBudget',
    ] as const) {
      expect(ultra[key]).toBeGreaterThanOrEqual(high[key]);
      expect(high[key]).toBeGreaterThanOrEqual(medium[key]);
      expect(medium[key]).toBeGreaterThanOrEqual(safe[key]);
    }

    expect(ultra.fieldResolution).toBeGreaterThanOrEqual(high.fieldResolution);
    expect(high.fieldResolution).toBeGreaterThanOrEqual(medium.fieldResolution);
    expect(medium.fieldResolution).toBeGreaterThanOrEqual(safe.fieldResolution);
    expect(ultra.allowBloom).toBe(true);
    expect(safe.allowBloom).toBe(false);
    expect(getCoreParameters('ultra')).toEqual(getCoreParameters('ultra'));
  });

  it('keeps every V2 budget finite and positive', () => {
    for (const profile of ['ultra', 'high', 'medium', 'safe'] as const) {
      const parameters = getCoreParameters(profile);

      for (const key of [
        'particleBudget',
        'topologyNodeBudget',
        'topologyEdgeBudget',
        'fragmentBudget',
        'trajectoryBudget',
        'fieldResolution',
      ] as const) {
        expect(Number.isFinite(parameters[key])).toBe(true);
        expect(parameters[key]).toBeGreaterThan(0);
      }
    }
  });

  it('keeps SAFE structural budgets non-zero', () => {
    const safe = getCoreParameters('safe');

    expect(safe.topologyNodeBudget).toBeGreaterThan(0);
    expect(safe.topologyEdgeBudget).toBeGreaterThan(0);
    expect(safe.fragmentBudget).toBeGreaterThan(0);
    expect(safe.trajectoryBudget).toBeGreaterThan(0);
    expect(safe.fieldResolution).toBeGreaterThan(0);
  });

  it('does not expose the removed V1 shape budgets', () => {
    const parameters = getCoreParameters('safe');

    expect('shellRadius' in parameters).toBe(false);
    expect('cageSegments' in parameters).toBe(false);
    expect('orbitalCount' in parameters).toBe(false);
  });
});