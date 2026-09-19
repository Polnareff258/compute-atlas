import type {
  GraphEdge,
  GraphLayout,
  GraphManifest,
  GraphPosition,
} from './types';

const NODE_LAYOUT: GraphLayout = {
  core: [0, 0, 0],
  ai: [-2.96, 1.02, 0.78],
  graphics: [-3.02, -1.06, -0.52],
  'game-analysis': [0.04, 1.82, -1.12],
  systems: [2.96, 1.02, 0.56],
  research: [3.02, -1.16, -0.86],
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
  const subdivisions = Math.max(3, Math.round(clamp(graphDensity, 0.1, 1) * 6));
  const points: GraphPosition[] = [];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.max(Math.hypot(dx, dy), 0.001);
  const normalX = -dy / length;
  const normalY = dx / length;
  const identity = Array.from(edge.id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const sign = identity % 2 === 0 ? 1 : -1;
  const bend = sign * (0.28 + edge.strength * 0.16);
  const control = [
    (start[0] + end[0]) * 0.5 + normalX * bend,
    (start[1] + end[1]) * 0.5 + normalY * bend,
    (start[2] + end[2]) * 0.5 + (identity % 3 - 1) * 0.22,
  ] as const;

  for (let index = 0; index <= subdivisions; index += 1) {
    const progress = index / subdivisions;
    const inverse = 1 - progress;
    const curve: GraphPosition = [
      inverse * inverse * start[0] + 2 * inverse * progress * control[0] + progress * progress * end[0],
      inverse * inverse * start[1] + 2 * inverse * progress * control[1] + progress * progress * end[1],
      inverse * inverse * start[2] + 2 * inverse * progress * control[2] + progress * progress * end[2],
    ];
    const fanOffset = index === subdivisions - 1 ? sign * 0.065 : 0;
    points.push([curve[0] + normalX * fanOffset, curve[1] + normalY * fanOffset, curve[2]]);
  }

  return points;
}
