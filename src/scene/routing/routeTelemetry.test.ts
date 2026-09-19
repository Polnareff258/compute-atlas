import { describe, expect, it } from 'vitest';

import {
  deriveDashesPerRoute,
  deriveRouteDashAttributes,
  deriveRouteDashDrawRange,
  type RouteCurve,
} from './routeDash';
import {
  countFieldDashes,
  deriveRouteFieldTelemetryCounts,
  type RouteFieldSample,
} from './routeTelemetry';

function curve(id: number, route: RouteCurve['route']): RouteCurve {
  return {
    id,
    rank: id,
    route,
    group: 0,
    start: [0, 0, 0],
    control: [0, 1, 0],
    end: [1, 0, 0],
  };
}

/** One of each class, so the draw range has a class boundary to cut on. */
const SCENE_CURVES: readonly RouteCurve[] = [
  curve(1, 'primary'),
  curve(2, 'secondary'),
  curve(3, 'signal'),
  curve(4, 'ambient'),
];

function field(lanes: number, dashesPerRoute = 5, capacity?: number): RouteFieldSample {
  const sample = { curves: SCENE_CURVES, dashesPerRoute, lanes };
  return capacity === undefined ? sample : { ...sample, capacity };
}

describe('countFieldDashes', () => {
  it('reports only the dashes the draw range reveals', () => {
    const counts = countFieldDashes(field(1));

    // One class of one curve at five dashes per route.
    expect(counts.rendered).toBe(5);
    expect(counts.signal).toBe(0);
  });

  it('splits the signal class out once the signal lane is exposed', () => {
    const withoutSignal = countFieldDashes(field(2));
    const withSignal = countFieldDashes(field(3));

    expect(withoutSignal.signal).toBe(0);
    expect(withSignal.signal).toBe(5);
    expect(withSignal.rendered).toBeGreaterThan(withoutSignal.rendered);
  });

  it('never reports more dashes than the field submitted', () => {
    const counts = countFieldDashes(field(4));

    expect(counts.rendered).toBe(SCENE_CURVES.length * 5);
    expect(counts.signal).toBeLessThanOrEqual(counts.rendered);
  });

  it('honours the backend capacity cap without breaking the split', () => {
    const capped = countFieldDashes(field(4, 5, 12));

    expect(capped.rendered).toBe(12);
    // Twelve dashes reach into the third curve, whose class is signal.
    expect(capped.signal).toBe(2);
  });

  it('stays finite for hostile inputs', () => {
    for (const lanes of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const counts = countFieldDashes(field(lanes));
      expect(Number.isFinite(counts.rendered)).toBe(true);
      expect(counts.rendered).toBeGreaterThanOrEqual(0);
    }

    expect(countFieldDashes(field(4, 0))).toEqual({ rendered: 0, signal: 0 });
  });

  it('matches the packed draw range it stands in for', () => {
    // Telemetry counts from descriptors to avoid re-packing the ribbon buffer
    // several times a second. This is the assertion that keeps the shortcut
    // honest: every lane count, with and without a backend cap, must agree with
    // what the packed attributes reveal.
    for (const dashesPerRoute of [0, 1, 3, 7]) {
      const attributes = deriveRouteDashAttributes(SCENE_CURVES, dashesPerRoute, 17);

      for (let lanes = 0; lanes <= 4; lanes += 1) {
        const packed = deriveRouteDashDrawRange(attributes, lanes).count / 4;
        expect(countFieldDashes({ curves: SCENE_CURVES, dashesPerRoute, lanes }).rendered).toBe(
          packed,
        );

        for (const capacity of [3, 11, 40]) {
          const expected = Math.min(packed, capacity);
          expect(
            countFieldDashes({ curves: SCENE_CURVES, dashesPerRoute, lanes, capacity })
              .rendered,
          ).toBe(expected);
        }
      }
    }
  });
});

describe('deriveRouteFieldTelemetryCounts', () => {
  it('adds the Core field and the graph field into one truthful triple', () => {
    const counts = deriveRouteFieldTelemetryCounts(72_000, [field(4), field(1)]);

    expect(counts.configuredFieldBudget).toBe(72_000);
    expect(counts.renderedFieldSamples).toBe(SCENE_CURVES.length * 5 + 5);
    expect(counts.activeSignalSamples).toBe(5);
  });

  it('reports the configured budget unchanged rather than the drawn count', () => {
    const counts = deriveRouteFieldTelemetryCounts(72_000, [field(1)]);

    expect(counts.renderedFieldSamples).toBeLessThan(counts.configuredFieldBudget);
    expect(counts.configuredFieldBudget).toBe(72_000);
  });

  it('reports a denser field for the implementation that can afford it', () => {
    const detail = 1;
    const lanes = 4;
    const advected = deriveRouteFieldTelemetryCounts(72_000, [
      {
        curves: SCENE_CURVES,
        dashesPerRoute: deriveDashesPerRoute(true, detail, lanes),
        lanes,
      },
    ]);
    const instanced = deriveRouteFieldTelemetryCounts(72_000, [
      {
        curves: SCENE_CURVES,
        dashesPerRoute: deriveDashesPerRoute(false, detail, lanes),
        lanes,
        capacity: 180,
      },
    ]);

    expect(advected.renderedFieldSamples).toBeGreaterThan(
      instanced.renderedFieldSamples,
    );
    expect(instanced.renderedFieldSamples).toBeLessThanOrEqual(180);
  });

  it('collapses an empty scene to zeros instead of NaN', () => {
    expect(deriveRouteFieldTelemetryCounts(Number.NaN, [])).toEqual({
      configuredFieldBudget: 0,
      renderedFieldSamples: 0,
      activeSignalSamples: 0,
    });
  });
});
