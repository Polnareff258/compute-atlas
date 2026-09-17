import { describe, expect, it } from 'vitest';

import { GRAPH_MANIFEST } from './graphManifest';
import type { GraphNodeId } from './types';

const EXPECTED_NODE_IDS: readonly GraphNodeId[] = [
  'core',
  'ai',
  'graphics',
  'game-analysis',
  'systems',
  'research',
];

describe('GRAPH_MANIFEST', () => {
  it('defines exactly one stable semantic node for every Phase 1 graph id', () => {
    const nodeIds = GRAPH_MANIFEST.nodes.map((node) => node.id);

    expect(nodeIds).toEqual(EXPECTED_NODE_IDS);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it('keeps the first topology as a small star rooted at core', () => {
    const nodeIds = new Set(GRAPH_MANIFEST.nodes.map((node) => node.id));

    expect(GRAPH_MANIFEST.edges).toHaveLength(5);
    for (const edge of GRAPH_MANIFEST.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
      expect(edge.source).not.toBe(edge.target);
      expect(edge.source).toBe('core');
    }
  });

  it('is JSON serializable without losing graph semantics', () => {
    const serialized = JSON.stringify(GRAPH_MANIFEST);
    const parsed: unknown = JSON.parse(serialized);

    expect(parsed).toEqual(GRAPH_MANIFEST);
  });
});
