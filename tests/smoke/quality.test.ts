import { describe, expect, it } from 'vitest';

import {
  QUALITY_PROFILES,
  getQualityProfile,
} from '../../src/config/quality';

describe('quality profiles', () => {
  it('defines all four renderer profiles with increasing budgets', () => {
    expect(Object.keys(QUALITY_PROFILES).sort()).toEqual([
      'high',
      'medium',
      'safe',
      'ultra',
    ]);

    expect(QUALITY_PROFILES.ultra.particleBudget).toBeGreaterThan(
      QUALITY_PROFILES.high.particleBudget,
    );
    expect(QUALITY_PROFILES.high.particleBudget).toBeGreaterThan(
      QUALITY_PROFILES.medium.particleBudget,
    );
    expect(QUALITY_PROFILES.medium.particleBudget).toBeGreaterThan(
      QUALITY_PROFILES.safe.particleBudget,
    );
  });

  it('returns a stable profile for a requested quality level', () => {
    expect(getQualityProfile('ultra')).toEqual(QUALITY_PROFILES.ultra);
  });

  it("keeps every profile's display constraints positive", () => {
    for (const profile of Object.values(QUALITY_PROFILES)) {
      expect(profile.maxDpr).toBeGreaterThan(0);
      expect(profile.pixelRatioScale).toBeGreaterThan(0);
      expect(profile.particleBudget).toBeGreaterThan(0);
    }
  });
});
