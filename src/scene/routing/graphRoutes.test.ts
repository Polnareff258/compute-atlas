import { describe, expect, it } from 'vitest';

import { deriveGraphLayout } from '../../graph/layout';
import { GRAPH_MANIFEST } from '../../graph/graphManifest';
import { deriveCoreStructure, type CoreStructure } from '../core/coreStructure';
import { MAX_ROUTE_GROUPS, ROUTE_CLASS_ORDER, type RouteCurve } from './routeDash';
import {
  CORE_ROUTE_GROUP,
  deriveGraphGroupWeights,
  deriveGraphRouting,
  DOMAIN_ROUTE_GROUP_BASE,
  TRUNK_ROUTE_GROUP_BASE,
  type GraphRouting,
} from './graphRoutes';

const SEED = 17;
const LAYOUT = deriveGraphLayout(GRAPH_MANIFEST);

function structure(detail = 1): CoreStructure {
  return deriveCoreStructure({ structureDetail: detail }, SEED);
}

function routing(): GraphRouting {
  return deriveGraphRouting(GRAPH_MANIFEST, LAYOUT, structure(), 1, SEED);
}

function curvesOfClass(result: GraphRouting, route: RouteCurve['route']): RouteCurve[] {
  return result.curves.filter((curve) => curve.route === route);
}

describe('deriveGraphRouting', () => {
  it('replaces five spokes with shared trunks that fork', () => {
    const result = routing();

    // Two sides of the Core, not one line per domain.
    expect(result.trunks.length).toBe(2);
    for (const trunk of result.trunks) {
      expect(trunk.domains.length).toBeGreaterThan(1);
    }

    const totalDomains = result.trunks.reduce(
      (sum, trunk) => sum + trunk.domains.length,
      0,
    );
    expect(totalDomains).toBe(5);
  });

  it('gives every semantic edge exactly one physical route', () => {
    const result = routing();

    expect(result.routes.length).toBe(GRAPH_MANIFEST.edges.length);

    const edgeIds = new Set(result.routes.map((route) => route.edgeId));
    for (const edge of GRAPH_MANIFEST.edges) {
      expect(edgeIds.has(edge.id)).toBe(true);
    }
  });

  it('makes domains on one trunk depart from a single shared fork point', () => {
    const result = routing();

    for (const trunk of result.trunks) {
      const members = result.routes.filter((route) => route.trunkId === trunk.id);
      expect(members.length).toBe(trunk.domains.length);

      for (const member of members) {
        expect(member.branch.start).toEqual(trunk.fork);
      }
    }
  });

  it('orders curves so the primary lane is exactly the shared trunks', () => {
    const result = routing();

    expect(curvesOfClass(result, 'primary').length).toBe(result.trunks.length);
    expect(curvesOfClass(result, 'secondary').length).toBe(result.routes.length);
    expect(curvesOfClass(result, 'signal').length).toBe(result.routes.length);

    // Draw ranges are contiguous, so the lanes must be emitted in class order.
    const order = result.curves.map((curve) =>
      ROUTE_CLASS_ORDER.indexOf(curve.route),
    );
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it('reveals only the two trunks while idle, which is a few main routes', () => {
    const result = routing();
    const primary = curvesOfClass(result, 'primary');

    expect(primary.length).toBe(2);
    expect(primary.length).toBeLessThan(result.curves.length / 2);
  });

  it('puts each ingress between the Core and its domain, facing the Core', () => {
    const result = routing();
    const centroid = structure().centroid;

    for (const route of result.routes) {
      const anchor = LAYOUT[route.domainId];
      const toIngress = Math.hypot(
        route.ingress.position[0] - centroid[0],
        route.ingress.position[1] - centroid[1],
        route.ingress.position[2] - centroid[2],
      );
      const toAnchor = Math.hypot(
        anchor[0] - centroid[0],
        anchor[1] - centroid[1],
        anchor[2] - centroid[2],
      );

      // The mouth sits just short of the domain, on the Core-facing side.
      expect(toIngress).toBeLessThan(toAnchor);

      // `direction` is the outward normal, so ingressing traffic meets the mouth.
      const dot =
        route.ingress.direction[0] * (centroid[0] - route.ingress.position[0]) +
        route.ingress.direction[1] * (centroid[1] - route.ingress.position[1]) +
        route.ingress.direction[2] * (centroid[2] - route.ingress.position[2]);
      expect(dot).toBeLessThan(0);
    }
  });

  it('arrives at the ingress with the approach curve end', () => {
    const result = routing();

    for (const route of result.routes) {
      expect(route.approach.end).toEqual(route.ingress.position);
      expect(route.branch.end).toEqual(route.approach.start);
    }
  });

  it('keeps every route group inside the eight uniform slots and unique', () => {
    const result = routing();
    const groups = [
      ...result.routes.map((route) => route.group),
      ...result.trunks.map((trunk) => trunk.group),
    ];

    for (const group of groups) {
      expect(group).toBeGreaterThanOrEqual(DOMAIN_ROUTE_GROUP_BASE);
      expect(group).toBeLessThan(MAX_ROUTE_GROUPS);
    }
    expect(new Set(groups).size).toBe(groups.length);
    expect(result.trunks[0]?.group).toBeGreaterThanOrEqual(TRUNK_ROUTE_GROUP_BASE);
  });

  it('leaves group 0 free for the Core circulation', () => {
    const result = routing();
    const used = [
      ...result.routes.map((route) => route.group),
      ...result.trunks.map((trunk) => trunk.group),
    ];

    expect(used).not.toContain(CORE_ROUTE_GROUP);
  });

  it('is deterministic and finite for the whole curve set', () => {
    const first = routing();
    const second = routing();

    expect(second.curves).toEqual(first.curves);

    for (const curve of first.curves) {
      for (const value of [...curve.start, ...curve.control, ...curve.end]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('still produces finite curves when a domain sits exactly on the Core', () => {
    const collapsed = {
      ...LAYOUT,
      graphics: [structure().centroid[0], structure().centroid[1], structure().centroid[2]],
    } as typeof LAYOUT;

    const result = deriveGraphRouting(GRAPH_MANIFEST, collapsed, structure(), 1, SEED);
    const graphics = result.routes.find((route) => route.domainId === 'graphics');

    expect(graphics).toBeDefined();
    for (const curve of [graphics!.branch, graphics!.approach]) {
      for (const value of [...curve.start, ...curve.control, ...curve.end]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('narrows detail without losing the trunk-and-branch topology', () => {
    const coarse = deriveGraphRouting(
      GRAPH_MANIFEST,
      LAYOUT,
      structure(0),
      0.4,
      SEED,
    );

    expect(coarse.trunks.length).toBe(2);
    expect(coarse.routes.length).toBe(5);
  });
});

describe('deriveGraphGroupWeights', () => {
  const base = { activeDomainId: null, focused: false, coreWeight: 0.3 } as const;

  it('lets the strongest trunk lead while idle', () => {
    const result = routing();
    const weights = deriveGraphGroupWeights(result, base);
    const byGroup = new Map(weights.map((entry) => [entry.group, entry.weight]));

    const trunkWeights = result.trunks.map((trunk) => byGroup.get(trunk.group) ?? 0);
    const leader = Math.max(...trunkWeights);
    const follower = Math.min(...trunkWeights);

    expect(leader).toBeGreaterThan(follower);
    // Still clearly the same composition: one route leads, the other is present.
    expect(follower).toBeGreaterThan(0.2);
    expect(leader).toBeLessThanOrEqual(0.9);
  });

  it('lifts the hovered domain branch above the others', () => {
    const result = routing();
    const graphics = result.routes.find((route) => route.domainId === 'graphics')!;
    const ai = result.routes.find((route) => route.domainId === 'ai')!;

    const weights = deriveGraphGroupWeights(result, {
      ...base,
      activeDomainId: 'graphics',
    });
    const byGroup = new Map(weights.map((entry) => [entry.group, entry.weight]));

    expect(byGroup.get(graphics.group)).toBeGreaterThan(byGroup.get(ai.group)!);
  });

  it('recedes non-target domains to outlines once focused', () => {
    const result = routing();
    const graphics = result.routes.find((route) => route.domainId === 'graphics')!;
    const ai = result.routes.find((route) => route.domainId === 'ai')!;

    const hoverWeights = deriveGraphGroupWeights(result, {
      ...base,
      activeDomainId: 'graphics',
    });
    const focusWeights = deriveGraphGroupWeights(result, {
      ...base,
      activeDomainId: 'graphics',
      focused: true,
    });
    const hoverByGroup = new Map(hoverWeights.map((e) => [e.group, e.weight]));
    const focusByGroup = new Map(focusWeights.map((e) => [e.group, e.weight]));

    // Focus must increase separation in both directions at once.
    expect(focusByGroup.get(graphics.group)).toBeGreaterThan(
      hoverByGroup.get(graphics.group)!,
    );
    expect(focusByGroup.get(ai.group)).toBeLessThan(hoverByGroup.get(ai.group)!);
    expect(focusByGroup.get(graphics.group)).toBe(1);
  });

  it('lifts the trunk carrying the active domain', () => {
    const result = routing();
    const graphics = result.routes.find((route) => route.domainId === 'graphics')!;
    const carrying = result.trunks.find((trunk) => trunk.id === graphics.trunkId)!;
    const other = result.trunks.find((trunk) => trunk.id !== graphics.trunkId)!;

    const weights = deriveGraphGroupWeights(result, {
      ...base,
      activeDomainId: 'graphics',
      focused: true,
    });
    const byGroup = new Map(weights.map((entry) => [entry.group, entry.weight]));

    expect(byGroup.get(carrying.group)).toBe(1);
    expect(byGroup.get(other.group)).toBeLessThan(1);
  });

  it('carries the Core weight through without letting it go non-finite', () => {
    const result = routing();

    expect(
      deriveGraphGroupWeights(result, { ...base, coreWeight: 0.55 }).find(
        (entry) => entry.group === CORE_ROUTE_GROUP,
      )?.weight,
    ).toBeCloseTo(0.55, 6);

    expect(
      deriveGraphGroupWeights(result, { ...base, coreWeight: Number.NaN }).find(
        (entry) => entry.group === CORE_ROUTE_GROUP,
      )?.weight,
    ).toBe(0);
  });

  it('never emits a negative weight for hostile input', () => {
    const result = routing();
    const weights = deriveGraphGroupWeights(result, {
      activeDomainId: null,
      focused: false,
      coreWeight: Number.NEGATIVE_INFINITY,
    });

    for (const entry of weights) {
      expect(Number.isFinite(entry.weight)).toBe(true);
      expect(entry.weight).toBeGreaterThanOrEqual(0);
    }
  });
});