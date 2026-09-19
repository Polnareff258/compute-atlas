import { describe, expect, it } from 'vitest';

import {
  compressRouteProgress,
  deriveDashEnvelope,
  deriveDashPhase,
  deriveRouteAcross,
  deriveRouteDashAttributes,
  deriveRouteDashDrawRange,
  deriveRouteGroupWeights,
  deriveStaticFlowState,
  MAX_ROUTE_GROUPS,
  ROUTE_CLASS_ORDER,
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
  it('packs one four-vertex quad per dash with matching indices', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 3, SEED);

    expect(attributes.dashCount).toBe(ROUTES.length * 3);
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

    expect(Array.from(attributes.routeOffsets)).toEqual([
      0, // primary starts at vertex 0
      8, // secondary (1 route x 2 dashes x 4 verts)
      16, // signal
      24, // ambient
      32, // terminator
    ]);
    expect(attributes.routeOffsets.length).toBe(ROUTE_CLASS_ORDER.length + 1);
  });

  it('reveals only the primary lane while idle and the full set on focus', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 2, SEED);

    expect(deriveRouteDashDrawRange(attributes, 1)).toEqual({ start: 0, count: 8 });
    expect(deriveRouteDashDrawRange(attributes, 4)).toEqual({ start: 0, count: 32 });
  });

  it('clamps an impossible lane request instead of reading past the buffer', () => {
    const attributes = deriveRouteDashAttributes(ROUTES, 2, SEED);

    expect(deriveRouteDashDrawRange(attributes, 99)).toEqual({ start: 0, count: 32 });
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

    // Primary is emitted first, so the first quad belongs to group 1.
    expect(attributes.group[0]).toBe(1);
    expect(attributes.group[5]).toBe(4);
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