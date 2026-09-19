import { describe, expect, it } from 'vitest';

import { createInitialGraphInteractionState, reduceGraphInteraction } from '../../graph/interaction';
import { GRAPH_MANIFEST } from '../../graph/graphManifest';
import { deriveGraphLayout } from '../../graph/layout';
import { deriveCoreStructure } from '../core/coreStructure';
import { TRUNK_ROUTE_GROUP_BASE, deriveGraphRouting } from './graphRoutes';
import {
  advanceRouteFlow,
  createRouteFlowState,
  deriveRouteFlowTarget,
  freezeRouteFlow,
} from './routeFlow';
import { ROUTE_CLASS_ORDER, type RouteFlowState } from './routeDash';

const structure = deriveCoreStructure({ structureDetail: 1 });
const routing = deriveGraphRouting(
  GRAPH_MANIFEST,
  deriveGraphLayout(GRAPH_MANIFEST),
  structure,
);

const idle = createInitialGraphInteractionState();
const hovered = reduceGraphInteraction(idle, {
  type: 'POINTER_ENTER_NODE',
  nodeId: 'graphics',
});
const focused = reduceGraphInteraction(hovered, {
  type: 'FOCUS_NODE',
  nodeId: 'graphics',
});

/** Runs the ease long enough to reach the target, as a live frame loop would. */
function settle(
  interaction: Parameters<typeof deriveRouteFlowTarget>[1],
  reducedMotion = false,
  frames = 240,
): RouteFlowState {
  const state = createRouteFlowState();
  const target = deriveRouteFlowTarget(routing, interaction);
  for (let frame = 0; frame < frames; frame += 1) {
    advanceRouteFlow(state, target, 1 / 60, reducedMotion);
  }
  return state;
}

describe('deriveRouteFlowTarget', () => {
  it('keeps idle to one strongly lit outbound route', () => {
    const target = deriveRouteFlowTarget(routing, idle);
    const trunkWeights = routing.trunks.map(
      (trunk) => target.groupWeights.find((entry) => entry.group === trunk.group)?.weight ?? 0,
    );

    expect(trunkWeights).toHaveLength(routing.trunks.length);
    // Exactly one trunk leads, and the other stays clearly behind it.
    expect(Math.max(...trunkWeights)).toBeGreaterThan(0.6);
    expect(Math.min(...trunkWeights)).toBeLessThan(0.5);
  });

  it('lifts the hovered domain and pushes the others back', () => {
    const idleTarget = deriveRouteFlowTarget(routing, idle);
    const hoverTarget = deriveRouteFlowTarget(routing, hovered);
    const weightOf = (
      target: ReturnType<typeof deriveRouteFlowTarget>,
      domainId: string,
    ): number => {
      const route = routing.routes.find((candidate) => candidate.domainId === domainId);
      return target.groupWeights.find((entry) => entry.group === route?.group)?.weight ?? 0;
    };

    expect(weightOf(hoverTarget, 'graphics')).toBeGreaterThan(
      weightOf(idleTarget, 'graphics'),
    );
    expect(weightOf(hoverTarget, 'systems')).toBeLessThan(
      weightOf(idleTarget, 'systems'),
    );
  });

  it('commits focus to a stronger, faster, more compressed field than hover', () => {
    const hoverTarget = deriveRouteFlowTarget(routing, hovered);
    const focusTarget = deriveRouteFlowTarget(routing, focused);

    expect(focusTarget.compression).toBeGreaterThan(hoverTarget.compression);
    expect(focusTarget.wake).toBeGreaterThan(hoverTarget.wake);
    expect(focusTarget.advectionSpeed).toBeGreaterThan(hoverTarget.advectionSpeed);
    expect(focusTarget.laneWeights.signal).toBeGreaterThan(hoverTarget.laneWeights.signal);
    // Non-target domains recede further under focus than under hover.
    const trunkWeight = (target: ReturnType<typeof deriveRouteFlowTarget>): number =>
      Math.min(
        ...routing.trunks.map(
          (trunk) =>
            target.groupWeights.find((entry) => entry.group === trunk.group)?.weight ?? 0,
        ),
      );
    expect(trunkWeight(focusTarget)).toBeLessThan(trunkWeight(hoverTarget));
  });

  it('always keeps every lane and group weight finite and non-negative', () => {
    for (const interaction of [idle, hovered, focused]) {
      const target = deriveRouteFlowTarget(routing, interaction);
      for (const routeClass of ROUTE_CLASS_ORDER) {
        expect(target.laneWeights[routeClass]).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(target.laneWeights[routeClass])).toBe(true);
      }
      for (const entry of target.groupWeights) {
        expect(entry.weight).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(entry.weight)).toBe(true);
      }
    }
  });
});

describe('advanceRouteFlow', () => {
  it('converges on the target rather than overshooting it', () => {
    const target = deriveRouteFlowTarget(routing, focused);
    const settled = settle(focused);

    expect(settled.laneWeights[2]).toBeCloseTo(target.laneWeights.signal, 3);
    expect(settled.compression).toBeCloseTo(target.compression, 3);
    expect(settled.wake).toBeCloseTo(target.wake, 3);
    for (const trunk of routing.trunks) {
      const weight = settled.groupWeights[trunk.group] ?? 0;
      expect(weight).toBeLessThanOrEqual(1.0001);
      expect(weight).toBeGreaterThanOrEqual(0);
    }
  });

  it('restores the idle field on escape without a jump', () => {
    const focusedState = settle(focused);
    const escapeTarget = deriveRouteFlowTarget(routing, idle);
    const before = focusedState.compression;

    // One frame must move the field, not teleport it.
    advanceRouteFlow(focusedState, escapeTarget, 1 / 60, false);
    expect(focusedState.compression).toBeLessThan(before);
    expect(focusedState.compression).toBeGreaterThan(escapeTarget.compression);

    for (let frame = 0; frame < 240; frame += 1) {
      advanceRouteFlow(focusedState, escapeTarget, 1 / 60, false);
    }
    expect(focusedState.compression).toBeCloseTo(escapeTarget.compression, 3);
  });

  it('freezes advection under reduced motion while keeping state readable', () => {
    const state = settle(focused, true);

    expect(state.motionScale).toBe(0);
    expect(state.reducedMotion).toBe(true);
    // The static frame still shows the route selection and compression shape.
    expect(state.compression).toBeGreaterThan(0.5);
    expect(state.laneWeights[0]).toBeGreaterThan(0.5);
  });

  it('survives a non-finite or negative frame delta', () => {
    const state = createRouteFlowState();
    const target = deriveRouteFlowTarget(routing, hovered);

    advanceRouteFlow(state, target, Number.NaN, false);
    advanceRouteFlow(state, target, -1, false);
    for (const weight of state.laneWeights) {
      expect(Number.isFinite(weight)).toBe(true);
      expect(weight).toBeGreaterThanOrEqual(0);
    }
    for (const weight of state.groupWeights) {
      expect(Number.isFinite(weight)).toBe(true);
    }
  });

  it('reaches the target in a single large step instead of crawling', () => {
    const state = createRouteFlowState();
    const target = deriveRouteFlowTarget(routing, idle);

    advanceRouteFlow(state, target, 4, false);
    expect(state.advectionSpeed).toBeCloseTo(target.advectionSpeed, 3);
  });
});

describe('freezeRouteFlow', () => {
  it('returns a still frame that still carries the route selection', () => {
    const frozen = freezeRouteFlow(routing, focused);

    expect(frozen.motionScale).toBe(0);
    expect(frozen.advectionSpeed).toBe(0);
    expect(frozen.reducedMotion).toBe(true);
    expect(frozen.groupWeights[TRUNK_ROUTE_GROUP_BASE]).toBeGreaterThan(0);
    expect(frozen.laneWeights[2]).toBeGreaterThan(0);
  });
});