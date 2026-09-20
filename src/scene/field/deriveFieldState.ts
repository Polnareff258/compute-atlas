import type { GraphInteractionState } from '../../graph/interaction';
import type { GraphLayout } from '../../graph/types';
import { NAMED_DOMAIN_PROMINENCE } from '../../graph/layout';
import type { GraphManifest } from '../../graph/types';
import type { RiftStructure } from '../hero/riftStructure';
import { selectRiftPortForDirection } from '../hero/riftStructure';
import { createRestingAgentActivity, type AgentActivitySignal } from './agentActivity';

type Vector = readonly [number, number, number];

/**
 * Idle's own activity level.
 *
 * A foundry at rest is still a foundry. Zero would make the idle frame a
 * screenshot of an unpowered machine, and the brief's idle requirements —
 * breathing density layers, flowing sheets, streams entering from far — are all
 * motion. What idleness buys is *directionlessness*, not stillness.
 *
 * Raised from 0.24 after the second capture. Every gain in the matter shader is
 * a function of this number, and at 0.24 the field's own displacement term
 * (`live`, in `dataMatterMaterial`) resolved to about a third of a world unit —
 * so a hundred and twenty thousand units were being drawn at very nearly their
 * home positions, in a volume the size of the cavity. The result did not read as
 * a volume of matter moving through a machine; it read as soft blotches sitting
 * on the machine's surfaces, which is a texture and not a phenomenon. The
 * number below is the one that puts the field's displacement in the same order
 * as its own extent.
 */
const IDLE_ACTIVITY = 0.4;
const HOVER_ACTIVITY = 0.58;
const FOCUS_ACTIVITY = 0.92;

/**
 * How far along the rift axis the idle inflow is authored to come from.
 *
 * Only the geometry of the idle corridor is decided here. How *hard* idle pulls
 * matter in is not: that is the corridor's strength, and it is resolved in
 * `fieldUniforms.update` from `IDLE_CORRIDOR` plus the interaction terms,
 * because the same number also has to answer for hover and focus and splitting
 * it across two modules is how the two ends drift apart.
 */
const IDLE_INFLOW_DISTANCE = 46;

/**
 * The five regional loads.
 *
 * At rest a region still carries its own weight: the composition is ranked, and
 * the ranking is a property of the layout rather than of the interaction, so the
 * idle frame is the same frame every time. A pointed-at region takes over; the
 * others recede but do not go dark, because a machine where everything except
 * one bay has stopped is a machine that is not running.
 */
export function deriveRegionalLoads(
  manifest: GraphManifest,
  layout: GraphLayout,
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

  void layout;
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
 * The rift is consulted here rather than in the view because *which* port the
 * signal leaves from is semantic: it depends on where the signal is going, and
 * the hero must not be able to make that decision without being told what a
 * domain is.
 */
export function deriveFieldState(input: {
  readonly manifest: GraphManifest;
  readonly layout: GraphLayout;
  readonly interaction: GraphInteractionState;
  readonly prominence: Readonly<Record<string, number>>;
  readonly rift: RiftStructure;
}): AgentActivitySignal {
  const { manifest, layout, interaction, prominence, rift } = input;
  const resting = createRestingAgentActivity();
  const domainActivity = deriveRegionalLoads(
    manifest,
    layout,
    interaction,
    prominence,
  );

  const activeId = interaction.focusedNodeId ?? interaction.hoveredNodeId;

  if (activeId === null) {
    // Idle: matter enters along the spine from far out and reconfigures at the
    // throat. The origin is authored at a fixed distance so the corridor is the
    // same length every time — a corridor whose length varied with nothing would
    // make the field's compression term drift for no reason.
    const along: Vector = [
      rift.riftAxis[0] * -IDLE_INFLOW_DISTANCE,
      rift.riftAxis[1] * -IDLE_INFLOW_DISTANCE,
      rift.riftAxis[2] * -IDLE_INFLOW_DISTANCE,
    ];
    const origin: Vector = [
      rift.riftCentre[0] + along[0],
      rift.riftCentre[1] + along[1],
      rift.riftCentre[2] + along[2],
    ];
    return {
      ...resting,
      activityStrength: IDLE_ACTIVITY,
      activityPhase: 0,
      signalOrigin: origin,
      signalTarget: rift.riftCentre,
      routeCongestion: 0,
      domainActivity,
      operationProgress: 0,
      phase: 'idle',
    };
  }

  const focused = interaction.focusedNodeId !== null;
  const target = layout[activeId];
  const direction: Vector = [
    target[0] - rift.riftCentre[0],
    target[1] - rift.riftCentre[1],
    target[2] - rift.riftCentre[2],
  ];
  const port = selectRiftPortForDirection(rift, direction);

  return {
    ...resting,
    activityStrength: focused ? FOCUS_ACTIVITY : HOVER_ACTIVITY,
    activityPhase: 0,
    semanticTarget: activeId,
    signalOrigin: port.position,
    signalTarget: target,
    routeCongestion: focused ? 0.18 : 0.08,
    domainActivity,
    operationProgress: focused ? 0.55 : 0.2,
    phase: focused ? 'running' : 'awaiting',
  };
}

/** At or above this a domain carries its name at rest. */
export { NAMED_DOMAIN_PROMINENCE };
