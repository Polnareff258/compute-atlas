import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';
import { deriveCoreTrajectories, deriveCoreTrajectoryActivation } from './coreTrajectories';
import type { CoreVisualInput } from './coreTypes';
import {
  createCoreTrajectoryResources,
  disposeCoreTrajectoryResources,
  updateCoreTrajectoryResources,
} from './CoreTrajectoryPaths';
import {
  createCoreSignalResources,
  disposeCoreSignalResources,
  updateCoreSignalResources,
} from './CoreSignals';

const baseVisualInput: CoreVisualInput = {
  pointerX: 0.3,
  pointerY: -0.2,
  focusX: 0.7,
  focusY: 0.18,
  focusZ: -0.4,
  intensity: 0.6,
  visualState: 'idle',
  reducedMotion: false,
};

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
  it('maps visual states to deterministic route activation without mutating descriptor points', () => {
    const trajectories = deriveCoreTrajectories({ trajectoryBudget: 12 }, 17);
    const pointsBefore = trajectories.map((trajectory) => trajectory.points.map((point) => [...point]));
    const idle = deriveCoreTrajectoryActivation(trajectories, baseVisualInput);
    const hover = deriveCoreTrajectoryActivation(trajectories, {
      ...baseVisualInput,
      pointerX: -0.84,
      pointerY: 0.42,
      visualState: 'hover_response',
    });
    const focus = deriveCoreTrajectoryActivation(trajectories, {
      ...baseVisualInput,
      focusX: -0.91,
      focusY: 0.18,
      focusZ: 0.52,
      visualState: 'focusing',
    });
    const agent = deriveCoreTrajectoryActivation(trajectories, {
      ...baseVisualInput,
      visualState: 'agent_activity',
    });
    const routeFor = (id: number) => trajectories.find((trajectory) => trajectory.id === id)?.route;

    expect(idle.activeTrajectoryIds.every((id) => {
      const route = routeFor(id);
      return route === 'dormant' || route === 'local';
    })).toBe(true);
    expect(hover.activeTrajectoryIds.length).toBeGreaterThan(0);
    expect(hover.activeTrajectoryIds.every((id) => routeFor(id) === 'local')).toBe(true);
    expect(focus.activeTrajectoryIds.length).toBeGreaterThan(0);
    expect(focus.activeTrajectoryIds.every((id) => routeFor(id) === 'directional')).toBe(true);
    expect(agent.signalTrajectoryIds.length).toBeGreaterThanOrEqual(2);
    expect(agent.signalTrajectoryIds.every((id) => routeFor(id) === 'signal')).toBe(true);
    expect(new Set(agent.signalTrajectoryIds).size).toBe(agent.signalTrajectoryIds.length);
    expect(hover.activeTrajectoryIds).not.toEqual(idle.activeTrajectoryIds);
    expect(focus.activeTrajectoryIds).not.toEqual(hover.activeTrajectoryIds);
    expect(trajectories.map((trajectory) => trajectory.points.map((point) => [...point]))).toEqual(pointsBefore);
  });

  it('keeps activation serializable and bounded for empty paths and reduced motion', () => {
    const trajectories = deriveCoreTrajectories({ trajectoryBudget: 0 }, 17);
    const activation = deriveCoreTrajectoryActivation(trajectories, {
      ...baseVisualInput,
      intensity: Number.NaN,
      pointerX: Number.POSITIVE_INFINITY,
      focusY: Number.NEGATIVE_INFINITY,
      visualState: 'agent_activity',
      reducedMotion: true,
    });

    expect(JSON.parse(JSON.stringify(activation))).toEqual(activation);
    expect(activation.activeTrajectoryIds).toEqual([]);
    expect(activation.signalTrajectoryIds).toEqual([]);
    expect(Number.isFinite(activation.activeSegmentFraction)).toBe(true);
    expect(activation.activeSegmentFraction).toBeGreaterThanOrEqual(0);
    expect(activation.activeSegmentFraction).toBeLessThanOrEqual(1);
    expect(Number.isFinite(activation.signalSpeed)).toBe(true);
    expect(activation.signalSpeed).toBe(0);
  });
  it('reuses merged trajectory buffers while state changes select existing segments', () => {
    const trajectories = deriveCoreTrajectories({ trajectoryBudget: 12 }, 17);
    const resources = createCoreTrajectoryResources(trajectories);
    const idle = deriveCoreTrajectoryActivation(trajectories, baseVisualInput);
    const focus = deriveCoreTrajectoryActivation(trajectories, {
      ...baseVisualInput,
      focusX: -0.9,
      focusY: 0.24,
      focusZ: 0.51,
      visualState: 'focusing',
    });
    const activeBuffer = resources.activePositionAttribute.array;

    updateCoreTrajectoryResources(resources, idle, false);
    const idlePositions = Array.from(activeBuffer);
    updateCoreTrajectoryResources(resources, focus, false);

    expect(resources.passiveGeometry.drawRange.count).toBeGreaterThan(0);
    expect(resources.activePositionAttribute.array).toBe(activeBuffer);
    expect(resources.activeGeometry.drawRange.count).toBeGreaterThan(0);
    expect(Array.from(activeBuffer)).not.toEqual(idlePositions);
    disposeCoreTrajectoryResources(resources);
  });

  it('moves bounded signal points along existing signal trajectories without creating new buffers', () => {
    const trajectories = deriveCoreTrajectories({ trajectoryBudget: 12 }, 17);
    const resources = createCoreSignalResources(trajectories);
    const agent = deriveCoreTrajectoryActivation(trajectories, {
      ...baseVisualInput,
      visualState: 'agent_activity',
    });
    const positions = resources.positionAttribute.array;

    updateCoreSignalResources(resources, agent, 0, false);
    const atStart = Array.from(positions);
    updateCoreSignalResources(resources, agent, 1.5, false);
    const inMotion = Array.from(positions);
    updateCoreSignalResources(resources, agent, 1.5, true);
    const reducedFirst = Array.from(positions);
    updateCoreSignalResources(resources, agent, 4.5, true);

    expect(resources.positionAttribute.array).toBe(positions);
    expect(resources.geometry.drawRange.count).toBe(agent.signalTrajectoryIds.length);
    expect(inMotion).not.toEqual(atStart);
    expect(Array.from(positions)).toEqual(reducedFirst);
    disposeCoreSignalResources(resources);
  });
});
