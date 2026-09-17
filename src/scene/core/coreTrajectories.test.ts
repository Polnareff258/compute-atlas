import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';
import { deriveCoreTrajectories } from './coreTrajectories';

function distanceSquared(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  const deltaZ = first[2] - second[2];

  return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
}

function expectFiniteOpenPaths(
  trajectories: ReturnType<typeof deriveCoreTrajectories>,
): void {
  for (const trajectory of trajectories) {
    const start = trajectory.points[0];
    const end = trajectory.points.at(-1);

    expect(trajectory.points.every((point) => point.every(Number.isFinite))).toBe(true);
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(distanceSquared(start!, end!)).toBeGreaterThan(0.04);
  }
}

describe('deriveCoreTrajectories', () => {
  const parameters = getCoreParameters('ultra');

  it('produces deterministic serializable paths for equal inputs', () => {
    const first = deriveCoreTrajectories(parameters, 17);
    const second = deriveCoreTrajectories(parameters, 17);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
  });

  it('keeps every sampled point finite and every path open', () => {
    const trajectories = deriveCoreTrajectories(parameters, 17);

    expect(trajectories.length).toBeGreaterThan(0);
    for (const trajectory of trajectories) {
      const start = trajectory.points[0];
      const end = trajectory.points.at(-1);

      expect(start).toBeDefined();
      expect(end).toBeDefined();
      expect(trajectory.points.length).toBeGreaterThanOrEqual(3);
      expect(trajectory.points.every((point) => point.every(Number.isFinite))).toBe(true);
      expect(start?.some((coordinate) => Math.abs(coordinate) > 0.01)).toBe(true);
      expect(end?.some((coordinate) => Math.abs(coordinate) > 0.01)).toBe(true);
      expect(distanceSquared(start!, end!)).toBeGreaterThan(0.04);
    }
  });

  it('uses varied open path lengths and endpoint pairs', () => {
    const trajectories = deriveCoreTrajectories(parameters, 17);
    const lengths = new Set(trajectories.map((trajectory) => trajectory.points.length));
    const endpointPairs = new Set(
      trajectories.map((trajectory) => {
        const start = trajectory.points[0]!;
        const end = trajectory.points.at(-1)!;

        return `${start.join(',')}|${end.join(',')}`;
      }),
    );

    expect(lengths.size).toBeGreaterThanOrEqual(2);
    expect(endpointPairs.size).toBeGreaterThanOrEqual(2);
  });

  it('scales path count with quality while preserving a SAFE path', () => {
    const ultra = deriveCoreTrajectories(getCoreParameters('ultra'), 17);
    const safe = deriveCoreTrajectories(getCoreParameters('safe'), 17);

    expect(safe.length).toBeGreaterThanOrEqual(1);
    expect(safe.length).toBeLessThan(ultra.length);
  });

  it('normalizes boundary budgets without creating invalid or excess paths', () => {
    const cases = [
      { budget: 0, maximumPathCount: 0 },
      { budget: -3, maximumPathCount: 0 },
      { budget: 2.75, maximumPathCount: 2 },
      { budget: Number.NaN, maximumPathCount: 0 },
      { budget: Number.POSITIVE_INFINITY, maximumPathCount: 0 },
    ];

    for (const { budget, maximumPathCount } of cases) {
      const first = deriveCoreTrajectories({ trajectoryBudget: budget }, 17);
      const second = deriveCoreTrajectories({ trajectoryBudget: budget }, 17);

      expect(first).toEqual(second);
      expect(first.length).toBeLessThanOrEqual(maximumPathCount);
      expectFiniteOpenPaths(first);
    }

    expect(deriveCoreTrajectories(getCoreParameters('safe'), 17).length).toBeGreaterThanOrEqual(1);
  });

  it('varies routes and uses unique ordered activation ranks for normal paths', () => {
    const trajectories = deriveCoreTrajectories({ trajectoryBudget: 8 }, 17);
    const routes = new Set(trajectories.map((trajectory) => trajectory.route));
    const activationRanks = trajectories.map((trajectory) => trajectory.activationRank);

    expect(routes.size).toBeGreaterThan(1);
    expect(activationRanks.every(Number.isFinite)).toBe(true);
    expect(new Set(activationRanks).size).toBe(activationRanks.length);
    expect(activationRanks).toEqual([...activationRanks].sort((first, second) => first - second));
    expectFiniteOpenPaths(trajectories);
  });
});
