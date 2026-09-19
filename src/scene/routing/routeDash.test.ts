import { describe, expect, it } from 'vitest';

import {
  compressRouteProgress,
  deriveCurveDashCounts,
  deriveRouteCurveLength,
  deriveRouteDashDensity,
  deriveRouteDashIntensity,
  deriveRouteVisibility,
  ROUTE_VISIBILITY_FLOOR,
  deriveDashEnvelope,
  deriveDashPhase,
  deriveDashScatter,
  deriveDashSpread,
  deriveRouteAcross,
  deriveRouteDashAttributes,
  deriveRouteDashDrawRange,
  deriveRouteGroupWeights,
  deriveStaticFlowState,
  MAX_ROUTE_GROUPS,
  ROUTE_CLASS_ORDER,
  ROUTE_CLASS_SPREAD,
  ROUTE_CLASS_SPREAD_VECTOR,
  sampleRoutePoint,
  sampleRouteTangent,
  type RouteCurve,
} from './routeDash';

const SEED = 17;

function curve(overrides: Partial<RouteCurve> & Pick<RouteCurve, 'id'>): RouteCurve {
  return {
    rank: 1,
    route: 'primary',
    group: 0,
    start: [0, 0, 0],
    control: [1, 0.5, 0],
    end: [2, 0, 0],
    ...overrides,
  };
}

const ROUTES: readonly RouteCurve[] = [
  curve({ id: 0, route: 'primary' }),
  curve({ id: 1, route: 'secondary', start: [0, 1, 0], end: [2, 1, 0] }),
  curve({ id: 2, route: 'signal', start: [0, -1, 0], end: [2, -1, 0] }),
  curve({ id: 3, route: 'ambient', start: [0, 0, 1], end: [2, 0, 1] }),
];

describe('route sampling', () => {
  it('hits the curve endpoints exactly', () => {
    const route = curve({ id: 0 });
    const head: number[] = [0, 0, 0];
    const tail: number[] = [0, 0, 0];

    sampleRoutePoint(route, 0, head);
    sampleRoutePoint(route, 1, tail);

    expect(head).toEqual([0, 0, 0]);
    expect(tail).toEqual([2, 0, 0]);
  });

  it('clamps out-of-range and non-finite progress instead of extrapolating', () => {
    const route = curve({ id: 0 });
    const target: number[] = [0, 0, 0];

    for (const t of [-4, Number.NaN, Number.POSITIVE_INFINITY]) {
      sampleRoutePoint(route, t, target);
      for (const value of target) expect(Number.isFinite(value)).toBe(true);
    }

    sampleRoutePoint(route, -4, target);
    expect(target[0]).toBeCloseTo(0, 6);
  });

  it('returns a unit tangent so the dash stretches along the route', () => {
    const route = curve({ id: 0 });
    const tangent: number[] = [0, 0, 0];

    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      sampleRouteTangent(route, t, tangent);
      expect(Math.hypot(...(tangent as [number, number, number]))).toBeCloseTo(1, 5);
    }
  });

  it('falls back to the chord when the control point collapses the derivative', () => {
    const degenerate = curve({
      id: 0,
      start: [0, 0, 0],
      control: [1, 0, 0],
      end: [0, 0, 0],
    });
    const tangent: number[] = [0, 0, 0];

    sampleRouteTangent(degenerate, 0.5, tangent);
    expect(Math.hypot(...(tangent as [number, number, number]))).toBeCloseTo(1, 5);
  });

  it('derives a unit across-axis orthogonal to the tangent', () => {
    const tangent = [0, 0, 1];
    const across: number[] = [0, 0, 0];

    deriveRouteAcross(tangent, 0, across);

    expect(Math.hypot(...(across as [number, number, number]))).toBeCloseTo(1, 5);
    const dot =
      across[0]! * tangent[0]! + across[1]! * tangent[1]! + across[2]! * tangent[2]!;
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('stays orthogonal even when the tangent is parallel to the up reference', () => {
    const tangent = [0, 1, 0];
    const across: number[] = [0, 0, 0];

    deriveRouteAcross(tangent, 0, across);

    expect(Math.hypot(...(across as [number, number, number]))).toBeCloseTo(1, 5);
  });

  it('widens across the view direction, not across the world up', () => {
    // The whole field is authored against a camera that looks down -Z and never
    // rolls. Building the across axis from world up makes it *always horizontal*,
    // which is exactly what the camera's right vector is — so every band was
    // viewed edge-on and a channel a fifth of a unit wide resolved to the
    // one-pixel scratch the entire routing field used to read as. A route
    // travelling straight left must therefore widen vertically.
    const tangent = [1, 0, 0];
    const across: number[] = [0, 0, 0];

    deriveRouteAcross(tangent, 0, across);

    expect(Math.abs(across[1]!)).toBeGreaterThan(0.9);
    expect(Math.abs(across[2]!)).toBeLessThan(0.2);
  });

  it('keeps the widening continuous as a route turns toward the camera', () => {
    // The facing axis is degenerate for a tangent parallel to it, so there is a
    // fallback — and the fallback has to agree with the primary branch in the
    // limit, because a hard switch between two axes a quarter turn apart tears
    // the ribbon into the loops and hooks that made the hero look scribbled on.
    const sample = (angle: number) => {
      const across: number[] = [0, 0, 0];
      deriveRouteAcross([Math.sin(angle), 0, Math.cos(angle)], 0, across);
      return across;
    };

    let previous = sample(0);
    for (let step = 1; step <= 64; step += 1) {
      const current = sample((step / 64) * (Math.PI / 2));
      const dot = previous[0]! * current[0]! + previous[1]! * current[1]! + previous[2]! * current[2]!;
      // A torn ribbon is a sign flip or a quarter-turn jump between neighbouring
      // samples; a continuous one is a small angle.
      expect(dot).toBeGreaterThan(0.9);
      previous = current;
    }
  });
});

describe('compressRouteProgress', () => {
  it('is the identity when there is nothing to compress', () => {
    for (const t of [0, 0.3, 0.75, 1]) {
      expect(compressRouteProgress(t, 0)).toBeCloseTo(t, 6);
    }
  });

  it('pins both ends and bunches the middle toward arrival', () => {
    expect(compressRouteProgress(0, 1)).toBeCloseTo(0, 6);
    expect(compressRouteProgress(1, 1)).toBeCloseTo(1, 6);

    // Mid-route progress must advance further than linear, which is what draws
    // dashes together in front of the ingress.
    expect(compressRouteProgress(0.5, 1)).toBeGreaterThan(0.5);
    expect(compressRouteProgress(0.5, 1)).toBeLessThanOrEqual(1);
  });

  it('is monotonic in compression so hover reads as a stronger bend than idle', () => {
    const light = compressRouteProgress(0.6, 0.25);
    const heavy = compressRouteProgress(0.6, 0.9);

    expect(heavy).toBeGreaterThan(light);
  });
});

describe('deriveDashEnvelope', () => {
  it('fades in at birth and out at arrival rather than popping', () => {
    expect(deriveDashEnvelope(0, 0)).toBeCloseTo(0, 6);
    expect(deriveDashEnvelope(1, 0)).toBeCloseTo(0, 6);
    expect(deriveDashEnvelope(0.5, 0)).toBeGreaterThan(0.8);
  });

  it('brightens the arrival region as wake rises', () => {
    const quiet = deriveDashEnvelope(0.98, 0);
    const waking = deriveDashEnvelope(0.98, 1);

    expect(waking).toBeGreaterThan(quiet);
  });

  it('stays finite and non-negative for hostile input', () => {
    for (const t of [-1, Number.NaN, 2]) {
      for (const wake of [-5, Number.NaN, 50]) {
        const value = deriveDashEnvelope(t, wake);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('deriveRouteDashAttributes', () => {
  /**
   * Vertices each route class is worth, in class order.
   *
   * Taken from the shared rule rather than written down, because the counts now
   * depend on each curve's own length: the four routes below are purposely not
   * the same length, so a hard-coded stride would be asserting the wrong thing.
   */
  function verticesPerClass(density: number): number[] {
    const counts = deriveCurveDashCounts(ROUTES, density);
    return ROUTE_CLASS_ORDER.map((routeClass) =>
      ROUTES.reduce(
        (sum, route, index) =>
          route.route === routeClass ? sum + (counts[index] ?? 0) * 4 : sum,
        0,
      ),
    );
  }

  it('packs one four-vertex quad per dash with matching indices', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 3, SEED);
    const dashCount = verticesPerClass(3).reduce((sum, count) => sum + count, 0) / 4;

    expect(attributes.dashCount).toBe(dashCount);
    expect(attributes.vertexCount).toBe(attributes.dashCount * 4);
    expect(attributes.indices.length).toBe(attributes.dashCount * 6);

    let highest = 0;
    for (const index of attributes.indices) {
      highest = Math.max(highest, index);
    }
    expect(highest).toBe(attributes.vertexCount - 1);
  });

  it('orders dashes by route class so a draw range can reveal lanes', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 2, SEED);
    const perClass = verticesPerClass(2);

    expect(Array.from(attributes.routeOffsets)).toEqual([
      0, // primary starts at vertex 0
      perClass[0], // + secondary
      (perClass[0] ?? 0) + (perClass[1] ?? 0), // + signal
      (perClass[0] ?? 0) + (perClass[1] ?? 0) + (perClass[2] ?? 0), // + ambient
      attributes.vertexCount, // terminator
    ]);
    expect(attributes.routeOffsets.length).toBe(ROUTE_CLASS_ORDER.length + 1);
  });

  it('reveals only the primary lane while idle and the full set on focus', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 2, SEED);
    const perClass = verticesPerClass(2);

    expect(deriveRouteDashDrawRange(attributes, 1)).toEqual({
      start: 0,
      count: perClass[0],
    });
    expect(deriveRouteDashDrawRange(attributes, 4)).toEqual({
      start: 0,
      count: attributes.vertexCount,
    });
  });

  it('clamps an impossible lane request instead of reading past the buffer', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 2, SEED);

    expect(deriveRouteDashDrawRange(attributes, 99)).toEqual({
      start: 0,
      count: attributes.vertexCount,
    });
    expect(deriveRouteDashDrawRange(attributes, -3)).toEqual({ start: 0, count: 0 });
    expect(deriveRouteDashDrawRange(attributes, Number.NaN)).toEqual({
      start: 0,
      count: 0,
    });
  });

  it('is deterministic and every attribute value is finite', () => {
    const first = deriveRouteDashAttributes(ROUTES, 3, SEED);
    const second = deriveRouteDashAttributes(ROUTES, 3, SEED);

    expect(Array.from(second.phase)).toEqual(Array.from(first.phase));
    expect(Array.from(second.length)).toEqual(Array.from(first.length));

    for (const key of [
      'corner',
      'start',
      'control',
      'end',
      'phase',
      'speed',
      'length',
      'width',
      'route',
      'group',
      'brightness',
    ] as const) {
      for (const value of first[key]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('carries the route group through so one branch can brighten alone', () => {
    const grouped: readonly RouteCurve[] = [
      curve({ id: 0, route: 'primary', group: 1 }),
      curve({ id: 1, route: 'secondary', group: 4 }),
    ];
    const attributes = deriveRouteDashAttributes(grouped, 1, SEED);
    const perCurve = deriveCurveDashCounts(grouped, 1)[0] ?? 0;

    // Primary is emitted first, so the first quad belongs to group 1; the first
    // vertex of the class that follows it belongs to group 4.
    expect(attributes.group[0]).toBe(1);
    expect(attributes.group[perCurve * 4]).toBe(4);
  });

  it('clamps an out-of-range group instead of writing an unreadable uniform slot', () => {
    const attributes = deriveRouteDashAttributes(
      [curve({ id: 0, group: 99 })],
      1,
      SEED,
    );

    expect(attributes.group[0]).toBe(MAX_ROUTE_GROUPS - 1);
  });

  it('spreads dash phases so a still frame is not a stack of identical packets', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 4, SEED);
    const distinct = new Set(Array.from(attributes.phase));

    expect(distinct.size).toBeGreaterThan(4);
  });

  it('allocates nothing when a profile asks for no dashes', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 0, SEED);

    expect(attributes.dashCount).toBe(0);
    expect(attributes.vertexCount).toBe(0);
    expect(attributes.indices.length).toBe(0);
  });
});

describe('deriveDashPhase', () => {
  it('advances with time while motion is allowed', () => {
    const early = deriveDashPhase(0, 0.2, 0, 1);
    const later = deriveDashPhase(0, 0.2, 2, 1);

    expect(later).not.toBeCloseTo(early, 3);
  });

  it('freezes to a spread static phase under reduced motion', () => {
    const first = deriveDashPhase(0, 0.2, 1, 0);
    const second = deriveDashPhase(0, 0.2, 90, 0);

    expect(second).toBeCloseTo(first, 6);
    // Not stacked at the source: the still frame still reads as a flow.
    expect(first).toBeGreaterThan(0.3);
    expect(first).toBeLessThan(0.5);
  });

  it('keeps different dashes at different frozen phases', () => {
    expect(deriveDashPhase(0.1, 0.2, 5, 0)).not.toBeCloseTo(
      deriveDashPhase(0.8, 0.2, 5, 0),
      3,
    );
  });

  it('stays inside the unit interval for hostile input', () => {
    for (const phase of [-3, Number.NaN, 12]) {
      for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, -2]) {
        const value = deriveDashPhase(phase, speed, Number.NaN, 1);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe('deriveRouteGroupWeights', () => {
  it('packs listed groups and settles the rest to the default', () => {
    const weights = deriveRouteGroupWeights(
      [
        { group: 0, weight: 0.3 },
        { group: 3, weight: 1 },
      ],
      0.08,
    );

    expect(weights.length).toBe(MAX_ROUTE_GROUPS);
    expect(weights[0]).toBeCloseTo(0.3, 6);
    expect(weights[3]).toBeCloseTo(1, 6);
    expect(weights[1]).toBeCloseTo(0.08, 6);
    expect(weights[7]).toBeCloseTo(0.08, 6);
  });

  it('drops out-of-range and non-finite entries rather than corrupting a slot', () => {
    const weights = deriveRouteGroupWeights(
      [
        { group: -4, weight: 1 },
        { group: 99, weight: 1 },
        { group: 2, weight: Number.NaN },
        { group: 4, weight: -3 },
      ],
      0.1,
    );

    // Float32 storage, so compare by value rather than by exact representation.
    expect(Array.from(weights).map((value) => Number(value.toFixed(4)))).toEqual([
      0.1, 0.1, 0, 0.1, 0, 0.1, 0.1, 0.1,
    ]);
  });

  it('never emits a negative or non-finite default', () => {
    const weights = deriveRouteGroupWeights([], Number.NaN);

    for (const value of weights) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('deriveStaticFlowState', () => {
  it('stops the field while preserving the static selection', () => {
    const state = deriveStaticFlowState({ compression: 0.8, wake: 0.5 });

    expect(state.motionScale).toBe(0);
    expect(state.reducedMotion).toBe(true);
    expect(state.compression).toBe(0.8);
    expect(state.wake).toBe(0.5);
  });

  it('cannot be talked back into motion by an override', () => {
    const state = deriveStaticFlowState({ motionScale: 5 });

    expect(state.motionScale).toBe(0);
  });
});
describe('deriveRouteVisibility', () => {
  it('removes a route that is not participating rather than dimming it', () => {
    // Dimming alone left every receded route hazing the frame at additive
    // blending, which is what made "the others recede" read as "everything is
    // faintly on".
    expect(deriveRouteVisibility(0)).toBe(0);
    expect(deriveRouteVisibility(ROUTE_VISIBILITY_FLOOR * 0.5)).toBe(0);
    expect(deriveRouteVisibility(ROUTE_VISIBILITY_FLOOR)).toBe(0);
  });

  it('ramps from the floor to a full-weight route on a square root', () => {
    const half = ROUTE_VISIBILITY_FLOOR + (1 - ROUTE_VISIBILITY_FLOOR) * 0.5;

    expect(deriveRouteVisibility(1)).toBeCloseTo(1, 10);
    // The root is the difference between a presence curve and a brightness
    // curve: a linear ramp reads half a route as half a route, and every idle
    // domain at 0.34 as a fifth, which is how the field disappeared.
    expect(deriveRouteVisibility(half)).toBeCloseTo(Math.SQRT1_2, 10);
    expect(deriveRouteVisibility(0.6)).toBeGreaterThan(deriveRouteVisibility(0.3));
  });

  it('keeps a participating route near full and removes one that is not', () => {
    // The three weights the idle composition actually passes: the Core's own
    // circulation at 0.55, the leading trunk at 0.86 and the trailing one at
    // 0.46. Every one of them is above the floor and has to read as present
    // rather than as a ghost of itself, which is what the root is for — a
    // linear ramp would put all three under half.
    expect(deriveRouteVisibility(0.55)).toBeGreaterThan(0.6);
    expect(deriveRouteVisibility(0.86)).toBeGreaterThan(0.85);
    expect(deriveRouteVisibility(0.46)).toBeGreaterThan(0.5);
    // And the weight a domain carries at rest is *below* the floor, so idle
    // draws two shared trunks and no branches. 0.2 is that weight; 0.14 is a
    // non-target domain under hover and 0.05 is one under focus.
    expect(deriveRouteVisibility(0.2)).toBe(0);
    expect(deriveRouteVisibility(0.14)).toBe(0);
    expect(deriveRouteVisibility(0.05)).toBe(0);
  });

  it('stays bounded and finite for inputs that are neither', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -4, 99]) {
      const visibility = deriveRouteVisibility(value);
      expect(Number.isFinite(visibility)).toBe(true);
      expect(visibility).toBeGreaterThanOrEqual(0);
      expect(visibility).toBeLessThanOrEqual(1);
    }
  });
});

describe('deriveRouteDashIntensity', () => {
  it('gives a receded route exactly nothing', () => {
    // Exactly zero, not nearly zero: the vertex shader collapses the packet on
    // this same threshold, and the fallback has to agree with it.
    expect(deriveRouteDashIntensity(1, 1, 0)).toBe(0);
    expect(deriveRouteDashIntensity(1, 1, ROUTE_VISIBILITY_FLOOR)).toBe(0);
  });

  it('still scales an active route by its envelope and brightness', () => {
    const dim = deriveRouteDashIntensity(0.2, 0.5, 1);
    const bright = deriveRouteDashIntensity(0.9, 1, 1);

    expect(bright).toBeGreaterThan(dim);
    expect(dim).toBeGreaterThan(0);
  });

  it('carries a wake boost without exceeding the field ceiling', () => {
    const plain = deriveRouteDashIntensity(0.5, 0.8, 1);
    const woken = deriveRouteDashIntensity(0.5, 0.8, 1, 1.6);

    expect(woken).toBeGreaterThan(plain);
    expect(woken).toBeLessThanOrEqual(1.6);
  });
});

describe('deriveRouteDashDensity', () => {
  it('gives the advected implementation a far denser field', () => {
    const advected = deriveRouteDashDensity(true, 1);
    const instanced = deriveRouteDashDensity(false, 1);

    // Packets per world unit of route. The advected field is dense enough that a
    // route reads as a stream; the fallback carries the same language at a bit
    // over a third of the density, which is the difference the backend is meant
    // to show.
    expect(advected).toBeGreaterThan(instanced * 2);
    expect(instanced).toBeLessThanOrEqual(5);
  });

  it('scales with the profile instead of stepping between two values', () => {
    expect(deriveRouteDashDensity(true, 0.12)).toBeLessThan(
      deriveRouteDashDensity(true, 1),
    );
    expect(deriveRouteDashDensity(false, 0.12)).toBeLessThan(
      deriveRouteDashDensity(false, 1),
    );
    // Hostile detail is a profile of zero, never a negative density.
    expect(deriveRouteDashDensity(true, Number.NaN)).toBe(
      deriveRouteDashDensity(true, 0),
    );
  });
});

describe('deriveRouteCurveLength', () => {
  it('is the chord for a straight route and longer for a bent one', () => {
    const straight = curve({ id: 0, control: [1, 0, 0], end: [2, 0, 0] });
    const bent = curve({ id: 1, control: [1, 1.4, 0], end: [2, 0, 0] });

    expect(deriveRouteCurveLength(straight)).toBeCloseTo(2, 6);
    expect(deriveRouteCurveLength(bent)).toBeGreaterThan(2);
  });

  it('never returns a non-positive length for a degenerate route', () => {
    const point = curve({ id: 0, control: [0, 0, 0], end: [0, 0, 0] });

    // It is a divisor, so zero would make every packet on the route infinite.
    expect(deriveRouteCurveLength(point)).toBeGreaterThan(0);
    expect(Number.isFinite(deriveRouteCurveLength(point))).toBe(true);
  });
});

describe('deriveCurveDashCounts', () => {
  const DENSITY = 6;

  it('gives a long route more packets than a short one', () => {
    const short = curve({ id: 0, control: [0.2, 0.1, 0], end: [0.4, 0, 0] });
    const long = curve({ id: 1, control: [1.3, 0.34, 0.12], end: [2.6, -0.2, 0] });
    const [shortCount, longCount] = deriveCurveDashCounts([short, long], DENSITY);

    // This is what makes the Core the dense end of the field: its circulation is
    // short and long at once, and density per unit of route reads as density per
    // unit of frame exactly there.
    expect(longCount!).toBeGreaterThan(shortCount!);
  });

  it('never drops a route entirely, however short', () => {
    // The floor is one packet, not the three this used to be. On a curve this
    // short a packet is already capped to a third of its own route, so three of
    // them lit it end to end: the reach became a solid bar and, being bent, the
    // white hook that sat over the Core's hull. Short runs are the sparsest part
    // of the field by design — the density is per world unit — so the guarantee
    // here is only that a route is never silently dropped.
    const stub = curve({ id: 0, control: [0.05, 0.02, 0], end: [0.1, 0, 0] });
    const [count] = deriveCurveDashCounts([stub], DENSITY);

    expect(count).toBeGreaterThanOrEqual(1);

    // The length the Core's own ingress reaches actually are, at the density the
    // renderer actually runs at ULTRA. A reach is shorter than a trunk and still
    // has to read as a direction rather than as a dot.
    const reach = curve({ id: 0, control: [0.07, 0.02, 0], end: [0.15, 0, 0] });
    const [reachCount] = deriveCurveDashCounts([reach], deriveRouteDashDensity(true, 1));
    expect(reachCount).toBeGreaterThan(1);
  });

  it('packs nothing at zero density rather than flooring every route up', () => {
    expect(deriveCurveDashCounts(ROUTES, 0)).toEqual([0, 0, 0, 0]);
  });

  it('scales the whole field to meet a capacity instead of cutting its tail off', () => {
    const mixed = [
      curve({ id: 0, control: [0.6, 0.2, 0], end: [1.2, 0, 0] }),
      curve({ id: 1, control: [1.3, 0.34, 0.12], end: [2.6, -0.2, 0] }),
    ];
    const uncapped = deriveCurveDashCounts(mixed, 8);
    const capped = deriveCurveDashCounts(mixed, 8, 9);

    // The old cap spent the ceiling curve by curve, which flattened every route
    // to the same handful of packets; the one before it truncated the packed
    // order, which deleted the later routes entirely. Neither is a sparser field.
    expect(capped.reduce((sum, count) => sum + count, 0)).toBeLessThan(
      uncapped.reduce((sum, count) => sum + count, 0),
    );
    for (const count of capped) expect(count).toBeGreaterThan(0);
    // And the shape survives: the longer route is still the denser one.
    expect(capped[1]!).toBeGreaterThanOrEqual(capped[0]!);
    expect(uncapped[1]!).toBeGreaterThan(uncapped[0]!);
  });
});

describe('packet geometry', () => {
  it('draws packets that are streaks along their route rather than beads', () => {
    // A route of the length the scene actually draws between the Core and a
    // domain. The stored `length` is in route *progress*, so comparing it to a
    // world width directly compares two different quantities — which is what
    // this test did, and why it reported packets several times longer than they
    // were and let them shrink to beads without noticing.
    const route = curve({
      id: 1,
      control: [1.3, 0.34, 0.12],
      end: [2.6, -0.2, 0],
    });
    const attributes = deriveRouteDashAttributes([route], 128, SEED);
    const head: number[] = [0, 0, 0];
    const tail: number[] = [0, 0, 0];

    let shortestStreak = Number.POSITIVE_INFINITY;
    let longest = 0;
    let widest = 0;

    for (let dash = 0; dash < attributes.dashCount; dash += 1) {
      const vertex = dash * 4;
      const length = attributes.length[vertex]!;
      const width = attributes.width[vertex]!;
      const phase = attributes.phase[vertex]!;
      // A packet near the source has its tail clamped at the start, so its drawn
      // extent is genuinely shorter than its own length; those are measured
      // rather than reasoned about, so they are left out of the streak figure.
      if (phase < length) continue;

      sampleRoutePoint(route, phase, head);
      sampleRoutePoint(route, phase - length, tail);
      const worldLength = Math.hypot(
        head[0]! - tail[0]!,
        head[1]! - tail[1]!,
        head[2]! - tail[2]!,
      );

      shortestStreak = Math.min(shortestStreak, worldLength / width);
      longest = Math.max(longest, length);
      widest = Math.max(widest, width);
    }

    // Every packet, not the average one: one bead among a family of streaks is a
    // dot on the frame that the eye stops at.
    //
    // The ratio is the contract and the two bounds below it are its arithmetic.
    // They moved together when the packets were widened: two to six hundredths
    // of a world unit is a band, and a band carrying the old tenth-of-a-unit
    // length would have been a bead by this same ratio — which is what the
    // ratio is here to catch. Both numbers are read off the packer, so a packet
    // that grew in width without growing in length fails here rather than on the
    // frame.
    expect(shortestStreak).toBeGreaterThan(1.5);
    expect(longest).toBeLessThan(0.12);
    expect(widest).toBeLessThan(0.07);
  });

  it('sizes a packet in world units, so a short route gets short packets', () => {
    // A slice of route progress is not a size. One curve here is a trunk and the
    // other is half of it, and the same slice of progress was a fifteen-pixel
    // streak on the first and a blob on the second — which is what made the
    // Core's own circulation read as white hooks laid over the hull while the
    // routes between domains read as wire.
    const trunk = curve({ id: 1, control: [1.3, 0.34, 0.12], end: [2.6, -0.2, 0] });
    // Same id, so the per-packet size jitter is the same and the comparison is
    // between the two curves' lengths alone.
    //
    // Long enough that the length cap does not bind on it. The stub used to be
    // a tenth of the trunk, which put its cap just above the packet size and
    // made this test measure the cap rather than the sizing: the day the packet
    // grew, the two stopped agreeing and the failure had nothing to do with the
    // property under test. The cap has its own assertion below, on both curves.
    const stub = curve({ id: 1, control: [0.65, 0.17, 0.06], end: [1.3, -0.1, 0] });

    const measured = [trunk, stub].map((route) => {
      const attributes = deriveRouteDashAttributes([route], 8, SEED);
      const head: number[] = [0, 0, 0];
      const tail: number[] = [0, 0, 0];
      const length = attributes.length[0]!;
      sampleRoutePoint(route, length, head);
      sampleRoutePoint(route, 0, tail);

      return {
        world: Math.hypot(head[0]! - tail[0]!, head[1]! - tail[1]!, head[2]! - tail[2]!),
        route: deriveRouteCurveLength(route),
      };
    });

    // The same size on both, to within the cap's worth of shortening.
    expect(measured[1]!.world).toBeGreaterThan(measured[0]!.world * 0.8);
    expect(measured[1]!.world).toBeLessThan(measured[0]!.world * 1.2);
    // And the cap is real: a packet is never most of the route it runs on.
    for (const { world, route } of measured) {
      expect(world / route).toBeLessThan(0.35);
    }
  });
});

describe('the routing weave', () => {
  it('indexes the spread table in the class order the shader assumes', () => {
    // The vertex shader indexes the spread table with the same four-component
    // basis it uses for every other per-class quantity, so the vector has to be
    // the table read in `ROUTE_CLASS_ORDER` and nothing else. Written as a test
    // rather than trusted because the failure mode is two backends quietly
    // scattering different classes by different amounts.
    expect(ROUTE_CLASS_ORDER).toEqual(['primary', 'secondary', 'signal', 'ambient']);
    expect([...ROUTE_CLASS_SPREAD_VECTOR]).toEqual(
      ROUTE_CLASS_ORDER.map((route) => ROUTE_CLASS_SPREAD[route]),
    );
  });

  it('opens the band along the route and closes it at the machine', () => {
    for (const route of ROUTE_CLASS_ORDER) {
      const atCore = deriveDashSpread(route, 0, 0);
      const midway = deriveDashSpread(route, 0.5, 0);
      const atDomain = deriveDashSpread(route, 1, 0);

      // Every curve in the scene is authored Core-end at progress 0, so this
      // ordering is the compression zone: filaments converge as they approach
      // the machine and fan out as they leave it.
      expect(atCore).toBeLessThan(midway);
      expect(midway).toBeLessThan(atDomain);
      // But a trunk does not pinch to a line at the Core, which would be the one
      // place a braid is most visible.
      expect(atCore).toBeGreaterThan(0);
    }
  });

  it('orders the classes by how much traffic each one carries', () => {
    const at = (route: (typeof ROUTE_CLASS_ORDER)[number]) =>
      deriveDashSpread(route, 1, 0);

    expect(at('primary')).toBeGreaterThan(at('secondary'));
    expect(at('secondary')).toBeGreaterThan(at('ambient'));
    // The ingress stays precise: a socket that sprayed would not read as one.
    expect(at('signal')).toBeLessThan(at('ambient'));
  });

  it('deploys the braid as the field commits, without ever inverting', () => {
    for (const route of ROUTE_CLASS_ORDER) {
      const idle = deriveDashSpread(route, 1, 0);
      const focus = deriveDashSpread(route, 1, 1);

      // Idle-to-focus is the one transition that must not go backwards: a braid
      // that narrowed as the field committed would read as the route losing
      // traffic at the moment it gains it.
      expect(focus).toBeGreaterThan(idle);
      // And "focus" is not an order of magnitude: the widest band the field can
      // reach still has to sit near its own channel, or the strands detach from
      // the route they belong to and the weave becomes spray.
      expect(focus).toBeLessThan(idle * 4);
    }
  });

  it('places every packet in its band, and never two in the same place', () => {
    const seen = new Set<string>();
    // Where a packet sits laterally, mapped to the depths seen at that lateral
    // position. The two axes are hashed independently, and this is what says so:
    // a single hash puts every packet on a diagonal through its own band, one
    // depth per lateral position, which is a stripe — and a stripe across a band
    // is exactly the line the weave is meant to replace.
    const depthsPerLateral = new Map<string, Set<string>>();

    for (let index = 0; index < 256; index += 1) {
      const phase = (index * 0.6180339887) % 1;
      const { across, through } = deriveDashScatter(phase);

      expect(across).toBeGreaterThanOrEqual(-1);
      expect(across).toBeLessThan(1);
      expect(through).toBeGreaterThanOrEqual(-1);
      expect(through).toBeLessThan(1);
      seen.add(`${across.toFixed(6)}:${through.toFixed(6)}`);
      const key = across.toFixed(1);
      const depths = depthsPerLateral.get(key) ?? new Set<string>();
      depths.add(through.toFixed(1));
      depthsPerLateral.set(key, depths);
    }

    expect(seen.size).toBe(256);
    for (const depths of depthsPerLateral.values()) {
      expect(depths.size).toBeGreaterThan(1);
    }
  });

  it('scatters from the packet phase it is given, and stays finite for any of it', () => {
    for (const phase of [Number.NaN, Number.POSITIVE_INFINITY, -0.4, 3.75]) {
      const { across, through } = deriveDashScatter(phase);
      expect(Number.isFinite(across)).toBe(true);
      expect(Number.isFinite(through)).toBe(true);
    }

    // The same packet keeps its place in the band: the offset is a function of
    // the packet, so it cannot wander while it travels, which would read as
    // noise rather than as flow. Compared closely rather than exactly, because
    // `phase - floor(phase)` is not bit-identical across a whole-number step and
    // the scatter multiplies that residue by ninety.
    expect(deriveDashScatter(0.37)).toEqual(deriveDashScatter(0.37));
    const oneTurn = deriveDashScatter(1.37);
    expect(oneTurn.across).toBeCloseTo(deriveDashScatter(0.37).across, 9);
    expect(oneTurn.through).toBeCloseTo(deriveDashScatter(0.37).through, 9);
  });

  it('stays finite for hostile spread inputs', () => {
    for (const route of ROUTE_CLASS_ORDER) {
      for (const [progress, compression] of [
        [Number.NaN, Number.NaN],
        [-3, 9],
        [Number.POSITIVE_INFINITY, 0.5],
      ] as const) {
        const spread = deriveDashSpread(route, progress, compression);
        expect(Number.isFinite(spread)).toBe(true);
        expect(spread).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
