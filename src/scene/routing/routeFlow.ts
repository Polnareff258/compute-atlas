import type { GraphInteractionState } from '../../graph/interaction';
import {
  deriveGraphGroupWeights,
  type DomainVisualNodeId,
  type GraphRouting,
} from './graphRoutes';
import {
  ROUTE_CLASS_ORDER,
  deriveRouteGroupWeights,
  deriveStaticFlowState,
  type RouteClass,
  type RouteFlowState,
} from './routeDash';

/**
 * The single signal language shared by the Core's own circulation and the Graph
 * routes.
 *
 * Both write into one state object because lane weights are scene-wide: "how much
 * of each route class is lit" is a property of the interaction state, not of a
 * particular route family. Route *groups* stay per-route so one domain's branch
 * can lift while the others recede.
 */
export type RouteFlowTarget = {
  readonly laneWeights: Readonly<Record<RouteClass, number>>;
  readonly groupWeights: readonly { readonly group: number; readonly weight: number }[];
  readonly advectionSpeed: number;
  readonly compression: number;
  readonly wake: number;
  /** Unit direction the whole field leans toward while a target is bound. */
  readonly bend: readonly [number, number, number];
  readonly bendAmount: number;
};

/** How fast the flow eases toward its target, in reciprocal seconds. */
export const APPROACH_RATE = 3.4;
/** Reduced motion still gets a real transition, just a very short one. */
export const REDUCED_MOTION_RATE = 22;

/**
 * The scene's one motion transfer function.
 *
 * Routes ease with it, and so do the surfaces that open to receive them, so a
 * domain's membrane and the signal arriving at its ingress cannot settle at
 * different speeds. Frame-rate independent, and pinned to 1 on a large step so a
 * resumed tab lands on its target instead of crawling part of the way.
 */
export function easeApproach(
  from: number,
  to: number,
  deltaSeconds: number,
  reducedMotion: boolean,
): number {
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const rate = reducedMotion ? REDUCED_MOTION_RATE : APPROACH_RATE;
  const t = Math.min(1, 1 - Math.exp(-rate * delta));
  const safeFrom = Number.isFinite(from) ? from : 0;
  const safeTo = Number.isFinite(to) ? to : 0;
  return safeFrom + (safeTo - safeFrom) * t;
}

const IDLE_LANES: Readonly<Record<RouteClass, number>> = {
  primary: 1,
  secondary: 0.42,
  signal: 0.3,
  ambient: 0.55,
};

const HOVER_LANES: Readonly<Record<RouteClass, number>> = {
  primary: 1,
  secondary: 0.62,
  signal: 0.6,
  ambient: 0.34,
};

const FOCUS_LANES: Readonly<Record<RouteClass, number>> = {
  primary: 1,
  secondary: 0.88,
  signal: 1,
  ambient: 0.18,
};

export function createRouteFlowState(): RouteFlowState {
  return {
    laneWeights: [0, 0, 0, 0],
    groupWeights: [0, 0, 0, 0, 0, 0, 0, 0],
    advectionSpeed: 0,
    compression: 0,
    wake: 0,
    bend: [0, 0, 0],
    bendAmount: 0,
    motionScale: 1,
    reducedMotion: false,
  };
}

/**
 * Where the field wants to be for one discrete interaction state.
 *
 * Only discrete semantic states reach this function: hover, focus and the
 * absence of both. Continuous time, intensity and progress never travel through
 * React state, they are eased in `advanceRouteFlow` from these targets.
 *
 * `restingProminence` is the idle composition's ranking. It is optional because
 * a caller that has no ranking to offer gets the unranked field it had before
 * the ranking existed, rather than a field that silently collapses to the
 * dormant floor.
 */
export function deriveRouteFlowTarget(
  routing: GraphRouting,
  interaction: GraphInteractionState,
  restingProminence?: Readonly<Record<DomainVisualNodeId, number>>,
): RouteFlowTarget {
  const activeDomainId = interaction.focusedNodeId ?? interaction.hoveredNodeId;
  const focused = interaction.focusedNodeId !== null;
  const hasTarget = activeDomainId !== null;

  const lanes = focused ? FOCUS_LANES : hasTarget ? HOVER_LANES : IDLE_LANES;
  const bend = deriveBendDirection(routing, activeDomainId === 'core' ? null : activeDomainId);

  return {
    laneWeights: lanes,
    groupWeights: deriveGraphGroupWeights(routing, {
      activeDomainId: activeDomainId === 'core' ? null : activeDomainId,
      focused,
      // Idle is 0.55 rather than 0.3 because the field's visibility floor moved
      // up above the idle domain weights, and the Core's own circulation is not
      // a domain: it is the thing the idle frame is *of*. Left at 0.3 it would
      // have been culled along with the branches, and the brief's idle picture —
      // a still machine with a slow weave turning over inside it — would have
      // been a machine with nothing running in it at all.
      coreWeight: focused ? 0.92 : hasTarget ? 0.66 : 0.55,
      // Only read at rest; `deriveGraphGroupWeights` says why.
      ...(restingProminence === undefined ? {} : { restingProminence }),
    }),
    // Idle circulates slowly; focus commits a continuous source-to-target flow.
    advectionSpeed: focused ? 1.35 : hasTarget ? 1 : 0.55,
    compression: focused ? 0.88 : hasTarget ? 0.58 : 0.18,
    wake: focused ? 0.85 : hasTarget ? 0.52 : 0.12,
    bend,
    // Idle has no target to lean toward, so the interior just circulates.
    bendAmount: !hasTarget ? 0 : focused ? 0.26 : 0.16,
  };
}

/**
 * Direction from the Core toward the active domain's ingress.
 *
 * The field bends along this, so the interior and the graph routes deform
 * together instead of only the route to the target responding.
 */
function deriveBendDirection(
  routing: GraphRouting,
  activeDomainId: DomainVisualNodeId | null,
): readonly [number, number, number] {
  if (activeDomainId === null) return [0, 0, 0];
  const route = routing.routes.find((candidate) => candidate.domainId === activeDomainId);
  if (!route) return [0, 0, 0];

  const mouth = route.ingress.position;
  const length = Math.hypot(mouth[0], mouth[1], mouth[2]);
  if (!Number.isFinite(length) || length < 1e-6) return [0, 0, 0];
  return [mouth[0] / length, mouth[1] / length, mouth[2] / length];
}

/**
 * Eases the live flow state toward a target.
 *
 * Escape restores the idle composition by easing rather than snapping, and
 * reduced motion keeps a genuinely short transition instead of a continuous
 * drift.
 */
export function advanceRouteFlow(
  state: RouteFlowState,
  target: RouteFlowTarget,
  deltaSeconds: number,
  reducedMotion: boolean,
): void {
  const laneWeights = state.laneWeights;
  for (let index = 0; index < ROUTE_CLASS_ORDER.length; index += 1) {
    const routeClass = ROUTE_CLASS_ORDER[index]!;
    laneWeights[index] = easeApproach(
      laneWeights[index] ?? 0,
      target.laneWeights[routeClass],
      deltaSeconds,
      reducedMotion,
    );
  }

  const nextGroups = deriveRouteGroupWeights(target.groupWeights);
  const groupWeights = state.groupWeights;
  for (let index = 0; index < groupWeights.length; index += 1) {
    groupWeights[index] = easeApproach(
      groupWeights[index] ?? 0,
      nextGroups[index] ?? 0,
      deltaSeconds,
      reducedMotion,
    );
  }

  state.advectionSpeed = easeApproach(
    state.advectionSpeed,
    target.advectionSpeed,
    deltaSeconds,
    reducedMotion,
  );
  state.compression = easeApproach(
    state.compression,
    target.compression,
    deltaSeconds,
    reducedMotion,
  );
  state.wake = easeApproach(state.wake, target.wake, deltaSeconds, reducedMotion);
  // Direction is eased as a raw vector, then split back into a unit direction
  // and a magnitude, so a bend that reverses sweeps through the intervening
  // directions instead of flipping and re-normalising in one frame.
  const bend = state.bend;
  const targetX = target.bend[0] * target.bendAmount;
  const targetY = target.bend[1] * target.bendAmount;
  const targetZ = target.bend[2] * target.bendAmount;
  const rawX = easeApproach(bend[0] ?? 0, targetX, deltaSeconds, reducedMotion);
  const rawY = easeApproach(bend[1] ?? 0, targetY, deltaSeconds, reducedMotion);
  const rawZ = easeApproach(bend[2] ?? 0, targetZ, deltaSeconds, reducedMotion);
  const magnitude = Math.hypot(rawX, rawY, rawZ);

  if (magnitude > 1e-6) {
    bend[0] = rawX / magnitude;
    bend[1] = rawY / magnitude;
    bend[2] = rawZ / magnitude;
    state.bendAmount = magnitude;
  } else {
    state.bendAmount = 0;
  }

  state.motionScale = reducedMotion ? 0 : 1;
  state.reducedMotion = reducedMotion;
}

/**
 * A representative still frame for reduced motion: route selection, compression
 * shape and state readability survive, but nothing circulates.
 */
export function freezeRouteFlow(
  routing: GraphRouting,
  interaction: GraphInteractionState,
  restingProminence?: Readonly<Record<DomainVisualNodeId, number>>,
): RouteFlowState {
  const target = deriveRouteFlowTarget(routing, interaction, restingProminence);
  return deriveStaticFlowState({
    laneWeights: ROUTE_CLASS_ORDER.map((routeClass) => target.laneWeights[routeClass]),
    groupWeights: Array.from(deriveRouteGroupWeights(target.groupWeights)),
    advectionSpeed: 0,
    compression: target.compression,
    wake: target.wake,
  });
}