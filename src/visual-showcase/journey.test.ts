import { describe, expect, it } from 'vitest';

import { clampProgress, getJourney, getQuality } from './journey';

describe('clampProgress', () => {
  it('keeps progress inside the journey and maps NaN to the beginning', () => {
    expect(clampProgress(-0.2)).toBe(0);
    expect(clampProgress(0.4)).toBe(0.4);
    expect(clampProgress(1.2)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('getJourney', () => {
  it('starts and ends at the defined journey states', () => {
    expect(getJourney(0)).toEqual({ form: 1, melt: 0, fracture: 0, echo: 0, chapter: 0 });
    expect(getJourney(1)).toEqual({ form: 0, melt: 1, fracture: 1, echo: 1, chapter: 3 });
  });

  it('uses smooth transitions at their specified midpoints', () => {
    expect(getJourney(0.28).melt).toBeCloseTo(0.5, 12);
    expect(getJourney(0.55).fracture).toBeCloseTo(0.5, 12);
    expect(getJourney(0.87).echo).toBeCloseTo(0.5, 12);
  });

  it('keeps each transition continuous at both ends', () => {
    const epsilon = 0.000001;
    const transitions = [
      { start: 0.16, end: 0.4, key: 'melt' as const },
      { start: 0.43, end: 0.67, key: 'fracture' as const },
      { start: 0.76, end: 0.98, key: 'echo' as const },
    ];

    for (const { start, end, key } of transitions) {
      expect(getJourney(start)[key]).toBe(0);
      expect(getJourney(end)[key]).toBe(1);
      expect(Math.abs(getJourney(start + epsilon)[key] - getJourney(start)[key])).toBeLessThan(0.00002);
      expect(Math.abs(getJourney(end)[key] - getJourney(end - epsilon)[key])).toBeLessThan(0.00002);
    }

    expect(getJourney(0.43).form).toBe(1);
    expect(getJourney(0.67).form).toBe(0);
    expect(Math.abs(getJourney(0.43 + epsilon).form - getJourney(0.43).form)).toBeLessThan(0.00002);
    expect(Math.abs(getJourney(0.67).form - getJourney(0.67 - epsilon).form)).toBeLessThan(0.00002);
  });

  it('advances chapters exactly at the inclusive thresholds', () => {
    expect(getJourney(0.219999).chapter).toBe(0);
    expect(getJourney(0.22).chapter).toBe(1);
    expect(getJourney(0.479999).chapter).toBe(1);
    expect(getJourney(0.48).chapter).toBe(2);
    expect(getJourney(0.779999).chapter).toBe(2);
    expect(getJourney(0.78).chapter).toBe(3);
  });

  it('treats malformed and infinite progress as bounded journey positions', () => {
    expect(getJourney(Number.NaN)).toEqual(getJourney(0));
    expect(getJourney(Number.NEGATIVE_INFINITY)).toEqual(getJourney(0));
    expect(getJourney(Number.POSITIVE_INFINITY)).toEqual(getJourney(1));
  });

  it('returns the same state for the same progress regardless of call order', () => {
    const first = getJourney(0.62);
    getJourney(0.05);
    getJourney(0.99);
    expect(getJourney(0.62)).toEqual(first);
  });

  it('keeps continuous values finite and in range for representative inputs', () => {
    for (const progress of [-1, 0, 0.16, 0.28, 0.4, 0.55, 0.67, 0.87, 0.98, 1, 2, Number.NaN]) {
      const journey = getJourney(progress);
      for (const value of [journey.form, journey.melt, journey.fracture, journey.echo]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(journey.chapter).toBeGreaterThanOrEqual(0);
      expect(journey.chapter).toBeLessThanOrEqual(3);
    }
  });
});

describe('getQuality', () => {
  it('uses the mobile and desktop rendering budgets', () => {
    expect(getQuality(true)).toEqual({ dpr: 1, particles: 1800 });
    expect(getQuality(false)).toEqual({ dpr: 1.5, particles: 3600 });
  });
});
