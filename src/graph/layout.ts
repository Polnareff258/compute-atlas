import type { GraphLayout, GraphManifest, GraphNodeId } from './types';

/**
 * Deliberately asymmetric, depth-separated and far apart.
 *
 * The previous revision arranged the five domains on a ring of radius 5 to 6
 * around a centred monolith. That is the composition of a knowledge graph: one
 * thing in the middle, five satellites at a similar distance, and a viewer who
 * can see all of it at once and therefore reads it as a diagram. The brief for
 * this stage requires the opposite, so the ring is gone and the domains sit at
 * five different distances, five different heights and five different depths.
 *
 * Three consequences of the new composition are encoded here rather than left to
 * the camera.
 *
 * **The scale is roughly doubled.** The hero is a fault more than twenty units
 * long rather than a body eight units wide, so a domain at radius 5 would be
 * *inside* it. The radii here run from 8.4 to 17.7.
 *
 * **Nothing is on a sphere.** A uniform radius is the second half of what makes
 * a graph read as a graph: even with the ring broken, five points at one distance
 * still read as a shell. The radii are 17.7, 15.6, 12.1, 10.7 and 8.4 — five
 * distinct distances — and the layout test asserts the spread rather than the
 * numbers.
 *
 * **Every domain is reachable.** The previous revision placed them by screen
 * position and let three of the five fall outside the frame, which reads well in
 * a still and is false as a system: the GRAPHICS anchor projected to NDC
 * (-1.03, -0.80), off the left *and* below the bottom edge at once, so no pointer
 * position anywhere on the canvas reached its pick zone. Hover, focus and the
 * whole reframe choreography were unreachable for the domain the choreography is
 * built around, and the capture harness said so as "0 candidate positions around
 * the GRAPHICS label none reached hovered". A region you cannot point at is not a
 * region you can select, and being partly cropped is not the same thing as being
 * off-screen — the brief's "部分结构接近镜头并被裁切" is about the *structure*.
 *
 * So position is now resolved against the idle frustum: at BASE_CAMERA_DISTANCE
 * of 20 and 48 degrees, a point at world depth z has 0.4452·(20 − z) of
 * half-height and 1.7778 of that in half-width, and every domain is placed to
 * land inside about three quarters of each. Depth is what buys the room, which is
 * why the separation now comes from z: the five sit between z = +7 and z = −13,
 * a spread of twenty units, so the composition has a near bay, a middle and a far
 * one rather than five things at one distance.
 *
 * **GRAPHICS is the near-left bay.** It is the domain the focus choreography
 * reframes against, and it is placed furthest left and below the fault's own line
 * so the active corridor arrives at it diagonally rather than head-on. AI runs
 * back and up into the far dark — the furthest thing in the composition — which
 * is where a hierarchy being searched should be; game analysis is the nearest and
 * the most forward, the one that crosses the fault's silhouette; systems sits
 * right and back; research is right and near, the lowest thing in the frame and
 * the one the layout holds closest to an edge.
 *
 * The Core stays at the semantic origin. Its off-centre placement in the frame
 * is a camera concern, so it is not encoded here.
 */
const NODE_LAYOUT: GraphLayout = {
  core: [0, 0, 0],
  graphics: [-10.5, -4.5, 4],
  ai: [-9.5, 7.4, -13],
  'game-analysis': [2.7, 3.9, 7],
  systems: [13.2, 2.1, -8],
  research: [9.1, -5.3, 2],
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
  // The reframe domain, nearest to the fault and the one whose interior is worth
  // reading.
  graphics: 0.76,
  // The most ordered of the regions, and the one whose load is legible from far
  // away, so it carries a name at rest.
  systems: 0.62,
  'game-analysis': 0.47,
  // The two in the depth of the frame, held back to silhouette. They stay above
  // the noise floor rather than at it: presence scales the whole response, and a
  // value low enough to make the body disappear leaves only the brightest edge
  // of a member visible, which reads as a scratch rather than as a region
  // standing in the dark. A silhouette has to be dark *and* whole.
  ai: 0.31,
  research: 0.26,
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