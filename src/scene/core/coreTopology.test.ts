import { describe, expect, it, vi } from 'vitest';

import { getCoreParameters } from './coreParameters';
import type { CoreVisualInput } from './coreTypes';
import { deriveCoreTopology, deriveCoreTopologyActivation } from './coreTopology';
import type * as TopologyView from './CoreTopologyView';
import { createFragmentResources, disposeFragmentResources, updateFragmentResources } from './CoreFragments';
import type { CoreTopology } from './coreTopology';
import { createResourceLease } from './coreResourceLifecycle';

const { createTopologyResources, disposeTopologyResources, updateTopologyResources } =
  await vi.importActual<typeof TopologyView>('./CoreTopologyView');

describe('structural resource lease', () => {
  it('cancels retirement across setup-cleanup-setup, then disposes once on unmount', async () => {
    const resources = createFragmentResources(structuralFixture);
    let releases = 0;
    resources.geometry.addEventListener('dispose', () => { releases += 1; });
    const lease = createResourceLease(() => disposeFragmentResources(resources));
    const firstCleanup = lease.retain();
    firstCleanup();
    expect(releases).toBe(0);
    const finalCleanup = lease.retain();
    await Promise.resolve();
    expect(releases).toBe(0);
    finalCleanup();
    finalCleanup();
    await Promise.resolve();
    expect(releases).toBe(1);
    expect(() => lease.retain()).toThrow();
  });

  it('retires the old topology independently of the replacement', async () => {
    const released: string[] = [];
    const oldLease = createResourceLease(() => released.push('old'));
    const nextLease = createResourceLease(() => released.push('next'));
    const oldCleanup = oldLease.retain();
    oldCleanup();
    const nextCleanup = nextLease.retain();
    expect(released).toEqual([]);
    await Promise.resolve();
    expect(released).toEqual(['old']);
    nextCleanup();
    await Promise.resolve();
    expect(released).toEqual(['old', 'next']);
  });

  it('keeps resources alive until the last lease releases, ignoring stale cleanups', async () => {
    let releases = 0;
    const lease = createResourceLease(() => { releases += 1; });
    const firstCleanup = lease.retain();
    const secondCleanup = lease.retain();
    firstCleanup();
    firstCleanup();
    await Promise.resolve();
    expect(releases).toBe(0);
    secondCleanup();
    const replayCleanup = lease.retain();
    replayCleanup();
    await Promise.resolve();
    expect(releases).toBe(1);
  });
});

const structuralFixture: CoreTopology = {
  nodes: [
    { id: 10, position: [0, 0, 0], scale: [1, 1, 1], weight: 1, depthBand: 0, region: 'anchor' },
    { id: 20, position: [1, 2, 3], scale: [1, 0.5, 0.4], weight: 0.8, depthBand: 0.2, region: 'primary' },
    { id: 30, position: [-2, -1, -3], scale: [0.8, 0.4, 0.3], weight: 0.6, depthBand: 0.4, region: 'secondary' },
  ],
  edges: [
    { id: 100, source: 10, target: 20, activationRank: 0, importance: 1, route: 'primary' },
    { id: 200, source: 20, target: 30, activationRank: 1, importance: 0.7, route: 'secondary' },
    { id: 300, source: 30, target: 10, activationRank: 2, importance: 0.4, route: 'ambient' },
  ],
};

describe('structural resource contract', () => {
  it('preallocates instance colors and retains buffers while active membership shrinks', () => {
    const resources = createTopologyResources(structuralFixture);
    const colors = resources.nodeMesh.instanceColor;
    const positions = resources.secondaryPositionAttribute.array;
    const visualInput = {
      pointerX: 0, pointerY: 0, focusX: 0, focusY: 0, focusZ: 0,
      intensity: 0.4, reducedMotion: false,
    } as const;
    const idle = deriveCoreTopologyActivation(structuralFixture, { ...visualInput, visualState: 'idle' });
    const focus = deriveCoreTopologyActivation(structuralFixture, { ...visualInput, visualState: 'focusing' });
    const dormant = deriveCoreTopologyActivation(structuralFixture, { ...visualInput, visualState: 'dormant' });
    try {
      expect(colors).not.toBeNull();
      expect(colors?.count).toBe(3);
      updateTopologyResources(resources, idle, false);
      expect(resources.primaryMesh.count).toBe(1);
      expect(resources.secondaryGeometry.drawRange.count).toBe(2);
      expect(resources.ambientGeometry.drawRange.count).toBe(2);
      expect(resources.nodeMesh.count).toBe(3);
      updateTopologyResources(resources, focus, true);
      expect(resources.primaryMesh.count).toBe(0);
      expect(resources.secondaryGeometry.drawRange.count).toBe(2);
      expect(resources.nodeMesh.count).toBe(2);
      expect(Array.from(positions.slice(0, 6))).toEqual([1, 2, 3, -2, -1, -3]);
      expect(Array.from(resources.nodeMesh.instanceMatrix.array.slice(12, 15))).toEqual([1, 2, 3]);
      expect(resources.nodeMesh.instanceColor).toBe(colors);
      expect(resources.secondaryPositionAttribute.array).toBe(positions);
      updateTopologyResources(resources, dormant, false);
      expect(resources.secondaryGeometry.drawRange.count).toBe(0);
      expect(resources.nodeMesh.count).toBe(0);
    } finally {
      disposeTopologyResources(resources);
    }
  });

  it('reuses fragment storage and hides all inactive membranes, including stale buffer tails', () => {
    const resources = createFragmentResources(structuralFixture);
    const positions = resources.positionAttribute.array;
    try {
      updateFragmentResources(resources, [10, 20, 30], false);
      expect(resources.geometry.drawRange.count).toBe(12);
      updateFragmentResources(resources, [20], true);
      expect(resources.geometry.drawRange.count).toBe(6);
      expect(positions[0]).toBeCloseTo(1.115);
      expect(resources.positionAttribute.array).toBe(positions);
      updateFragmentResources(resources, [10], false);
      expect(resources.geometry.drawRange.count).toBe(0);
    } finally {
      disposeFragmentResources(resources);
    }
  });

  it('attempts every topology disposal even when the first resource throws', () => {
    const resources = createTopologyResources(structuralFixture);
    const released: string[] = [];
    resources.primaryMesh.addEventListener('dispose', () => { throw new Error('release failed'); });
    resources.primaryGeometry.addEventListener('dispose', () => released.push('primary geometry'));
    resources.primaryMaterial.addEventListener('dispose', () => released.push('primary material'));
    resources.secondaryGeometry.addEventListener('dispose', () => released.push('secondary geometry'));
    resources.secondaryMaterial.addEventListener('dispose', () => released.push('secondary material'));
    resources.ambientGeometry.addEventListener('dispose', () => released.push('ambient geometry'));
    resources.signalGeometry.addEventListener('dispose', () => released.push('signal geometry'));
    resources.nodeMesh.addEventListener('dispose', () => released.push('instances'));
    resources.nodeGeometry.addEventListener('dispose', () => released.push('node geometry'));
    resources.nodeMaterial.addEventListener('dispose', () => released.push('node material'));
    expect(() => disposeTopologyResources(resources)).toThrow();
    expect(released).toEqual([
      'primary geometry', 'primary material', 'secondary geometry', 'secondary material',
      'ambient geometry', 'signal geometry', 'instances', 'node geometry', 'node material',
    ]);
  });

  it('still releases the fragment material after geometry disposal throws', () => {
    const resources = createFragmentResources(structuralFixture);
    let materialReleased = false;
    resources.geometry.addEventListener('dispose', () => { throw new Error('release failed'); });
    resources.material.addEventListener('dispose', () => { materialReleased = true; });
    expect(() => disposeFragmentResources(resources)).toThrow();
    expect(materialReleased).toBe(true);
  });

  it.each([
    ['dormant', [], []],
    ['idle', [100, 200, 300], [10, 20, 30]],
    ['awakening', [100, 200], [10, 20, 30]],
    ['hover_response', [100], [10, 20]],
    ['focusing', [200], [20, 30]],
    ['agent_activity', [100, 200, 300], [10, 20, 30]],
  ] as const)('uses only selected edge endpoints for %s', (visualState, edges, nodes) => {
    const activation = deriveCoreTopologyActivation(structuralFixture, {
      visualState, pointerX: 1, pointerY: 0, focusX: -1, focusY: 0, focusZ: 0,
      intensity: 1, reducedMotion: false,
    });
    expect(activation.activeEdgeIds).toEqual(edges);
    expect(activation.activeNodeIds).toEqual(nodes);
  });
});

describe('deriveCoreTopology', () => {
  const parameters = getCoreParameters('ultra');

  it('exposes a massed machine hierarchy with explicit route classes and depth bands', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const nodes = topology.nodes as readonly (typeof topology.nodes[number] & {
      readonly scale?: readonly [number, number, number];
      readonly depthBand?: number;
    })[];
    const edges = topology.edges as readonly (typeof topology.edges[number] & {
      readonly importance?: number;
    })[];

    expect(new Set(nodes.map((node) => node.region))).toEqual(
      new Set(['anchor', 'primary', 'secondary', 'route', 'foreground']),
    );
    expect(nodes.every((node) => node.scale?.every(Number.isFinite))).toBe(true);
    expect(nodes.every((node) => Number.isFinite(node.depthBand))).toBe(true);
    expect(new Set(edges.map((edge) => edge.route))).toEqual(
      new Set(['primary', 'secondary', 'ambient', 'signal']),
    );
    expect(edges.filter((edge) => edge.route === 'primary').length).toBeGreaterThanOrEqual(2);
    expect(edges.every((edge) => Number.isFinite(edge.importance))).toBe(true);
  });

  it('renders primary members as a bounded instanced group and keeps support routes separate', () => {
    const resources = createTopologyResources(structuralFixture);
    const activation = deriveCoreTopologyActivation(structuralFixture, {
      visualState: 'idle', pointerX: 0, pointerY: 0, focusX: 0, focusY: 0, focusZ: 0,
      intensity: 0.4, reducedMotion: false,
    });

    try {
      updateTopologyResources(resources, activation, false);
      expect(resources.primaryMesh.count).toBe(1);
      expect(resources.secondaryGeometry.drawRange.count).toBe(2);
      expect(resources.ambientGeometry.drawRange.count).toBe(2);
      expect(resources.signalGeometry.drawRange.count).toBe(0);
    } finally {
      disposeTopologyResources(resources);
    }
  });

  it('separates primary, secondary and ambient activation memberships', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, {
      pointerX: 0.35,
      pointerY: -0.2,
      focusX: 0.8,
      focusY: 0.1,
      focusZ: -0.4,
      intensity: 0.72,
      visualState: 'idle',
      reducedMotion: false,
    });

    expect(activation.primaryEdgeIds.length).toBeGreaterThan(0);
    expect(activation.activeEdgeIds).toEqual(expect.arrayContaining([...activation.primaryEdgeIds]));
    expect(activation.activeEdgeIds).toEqual(expect.arrayContaining([...activation.secondaryEdgeIds]));
    expect(activation.activeEdgeIds).toEqual(expect.arrayContaining([...activation.ambientEdgeIds]));
  });

  function inputFor(
    visualState: CoreVisualInput['visualState'],
    overrides: Omit<Partial<CoreVisualInput>, 'visualState'> = {},
  ): CoreVisualInput {
    return {
      pointerX: 0.35,
      pointerY: -0.2,
      focusX: 0.8,
      focusY: 0.1,
      focusZ: -0.4,
      intensity: 0.72,
      reducedMotion: false,
      ...overrides,
      visualState,
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

  it('keeps an anchor, processing regions, routes, and intentional negative space', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const regions = new Set(topology.nodes.map((node) => node.region));

    expect(regions).toContain('anchor');
    expect(regions).toContain('primary');
    expect(regions).toContain('secondary');
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
    expect(safe.nodes.some((node) => node.region === 'primary')).toBe(true);
    expect(safe.nodes.some((node) => node.region === 'secondary')).toBe(true);
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
  it('activates a readable primary baseline with supporting routes while idle', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('idle'));

    expect(activation.primaryEdgeIds.length).toBeGreaterThan(0);
    expect(activation.activeEdgeIds).toEqual(expect.arrayContaining([...activation.primaryEdgeIds]));
    expect(activation.secondaryEdgeIds.length).toBeGreaterThan(0);
  });

  it('activates a primary branch for hover response', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('hover_response'));
    const activeEdges = topology.edges.filter((edge) => activation.activeEdgeIds.includes(edge.id));

    expect(activeEdges.length).toBeGreaterThan(0);
    expect(activeEdges.every((edge) => edge.route === 'primary')).toBe(true);
    expect(activation.activeEdgeIds).not.toEqual(
      deriveCoreTopologyActivation(topology, inputFor('idle')).activeEdgeIds,
    );
  });

  it('activates a secondary route while focusing', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const activation = deriveCoreTopologyActivation(topology, inputFor('focusing'));
    const activeEdges = topology.edges.filter((edge) => activation.activeEdgeIds.includes(edge.id));

    expect(activeEdges.length).toBeGreaterThan(0);
    expect(activeEdges.every((edge) => edge.route === 'secondary')).toBe(true);
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
  it('changes active node membership when the active route changes', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const idle = deriveCoreTopologyActivation(topology, inputFor('idle'));
    const hover = deriveCoreTopologyActivation(
      topology,
      inputFor('hover_response', { pointerX: 1, pointerY: 0 }),
    );

    expect(hover.activeNodeIds).not.toEqual(idle.activeNodeIds);
    expect(new Set(hover.activeEdgeIds).size).toBe(hover.activeEdgeIds.length);
  });

  it('selects different local edges for materially different pointer vectors', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const left = deriveCoreTopologyActivation(
      topology,
      inputFor('hover_response', { pointerX: -1, pointerY: 0 }),
    );
    const right = deriveCoreTopologyActivation(
      topology,
      inputFor('hover_response', { pointerX: 1, pointerY: 0 }),
    );

    expect(left.activeEdgeIds).not.toEqual(right.activeEdgeIds);
    expect(
      topology.edges.find((edge) => edge.id === left.activeEdgeIds[0])?.route,
    ).toBe('primary');
    expect(
      topology.edges.find((edge) => edge.id === right.activeEdgeIds[0])?.route,
    ).toBe('primary');
  });

  it('selects different directional edges for materially different focus vectors', () => {
    const topology = deriveCoreTopology(parameters, 17);
    const left = deriveCoreTopologyActivation(
      topology,
      inputFor('focusing', { focusX: -1, focusY: 0, focusZ: 0 }),
    );
    const right = deriveCoreTopologyActivation(
      topology,
      inputFor('focusing', { focusX: 1, focusY: 0, focusZ: 0 }),
    );

    expect(left.activeEdgeIds).not.toEqual(right.activeEdgeIds);
    expect(
      topology.edges.find((edge) => edge.id === left.activeEdgeIds[0])?.route,
    ).toBe('secondary');
    expect(
      topology.edges.find((edge) => edge.id === right.activeEdgeIds[0])?.route,
    ).toBe('secondary');
  });
});
