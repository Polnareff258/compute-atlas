import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';
import { deriveCoreTopology } from './coreTopology';

describe('deriveCoreTopology', () => {
  const parameters = getCoreParameters('ultra');

  it('produces the same topology for equal inputs', () => {
    const first = deriveCoreTopology(parameters, 17);
    const second = deriveCoreTopology(parameters, 17);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps positions and weights finite', () => {
    const topology = deriveCoreTopology(parameters, 17);

    for (const node of topology.nodes) {
      expect(node.position).toHaveLength(3);
      expect(node.position.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(node.weight)).toBe(true);
    }

    for (const edge of topology.edges) {
      expect(Number.isFinite(edge.activationRank)).toBe(true);
    }
  });

  it('uses unique node ids and valid, non-self edge indices', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const nodeIds = topology.nodes.map((node) => node.id);

    expect(new Set(nodeIds).size).toBe(nodeIds.length);

    for (const edge of topology.edges) {
      expect(nodeIds).toContain(edge.source);
      expect(nodeIds).toContain(edge.target);
      expect(edge.source).not.toBe(edge.target);
    }
  });

  it('respects the topology budgets', () => {
    const topology = deriveCoreTopology(parameters, 17);

    expect(topology.nodes.length).toBeLessThanOrEqual(parameters.topologyNodeBudget);
    expect(topology.edges.length).toBeLessThanOrEqual(parameters.topologyEdgeBudget);
  });

  it('keeps an anchor, satellites, routes, and intentional negative space', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const regions = new Set(topology.nodes.map((node) => node.region));

    expect(regions).toContain('anchor');
    expect(regions).toContain('satellite');
    expect(regions).toContain('route');

    const completeGraphEdgeCount = (topology.nodes.length * (topology.nodes.length - 1)) / 2;
    expect(topology.edges.length).toBeLessThan(completeGraphEdgeCount);

    const degrees = new Map(topology.nodes.map((node) => [node.id, 0]));
    for (const edge of topology.edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
    }
    expect(Math.max(...degrees.values())).toBeLessThan(topology.nodes.length - 1);

    const positions = topology.nodes.map((node) => node.position);
    expect(new Set(positions.map((position) => position.join(','))).size).toBe(positions.length);
  });

  it('keeps SAFE topology semantic rather than removing it', () => {
    const safe = deriveCoreTopology(getCoreParameters('safe'), 17);

    expect(safe.nodes.some((node) => node.region === 'anchor')).toBe(true);
    expect(safe.nodes.some((node) => node.region === 'satellite')).toBe(true);
    expect(safe.edges.length).toBeGreaterThan(0);
  });
});
