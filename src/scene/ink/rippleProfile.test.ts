import { describe, expect, it } from 'vitest';

import { RIPPLE_PROFILE, resolveRippleDisplacement } from './rippleProfile';

describe('RIPPLE_PROFILE', () => {
  it('keeps chromatic separation restrained and asymmetric', () => {
    expect(RIPPLE_PROFILE.leadingHueMix).toBeGreaterThan(RIPPLE_PROFILE.trailingHueMix);
    expect(RIPPLE_PROFILE.leadingHueMix).toBeLessThanOrEqual(0.72);
    expect(RIPPLE_PROFILE.trailingHueMix).toBeLessThanOrEqual(0.24);
    expect(RIPPLE_PROFILE.chromaticGain).toBeLessThanOrEqual(0.32);
    expect(RIPPLE_PROFILE.interiorHueMix).toBeGreaterThan(0.5);
    // Emission is also attenuated by the membrane alpha. This is source energy,
    // not the final on-screen brightness.
    expect(RIPPLE_PROFILE.interiorGain).toBeLessThanOrEqual(0.12);
    // The surface is alpha-composited; this is source-colour energy before the
    // roughly 0.22 interaction coverage attenuates it on screen.
    expect(RIPPLE_PROFILE.surfaceTintGain).toBeLessThanOrEqual(0.12);
    expect(RIPPLE_PROFILE.coverageGain).toBeLessThanOrEqual(0.24);
    expect(RIPPLE_PROFILE.interiorCoverageFloor).toBeGreaterThanOrEqual(0);
    expect(RIPPLE_PROFILE.interiorCoverageFloor).toBeLessThanOrEqual(0.08);
    expect(RIPPLE_PROFILE.edgeEmissionGain).toBeLessThanOrEqual(0.6);
    expect(RIPPLE_PROFILE.reboundGain).toBeLessThanOrEqual(0.22);
    expect(RIPPLE_PROFILE.spectralVariation).toBeGreaterThan(0);
    expect(RIPPLE_PROFILE.spectralVariation).toBeLessThanOrEqual(0.22);
  });

  it('adds a small elastic rebound without turning the surface into a spike', () => {
    expect(RIPPLE_PROFILE.pressureLift).toBeGreaterThan(0);
    expect(RIPPLE_PROFILE.pressureLift).toBeLessThanOrEqual(0.4);
    expect(RIPPLE_PROFILE.reboundAmplitude).toBeGreaterThan(0);
    expect(RIPPLE_PROFILE.reboundAmplitude).toBeLessThanOrEqual(0.08);
    // One compression crest and one weak rebound read as liquid calligraphy.
    // More than one full phase across the pressure body becomes a ladder of
    // parallel rings, regardless of how physically motivated it is.
    expect(RIPPLE_PROFILE.phaseFrequency).toBeGreaterThanOrEqual(5);
    expect(RIPPLE_PROFILE.phaseFrequency).toBeLessThanOrEqual(8);
  });

  it('moves the pressure front without lifting the solid brush core', () => {
    expect(resolveRippleDisplacement(1, 0, 1)).toBe(0);
    expect(resolveRippleDisplacement(0.8, 0.85, 0.5)).toBeGreaterThan(0.05);
    expect(resolveRippleDisplacement(0.8, 0.85, 0.5)).toBeLessThan(0.4);
    expect(resolveRippleDisplacement(0.8, 0.85, -1)).toBeGreaterThanOrEqual(0);
    expect(resolveRippleDisplacement(0, 1, 1)).toBe(0);
  });
});
