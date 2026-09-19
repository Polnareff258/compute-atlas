import type { GraphLayout, GraphManifest, GraphNodeId } from './types';

/**
 * Deliberately asymmetric and depth-separated.
 *
 * An earlier revision mirrored the domains in near-identical pairs, which is
 * exactly what makes a graph read as a diagram rather than a place. Each domain
 * now sits at its own distance, height and depth so the composition has a near
 * side and a far side, and GRAPHICS sits clearly to the left of the Core: it is
 * the domain the focus choreography reframes against.
 *
 * The radii are set against the Core rather than against each other. The hero
 * rebuild made the Core a body several units across, and at the original 2.5–3.4
 * unit radii its shoulders physically covered GAME ANALYSIS, SYSTEMS and
 * RESEARCH — the domains were being occluded by the subject instead of arranged
 * around it. Everything moved out to 2.6–4.7 so the Core has air on every side
 * at the idle framing and the outer domains leave the frame edge alone.
 *
 * The Core stays at the semantic origin. Its off-centre placement in the frame
 * is a camera concern, so it is not encoded here.
 */
const NODE_LAYOUT: GraphLayout = {
  core: [0, 0, 0],
  graphics: [-4.55, -0.72, 0.42],
  ai: [-3.55, 1.95, -1.25],
  // Held lower and further back than its original height: at the idle framing a
  // domain at y 2.35 sits within one domain-extent of the top edge, so the
  // assembly arrived as a box cut in half with its label off the frame. Depth
  // also keeps it in the far group, which is where the file's spread is checked.
  'game-analysis': [1.25, 2.15, 0.62],
  systems: [4.15, 0.95, -0.85],
  // Pulled in from [3.15, -2.15, 1.25]. At the idle framing the extra height and
  // radius put the lattice across the bottom-right frame corner: its lower
  // members were cut off by the frame itself, so the domain read as a bundle of
  // loose sticks rather than as a structure. It is still the lowest and the
  // nearest thing on that side, which is what the spread in the layout test
  // reads; it is no longer half outside the composition.
  research: [2.85, -1.75, 1.1],
};

/**
 * How much of the composition each domain is given at rest.
 *
 * Idle is a ranked composition, not five things drawn at one brightness. The
 * Core is the subject; three domains are held at working prominence and carry
 * their names; the two outermost sit in the depth of the frame as dormant
 * silhouettes with no text at all. Which two are dormant is a property of the
 * layout — they are the ones furthest from the Core on screen — and not of the
 * interaction state, so the idle frame is the same frame every time.
 *
 * The ranking is also what keeps the idle composition honest about the brief's
 * "never all labels at once": text is a budget, and it is spent on the domains
 * the composition is actually about.
 */
const NODE_PROMINENCE: Readonly<Record<GraphNodeId, number>> = {
  core: 1,
  // The reframe domain, and the one whose interior is worth reading.
  graphics: 0.74,
  // The clearest of the four sub-environments as a machine, so it earns a name.
  systems: 0.6,
  'game-analysis': 0.5,
  // Outer frame, held back: silhouette only.
  //
  // Raised from 0.22 and 0.17. Presence scales the whole response, so at the old
  // values these two resolved to about a tenth of their tier colour against a
  // background of #050609 — dark enough that the body disappeared and only the
  // brightest edge of a member was left, which is why a dormant domain read as a
  // scratch rather than as a machine standing in the depth of the frame. A
  // silhouette has to be dark *and* whole.
  ai: 0.28,
  research: 0.24,
};

/** At or above this, a domain carries its name at rest. */
export const NAMED_DOMAIN_PROMINENCE = 0.35;

export function deriveGraphLayout(manifest: GraphManifest): GraphLayout {
  for (const node of manifest.nodes) {
    const position = NODE_LAYOUT[node.id];
    if (!position || position.some((value) => !Number.isFinite(value))) {
      throw new Error('Graph layout is missing a finite position for ' + node.id);
    }
  }

  return NODE_LAYOUT;
}

export type GraphProminence = Readonly<Record<GraphNodeId, number>>;

/**
 * How much of the frame each node is given at rest.
 *
 * Validated against the manifest the same way the layout is, so a domain that
 * was added to the Graph without a place in the composition is a startup error
 * rather than a domain that silently renders at zero presence.
 */
export function deriveGraphProminence(manifest: GraphManifest): GraphProminence {
  for (const node of manifest.nodes) {
    const prominence = NODE_PROMINENCE[node.id];
    if (!Number.isFinite(prominence) || prominence < 0 || prominence > 1) {
      throw new Error(
        'Graph prominence is missing a 0..1 value for ' + node.id,
      );
    }
  }

  return NODE_PROMINENCE;
}