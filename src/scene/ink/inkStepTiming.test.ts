import { describe, expect, it } from 'vitest';

import { resolveInkStepTiming } from './inkStepTiming';

describe('resolveInkStepTiming', () => {
  it('advances ambient and direct motion together normally', () => {
    expect(resolveInkStepTiming(1 / 60, 12, false)).toEqual({
      ambientDelta: 1 / 60,
      interactionDelta: 1 / 60,
      elapsed: 12,
    });
  });

  it('freezes autonomous motion without disabling direct manipulation', () => {
    expect(resolveInkStepTiming(1 / 60, 12, true)).toEqual({
      ambientDelta: 0,
      interactionDelta: 1 / 60,
      elapsed: 0,
    });
  });

  it('clamps a suspended-tab delta for both clocks', () => {
    expect(resolveInkStepTiming(2, 12, false)).toEqual({
      ambientDelta: 0.1,
      interactionDelta: 0.1,
      elapsed: 12,
    });
  });
});
