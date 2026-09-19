import { describe, expect, it } from 'vitest';

import { GRAPH_MANIFEST } from './graphManifest';
import { deriveGraphLayout, deriveGraphEdgePoints } from './layout';

describe('deriveGraphLayout', () => {
  it('returns the same finite positions for the same manifest', () => {
    const first = deriveGraphLayout(GRAPH_MANIFEST);
    const second = deriveGraphLayout(GRAPH_MANIFEST);

    expect(first).toEqual(second);
    for (const position of Object.values(first)) {
      expect(position.every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps core centered and domain nodes spatially separated', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);
    const core = layout.core;
    const domainPositions = GRAPH_MANIFEST.nodes
      .filter((node) => node.id !== 'core')
      .map((node) => layout[node.id]);

    expect(core).toEqual([0, 0, 0]);
    expect(domainPositions.every((position) => position !== core)).toBe(true);
    expect(new Set(domainPositions.map((position) => position.join(','))).size).toBe(
      domainPositions.length,
    );
  });

  it('uses graph density only for deterministic edge detail', () => {
    const layout = deriveGraphLayout(GRAPH_MANIFEST);
    const edge = GRAPH_MANIFEST.edges[0];
    if (!edge) {
      throw new Error('Expected a graph edge');
    }

    const low = deriveGraphEdgePoints(edge, layout, 0.4);
    const high = deriveGraphEdgePoints(edge, layout, 1);

    expect(low[0]).toEqual(layout[edge.source]);
    expect(low.at(-1)).toEqual(layout[edge.target]);
    expect(high.length).toBeGreaterThan(low.length);
    const midpoint = low[Math.floor(low.length / 2)];
    expect(midpoint).toBeDefined();
    expect(midpoint?.[1]).not.toBeCloseTo(
      (layout[edge.source][1] + layout[edge.target][1]) / 2,
      2,
    );
    expect(Math.max(...Object.values(layout).map((position) => position[2])) -
      Math.min(...Object.values(layout).map((position) => position[2]))).toBeGreaterThan(1.5);
  });
});
