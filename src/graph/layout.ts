import type { GraphLayout, GraphManifest } from './types';

/**
 * Deliberately asymmetric and depth-separated.
 *
 * An earlier revision mirrored the domains in near-identical pairs, which is
 * exactly what makes a graph read as a diagram rather than a place. Each domain
 * now sits at its own distance, height and depth so the composition has a near
 * side and a far side, and GRAPHICS sits clearly to the left of the Core: it is
 * the domain the focus choreography reframes against.
 *
 * The Core stays at the semantic origin. Its off-centre placement in the frame
 * is a camera concern, so it is not encoded here.
 */
const NODE_LAYOUT: GraphLayout = {
  core: [0, 0, 0],
  graphics: [-3.35, -0.62, 0.35],
  ai: [-2.55, 1.42, -0.95],
  // Held lower and further back than its original height: at the idle framing a
  // domain at y 2.35 sits within one domain-extent of the top edge, so the
  // assembly arrived as a box cut in half with its label off the frame. Depth
  // also keeps it in the far group, which is where the file's spread is checked.
  'game-analysis': [0.95, 1.5, 0.4],
  systems: [3.05, 0.72, -0.65],
  research: [2.35, -1.75, 1.05],
};

export function deriveGraphLayout(manifest: GraphManifest): GraphLayout {
  for (const node of manifest.nodes) {
    const position = NODE_LAYOUT[node.id];
    if (!position || position.some((value) => !Number.isFinite(value))) {
      throw new Error('Graph layout is missing a finite position for ' + node.id);
    }
  }

  return NODE_LAYOUT;
}