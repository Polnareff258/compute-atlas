import { describe, expect, it } from 'vitest';

import { CORE_ROUTE_GROUP } from '../routing/graphRoutes';
import { ROUTE_CLASS_ORDER } from '../routing/routeDash';
import { deriveCoreCirculation } from './coreCirculation';
import { deriveCoreStructure } from './coreStructure';

function structureAt(detail: number) {
  return deriveCoreStructure({ structureDetail: detail });
}

describe('deriveCoreCirculation', () => {
  it('is deterministic for a seed and changes with it', () => {
    const structure = structureAt(1);

    expect(deriveCoreCirculation(structure, 1, 17)).toEqual(
      deriveCoreCirculation(structure, 1, 17),
    );
    expect(deriveCoreCirculation(structure, 1, 17)).not.toEqual(
      deriveCoreCirculation(structure, 1, 23),
    );
  });

  it('grows with detail rather than replacing itself', () => {
    const structure = structureAt(1);
    const sparse = deriveCoreCirculation(structure, 0.2);
    const rich = deriveCoreCirculation(structure, 1);

    expect(sparse.curves.length).toBeGreaterThan(0);
    expect(rich.curves.length).toBeGreaterThan(sparse.curves.length);
  });

  it('writes exactly one route group so it cannot dim a domain branch', () => {
    const circulation = deriveCoreCirculation(structureAt(1), 1);

    for (const curve of circulation.curves) {
      expect(curve.group).toBe(CORE_ROUTE_GROUP);
    }
  });

  it('uses route classes the packed lane order knows about', () => {
    const circulation = deriveCoreCirculation(structureAt(1), 1);
    const classes = new Set(circulation.curves.map((curve) => curve.route));

    for (const routeClass of classes) {
      expect(ROUTE_CLASS_ORDER).toContain(routeClass);
    }
    // The spine is the one route that must always be present at any tier.
    expect(classes.has('primary')).toBe(true);
  });

  it('leaves every curve finite and non-degenerate', () => {
    for (const detail of [0, 0.5, 0.75, 1]) {
      for (const curve of deriveCoreCirculation(structureAt(detail), detail).curves) {
        const values = [...curve.start, ...curve.control, ...curve.end];
        expect(values.every((value) => Number.isFinite(value))).toBe(true);
        expect(Number.isInteger(curve.id)).toBe(true);
        expect(Number.isInteger(curve.group)).toBe(true);

        const length = Math.hypot(
          curve.end[0] - curve.start[0],
          curve.end[1] - curve.start[1],
          curve.end[2] - curve.start[2],
        );
        expect(length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every curve a unique id so packing cannot alias two routes', () => {
    const circulation = deriveCoreCirculation(structureAt(1), 1);
    const ids = circulation.curves.map((curve) => curve.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('runs an ingress from every port so each one reads as connected', () => {
    const structure = structureAt(1);
    const circulation = deriveCoreCirculation(structure, 1);

    // Port ingresses are the signal-class curves; there is one per real port.
    const signalCurves = circulation.curves.filter((curve) => curve.route === 'signal');
    expect(signalCurves.length).toBe(structure.ports.length);

    for (const port of structure.ports) {
      const nearest = signalCurves.reduce<{ id: number; distance: number }>(
        (best, curve) => {
          const distance = Math.hypot(
            curve.start[0] - port.position[0],
            curve.start[1] - port.position[1],
            curve.start[2] - port.position[2],
          );
          return distance < best.distance ? { id: curve.id, distance } : best;
        },
        { id: -1, distance: Number.POSITIVE_INFINITY },
      );

      // The ingress starts at the port mouth, so the closest one is nearly on it.
      expect(nearest.distance).toBeLessThan(0.06);
    }
  });

  it('stays finite for hostile detail values', () => {
    const structure = structureAt(1);

    for (const detail of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const circulation = deriveCoreCirculation(structure, detail);
      expect(circulation.curves.length).toBeGreaterThan(0);
      for (const curve of circulation.curves) {
        expect(Number.isFinite(curve.start[0])).toBe(true);
        expect(Number.isFinite(curve.end[2])).toBe(true);
      }
    }
  });
});
