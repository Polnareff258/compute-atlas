import { describe, expect, it } from 'vitest';

import {
  QUALITY_PROFILES,
  deriveEffectiveDpr,
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
  it('derives a finite effective DPR from device ratio and quality policy', () => {
    const devicePixelRatios = [0.5, 1, 2, 3];

    for (const devicePixelRatio of devicePixelRatios) {
      for (const profile of Object.keys(QUALITY_PROFILES) as Array<
        keyof typeof QUALITY_PROFILES
      >) {
        const effectiveDpr = deriveEffectiveDpr(
          devicePixelRatio,
          getQualityProfile(profile),
        );

        expect(Number.isFinite(effectiveDpr)).toBe(true);
        expect(effectiveDpr).toBeGreaterThan(0);
        expect(effectiveDpr).toBeLessThanOrEqual(
          getQualityProfile(profile).maxDpr,
        );
      }
    }

    const effectiveDprs = (
      Object.keys(QUALITY_PROFILES) as Array<keyof typeof QUALITY_PROFILES>
    ).map((profile) =>
      deriveEffectiveDpr(2, getQualityProfile(profile)),
    );

    expect(effectiveDprs[0]).toBeGreaterThanOrEqual(effectiveDprs[1] ?? 0);
    expect(effectiveDprs[1]).toBeGreaterThanOrEqual(effectiveDprs[2] ?? 0);
    expect(effectiveDprs[2]).toBeGreaterThanOrEqual(effectiveDprs[3] ?? 0);
    expect(deriveEffectiveDpr(2, QUALITY_PROFILES.safe)).toBeLessThanOrEqual(1);
  });
});
