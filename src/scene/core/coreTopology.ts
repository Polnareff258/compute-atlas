import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreTopologyNode = {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly weight: number;
  readonly region: 'anchor' | 'satellite' | 'route';
};

export type CoreTopologyEdge = {
  readonly id: number;
  readonly source: number;
  readonly target: number;
  readonly activationRank: number;
  readonly route: 'local' | 'directional' | 'signal';
};

export type CoreTopology = {
  readonly nodes: readonly CoreTopologyNode[];
  readonly edges: readonly CoreTopologyEdge[];
};

type Region = CoreTopologyNode['region'];

const ANCHOR_POSITIONS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
];

const SATELLITE_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-0.82, 0.3, 0.28],
  [1.28, -0.68, -0.56],
];

const ROUTE_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-1.54, -0.5, 0.78],
  [0.74, 1.12, 0.62],
  [-0.34, -1.24, -0.9],
  [1.68, 0.74, 0.18],
  [-1.86, 0.76, -0.42],
  [0.16, 1.8, -0.76],
  [1.9, -1.04, 0.86],
  [-1.2, -1.68, 0.3],
];

const EDGE_CANDIDATES: readonly {
  readonly source: number;
  readonly target: number;
  readonly route: CoreTopologyEdge['route'];
  readonly activationRank: number;
}[] = [
  { source: 0, target: 1, route: 'local', activationRank: 0 },
  { source: 0, target: 2, route: 'directional', activationRank: 1 },
  { source: 1, target: 3, route: 'directional', activationRank: 2 },
  { source: 0, target: 4, route: 'signal', activationRank: 3 },
  { source: 2, target: 5, route: 'local', activationRank: 4 },
  { source: 3, target: 6, route: 'signal', activationRank: 5 },
  { source: 1, target: 4, route: 'directional', activationRank: 6 },
  { source: 5, target: 7, route: 'signal', activationRank: 7 },
  { source: 4, target: 8, route: 'directional', activationRank: 8 },
  { source: 3, target: 9, route: 'local', activationRank: 9 },
];

function hash(seed: number, index: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x45d9f3b)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function unitInterval(seed: number, index: number): number {
  return hash(seed, index) / 0x100000000;
}

function safeBudget(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function regionFor(index: number): Region {
  if (index < ANCHOR_POSITIONS.length) {
    return 'anchor';
  }

  if (index < ANCHOR_POSITIONS.length + SATELLITE_POSITIONS.length) {
    return 'satellite';
  }

  return 'route';
}

function positionFor(index: number, seed: number): readonly [number, number, number] {
  const fixedPosition = [
    ...ANCHOR_POSITIONS,
    ...SATELLITE_POSITIONS,
    ...ROUTE_POSITIONS,
  ][index];

  if (fixedPosition) {
    if (index === 0) {
      return [0, 0, 0];
    }

    const scale = 0.97 + unitInterval(seed, index + 121) * 0.06;
    const offsetX = (unitInterval(seed, index + 151) - 0.5) * 0.14;
    const offsetY = (unitInterval(seed, index + 181) - 0.5) * 0.18;
    const offsetZ = (unitInterval(seed, index + 211) - 0.5) * 0.14;

    return [
      fixedPosition[0] * scale + offsetX,
      fixedPosition[1] * scale + offsetY,
      fixedPosition[2] * scale + offsetZ,
    ];
  }

  const angle = (index + 1) * 2.399963229728653 + unitInterval(seed, index) * 0.38;
  const radius = 1.25 + unitInterval(seed, index + 31) * 0.95;
  const elevation = (unitInterval(seed, index + 61) - 0.5) * 1.9;

  return [
    Math.cos(angle) * radius,
    elevation,
    Math.sin(angle) * radius,
  ];
}

function weightFor(index: number, seed: number, region: Region): number {
  const baseWeight = region === 'anchor' ? 1.25 : region === 'satellite' ? 0.86 : 0.52;
  return baseWeight + unitInterval(seed, index + 91) * (region === 'anchor' ? 0.28 : 0.22);
}

function routeFor(seed: number, index: number): CoreTopologyEdge['route'] {
  const routeIndex = Math.floor(unitInterval(seed, index + 271) * 3);
  return routeIndex === 0 ? 'local' : routeIndex === 1 ? 'directional' : 'signal';
}

function deriveEdgeCandidates(nodeCount: number, seed: number): readonly {
  readonly source: number;
  readonly target: number;
  readonly route: CoreTopologyEdge['route'];
  readonly activationRank: number;
}[] {
  const fixedNodeCount =
    ANCHOR_POSITIONS.length + SATELLITE_POSITIONS.length + ROUTE_POSITIONS.length;
  const candidates = EDGE_CANDIDATES.filter(
    ({ source, target }) => source < nodeCount && target < nodeCount,
  ).map((candidate) => ({ ...candidate }));

  for (let target = fixedNodeCount; target < nodeCount; target += 1) {
    const source = Math.floor(unitInterval(seed, target + 301) * target);
    candidates.push({
      source,
      target,
      route: routeFor(seed, target),
      activationRank: candidates.length,
    });
  }

  return candidates;
}

export function deriveCoreTopology(
  parameters: Pick<CoreParameters, 'topologyNodeBudget' | 'topologyEdgeBudget'>,
  seed = 17,
): CoreTopology {
  const nodeCount = safeBudget(parameters.topologyNodeBudget);
  const nodes = Array.from({ length: nodeCount }, (_, id): CoreTopologyNode => {
    const region = regionFor(id);
    const position = positionFor(id, seed);

    return {
      id,
      position,
      weight: weightFor(id, seed, region),
      region,
    };
  });

  const edges = deriveEdgeCandidates(nodeCount, seed)
    .slice(0, safeBudget(parameters.topologyEdgeBudget))
    .map(({ source, target, route, activationRank }, id): CoreTopologyEdge => ({
      id,
      source,
      target,
      activationRank,
      route,
    }));

  return { nodes, edges };
}

export type CoreTopologyActivation = {
  readonly activeEdgeIds: readonly number[];
  readonly activeNodeIds: readonly number[];
};

type SpatialVector = readonly [number, number, number];

function spatialEdgeScore(
  edge: CoreTopologyEdge,
  topology: CoreTopology,
  vector: SpatialVector,
): number {
  const source = topology.nodes.find((node) => node.id === edge.source);
  const target = topology.nodes.find((node) => node.id === edge.target);
  if (!source || !target) {
    return Number.NEGATIVE_INFINITY;
  }

  const midpointX = (source.position[0] + target.position[0]) * 0.5;
  const midpointY = (source.position[1] + target.position[1]) * 0.5;
  const midpointZ = (source.position[2] + target.position[2]) * 0.5;
  const midpointLength = Math.hypot(midpointX, midpointY, midpointZ);
  const vectorLength = Math.hypot(vector[0], vector[1], vector[2]);

  if (midpointLength === 0 || vectorLength === 0) {
    return -edge.activationRank * 0.001;
  }

  const alignment =
    (midpointX * vector[0] + midpointY * vector[1] + midpointZ * vector[2]) /
    (midpointLength * vectorLength);

  return alignment * 4 - midpointLength * 0.025 - edge.activationRank * 0.0001;
}

function selectSpatialEdge(
  topology: CoreTopology,
  route: CoreTopologyEdge['route'],
  vector: SpatialVector,
): CoreTopologyEdge | undefined {
  let selected: CoreTopologyEdge | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const edge of topology.edges) {
    if (edge.route !== route) {
      continue;
    }

    const score = spatialEdgeScore(edge, topology, vector);
    if (score > selectedScore) {
      selected = edge;
      selectedScore = score;
    }
  }

  return selected;
}
function nodeIdsFor(edges: readonly CoreTopologyEdge[]): readonly number[] {
  const nodeIds = new Set<number>();

  for (const edge of edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  return [...nodeIds];
}

/**
 * Selects a serializable structural subset for the Compute Core visual state.
 * It deliberately changes graph relationships between states rather than only
 * changing material properties in the view layer.
 */
export function deriveCoreTopologyActivation(
  topology: CoreTopology,
  visualInput: CoreVisualInput,
): CoreTopologyActivation {
  const edges = topology.edges;
  let activeEdges: readonly CoreTopologyEdge[];

  switch (visualInput.visualState) {
    case 'dormant':
      activeEdges = [];
      break;
    case 'awakening':
      activeEdges = edges.slice(0, 2);
      break;
    case 'hover_response': {
      const localEdge = selectSpatialEdge(
        topology,
        'local',
        [visualInput.pointerX, visualInput.pointerY, 0],
      );
      activeEdges = localEdge ? [localEdge] : edges.slice(0, 1);
      break;
    }
    case 'focusing': {
      const directionalEdge = selectSpatialEdge(
        topology,
        'directional',
        [visualInput.focusX, visualInput.focusY, visualInput.focusZ],
      );
      activeEdges = directionalEdge ? [directionalEdge] : edges.slice(0, 1);
      break;
    }
    case 'agent_activity': {
      const representativeEdges = [
        selectSpatialEdge(topology, 'local', [visualInput.pointerX, visualInput.pointerY, 0]),
        selectSpatialEdge(topology, 'directional', [visualInput.focusX, visualInput.focusY, visualInput.focusZ]),
        selectSpatialEdge(topology, 'signal', [visualInput.focusZ, visualInput.pointerX, visualInput.pointerY]),
      ].filter((edge): edge is CoreTopologyEdge => edge !== undefined);
      activeEdges = representativeEdges.length > 0 ? representativeEdges : edges.slice(0, 1);
      break;
    }
    case 'idle':
    default:
      activeEdges = edges.slice(0, 1);
      break;
  }

  return {
    activeEdgeIds: activeEdges.map((edge) => edge.id),
    activeNodeIds: nodeIdsFor(activeEdges),
  };
}
