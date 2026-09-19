import { describe, expect, it } from 'vitest';

import {
  CORE_ROUTE_GROUP,
  DOMAIN_ROUTE_GROUP_BASE,
  DOMAIN_ROUTE_GROUP_COUNT,
  MAX_ROUTE_GROUPS,
  ROUTE_GROUPS,
  TRUNK_ROUTE_GROUP_BASE,
  TRUNK_ROUTE_GROUP_COUNT,
} from './routeContract';

describe('the routing group contract', () => {
  it('gives the Core group zero, because every producer defaults to zero', () => {
    // A curve whose group is missing or unreadable packs into slot zero. If the
    // Core did not own slot zero, every malformed Graph route would silently
    // become Core circulation and dim the hero instead of a domain.
    expect(CORE_ROUTE_GROUP).toBe(0);
  });

  it('keeps every range disjoint, so no two producers share a uniform slot', () => {
    const groups = ROUTE_GROUPS;
    expect(new Set(groups).size).toBe(groups.length);

    // Stated as ranges rather than as the flat list, because the flat list is
    // derived from these and a derived list cannot catch a range overlapping
    // itself.
    const domainEnd = DOMAIN_ROUTE_GROUP_BASE + DOMAIN_ROUTE_GROUP_COUNT - 1;
    const trunkEnd = TRUNK_ROUTE_GROUP_BASE + TRUNK_ROUTE_GROUP_COUNT - 1;
    expect(DOMAIN_ROUTE_GROUP_BASE).toBeGreaterThan(CORE_ROUTE_GROUP);
    expect(TRUNK_ROUTE_GROUP_BASE).toBeGreaterThan(domainEnd);
    expect(trunkEnd).toBeLessThan(MAX_ROUTE_GROUPS);
  });

  it('fits every group inside the packed uniform set', () => {
    for (const group of ROUTE_GROUPS) {
      expect(Number.isInteger(group)).toBe(true);
      expect(group).toBeGreaterThanOrEqual(0);
      // Past this the pack clamps, which draws two producers into one slot
      // rather than failing — the exact failure the ranges exist to prevent.
      expect(group).toBeLessThan(MAX_ROUTE_GROUPS);
    }
  });

  it('lists the groups in ascending order, one per slot', () => {
    const sorted = [...ROUTE_GROUPS].sort((a, b) => a - b);
    expect(ROUTE_GROUPS).toEqual(sorted);
    expect(ROUTE_GROUPS.length).toBe(
      1 + DOMAIN_ROUTE_GROUP_COUNT + TRUNK_ROUTE_GROUP_COUNT,
    );
  });
});
