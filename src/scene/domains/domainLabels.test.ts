import { describe, expect, it } from 'vitest';

import { resolveDomainLabelPresence } from './domainLabels';

describe('resolveDomainLabelPresence', () => {
  it('keeps dormant labels out of the artwork until a region is addressed', () => {
    expect(resolveDomainLabelPresence(false, false)).toBeLessThanOrEqual(0.06);
  });

  it('makes hover legible and reserves full emphasis for focus', () => {
    const dormant = resolveDomainLabelPresence(false, false);
    const hovered = resolveDomainLabelPresence(true, false);
    const focused = resolveDomainLabelPresence(false, true);

    expect(hovered).toBeGreaterThanOrEqual(0.7);
    expect(focused).toBe(1);
    expect(dormant).toBeLessThan(hovered);
  });
});
