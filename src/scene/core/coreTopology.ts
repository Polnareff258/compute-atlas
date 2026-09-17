import type { CoreParameters } from './coreTypes';

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
  [0.52, 0.16, -0.12],
];

const SATELLITE_POSITIONS: readonly (readonly [number, number, number])[] = [
  [-0.82, 0.3, 0.28],
  [1.28, -0.68, -0.56],
  [-1.54, -0.5, 0.78],
];

const ROUTE_POSITIONS: readonly (readonly [number, number, number])[] = [
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
  { source: 0, target: 5, route: 'signal', activationRank: 3 },
  { source: 2, target: 4, route: 'local', activationRank: 4 },
  { source: 3, target: 6, route: 'signal', activationRank: 5 },
  { source: 1, target: 5, route: 'directional', activationRank: 6 },
  { source: 4, target: 7, route: 'signal', activationRank: 7 },
  { source: 5, target: 8, route: 'directional', activationRank: 8 },
  { source: 3, target: 9, route: 'local', activationRank: 9 },
  { source: 6, target: 10, route: 'signal', activationRank: 10 },
  { source: 2, target: 11, route: 'directional', activationRank: 11 },
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
    return fixedPosition;
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

export function deriveCoreTopology(
  parameters: Pick<CoreParameters, 'topologyNodeBudget' | 'topologyEdgeBudget'>,
  seed = 17,
): CoreTopology {
  const nodeCount = Math.max(1, Math.floor(parameters.topologyNodeBudget));
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

  const edges = EDGE_CANDIDATES.filter(
    ({ source, target }) => source < nodeCount && target < nodeCount,
  )
    .slice(0, Math.max(0, Math.floor(parameters.topologyEdgeBudget)))
    .map(({ source, target, route, activationRank }, id): CoreTopologyEdge => ({
      id,
      source,
      target,
      activationRank,
      route,
    }));

  return { nodes, edges };
}
