import { Color, Vector3 } from 'three';
import { uniform } from 'three/tsl';

import { ENERGY_PALETTE, MACHINE_PALETTE } from '../materials/machinePalette';
import type { AgentActivitySignal } from './agentActivity';
import { resolveResultHue } from './agentActivity';

/**
 * The one block of GPU state the whole scene writes and the whole scene reads.
 *
 * Every material in the scene — the rift's structural shading, the matter field,
 * the membranes, the routing bundles, the backdrop — samples from this object.
 * That is the entire reason the scene can hold together as one event: there is
 * exactly one place where "what is happening" becomes numbers, and everything
 * downstream is a different way of drawing the same numbers.
 *
 * It is a *mutable singleton*, written in place once per frame. It is not React
 * state and must never become React state: the values change at frame rate and
 * a re-render per frame would be the end of the scene's budget. Nothing here
 * allocates after construction.
 *
 * The uniform set is deliberately small. Each entry is read by every material,
 * so the cost of adding one is paid across the whole scene, and a large uniform
 * block is a uniform block nobody can reason about. Eleven scalars, three
 * vectors and five colours is what the visual language actually needs:
 *
 * - **Activity** — the master gain. Everything that moves moves more when it is
 *   high, and this is the only value a superposed "how busy is it" reads from.
 * - **Hover / focus** — the two interaction strengths, kept separate because
 *   they are different phenomena: hover is a local field response, focus is a
 *   reconfiguration of the whole route.
 * - **Congestion / progress** — the two ends of an operation, and the reason the
 *   scene can express contention and completion without a second system.
 * - **Signal origin / target / strength** — the corridor. A vector pair rather
 *   than a node id, because the field system must not know what a domain is.
 * - **Five regional loads** — local activity, in manifest order, so a region
 *   that is working generates local structure and one that is not does not.
 * - **Elapsed and quality** — time, and the density scalar the shaders use to
 *   trade detail for budget without changing the art direction.
 */
export type FieldUniforms = ReturnType<typeof createFieldUniforms>;

/**
 * The corridor strength the machine carries when nothing is being asked of it.
 *
 * Small, and not zero. Idle's corridor is the spine of the composition: it is
 * what draws the rift as a lit channel through the hero and what gives the
 * entering matter something to be heading toward. Setting it to zero is not
 * "idle is quiet", it is "the hero has no axis" — see the note in `update`.
 */
const IDLE_CORRIDOR = 0.4;

const RESULT_HUES = {
  none: ENERGY_PALETTE.cyan,
  amber: ENERGY_PALETTE.amber,
  magenta: ENERGY_PALETTE.magenta,
} as const;

export function createFieldUniforms() {
  const uSignalOrigin = uniform(new Vector3(0, 0, 0));
  const uSignalTarget = uniform(new Vector3(0, 0, 0));
  const uStructuralLight = uniform(new Vector3(0, 0, 1));
  /** The rift's spine. Structural, not semantic: the matter field circulates
   *  around it and the travelling bands run along it. */
  const uRiftAxis = uniform(new Vector3(0, 0, 1));
  const uRiftCentre = uniform(new Vector3(0, 0, 0));

  const uFlow = uniform(new Color(ENERGY_PALETTE.cyan));
  const uDeep = uniform(new Color(ENERGY_PALETTE.ultraviolet));
  const uPeak = uniform(new Color(ENERGY_PALETTE.hot));
  const uRim = uniform(new Color(ENERGY_PALETTE.rim));
  const uMass = uniform(new Color(MACHINE_PALETTE.shellHigh));
  const uAnomaly = uniform(new Color(ENERGY_PALETTE.cyan));

  const uniforms = {
    uTime: uniform(0),
    uQuality: uniform(1),

    uActivity: uniform(0.22),
    uHover: uniform(0),
    uFocus: uniform(0),
    uCongestion: uniform(0),
    uProgress: uniform(0),
    uPhase: uniform(0),

    uSignalOrigin,
    uSignalTarget,
    uSignalStrength: uniform(0),
    /** Direction the key light comes from, in world space, for the rim term. */
    uStructuralLight,
    uRiftAxis,
    uRiftCentre,

    uLoadA: uniform(0),
    uLoadB: uniform(0),
    uLoadC: uniform(0),
    uLoadD: uniform(0),
    uLoadE: uniform(0),

    uFlow,
    uDeep,
    uPeak,
    uRim,
    uMass,
    uAnomaly,
  };

  const loadTargets = [
    uniforms.uLoadA,
    uniforms.uLoadB,
    uniforms.uLoadC,
    uniforms.uLoadD,
    uniforms.uLoadE,
  ];

  const scratchOrigin = new Vector3();
  const scratchTarget = new Vector3();

  /**
   * Writes a frame's worth of state in place.
   *
   * `elapsed` is passed rather than read from a clock so a reduced-motion frame
   * can pass a frozen time and get a frozen image out of the same code path —
   * the alternative, branching on reduced motion inside every shader, is five
   * copies of the same decision.
   */
  function update(
    signal: AgentActivitySignal,
    interaction: {
      readonly hover: number;
      readonly focus: number;
    },
    elapsed: number,
  ): void {
    uniforms.uTime.value = elapsed;
    uniforms.uActivity.value = clamp01(signal.activityStrength);
    uniforms.uHover.value = clamp01(interaction.hover);
    uniforms.uFocus.value = clamp01(interaction.focus);
    uniforms.uCongestion.value = clamp01(signal.routeCongestion);
    uniforms.uProgress.value = clamp01(signal.operationProgress);
    uniforms.uPhase.value = clamp01(signal.activityPhase);

    scratchOrigin.set(
      signal.signalOrigin[0],
      signal.signalOrigin[1],
      signal.signalOrigin[2],
    );
    scratchTarget.set(
      signal.signalTarget[0],
      signal.signalTarget[1],
      signal.signalTarget[2],
    );
    uSignalOrigin.value.copy(scratchOrigin);
    uSignalTarget.value.copy(scratchTarget);

    const span = scratchTarget.distanceTo(scratchOrigin);
    // A signal with no span is not a corridor, and a zero-length corridor would
    // make the shader's direction term a division by zero. Normalising to one
    // unit of length keeps the falloff continuous through the degenerate case.
    //
    // The floor is the part that matters. This used to resolve to zero whenever
    // nothing was pointed at, on the reasoning that idle is the absence of a
    // request — and that is true of a *request* and false of the machine. A
    // foundry at rest still has metal moving through it: the brief's idle frame
    // requires streams entering from far away and reconfiguring inside the Core,
    // and a corridor strength of zero deletes the one term that draws them. The
    // result was an idle frame whose hero carried no light along its own axis at
    // all, which is why the first capture of this composition had a black rift
    // and nothing happening in it.
    uniforms.uSignalStrength.value =
      span > 1e-3
        ? clamp01(IDLE_CORRIDOR + interaction.focus * 0.55 + interaction.hover * 0.42)
        : 0;

    for (let index = 0; index < loadTargets.length; index += 1) {
      const value = signal.domainActivity[index] ?? 0;
      loadTargets[index]!.value = clamp01(value);
    }

    uAnomaly.value.set(RESULT_HUES[resolveResultHue(signal.operationResult)]);
  }

  function setQuality(value: number): void {
    uniforms.uQuality.value = Number.isFinite(value) ? Math.min(1, Math.max(0.1, value)) : 1;
  }

  /**
   * Tells the field where the rift runs.
   *
   * Structural rather than semantic, and set once: the matter field circulates
   * around this axis and the travelling bands run along it, so both the matter
   * and the structural shading need it and neither should be re-deriving it.
   */
  function setRift(axis: readonly [number, number, number], centre: readonly [number, number, number]): void {
    uRiftAxis.value.set(axis[0], axis[1], axis[2]).normalize();
    uRiftCentre.value.set(centre[0], centre[1], centre[2]);
  }

  function dispose(): void {
    // `uniform` nodes hold no GPU resource of their own; they are values in a
    // uniform buffer owned by the renderer. Nothing to release. Present so the
    // call sites and every other scene handle read the same way.
  }

  return { uniforms, update, setQuality, setRift, dispose };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
