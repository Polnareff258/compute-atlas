import { describe, expect, it } from 'vitest';

import { GRAPH_MANIFEST } from './graphManifest';
import { deriveGraphLayout } from './layout';
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