import { describe, expect, it } from 'vitest';

import { BRUSH_SHAPE, resolveBrushRadius } from './brushProfile';

describe('resolveBrushRadius', () => {
  it('keeps direct manipulation local while scaling with the primary channel', () => {
    expect(resolveBrushRadius(10)).toBe(64);
    expect(resolveBrushRadius(40)).toBeCloseTo(136, 6);
  });

  it('authors a calligraphic crescent instead of an elliptical cursor stamp', () => {
    expect(BRUSH_SHAPE.breadth / BRUSH_SHAPE.depth).toBeGreaterThan(2.2);
    expect(BRUSH_SHAPE.bow).toBeGreaterThanOrEqual(0.28);
    expect(BRUSH_SHAPE.bow).toBeLessThanOrEqual(0.42);
    expect(BRUSH_SHAPE.skew).toBeGreaterThan(0);
    expect(BRUSH_SHAPE.skew).toBeLessThanOrEqual(0.1);
  });
});
