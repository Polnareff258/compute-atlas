import { describe, expect, it } from 'vitest';

import { deriveDomainVisualDescriptor } from './domainVisuals';

const DOMAIN_IDS = ['ai', 'graphics', 'game-analysis', 'systems', 'research'] as const;

describe('deriveDomainVisualDescriptor', () => {
  it('returns deterministic bounded members for equal domain and detail inputs', () => {
    for (const nodeId of DOMAIN_IDS) {
      const first = deriveDomainVisualDescriptor(nodeId, 1);
      const second = deriveDomainVisualDescriptor(nodeId, 1);

      expect(first).toEqual(second);
      expect(first.members.length).toBeGreaterThanOrEqual(3);
      expect(first.members.every((member) =>
        [...member.position, ...member.scale, ...member.rotation].every(Number.isFinite) &&
        member.position.every((value) => Math.abs(value) <= 1.2) &&
        member.scale.every((value) => value > 0 && value <= 1.2),
      )).toBe(true);
    }
  });

  it('assigns five distinct processing silhouettes', () => {
    const descriptors = DOMAIN_IDS.map((nodeId) => deriveDomainVisualDescriptor(nodeId, 1));

    expect(new Set(descriptors.map((descriptor) => descriptor.kind)).size).toBe(DOMAIN_IDS.length);
    expect(new Set(descriptors.map((descriptor) => JSON.stringify(descriptor.members))).size).toBe(DOMAIN_IDS.length);
  });
});
