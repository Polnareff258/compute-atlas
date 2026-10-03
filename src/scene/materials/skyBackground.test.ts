import { describe, expect, it } from 'vitest';

import { sampleSubmergedAirMix } from './skyBackground';

describe('submerged air', () => {
  it('keeps the sky dark while placing a restrained mineral wash behind the lower river', () => {
    expect(sampleSubmergedAirMix(0.2, 0.5)).toBe(0);
    expect(sampleSubmergedAirMix(-0.4, 0.5)).toBeGreaterThan(0.05);
    expect(sampleSubmergedAirMix(-0.4, 0.5)).toBeLessThan(0.12);
    expect(sampleSubmergedAirMix(-0.9, 1)).toBeLessThanOrEqual(0.20);
    expect(sampleSubmergedAirMix(-0.9, 1)).toBeGreaterThan(0.17);
  });
});
