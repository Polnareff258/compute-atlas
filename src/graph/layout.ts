import type {
  GraphEdge,
  GraphLayout,
  GraphManifest,
  GraphPosition,
} from './types';

const NODE_LAYOUT: GraphLayout = {
  core: [0, 0, 0],
  ai: [-2.52, 0.86, 0.24],
  graphics: [-2.28, -0.84, -0.38],
  'game-analysis': [0.02, 1.46, -0.76],
  systems: [2.28, 0.72, 0.46],
  research: [2.48, -0.86, -0.18],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function deriveGraphLayout(manifest: GraphManifest): GraphLayout {
  for (const node of manifest.nodes) {
    const position = NODE_LAYOUT[node.id];
    if (!position || position.some((value) => !Number.isFinite(value))) {
      throw new Error('Graph layout is missing a finite position for ' + node.id);
    }
  }

  return NODE_LAYOUT;
}

export function deriveGraphEdgePoints(
  edge: GraphEdge,
  layout: GraphLayout,
  graphDensity: number,
): readonly GraphPosition[] {
  const start = layout[edge.source];
  const end = layout[edge.target];
  const subdivisions = Math.max(1, Math.round(clamp(graphDensity, 0.1, 1) * 4));
  const points: GraphPosition[] = [];

  for (let index = 0; index <= subdivisions; index += 1) {
    const progress = index / subdivisions;
    points.push([
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress,
      start[2] + (end[2] - start[2]) * progress,
    ]);
  }

  return points;
}
