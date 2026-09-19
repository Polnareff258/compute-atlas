import type { GraphLayout, GraphManifest, GraphNodeId } from '../../graph/types';
import { selectCorePortForDirection, type CoreStructure } from '../core/coreStructure';
import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import type { RouteCurve } from './routeDash';
import {
  CORE_ROUTE_GROUP,
  DOMAIN_ROUTE_GROUP_BASE,
  TRUNK_ROUTE_GROUP_BASE,
} from './routeContract';

type Vector = readonly [number, number, number];

export {
  CORE_ROUTE_GROUP,
  DOMAIN_ROUTE_GROUP_BASE,
  TRUNK_ROUTE_GROUP_BASE,
} from './routeContract';

export type DomainVisualNodeId = Exclude<GraphNodeId, 'core'>;

export type GraphTrunk = {
  readonly id: string;
  /** -1 or 1; which side of the Core this trunk leaves from. */
  readonly sector: number;
  readonly domains: readonly DomainVisualNodeId[];
  readonly group: number;
  /**
   * Strongest member edge. Idle uses this to let one trunk read as *the*
   * outbound route while the other stays present but secondary.
   */
  readonly strength: number;
  /** Core port the trunk leaves from. */
  readonly origin: Vector;
  /** Shared branch point. Every domain on this trunk departs from here. */
  readonly fork: Vector;
  readonly curve: RouteCurve;
};

export type DomainIngress = {
  readonly position: Vector;
  /** Outward normal of the ingress mouth; faces away from the Core. */
  readonly direction: Vector;
  readonly halfWidth: number;
};

export type DomainRoute = {
  readonly id: string;
  readonly edgeId: string;
  readonly domainId: DomainVisualNodeId;
  readonly trunkId: string;
  readonly group: number;
  readonly strength: number;
  readonly ingress: DomainIngress;
  /** Shared trunk fork to the branch junction. Route class 'secondary'. */
  readonly branch: RouteCurve;
  /** Branch junction into the ingress mouth. Route class 'signal'. */
  readonly approach: RouteCurve;
};

export type GraphRouting = {
  readonly trunks: readonly GraphTrunk[];
  readonly routes: readonly DomainRoute[];
  /** Trunk curves first, then branches, then approaches. */
  readonly curves: readonly RouteCurve[];
};

const FORK_REACH = 0.62;
const JUNCTION_REACH = 0.74;
const INGRESS_REACH = 0.2;
const MIN_SPAN = 0.05;

/**
 * Idle trunk weights. The gap between them is deliberately wide: the brief
 * requires idle to read as one route leaving the Core, not as two equal ones.
 *
 * Both sit above the route field's visibility floor, which is the whole reason
 * the trailing weight is as high as it is. These two curves are the only routing
 * the idle frame draws, and "the trunk is present but secondary" and "the trunk
 * is culled" are one number apart at a floor this high.
 */
const IDLE_LEAD_WEIGHT = 0.86;
const IDLE_TRAILING_WEIGHT = 0.46;
/**
 * Idle weight for one domain's own route group, before the resting ranking.
 *
 * Below the visibility floor by construction, so the five branch-and-ingress
 * runs are absent from the idle frame rather than faint in it. The ranking
 * scales this down and never up, so no domain's resting prominence can lift it
 * back over the threshold. Hover passes 0.86 and focus 1 for the bound domain,
 * which is the reveal the composition is built around.
 */
const IDLE_DOMAIN_GROUP_WEIGHT = 0.2;
/**
 * What a domain with no resting prominence is left with.
 *
 * Not zero: a dormant domain is a silhouette with a dark interior, not an
 * absent one, and a group weight of zero would cull its interior circuits
 * entirely rather than holding them at the low level the composition asks for.
 */
const IDLE_DORMANT_GROUP_FLOOR = 0.3;

function magnitude(vector: Vector): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vector): Vector {
  const length = magnitude(vector);
  if (length < 1e-6) return [1, 0, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function lerp3(from: Vector, to: Vector, t: number): Vector {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/**
 * Sector is decided by which side of the Core's own centroid the domain sits on.
 * Splitting on x alone would collapse a layout where a domain sits directly
 * above the Core, so the y axis breaks that tie deterministically.
 */
function deriveSector(offset: Vector): number {
  if (Math.abs(offset[0]) > 1e-3) return offset[0] >= 0 ? 1 : -1;
  return offset[1] >= 0 ? 1 : -1;
}

function trunkIdFor(sector: number): string {
  return sector >= 0 ? 'trunk-right' : 'trunk-left';
}

/**
 * Maps the semantic manifest onto physical routing:
 * `Core port -> shared trunk -> branch -> domain ingress`.
 *
 * The manifest still owns the five edges; this module decides that two of them
 * travel the same trunk before forking, which is what stops the graph from
 * reading as a centre node with five separate spokes.
 */
export function deriveGraphRouting(
  manifest: GraphManifest,
  layout: GraphLayout,
  structure: CoreStructure,
  domainDetail = 1,
  seed = 17,
): GraphRouting {
  const normalizedSeed = normalizeSeed(seed);
  const detail = Number.isFinite(domainDetail)
    ? Math.min(1, Math.max(0, domainDetail))
    : 0;
  const centroid = structure.centroid;
  const domainNodes = manifest.nodes.filter((node) => node.kind === 'domain');

  // The manifest still owns the edges; this only indexes them by domain so the
  // geometric pass below can read each domain's own strength.
  const edgesByDomain = new Map<string, { id: string; strength: number }>();
  for (const edge of manifest.edges) {
    for (const endpoint of [edge.target, edge.source]) {
      if (endpoint === 'core' || edgesByDomain.has(endpoint)) continue;
      edgesByDomain.set(endpoint, { id: edge.id, strength: edge.strength });
    }
  }

  const domains = domainNodes.map((node) => {
    const anchor = layout[node.id];
    const offset: Vector = [
      anchor[0] - centroid[0],
      anchor[1] - centroid[1],
      anchor[2] - centroid[2],
    ];
    return {
      id: node.id as DomainVisualNodeId,
      anchor,
      offset,
      direction: normalize(offset),
      sector: deriveSector(offset),
    };
  });

  const sectors = [1, -1].filter((sector) =>
    domains.some((domain) => domain.sector === sector),
  );

  const trunks: GraphTrunk[] = [];
  const trunkIndexBySector = new Map<number, number>();

  for (const sector of sectors) {
    const members = domains
      .filter((domain) => domain.sector === sector)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (members.length === 0) continue;

    // The trunk leaves from the Core port best aligned with the sector's mean
    // direction, so the trunk and the Core agree on where traffic exits.
    const meanDirection = normalize(
      members.reduce<Vector>(
        (sum, member) => [
          sum[0] + member.direction[0],
          sum[1] + member.direction[1],
          sum[2] + member.direction[2],
        ],
        [0, 0, 0],
      ),
    );
    const port = selectCorePortForDirection(structure, meanDirection);
    const origin: Vector = port
      ? port.position
      : [
          centroid[0] + meanDirection[0] * structure.heroScale * 0.5,
          centroid[1] + meanDirection[1] * structure.heroScale * 0.5,
          centroid[2] + meanDirection[2] * structure.heroScale * 0.5,
        ];

    // The fork sits a fixed fraction of the way to the nearest domain on this
    // side, so trunk length follows the layout instead of a magic constant.
    const nearest = Math.min(
      ...members.map((member) => magnitude(member.offset)),
    );
    const forkReach = Math.max(MIN_SPAN, nearest * FORK_REACH);
    const fork: Vector = [
      origin[0] + meanDirection[0] * forkReach,
      origin[1] + meanDirection[1] * forkReach,
      origin[2] + meanDirection[2] * forkReach,
    ];

    const index = trunks.length;
    trunkIndexBySector.set(sector, index);
    const group = TRUNK_ROUTE_GROUP_BASE + Math.min(1, index);
    const lift = hashSigned(normalizedSeed, 900 + index) * 0.22;
    const control: Vector = [
      (origin[0] + fork[0]) * 0.5 + meanDirection[2] * lift * 1.4,
      (origin[1] + fork[1]) * 0.5 + lift,
      (origin[2] + fork[2]) * 0.5 - meanDirection[1] * lift * 1.1,
    ];

    trunks.push({
      id: trunkIdFor(sector),
      sector,
      domains: members.map((member) => member.id),
      group,
      strength: Math.max(
        ...members.map((member) => edgesByDomain.get(member.id)?.strength ?? 0.5),
      ),
      origin,
      fork,
      curve: {
        id: 100 + index,
        rank: 0,
        route: 'primary',
        group,
        start: origin,
        control,
        end: fork,
      },
    });
  }

  const routes: DomainRoute[] = [];
  domains.forEach((domain, domainIndex) => {
    const trunk = trunks[trunkIndexBySector.get(domain.sector) ?? 0];
    if (!trunk) return;

    const edge = edgesByDomain.get(domain.id);
    const reach = magnitude(domain.offset);
    // A degenerate layout (domain exactly on the Core) still gets a valid route
    // rather than a zero-length curve the dash maths would have to special-case.
    const junction: Vector = lerp3(trunk.fork, domain.anchor, JUNCTION_REACH);
    const ingressDepth = Math.min(INGRESS_REACH, reach * 0.24);
    const ingressPosition: Vector = [
      domain.anchor[0] - domain.direction[0] * ingressDepth,
      domain.anchor[1] - domain.direction[1] * ingressDepth,
      domain.anchor[2] - domain.direction[2] * ingressDepth,
    ];

    const rankSeed = 400 + domainIndex * 7;
    const bend = hashSigned(normalizedSeed, rankSeed) * 0.3;
    const approachLift = hashSigned(normalizedSeed, rankSeed + 1) * 0.16;
    const approachBend = hashSigned(normalizedSeed, rankSeed + 2) * 0.24;

    const group = DOMAIN_ROUTE_GROUP_BASE + domainIndex;
    const branchControl: Vector = [
      (trunk.fork[0] + junction[0]) * 0.5 - domain.direction[2] * bend,
      (trunk.fork[1] + junction[1]) * 0.5 + bend * 0.7,
      (trunk.fork[2] + junction[2]) * 0.5 + domain.direction[0] * bend,
    ];
    const approachControl: Vector = [
      (junction[0] + ingressPosition[0]) * 0.5 - domain.direction[2] * approachBend,
      (junction[1] + ingressPosition[1]) * 0.5 + approachLift,
      (junction[2] + ingressPosition[2]) * 0.5 + domain.direction[0] * approachBend,
    ];

    routes.push({
      id: 'route-' + domain.id,
      edgeId: edge?.id ?? 'edge-' + domain.id,
      domainId: domain.id,
      trunkId: trunk.id,
      group,
      strength: edge?.strength ?? 0.6,
      ingress: {
        position: ingressPosition,
        direction: domain.direction,
        // A richer domain opens a wider mouth, so the ingress reads as a real
        // opening at HIGH/ULTRA and as a narrow seam at SAFE.
        halfWidth: 0.045 + detail * 0.045 + hashUnit(normalizedSeed, rankSeed + 3) * 0.03,
      },
      branch: {
        id: 200 + domainIndex,
        rank: 1,
        route: 'secondary',
        group,
        start: trunk.fork,
        control: branchControl,
        end: junction,
      },
      approach: {
        id: 300 + domainIndex,
        rank: 2,
        route: 'signal',
        group,
        start: junction,
        control: approachControl,
        end: ingressPosition,
      },
    });
  });

  // Trunks first so the primary draw range is the shared main routes, then
  // branches, then the short ingress approaches.
  const curves: RouteCurve[] = [
    ...trunks.map((trunk) => trunk.curve),
    ...routes.map((route) => route.branch),
    ...routes.map((route) => route.approach),
  ];

  return { trunks, routes, curves };
}

/**
 * Group weights for one interaction state.
 *
 * A trunk carries everything on its side, so it takes the strongest weight of
 * its own domains. Non-target domains fall to the packer's default, which is how
 * they recede without the caller enumerating them.
 */
/**
 * Maps a domain's resting prominence onto a multiplier for its route group.
 *
 * Absent or non-finite prominence means "not part of the ranking", which is the
 * behaviour every caller had before the ranking existed, so the group weight is
 * returned unscaled rather than dropped to the dormant floor.
 */
function restingScale(
  prominence: Readonly<Record<DomainVisualNodeId, number>> | undefined,
  domainId: DomainVisualNodeId,
): number {
  if (prominence === undefined) return 1;
  const value = prominence[domainId];
  if (!Number.isFinite(value)) return 1;
  const bounded = Math.min(1, Math.max(0, value));
  return IDLE_DORMANT_GROUP_FLOOR + (1 - IDLE_DORMANT_GROUP_FLOOR) * bounded;
}

export function deriveGraphGroupWeights(
  routing: GraphRouting,
  input: {
    readonly activeDomainId: DomainVisualNodeId | null;
    readonly focused: boolean;
    readonly coreWeight: number;
    /**
     * Resting prominence per domain, 0..1, read only while nothing is bound.
     *
     * The trunk ranking below already decides which outbound route leads at
     * idle; this decides how much of each domain's *own* interior is lit. A
     * dormant domain runs dark while it waits, which is what keeps the idle
     * frame from showing the whole route set at one brightness. The moment
     * anything is bound the ranking is dropped, because from then on the
     * composition is about the bound domain and a second ranking would only
     * compete with it.
     */
    readonly restingProminence?: Readonly<Record<DomainVisualNodeId, number>>;
  },
): readonly { readonly group: number; readonly weight: number }[] {
  const focused = input.focused;
  const active = input.activeDomainId;
  const entries: { group: number; weight: number }[] = [
    {
      group: CORE_ROUTE_GROUP,
      weight: Number.isFinite(input.coreWeight) ? Math.max(0, input.coreWeight) : 0,
    },
  ];

  for (const route of routing.routes) {
    const isActive = active !== null && route.domainId === active;
    if (active === null) {
      entries.push({
        group: route.group,
        weight:
          IDLE_DOMAIN_GROUP_WEIGHT * restingScale(input.restingProminence, route.domainId),
      });
      continue;
    }
    if (isActive) {
      entries.push({ group: route.group, weight: focused ? 1 : 0.86 });
      continue;
    }
    // Non-target domains recede to outlines: present, but clearly secondary.
    entries.push({ group: route.group, weight: focused ? 0.05 : 0.14 });
  }

  // Idle shows only one strong outbound route: the trunk serving the strongest
  // domain leads outright, and the others stay legible at roughly a quarter of
  // it. Focusing that same domain continues the route the idle frame already
  // established, so the composition never restructures under interaction.
  const leadingStrength = Math.max(
    ...routing.trunks.map((trunk) => trunk.strength),
    1e-6,
  );
  for (const trunk of routing.trunks) {
    const carriesActive =
      active !== null && trunk.domains.some((domain) => domain === active);
    const ratio = Math.max(0, Math.min(1, trunk.strength / leadingStrength));
    const weight =
      active === null
        ? trunk.strength >= leadingStrength - 1e-9
          ? IDLE_LEAD_WEIGHT
          : IDLE_TRAILING_WEIGHT * (0.6 + 0.4 * ratio)
        : carriesActive
          ? focused
            ? 1
            : 0.78
          : focused
            ? 0.05
            : 0.12;
    entries.push({ group: trunk.group, weight });
  }

  return entries;
}