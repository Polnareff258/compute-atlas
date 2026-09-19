import { describe, expect, it } from 'vitest';

import { GRAPH_MANIFEST } from './graphManifest';
import {
  NAMED_DOMAIN_PROMINENCE,
  deriveGraphLayout,
  deriveGraphProminence,
} from './layout';
import type { GraphNodeId } from './types';

const DOMAIN_IDS: readonly GraphNodeId[] = [
  'graphics',
  'ai',
  'game-analysis',
  'systems',
  'research',
];

describe('deriveGraphLayout', () => {
  it('returns the same finite positions for the same manifest', () => {
    const first = deriveGraphLayout(GRAPH_MANIFEST);
    const second = deriveGraphLayout(GRAPH_MANIFEST);

    expect(first).toEqual(second);
    for (const position of Object.values(first)) {
      expect(position.every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps the semantic core at the origin and every domain apart', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);
    const core = layout.core;
    const domainPositions = DOMAIN_IDS.map((id) => layout[id]);

    expect(core).toEqual([0, 0, 0]);
    expect(domainPositions.every((position) => position !== core)).toBe(true);
    expect(new Set(domainPositions.map((position) => position.join(','))).size).toBe(
      domainPositions.length,
    );
  });

  it('refuses to mirror domains into tidy pairs', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);
    const positions = DOMAIN_IDS.map((id) => layout[id]);

    for (const position of positions) {
      const mirrored = positions.find(
        (candidate) =>
          Math.abs(candidate[0] + position[0]) < 0.25 &&
          Math.abs(candidate[1] + position[1]) < 0.25 &&
          Math.abs(candidate[2] + position[2]) < 0.25,
      );
      expect(mirrored).toBeUndefined();
    }
  });

  it('spreads domains through depth so the scene has a near and a far side', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);
    const depths = DOMAIN_IDS.map((id) => layout[id][2]);

    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(1.5);
    // A near-side domain and a far-side domain, relative to the Core's plane.
    expect(depths.filter((depth) => depth > 0.3).length).toBeGreaterThanOrEqual(2);
    expect(depths.filter((depth) => depth < -0.3).length).toBeGreaterThanOrEqual(2);
  });

  it('varies domain distance so they are not parked on one sphere', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);
    const radii = DOMAIN_IDS.map((id) => {
      const position = layout[id];
      return Math.hypot(position[0], position[1], position[2]);
    });

    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.6);
  });

  it('holds GRAPHICS to the left of the Core for the focus reframe', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);

    expect(layout.graphics[0]).toBeLessThan(-2.5);
    // And clearly further left than every other domain.
    for (const id of DOMAIN_IDS.filter((candidate) => candidate !== 'graphics')) {
      expect(layout.graphics[0]).toBeLessThan(layout[id][0]);
    }
  });

  it('throws rather than placing a node the manifest forgot', () => {
    const incomplete = {
      ...GRAPH_MANIFEST,
      nodes: [
        ...GRAPH_MANIFEST.nodes,
        {
          id: 'systems' as const,
          label: 'SYSTEMS',
          description: 'duplicate',
          kind: 'domain' as const,
          parentId: 'core' as const,
          importance: 1,
        },
        { ...GRAPH_MANIFEST.nodes[0]!, id: 'unknown-domain' as GraphNodeId },
      ],
    };

    expect(() => deriveGraphLayout(incomplete)).toThrow(/unknown-domain/);
  });
});

describe('deriveGraphProminence', () => {
  it('ranks the Core first and keeps every value a bounded unit', () => {
    const prominence = deriveGraphProminence(GRAPH_MANIFEST);

    expect(prominence.core).toBe(1);
    for (const id of ['core', ...DOMAIN_IDS] as const) {
      expect(prominence[id]).toBeGreaterThanOrEqual(0);
      expect(prominence[id]).toBeLessThanOrEqual(1);
    }
  });

  it('leaves exactly two domains dormant, so idle spends three names', () => {
    const prominence = deriveGraphProminence(GRAPH_MANIFEST);
    const named = DOMAIN_IDS.filter((id) => prominence[id] >= NAMED_DOMAIN_PROMINENCE);

    // The brief's "never all labels at once" is enforced here rather than in the
    // view: text is a budget the composition spends, and this is the budget.
    expect(named.length).toBe(3);
    expect(named).toContain('graphics');
  });

  it('holds the dormant domains above the noise floor', () => {
    const prominence = deriveGraphProminence(GRAPH_MANIFEST);
    const dormant = DOMAIN_IDS.filter((id) => prominence[id] < NAMED_DOMAIN_PROMINENCE);

    for (const id of dormant) {
      // Presence multiplies the whole response, so a dormant domain's rendered
      // luminance is roughly `prominence * tier colour`. Below about a fifth the
      // body drops under the background's own noise and only the brightest edge
      // of a member survives — which is a silhouette that has stopped being
      // whole, and reads as a scratch rather than as a machine in the depth.
      expect(prominence[id]).toBeGreaterThan(0.2);
    }
  });

  it('gives every domain a distinct ranking rather than a shared level', () => {
    const prominence = deriveGraphProminence(GRAPH_MANIFEST);
    const levels = DOMAIN_IDS.map((id) => prominence[id]);

    expect(new Set(levels).size).toBe(levels.length);
  });

  it('throws rather than rendering a domain at zero presence', () => {
    const incomplete = {
      ...GRAPH_MANIFEST,
      nodes: [
        ...GRAPH_MANIFEST.nodes,
        { ...GRAPH_MANIFEST.nodes[0]!, id: 'unknown-domain' as GraphNodeId },
      ],
    };

    expect(() => deriveGraphProminence(incomplete)).toThrow(/unknown-domain/);
  });
});