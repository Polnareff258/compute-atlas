import { describe, expect, it } from 'vitest';

import {
  FLOW_WAVE_PROFILE,
  GILDED_CURRENT_PROFILE,
  INK_VEIL_LAYERS,
  INK_MARBLING_PROFILE,
  PRIMARY_ROUTE_LIGHT_PROFILE,
  sampleCurrentGlint,
  sampleDensityCoverage,
  sampleFlowWave,
  sampleMarbling,
} from './inkVisualProfile';

describe('ink visual profile', () => {
  it('makes the middle of the advected river visible without making empty water opaque', () => {
    expect(sampleDensityCoverage(0)).toBe(0);
    expect(sampleDensityCoverage(0.012)).toBeGreaterThan(0);
    expect(sampleDensityCoverage(0.012)).toBeLessThan(0.03);
    expect(sampleDensityCoverage(0.04)).toBeLessThan(0.06);
    expect(sampleDensityCoverage(0.14)).toBeGreaterThan(0.25);
    expect(sampleDensityCoverage(0.14)).toBeLessThan(0.45);
    expect(sampleDensityCoverage(0.42)).toBeGreaterThan(0.95);
  });

  it('builds depth from two asymmetric, restrained field-derived veils', () => {
    expect(INK_VEIL_LAYERS).toHaveLength(2);
    expect(INK_VEIL_LAYERS[0]!.heightScale).not.toBe(INK_VEIL_LAYERS[1]!.heightScale);
    expect(INK_VEIL_LAYERS[0]!.phase).not.toBe(INK_VEIL_LAYERS[1]!.phase);
    expect(INK_VEIL_LAYERS[0]!.gain).toBeGreaterThan(INK_VEIL_LAYERS[1]!.gain);
    expect(INK_VEIL_LAYERS[0]!.worldOffset).not.toEqual(INK_VEIL_LAYERS[1]!.worldOffset);

    for (const layer of INK_VEIL_LAYERS) {
      expect(layer.gain).toBeGreaterThan(0);
      expect(layer.gain).toBeLessThanOrEqual(0.24);
      expect(layer.heightScale).toBeGreaterThanOrEqual(0.55);
      expect(layer.heightScale).toBeLessThanOrEqual(1.45);
      expect(Math.hypot(...layer.worldOffset)).toBeGreaterThan(70);
      expect(Math.hypot(...layer.worldOffset)).toBeLessThan(280);
    }
  });

  it('keeps the ambient wave slow, low and directional', () => {
    expect(FLOW_WAVE_PROFILE.height).toBeGreaterThan(0.4);
    expect(FLOW_WAVE_PROFILE.height).toBeLessThanOrEqual(2.8);
    expect(FLOW_WAVE_PROFILE.rate).toBeGreaterThan(0.28);
    expect(FLOW_WAVE_PROFILE.rate).toBeLessThan(0.75);
    expect(FLOW_WAVE_PROFILE.coverageDiffusionReach).toBeGreaterThanOrEqual(2.2);
    expect(FLOW_WAVE_PROFILE.coverageDiffusionReach).toBeLessThanOrEqual(3.2);
    expect(FLOW_WAVE_PROFILE.coverageNoiseFloor).toBeGreaterThanOrEqual(0.4);
    expect(FLOW_WAVE_PROFILE.coverageNoiseFloor).toBeLessThanOrEqual(0.7);
    expect(FLOW_WAVE_PROFILE.edgeColourFloor).toBeGreaterThanOrEqual(0.08);
    expect(FLOW_WAVE_PROFILE.edgeColourFloor).toBeLessThanOrEqual(0.22);

    const now = sampleFlowWave(0.37, 0.62, 0);
    const later = sampleFlowWave(0.37, 0.62, 2.4);
    const downstream = sampleFlowWave(0.41, 0.62, 0);

    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(1);
    expect(Math.abs(later - now)).toBeGreaterThan(0.04);
    expect(Math.abs(downstream - now)).toBeGreaterThan(0.04);
  });

  it('moves a sparse highlight downstream instead of lighting the full route', () => {
    const samples = Array.from({ length: 101 }, (_, index) =>
      sampleCurrentGlint(index / 100, 0.31, 0),
    );
    const bright = samples.filter((value) => value > 0.6).length;
    expect(bright).toBeGreaterThan(8);
    expect(bright).toBeLessThan(38);
    const drift = samples.reduce(
      (total, value, index) =>
        total + Math.abs(value - sampleCurrentGlint(index / 100, 0.31, 3)),
      0,
    );
    expect(drift).toBeGreaterThan(12);
    expect(GILDED_CURRENT_PROFILE.bodyGain).toBeLessThan(
      GILDED_CURRENT_PROFILE.glintGain,
    );
  });

  it('keeps the river marbling broad, flowing, and subordinate to the body', () => {
    const crossSection = Array.from({ length: 121 }, (_, index) =>
      sampleMarbling(0.4, index / 120 - 0.5, 0.42, 0.57, 0),
    );
    const lit = crossSection.filter((value) => value > 0.5).length;
    expect(lit).toBeGreaterThan(10);
    expect(lit).toBeLessThan(60);
    expect(INK_MARBLING_PROFILE.opacityGain).toBeGreaterThan(0.12);
    expect(INK_MARBLING_PROFILE.opacityGain).toBeLessThan(0.22);
    const motion = crossSection.reduce((sum, value, index) =>
      sum + Math.abs(value - sampleMarbling(0.4, index / 120 - 0.5, 0.42, 0.57, 4)), 0);
    expect(motion).toBeGreaterThan(14);
  });

  it('lights a soft route body instead of outlining its raster boundary', () => {
    expect(PRIMARY_ROUTE_LIGHT_PROFILE.rimGain).toBe(0);
    expect(PRIMARY_ROUTE_LIGHT_PROFILE.bodyGain).toBeGreaterThan(0);
    expect(PRIMARY_ROUTE_LIGHT_PROFILE.bodyGain).toBeLessThanOrEqual(0.1);
    expect(PRIMARY_ROUTE_LIGHT_PROFILE.glintGain).toBeLessThanOrEqual(0.2);
    // The route may reinforce existing pigment, but must remain below the
    // surface-visibility threshold when it is the only signal present.
    expect(PRIMARY_ROUTE_LIGHT_PROFILE.coverageGain).toBeLessThan(0.018);
  });
});
