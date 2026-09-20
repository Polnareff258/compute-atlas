import type { GraphInteractionState } from '../../graph/interaction';
import type { GraphManifest } from '../../graph/types';
import { NAMED_DOMAIN_PROMINENCE } from '../../graph/layout';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';
import { createRestingAgentActivity, type AgentActivitySignal } from './agentActivity';

type Vector = readonly [number, number, number];

/**
 * Idle's own activity level.
 *
 * A watershed at rest is still a watershed. Zero would make the idle frame a
 * screenshot of a dry valley, and the brief's idle requirements — data flowing
 * slowly along the surface, regions eroding and depositing, the convergence zone
 * compressing and releasing — are all motion. What idleness buys is
 * *directionlessness*, not stillness.
 *
 * The previous scene learned this the expensive way: every gain in its matter
 * shader was a function of this number, and at 0.24 the field's displacement
 * resolved to about a third of a world unit, so a hundred and twenty thousand
 * units were drawn at very nearly their home positions. It read as soft blotches
 * sitting on surfaces, which is a texture and not a phenomenon. The number below
 * is the one that puts the field's displacement in the same order as its own
 * extent.
 */
const IDLE_ACTIVITY = 0.4;
const HOVER_ACTIVITY = 0.58;
const FOCUS_ACTIVITY = 0.92;

/**
 * The five regional loads.
 *
 * At rest a region still carries its own weight: the composition is ranked, and
 * the ranking is a property of the layout rather than of the interaction, so the
 * idle frame is the same frame every time. A pointed-at region takes over; the
 * others recede but do not go dark, because a landscape where everything except
 * one region has stopped is not a landscape that is running.
 */
export function deriveRegionalLoads(
  manifest: GraphManifest,
  interaction: GraphInteractionState,
  prominence: Readonly<Record<string, number>>,
): number[] {
  const active = interaction.focusedNodeId ?? interaction.hoveredNodeId;
  const loads: number[] = [];

  for (const node of manifest.nodes) {
    if (node.kind !== 'domain') continue;
    const base = prominence[node.id] ?? 0.3;
    const isActive = node.id === active;
    const isFocused = node.id === interaction.focusedNodeId;

    if (isActive) {
      loads.push(isFocused ? 0.95 : 0.72);
    } else if (active !== null) {
      // Something else is being examined. This region keeps running at a
      // fraction of its rest load rather than stopping: the brief's requirement
      // is that "unrelated background field slows and dims", not that it stops.
      loads.push(base * 0.35);
    } else {
      loads.push(base * 0.55);
    }
  }

  return loads;
}

/**
 * The whole of "what is happening" as one record.
 *
 * This is the single translation point between the semantic layer — which knows
 * about nodes, edges and pointer state — and the field layer, which knows about
 * points, directions and gains. Everything downstream of here is a different way
 * of drawing these same numbers, which is why the scene can hold together as one
 * event rather than as several effects that happen to be on screen at once.
 *
 * **The corridor is the flow, and that is the change from the previous scene.**
 * The rift's corridor was a fixed axis through the machine, so idle had to
 * *author* an inflow direction (`riftAxis × -IDLE_INFLOW_DISTANCE`) and both ends
 * were fictions chosen to look plausible. A watershed already has real water in
 * it: the primary river's own course *is* the corridor's shape, and the brief's
 * "primary flow leads the eye" is a statement about the composition rather than a
 * separate lighting decision. So idle's corridor runs down the primary river from
 * its source to the basin, and an active region's corridor runs up its own feeder
 * from that feeder's source to the region. Nothing here is authored; every point
 * is read from the descriptor.
 *
 * The descriptor is consulted here rather than in the view because *which* water
 * carries the signal is semantic: it depends on which region the signal is going
 * to, and the terrain must not be able to make that decision without being told
 * what a domain is.
 */
export function deriveFieldState(input: {
  readonly manifest: GraphManifest;
  readonly interaction: GraphInteractionState;
  readonly prominence: Readonly<Record<string, number>>;
  readonly descriptor: WatershedDescriptor;
}): AgentActivitySignal {
  const { manifest, interaction, prominence, descriptor } = input;
  const resting = createRestingAgentActivity();
  const domainActivity = deriveRegionalLoads(manifest, interaction, prominence);

  /** A point on the spine, lifted clear of the ground it is carved into. */
  const onCourse = (point: readonly [number, number]): Vector => [point[0], 0, point[1]];

  const basinTarget: Vector = [
    descriptor.basin.centre[0],
    descriptor.basinFloor,
    descriptor.basin.centre[1],
  ];

  const activeId = interaction.focusedNodeId ?? interaction.hoveredNodeId;

  if (activeId === null) {
    // Idle: the primary river runs the length of the frame and the basin is what
    // it runs into. Falling back to the basin's own centre when there is no
    // primary river keeps the corridor's *span* non-zero in every seed, because a
    // zero-length corridor is a division by zero in the shader — see the guard in
    // `fieldUniforms.update`.
    const primary = descriptor.rivers.find((river) => river.id === 'primary');
    const source = primary?.spine[0];
    const origin: Vector = source ? onCourse(source) : [basinTarget[0], basinTarget[1], basinTarget[2] + 260];

    return {
      ...resting,
      activityStrength: IDLE_ACTIVITY,
      activityPhase: 0,
      signalOrigin: origin,
      signalTarget: basinTarget,
      routeCongestion: 0,
      domainActivity,
      operationProgress: 0,
      phase: 'idle',
    };
  }

  const focused = interaction.focusedNodeId !== null;
  const domain = descriptor.domains.find((candidate) => candidate.id === activeId);
  const feeder = descriptor.rivers.find((river) => river.domainId === activeId);
  const target: Vector = domain
    ? [domain.centre[0], domain.labelAnchor[1], domain.centre[1]]
    : basinTarget;
  // The feeder's source. Every domain-feeding river lands *exactly* on its
  // domain's anchor — asserted in the descriptor's tests — so the corridor's
  // target end is the region itself and not an approximation of it.
  const origin: Vector = feeder?.spine[0] ? onCourse(feeder.spine[0]) : target;

  return {
    ...resting,
    activityStrength: focused ? FOCUS_ACTIVITY : HOVER_ACTIVITY,
    activityPhase: 0,
    semanticTarget: domain ? domain.id : null,
    signalOrigin: origin,
    signalTarget: target,
    routeCongestion: focused ? 0.18 : 0.08,
    domainActivity,
    operationProgress: focused ? 0.55 : 0.2,
    phase: focused ? 'running' : 'awaiting',
  };
}

/** At or above this a domain carries its name at rest. */
export { NAMED_DOMAIN_PROMINENCE };
