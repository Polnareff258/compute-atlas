import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';
import type { CoreVisualInput } from './coreTypes';
import { deriveCoreTopology, deriveCoreTopologyActivation } from './coreTopology';

describe('deriveCoreTopology', () => {
  const parameters = getCoreParameters('ultra');

  function inputFor(visualState: CoreVisualInput['visualState']): CoreVisualInput {
    return {
      pointerX: 0.35,
      pointerY: -0.2,
      focusX: 0.8,
      focusY: 0.1,
      focusZ: -0.4,
      intensity: 0.72,
      visualState,
      reducedMotion: false,
    };
  }

  it('produces the same topology for equal inputs', () => {
    const first = deriveCoreTopology(parameters, 17);
    const second = deriveCoreTopology(parameters, 17);

    expect(first).toEqual(second);
    expect(first.nodes[0]?.position).not.toBe(second.nodes[0]?.position);
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
    const edgeIds = topology.edges.map((edge) => edge.id);

    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);

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
    expect(safe.nodes.some((node) => node.region === 'route')).toBe(true);
    expect(safe.edges.length).toBeGreaterThan(0);
  });

  it('does not exceed zero or low node and edge budgets', () => {
    const zero = deriveCoreTopology({ topologyNodeBudget: 0, topologyEdgeBudget: 0 }, 17);
    const low = deriveCoreTopology({ topologyNodeBudget: 2, topologyEdgeBudget: 1 }, 17);

    expect(zero.nodes).toEqual([]);
    expect(zero.edges).toEqual([]);
    expect(low.nodes.length).toBeLessThanOrEqual(2);
    expect(low.edges.length).toBeLessThanOrEqual(1);
    expect(low.edges.every((edge) => edge.source !== edge.target)).toBe(true);
  });

  it('changes non-core fixed positions for different seeds', () => {
    const first = deriveCoreTopology(parameters, 17);
    const second = deriveCoreTopology(parameters, 91);

    expect(first.nodes[0]?.position).toEqual([0, 0, 0]);
    expect(second.nodes[0]?.position).toEqual([0, 0, 0]);
    expect(first.nodes[1]?.position).not.toEqual(second.nodes[1]?.position);
  });

  it('connects nodes beyond the fixed catalog when budgets allow them', () => {
    const topology = deriveCoreTopology({ topologyNodeBudget: 16, topologyEdgeBudget: 24 }, 17);
    const extendedNodeIds = new Set(topology.nodes.filter((node) => node.id >= 10).map((node) => node.id));
    const connectedExtendedIds = new Set(
      topology.edges.flatMap((edge) =>
        extendedNodeIds.has(edge.source) || extendedNodeIds.has(edge.target)
          ? [edge.source, edge.target]
          : [],
      ),
    );

    expect(topology.nodes.length).toBe(16);
    expect(connectedExtendedIds.size).toBeGreaterThan(0);
    expect(topology.edges.length).toBeLessThanOrEqual(24);
  });

  it('does not arrange non-anchor positions as mirrored opposite pairs', () => {
    const tolerance = 0.08;
    const mirroredPairs: string[] = [];

    for (const seed of [17, 91, 401]) {
      const nonAnchorNodes = deriveCoreTopology(parameters, seed).nodes.filter(
        (node) => node.region !== 'anchor',
      );

      for (let firstIndex = 0; firstIndex < nonAnchorNodes.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < nonAnchorNodes.length; secondIndex += 1) {
          const first = nonAnchorNodes[firstIndex]?.position;
          const second = nonAnchorNodes[secondIndex]?.position;

          if (
            first &&
            second &&
            first.every((value, axis) => Math.abs(value + (second[axis] ?? 0)) < tolerance)
          ) {
            mirroredPairs.push(
              seed + ':' + nonAnchorNodes[firstIndex]?.id + '/' + nonAnchorNodes[secondIndex]?.id,
            );
          }
        }
      }
    }

    expect(mirroredPairs).toEqual([]);
  });

  it('keeps spatial structure measurably asymmetric across elevation and depth', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const elevations = new Set(topology.nodes.map((node) => node.position[1].toFixed(3)));
    const depths = new Set(topology.nodes.map((node) => node.position[2].toFixed(3)));

    expect(elevations.size).toBeGreaterThan(2);
    expect(depths.size).toBeGreaterThan(2);
    expect(topology.nodes.some((node) => node.position[1] > 0.5)).toBe(true);
    expect(topology.nodes.some((node) => node.position[1] < -0.5)).toBe(true);
    expect(topology.nodes.some((node) => node.position[2] > 0.5)).toBe(true);
    expect(topology.nodes.some((node) => node.position[2] < -0.5)).toBe(true);
  });
  it('activates a sparse baseline while idle', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('idle'));

    expect(activation.activeEdgeIds).toEqual([0]);
    expect(activation.activeNodeIds).toEqual([0, 1]);
  });

  it('activates a local branch for hover response', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('hover_response'));
    const activeEdges = topology.edges.filter((edge) => activation.activeEdgeIds.includes(edge.id));

    expect(activeEdges.length).toBeGreaterThan(0);
    expect(activeEdges.every((edge) => edge.route === 'local')).toBe(true);
    expect(activation.activeEdgeIds).not.toEqual(
      deriveCoreTopologyActivation(topology, inputFor('idle')).activeEdgeIds,
    );
  });

  it('activates a directional route while focusing', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('focusing'));
    const activeEdges = topology.edges.filter((edge) => activation.activeEdgeIds.includes(edge.id));

    expect(activeEdges.length).toBeGreaterThan(0);
    expect(activeEdges.every((edge) => edge.route === 'directional')).toBe(true);
    expect(activation.activeEdgeIds).not.toEqual(
      deriveCoreTopologyActivation(topology, inputFor('hover_response')).activeEdgeIds,
    );
  });

  it('activates more than one route during agent activity', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('agent_activity'));
    const activeEdges = topology.edges.filter((edge) => activation.activeEdgeIds.includes(edge.id));

    expect(new Set(activeEdges.map((edge) => edge.route)).size).toBeGreaterThan(1);
    expect(activation.activeEdgeIds).not.toEqual(
      deriveCoreTopologyActivation(topology, inputFor('focusing')).activeEdgeIds,
    );
  });
});
