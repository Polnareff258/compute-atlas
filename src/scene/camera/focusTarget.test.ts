import { describe, expect, it } from 'vitest';

import { deriveCameraFocusTarget } from './cameraController';

describe('deriveCameraFocusTarget', () => {
  it('returns a finite normalized direction for a domain node position', () => {
    const target = deriveCameraFocusTarget([2.4, -0.8, 0.4]);
    const length = Math.hypot(...target);

    expect(length).toBeCloseTo(1, 6);
    expect(target[0]).toBeGreaterThan(0.9);
    expect(target[1]).toBeLessThan(-0.3);
    expect(target[2]).toBeGreaterThan(0.1);
  });

  it('returns the overview direction for the centered core', () => {
    expect(deriveCameraFocusTarget([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
