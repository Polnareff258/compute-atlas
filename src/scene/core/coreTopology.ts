import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreTopologyRegion = 'anchor' | 'primary' | 'secondary' | 'route' | 'foreground';
export type CoreTopologyRoute = 'primary' | 'secondary' | 'ambient' | 'signal';

export type CoreTopologyNode = {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly weight: number;
  readonly region: CoreTopologyRegion;
  readonly depthBand: number;
};

export type CoreTopologyEdge = {
  readonly id: number;
  readonly source: number;
  readonly target: number;
  readonly activationRank: number;
  readonly route: CoreTopologyRoute;
  readonly importance: number;
};

export type CoreTopology = {
  readonly nodes: readonly CoreTopologyNode[];
  readonly edges: readonly CoreTopologyEdge[];
};

const ANCHOR_POSITIONS: readonly (readonly [number, number, number])[] = [[0, 0, 0]];
const PRIMARY_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-0.84, 0.08, 0.12], [0.06, 0.28, 0.2], [1.08, 0.16, 0.08],
];
const SECONDARY_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-0.82, -0.48, -0.28], [0.12, -0.62, 0.3], [1.02, -0.5, -0.32],
];
const ROUTE_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-1.68, 0.58, -0.38], [1.76, 0.52, 0.34], [0.12, 1.28, -0.58],
];
const FOREGROUND_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-1.02, -1.24, 0.58], [1.16, -1.16, 0.44],
];
const FIXED_POSITIONS = [
  ...ANCHOR_POSITIONS, ...PRIMARY_POSITIONS, ...SECONDARY_POSITIONS,
  ...ROUTE_POSITIONS, ...FOREGROUND_POSITIONS,
] as const;

const EDGE_CANDIDATES: readonly {
  readonly source: number;
  readonly target: number;
  readonly route: CoreTopologyRoute;
  readonly activationRank: number;
  readonly importance: number;
}[] = [
  { source: 0, target: 1, route: 'primary', activationRank: 0, importance: 1 },
  { source: 1, target: 2, route: 'primary', activationRank: 1, importance: 0.96 },
  { source: 2, target: 3, route: 'primary', activationRank: 2, importance: 0.92 },
  { source: 0, target: 4, route: 'secondary', activationRank: 3, importance: 0.76 },
  { source: 2, target: 5, route: 'secondary', activationRank: 4, importance: 0.7 },
  { source: 3, target: 6, route: 'secondary', activationRank: 5, importance: 0.66 },
  { source: 1, target: 7, route: 'ambient', activationRank: 6, importance: 0.34 },
  { source: 3, target: 8, route: 'ambient', activationRank: 7, importance: 0.3 },
  { source: 0, target: 9, route: 'ambient', activationRank: 8, importance: 0.26 },
  { source: 4, target: 10, route: 'signal', activationRank: 9, importance: 0.58 },
  { source: 6, target: 11, route: 'signal', activationRank: 10, importance: 0.54 },
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

function regionFor(index: number): CoreTopologyRegion {
  if (index < ANCHOR_POSITIONS.length) return 'anchor';
  if (index < ANCHOR_POSITIONS.length + PRIMARY_POSITIONS.length) return 'primary';
  if (index < ANCHOR_POSITIONS.length + PRIMARY_POSITIONS.length + SECONDARY_POSITIONS.length) return 'secondary';
  if (index < FIXED_POSITIONS.length - FOREGROUND_POSITIONS.length) return 'route';
  return 'foreground';
}

function depthBandFor(region: CoreTopologyRegion): number {
  switch (region) {
    case 'anchor': return 0;
    case 'primary': return 0.16;
    case 'secondary': return 0.3;
    case 'route': return 0.48;
    case 'foreground': return 0.68;
  }
}

function baseScaleFor(region: CoreTopologyRegion): readonly [number, number, number] {
  switch (region) {
    case 'anchor': return [1.28, 0.92, 0.72];
    case 'primary': return [0.92, 0.34, 0.28];
    case 'secondary': return [0.72, 0.28, 0.24];
    case 'route': return [0.42, 0.14, 0.14];
    case 'foreground': return [0.58, 0.1, 0.1];
  }
}

function positionFor(index: number, seed: number): readonly [number, number, number] {
  const fixedPosition = FIXED_POSITIONS[index];
  if (fixedPosition) {
    if (index === 0) return [0, 0, 0];
    const scale = 0.97 + unitInterval(seed, index + 121) * 0.06;
    return [
      fixedPosition[0] * scale + (unitInterval(seed, index + 151) - 0.5) * 0.1,
      fixedPosition[1] * scale + (unitInterval(seed, index + 181) - 0.5) * 0.12,
      fixedPosition[2] * scale + (unitInterval(seed, index + 211) - 0.5) * 0.1,
    ];
  }

  const angle = (index + 1) * 2.399963229728653 + unitInterval(seed, index) * 0.38;
  const radius = 1.35 + unitInterval(seed, index + 31) * 0.8;
  const elevation = (unitInterval(seed, index + 61) - 0.5) * 1.7;
  return [Math.cos(angle) * radius, elevation, Math.sin(angle) * radius];
}

function scaleFor(index: number, seed: number, region: CoreTopologyRegion): readonly [number, number, number] {
  const base = baseScaleFor(region);
  const variation = 0.94 + unitInterval(seed, index + 241) * 0.12;
  return [base[0] * variation, base[1] * variation, base[2] * variation];
}

function weightFor(index: number, seed: number, region: CoreTopologyRegion): number {
  const baseWeight = region === 'anchor' ? 1.3 : region === 'primary' ? 1 : region === 'secondary' ? 0.78 : 0.46;
  return baseWeight + unitInterval(seed, index + 91) * (region === 'anchor' ? 0.22 : 0.18);
}

function routeFor(seed: number, index: number): CoreTopologyRoute {
  const routeIndex = Math.floor(unitInterval(seed, index + 271) * 4);
  return routeIndex === 0 ? 'primary' : routeIndex === 1 ? 'secondary' : routeIndex === 2 ? 'ambient' : 'signal';
}

function deriveEdgeCandidates(nodeCount: number, seed: number): readonly {
  readonly source: number;
  readonly target: number;
  readonly route: CoreTopologyRoute;
  readonly activationRank: number;
  readonly importance: number;
}[] {
  const candidates = EDGE_CANDIDATES.filter(({ source, target }) => source < nodeCount && target < nodeCount)
    .map((candidate) => ({ ...candidate }));

  for (let target = FIXED_POSITIONS.length; target < nodeCount; target += 1) {
    const source = Math.floor(unitInterval(seed, target + 301) * target);
    const route = routeFor(seed, target);
    candidates.push({
      source, target, route, activationRank: candidates.length,
      importance: route === 'primary' ? 0.8 : route === 'secondary' ? 0.58 : 0.28,
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
    return {
      id, position: positionFor(id, seed), scale: scaleFor(id, seed, region),
      weight: weightFor(id, seed, region), region, depthBand: depthBandFor(region),
    };
  });
  const edges = deriveEdgeCandidates(nodeCount, seed)
    .slice(0, safeBudget(parameters.topologyEdgeBudget))
    .map(({ source, target, route, activationRank, importance }, id): CoreTopologyEdge => ({
      id, source, target, activationRank, route, importance,
    }));
  return { nodes, edges };
}

export type CoreTopologyActivation = {
  readonly primaryEdgeIds: readonly number[];
  readonly secondaryEdgeIds: readonly number[];
  readonly ambientEdgeIds: readonly number[];
  readonly signalEdgeIds: readonly number[];
  readonly activeEdgeIds: readonly number[];
  readonly activeNodeIds: readonly number[];
};

type SpatialVector = readonly [number, number, number];

function spatialEdgeScore(edge: CoreTopologyEdge, topology: CoreTopology, vector: SpatialVector): number {
  const source = topology.nodes.find((node) => node.id === edge.source);
  const target = topology.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return Number.NEGATIVE_INFINITY;
  const midpoint = [
    (source.position[0] + target.position[0]) * 0.5,
    (source.position[1] + target.position[1]) * 0.5,
    (source.position[2] + target.position[2]) * 0.5,
  ] as const;
  const midpointLength = Math.hypot(...midpoint);
  const vectorLength = Math.hypot(...vector);
  if (midpointLength === 0 || vectorLength === 0) return -edge.activationRank * 0.001;
  const alignment = (midpoint[0] * vector[0] + midpoint[1] * vector[1] + midpoint[2] * vector[2]) /
    (midpointLength * vectorLength);
  return alignment * 4 - midpointLength * 0.025 - edge.activationRank * 0.0001;
}

function selectSpatialEdge(topology: CoreTopology, route: CoreTopologyRoute, vector: SpatialVector): CoreTopologyEdge | undefined {
  let selected: CoreTopologyEdge | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const edge of topology.edges) {
    if (edge.route !== route) continue;
    const score = spatialEdgeScore(edge, topology, vector);
    if (score > selectedScore) {
      selected = edge;
      selectedScore = score;
    }
  }
  return selected;
}

function firstEdges(topology: CoreTopology, route: CoreTopologyRoute, count: number): readonly CoreTopologyEdge[] {
  return topology.edges.filter((edge) => edge.route === route).slice(0, count);
}

function nodeIdsFor(edges: readonly CoreTopologyEdge[]): readonly number[] {
  const nodeIds = new Set<number>();
  for (const edge of edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return [...nodeIds];
}

/** Selects route membership first; view materials only render the result. */
export function deriveCoreTopologyActivation(
  topology: CoreTopology,
  visualInput: CoreVisualInput,
): CoreTopologyActivation {
  let primary: readonly CoreTopologyEdge[] = [];
  let secondary: readonly CoreTopologyEdge[] = [];
  let ambient: readonly CoreTopologyEdge[] = [];
  let signal: readonly CoreTopologyEdge[] = [];

  switch (visualInput.visualState) {
    case 'dormant': break;
    case 'awakening':
      primary = firstEdges(topology, 'primary', 2);
      secondary = firstEdges(topology, 'secondary', 1);
      break;
    case 'hover_response': {
      const selected = selectSpatialEdge(topology, 'primary', [visualInput.pointerX, visualInput.pointerY, 0]);
      primary = selected ? [selected] : firstEdges(topology, 'primary', 1);
      break;
    }
    case 'focusing': {
      const selected = selectSpatialEdge(topology, 'secondary', [visualInput.focusX, visualInput.focusY, visualInput.focusZ]);
      secondary = selected ? [selected] : firstEdges(topology, 'primary', 1);
      break;
    }
    case 'agent_activity': {
      const selectedPrimary = selectSpatialEdge(topology, 'primary', [visualInput.pointerX, visualInput.pointerY, 0]);
      const selectedSecondary = selectSpatialEdge(topology, 'secondary', [visualInput.focusX, visualInput.focusY, visualInput.focusZ]);
      const selectedSignal = selectSpatialEdge(topology, 'signal', [visualInput.focusZ, visualInput.pointerX, visualInput.pointerY]);
      const selectedAmbient = selectSpatialEdge(topology, 'ambient', [visualInput.pointerX, visualInput.focusY, visualInput.focusZ]);
      primary = selectedPrimary ? [selectedPrimary] : firstEdges(topology, 'primary', 1);
      secondary = selectedSecondary ? [selectedSecondary] : firstEdges(topology, 'secondary', 1);
      signal = selectedSignal ? [selectedSignal] : firstEdges(topology, 'signal', 1);
      ambient = selectedAmbient ? [selectedAmbient] : firstEdges(topology, 'ambient', 1);
      break;
    }
    case 'idle':
    default:
      primary = firstEdges(topology, 'primary', 2);
      secondary = firstEdges(topology, 'secondary', 1);
      ambient = firstEdges(topology, 'ambient', 1);
      break;
  }

  const activeEdges = [primary, secondary, ambient, signal].flat();
  return {
    primaryEdgeIds: primary.map((edge) => edge.id),
    secondaryEdgeIds: secondary.map((edge) => edge.id),
    ambientEdgeIds: ambient.map((edge) => edge.id),
    signalEdgeIds: signal.map((edge) => edge.id),
    activeEdgeIds: activeEdges.map((edge) => edge.id),
    activeNodeIds: nodeIdsFor(activeEdges),
  };
}
