import type { GraphLayout, GraphManifest, GraphNodeId } from '../../graph/types';
import { hashUnit, normalizeSeed } from '../seedRandom';

type Vector = readonly [number, number, number];

/**
 * The five field behaviours.
 *
 * A domain is not a box with a label on it. It is a *phenomenon* — a region of
 * the substrate where a particular kind of computation is happening, and what
 * distinguishes one from another is how its matter moves, not what colour it is.
 * Colour is downstream of motion here: a region reads as "graphics" because its
 * matter is organised into dense sampling sheets that interfere with each other,
 * and only then because that reads cool and dense.
 *
 * Each behaviour is defined by the same small parameter set the matter shader
 * already understands — how strongly the region organises its units, how much
 * spread it allows, how fast it runs, how far its local structure reaches — plus
 * a signature the view uses to add the one or two geometry families that no
 * amount of parameter variation could produce.
 *
 * - `inference` — AI. Branch and merge: a hierarchy that is self-similar at every
 *   scale, with several candidate paths alive at once until one converges.
 * - `sampling` — GRAPHICS. Density and interference: sheets sampled at a high
 *   rate, whose overlapping spatial frequencies beat against each other.
 * - `branching` — GAME ANALYSIS. Parallel state: two or more streams evolving
 *   side by side, with a rollback that leaves an afterimage behind it.
 * - `throughput` — SYSTEMS. Saturation: a stack of buses running at capacity,
 *   where the interesting thing is the queue rather than the flow.
 * - `probe` — RESEARCH. Sparsity: a few long probes into unmeasured depth, and
 *   the analysis slices that form where they come back with something.
 */
export type DomainPhenomenon =
  | 'inference'
  | 'sampling'
  | 'branching'
  | 'throughput'
  | 'probe';

export type DomainFieldDescriptor = {
  readonly id: GraphNodeId;
  readonly label: string;
  /** 1..5, in manifest order. The matter shader's region selector. */
  readonly kind: number;
  readonly phenomenon: DomainPhenomenon;
  readonly centre: Vector;
  /** Half-extents of the region's own envelope. */
  readonly extent: Vector;
  /** Where the label anchors, in world space. Offset from the centre. */
  readonly labelAnchor: Vector;
  readonly prominence: number;
  /** 0..1. How strongly this region organises the matter inside it. */
  readonly organisation: number;
  /** 0..1. How much the region's own structure resists compression. */
  readonly pressure: number;
  /** Local motion rate multiplier. */
  readonly rate: number;
};

const PHENOMENON_BY_ID: Readonly<Record<string, DomainPhenomenon>> = {
  ai: 'inference',
  graphics: 'sampling',
  'game-analysis': 'branching',
  systems: 'throughput',
  research: 'probe',
};

/**
 * Per-behaviour field constants.
 *
 * These are the numbers that make the five regions *feel* different before any
 * local geometry is drawn, and they are tuned against each other rather than in
 * isolation: `probe` is legible as sparse because `sampling` beside it is dense,
 * and a frame where all five were tuned to look good on their own would have
 * five regions that all look the same.
 */
const BEHAVIOUR: Readonly<
  Record<
    DomainPhenomenon,
    {
      readonly organisation: number;
      readonly pressure: number;
      readonly rate: number;
      readonly extent: number;
    }
  >
> = {
  inference: { organisation: 0.72, pressure: 0.45, rate: 1.15, extent: 3.9 },
  sampling: { organisation: 0.88, pressure: 0.8, rate: 0.9, extent: 3.4 },
  branching: { organisation: 0.6, pressure: 0.55, rate: 1.4, extent: 3.6 },
  throughput: { organisation: 0.94, pressure: 0.95, rate: 0.75, extent: 4.1 },
  probe: { organisation: 0.34, pressure: 0.25, rate: 0.6, extent: 4.4 },
};

/**
 * Where a region carries its name.
 *
 * Two rules, and both of them are load-bearing rather than decorative.
 * Horizontally the label annotates *inward*, toward the composition: a region on
 * the right half of the frame offsets its text to the left of itself. Placing
 * every label on the same side pushes the outermost region's name off the frame
 * edge, which is the one label the idle composition actually needs.
 *
 * Vertically it runs *away from the Core*, on whichever side that is. The route
 * arrives from the Core, so the corridor occupies the quadrant of a region that
 * points back at the origin, and a label sitting in that quadrant draws its plate
 * over the route's arrival — the one thing the focus frame is about.
 *
 * The anchor is resolved here, in the descriptor, rather than in the view,
 * because it is a property of the region's place in the composition and not of
 * how that region is drawn. The view is then free to be a view.
 *
 * The offset is **local to the region**, and that is not a detail. The view
 * renders the label inside the region's own group, and that group's position is
 * set to `centre` every frame — so an anchor authored as `centre + offset` was
 * added twice, and every label in the scene landed at roughly twice its region's
 * distance from the origin. The three named regions projected to 1920x1080
 * coordinates of (-858, 1857), (1705, -1971) and (1780, 288): off the left and
 * the bottom, off the top and the right, off the right. Nothing was hoverable,
 * because no pointer position on the canvas was anywhere near a label, and the
 * capture harness reported it as "0 candidate positions around the GRAPHICS label
 * none reached hovered" — with the whole hover, focus, reframe and escape
 * choreography unreachable behind it. A descriptor whose position is measured
 * against one origin and drawn against another has no correct value; the fix is
 * to make the descriptor say which origin it means.
 */
const LABEL_LATERAL = 0.8;
const LABEL_LIFT = 1.45;

export function deriveDomainPhenomena(
  manifest: GraphManifest,
  layout: GraphLayout,
  detail: number,
  seed = 17,
): readonly DomainFieldDescriptor[] {
  const normalised = normalizeSeed(seed);
  const boundedDetail = Number.isFinite(detail)
    ? Math.min(1, Math.max(0, detail))
    : 0;
  const domains: DomainFieldDescriptor[] = [];
  let kind = 0;

  for (const node of manifest.nodes) {
    if (node.kind !== 'domain') continue;
    kind += 1;

    const phenomenon = PHENOMENON_BY_ID[node.id] ?? 'sampling';
    const behaviour = BEHAVIOUR[phenomenon];
    const centre = layout[node.id];
    const jitter = (hashUnit(normalised, kind * 31) - 0.5) * 0.4;

    // Envelopes grow with detail so the lower tiers are the same architecture on
    // a smaller footprint rather than a different architecture.
    const scale = 0.82 + boundedDetail * 0.18;
    const extent: Vector = [
      behaviour.extent * scale,
      behaviour.extent * scale * (phenomenon === 'throughput' ? 0.52 : 0.72),
      behaviour.extent * scale * 0.6,
    ];
    const sideX = centre[0] > 0 ? -1 : 1;
    const sideY = centre[1] > 0 ? 1 : -1;

    domains.push({
      id: node.id,
      label: node.label,
      kind,
      phenomenon,
      centre,
      extent,
      labelAnchor: [
        sideX * extent[0] * LABEL_LATERAL,
        sideY * extent[1] * LABEL_LIFT + jitter,
        extent[2] * 0.2,
      ],
      prominence: node.importance,
      organisation: behaviour.organisation,
      pressure: behaviour.pressure,
      rate: behaviour.rate,
    });
  }

  return domains;
}
