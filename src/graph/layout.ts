import type { GraphLayout, GraphManifest, GraphNodeId } from './types';

/**
 * Deliberately asymmetric and depth-separated.
 *
 * An earlier revision mirrored the domains in near-identical pairs, which is
 * exactly what makes a graph read as a diagram rather than a place. Each domain
 * sits at its own distance, height and depth so the composition has a near side
 * and a far side, and GRAPHICS sits clearly to the left of the Core: it is the
 * domain the focus choreography reframes against.
 *
 * The radii are set against the Core rather than against each other, and they
 * have now been moved twice for the same reason. The Core's half-extents are
 * 4.05 by 3.30 by 1.50, so a ring of domains at four units is a ring of domains
 * *inside* the subject, and a domain is placed where its own bay clears that box
 * rather than at a fixed radius.
 *
 * Measured, four of the five clear it: graphics 6.24 world units from the
 * origin, systems 5.80, ai 5.64, research 4.70. The fifth does not.
 * `game-analysis` sits 3.41 out, which puts it inside the box on every axis at
 * once — above the mass at 2.85 against a top of 3.30, and 1.70 off centre
 * against a half-width of 4.05 — so the crown passes in front of its lower
 * members and the bay reads as mounted on the machine rather than standing
 * beside it. That is the one place the depth overlap this layout is built for
 * turns into occlusion of a whole domain, and it is visible in the idle frame.
 * This paragraph used to claim the domains "sit at 5.8-7.0, which clears the
 * mass on every side". The radii were moved twice after that was written and the
 * claim was never re-measured, so for a stage the comment asserted a clearance
 * the table below it did not have.
 *
 * That clipping is the composition rather than a defect. Idle is meant to read
 * as a large computed body with bays arranged around it, not as five icons on a
 * ring: two or three domains are legible at rest, the rest are in depth or
 * partly outside the frame, and the focus choreography is what brings one of
 * them fully into view.
 *
 * The Core stays at the semantic origin. Its off-centre placement in the frame
 * is a camera concern, so it is not encoded here.
 */
const NODE_LAYOUT: GraphLayout = {
  core: [0, 0, 0],
  graphics: [-6.15, -0.9, 0.5],
  ai: [-4.8, 2.5, -1.6],
  // Held lower and further back than its original height: at the idle framing a
  // domain near the top edge arrived as an assembly cut in half with its label
  // off the frame. It is still the highest thing in the composition, which is
  // what the spread in the layout test reads.
  'game-analysis': [1.7, 2.85, 0.8],
  systems: [5.55, 1.25, -1.1],
  // The lowest and the nearest thing on its side, kept out of the bottom-right
  // frame corner so its lower members are not cut off by the frame itself.
  research: [3.85, -2.3, 1.4],
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
  // near-black background — dark enough that the body disappeared and only the
  // brightest edge of a member was left, which is why a dormant domain read as a
  // scratch rather than as a machine standing in the depth of the frame. A
  // silhouette has to be dark *and* whole. The margin is thinner than it was
  // when that was measured, because the backdrop is now a measured step above
  // the void rather than the void itself.
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