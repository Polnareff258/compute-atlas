import { Color, Vector3, Vector4 } from 'three';
import { uniform } from 'three/tsl';

import { WATERSHED_PALETTE, type DomainPalette } from '../watershed/watershedDescriptor';
import type { AgentActivitySignal } from './agentActivity';
import { resolveResultHue } from './agentActivity';

/**
 * The one block of GPU state the whole scene writes and the whole scene reads.
 *
 * Every material in the scene — the terrain, the membranes, the rivers, the
 * crystals, the fog — samples from this object. That is the entire reason the
 * scene can hold together as one event: there is exactly one place where "what
 * is happening" becomes numbers, and everything downstream is a different way of
 * drawing the same numbers.
 *
 * It is a *mutable singleton*, written in place once per frame. It is not React
 * state and must never become React state: the values change at frame rate and a
 * re-render per frame would be the end of the scene's budget. Nothing here
 * allocates after construction.
 *
 * The set is deliberately small. Each entry is read by every material, so the
 * cost of adding one is paid across the whole scene, and a large uniform block
 * is a uniform block nobody can reason about.
 *
 * **What changed from the rift's version, and why.** The rift's block carried
 * `uRiftAxis` and `uRiftCentre`: the hero was a *line* through the world, and
 * everything was measured from it. The watershed's hero is the Convergence
 * Basin, which is a *place* — a centre, a radius, a depth and a floor — so the
 * structural uniforms became those four. Three more were added. `uActiveDomain`
 * and the domain's own three colours are what let a region answer for itself
 * without a per-region material; `uHighlight` is the budget from constraint C5,
 * the single value that decides which region is allowed to be bright, because
 * "at most one primary highlight region per frame" is a rule that has to live
 * somewhere and a uniform is the only place the whole scene can agree on it.
 * `uFlowPhase` is separate from `uPhase` on purpose — see below.
 *
 * - **Activity** — the master gain. Everything that moves moves more when it is
 *   high, and this is the only value a superposed "how busy is it" reads from.
 * - **Hover / focus** — the two interaction strengths, kept separate because
 *   they are different phenomena: hover is a local field response, focus is a
 *   reconfiguration of the whole route.
 * - **Congestion / progress** — the two ends of an operation, and the reason the
 *   scene can express contention and completion without a second system.
 * - **Signal origin / target / strength** — the corridor: the flow currently
 *   carrying the visitor's attention. A vector pair rather than a node id,
 *   because the field system must not know what a domain is.
 * - **Five regional loads** — local activity, in `DOMAIN_IDS` order, so a region
 *   that is working generates local structure and one that is not does not.
 * - **Elapsed and quality** — time, and the density scalar the shaders use to
 *   trade detail for budget without changing the art direction.
 */
export type FieldUniforms = ReturnType<typeof createFieldUniforms>;

/**
 * The corridor strength the landscape carries when nothing is being asked of it.
 *
 * Small, and not zero. Idle's corridor is the spine of the composition: it is
 * what draws the primary flow as a lit channel through the mid-ground and what
 * gives the migrating units something to be heading toward. Setting it to zero
 * is not "idle is quiet", it is "the frame has no axis" — see the note in
 * `update`, which records what that looked like the first time it was tried.
 */
const IDLE_CORRIDOR = 0.4;

/**
 * Anomaly colours, taken from the two regions that own them.
 *
 * `interrupted` and `failed` are the only states permitted to spend amber or
 * magenta anywhere in the frame, and they may only spend the hue of the region
 * that owns it — GAME ANALYSIS keeps amber because its whole behaviour is
 * parallel unresolved futures, GRAPHICS keeps magenta because it is the region
 * where dispersion is made visible. Borrowing either for a generic "warning"
 * would spend the scarcity that makes them readable.
 */
const RESULT_HUES = {
  none: WATERSHED_PALETTE.cyan,
  amber: '#ffab3d',
  magenta: '#ff4fd8',
} as const;

export function createFieldUniforms() {
  const uSignalOrigin = uniform(new Vector3(0, 0, 0));
  const uSignalTarget = uniform(new Vector3(0, 0, 0));
  const uStructuralLight = uniform(new Vector3(0, 0, 1));

  /**
   * The basin, as the structural centre of the world.
   *
   * Set once, from the descriptor. Four values rather than a mesh or a matrix,
   * because three separate systems need them and none of them should be
   * re-deriving the basin: the terrain sinks toward it, the fog gathers in it,
   * and the flow decelerates into it.
   */
  const uBasinCentre = uniform(new Vector3(0, 0, 0));
  const uBasinFloor = uniform(0);

  const uFlow = uniform(new Color(WATERSHED_PALETTE.cyan));
  const uSpectral = uniform(new Color(WATERSHED_PALETTE.spectral));
  const uDeep = uniform(new Color(WATERSHED_PALETTE.violet));
  const uRim = uniform(new Color(WATERSHED_PALETTE.cobalt));
  const uMass = uniform(new Color(WATERSHED_PALETTE.midnight));
  const uHaze = uniform(new Color(WATERSHED_PALETTE.petroleum));
  const uPeak = uniform(new Color(WATERSHED_PALETTE.compression));
  const uAnomaly = uniform(new Color(WATERSHED_PALETTE.cyan));

  /*
   * The sediment trio and the floor.
   *
   * `uInk` is the composition's bottom value: the whole 70% layer climbs out of it
   * and the frame's negative space *is* it, so it is the single number the value
   * hierarchy stands on. The other three are the hues the ink-density material
   * spends, and they live here rather than as constants inside one material for the
   * same reason every other colour does — the scene has exactly one place where
   * "what is happening" becomes numbers, and a second place is how two systems come
   * to disagree about what the world looks like.
   */
  const uInk = uniform(new Color(WATERSHED_PALETTE.ink));
  const uBone = uniform(new Color(WATERSHED_PALETTE.bone));
  const uGreyViolet = uniform(new Color(WATERSHED_PALETTE.greyViolet));
  const uPalePink = uniform(new Color(WATERSHED_PALETTE.palePink));
  /*
   * `uMidnight` and `uCobalt` are the same two palette entries `uMass` and `uRim`
   * already carry. They are declared again under their own names rather than reusing
   * those, because `uMass` and `uRim` are named for the *rift* composition's roles —
   * "the mass tone" and "the rim tone" — and a material that read `uMass` for a
   * pigment wash would be a material whose numbers could not be understood without
   * reading a stage that no longer exists. Both names resolve to one colour, and the
   * palette is a single frozen record, so they cannot drift.
   */
  const uMidnight = uniform(new Color(WATERSHED_PALETTE.midnight));
  const uCobalt = uniform(new Color(WATERSHED_PALETTE.cobalt));

  /** The active region's own three colours, or the global trio when none is. */
  const uRegionGround = uniform(new Color(WATERSHED_PALETTE.violet));
  const uRegionAmbient = uniform(new Color(WATERSHED_PALETTE.petroleum));
  const uRegionAccent = uniform(new Color(WATERSHED_PALETTE.cyan));

  const uniforms = {
    uTime: uniform(0),
    uQuality: uniform(1),

    uActivity: uniform(0.22),
    uHover: uniform(0),
    uFocus: uniform(0),
    uCongestion: uniform(0),
    uProgress: uniform(0),
    uPhase: uniform(0),

    /**
     * The flow's own clock, kept separate from `uTime`.
     *
     * `uPhase` is the *operation's* position and freezes under reduced motion.
     * The flow has to keep moving when everything else has stopped, because a
     * still river reads as a frozen photograph of a river rather than as a
     * landscape at rest — and the reduced-motion requirement is that the frame
     * stops changing, not that the world stops being a world. So this one
     * advances always, at a rate low enough to be a drift.
     */
    uFlowPhase: uniform(0),

    uSignalOrigin,
    uSignalTarget,
    uSignalStrength: uniform(0),
    /** Direction the key light comes from, in world space, for the rim term. */
    uStructuralLight,
    uBasinCentre,
    uBasinFloor,

    uLoadA: uniform(0),
    uLoadB: uniform(0),
    uLoadC: uniform(0),
    uLoadD: uniform(0),
    uLoadE: uniform(0),

    /** Which region the interaction is about, or -1. Never used to index. */
    uActiveDomain: uniform(-1),
    /** Constraint C5's budget: 0..1, and only one region may hold it. */
    uHighlight: uniform(0),

    /**
     * The scroll story's four layer weights: pigment, bedding, sharpness, granules.
     *
     * One `vec4` rather than four floats, because they are never read separately — the
     * material applies all four to the same term stack in the same expression, and four
     * names for one gesture is four places for a caller to set three of them.
     *
     * At rest they are the hero act's own weights, so a page that is never scrolled renders
     * the resting composition rather than a frame with a story's weights set to something
     * arbitrary. The scene host overwrites them every frame; these are the values that hold
     * before it does.
     */
uScrollLayers: uniform(new Vector4(0.85, 0.45, 1, 0)),

    /**
     * Which diagnostic view the hero material draws, or `0` for the real frame.
     *
     * A developer diagnostic that stays in the code rather than being applied and reverted
     * by hand each time a term is suspected. Four rounds of this work were spent editing one
     * expression, re-capturing and measuring, and every measurement rejected the guess; the
     * instrument is cheaper than the fifth guess.
     *
     * It costs one float in a uniform block that is already uploaded every frame, and the
     * material's select chain is dead code on every real frame.
     */
    uDebugMode: uniform(0),

    uFlow,
    uSpectral,
    uDeep,
    uRim,
    uMass,
    uHaze,
    uPeak,
    uAnomaly,

    uInk,
    uBone,
    uGreyViolet,
    uPalePink,
    uMidnight,
    uCobalt,

    uRegionGround,
    uRegionAmbient,
    uRegionAccent,
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
    flowElapsed: number = elapsed,
  ): void {
    uniforms.uTime.value = elapsed;
    uniforms.uFlowPhase.value = flowElapsed;
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
    // The floor is the part that matters. This resolved to zero whenever nothing
    // was pointed at, on the reasoning that idle is the absence of a request —
    // and that is true of a *request* and false of a watershed. A basin at rest
    // still has water moving through it: the brief's idle frame requires the
    // primary flow leading the eye, and a corridor strength of zero deletes the
    // one term that draws it. The result was an idle frame whose hero carried no
    // light along its own axis at all, which is why the first capture of the
    // previous composition had a black centre and nothing happening in it.
    uniforms.uSignalStrength.value =
      span > 1e-3
        ? clamp01(IDLE_CORRIDOR + interaction.focus * 0.55 + interaction.hover * 0.42)
        : 0;

    for (let index = 0; index < loadTargets.length; index += 1) {
      const value = signal.domainActivity[index] ?? 0;
      loadTargets[index]!.value = clamp01(value);
    }

    // The highlight follows the *load*, not the pointer: the region allowed to
    // be bright is the region with work in it, so a hover that lights a region
    // and a region that is busy cannot disagree about which one is the subject.
    const peak = Math.max(...loadTargets.map((target) => target.value));
    uniforms.uHighlight.value = clamp01(peak);
    uAnomaly.value.set(RESULT_HUES[resolveResultHue(signal.operationResult)]);
  }

  /**
   * The scroll's layer weights, written once a frame.
   *
   * A setter rather than a direct field write, so the clamp lives in one place: a weight
   * outside `0`..`1` would scale a term past its authored range, and the failure is not a
   * clamp but a frame that is brighter than any state the art direction was tuned against.
   */
  function setScrollLayers(pigment: number, bedding: number, sharpness: number, granules: number): void {
    uniforms.uScrollLayers.value.set(
      clamp01(pigment),
      clamp01(bedding),
      clamp01(sharpness),
      clamp01(granules),
    );
  }

  /**
   * Selects a diagnostic view. Called once at startup from a query parameter.
   *
   * Integer modes rather than a string table, because the value has to cross into a shader
   * and because an unrecognised mode falling back to the real frame is the safe default.
   */
  function setDebugMode(mode: number): void {
    uniforms.uDebugMode.value = Number.isFinite(mode) && mode >= 0 ? Math.floor(mode) : 0;
  }

  function setQuality(value: number): void {
    uniforms.uQuality.value = Number.isFinite(value) ? Math.min(1, Math.max(0.1, value)) : 1;
  }

  /**
   * Tells the field where the basin is, and where its floor sits.
   *
   * Structural rather than semantic, and set once per descriptor: the terrain
   * sinks toward this point, the fog gathers in it and the flow decelerates into
   * it, so all three need it and none of them should be re-deriving it from the
   * descriptor independently.
   */
  function setBasin(centre: readonly [number, number], floor: number): void {
    uBasinCentre.value.set(centre[0], floor, centre[1]);
    uBasinFloor.value = floor;
  }

  /**
   * Tells the field which region is answering, so its material can be its own.
   *
   * Passing `null` restores the global trio — the world's own colour, which is
   * what a region recedes to. Note that this writes three colours and one index
   * and does *not* decide how bright the region is: that is `uHighlight`, and
   * keeping the two apart is what stops "which region" and "how much of the
   * frame's light this region gets" from becoming the same question.
   */
  function setRegion(index: number, palette: DomainPalette | null): void {
    if (palette === null) {
      uniforms.uActiveDomain.value = -1;
      uRegionGround.value.set(WATERSHED_PALETTE.violet);
      uRegionAmbient.value.set(WATERSHED_PALETTE.petroleum);
      uRegionAccent.value.set(WATERSHED_PALETTE.cyan);
      return;
    }
    uniforms.uActiveDomain.value = index;
    uRegionGround.value.set(palette.ground);
    uRegionAmbient.value.set(palette.ambient);
    uRegionAccent.value.set(palette.accent);
  }

  function dispose(): void {
    // `uniform` nodes hold no GPU resource of their own; they are values in a
    // uniform buffer owned by the renderer. Nothing to release. Present so the
    // call sites and every other scene handle read the same way.
  }

return {
    uniforms,
    update,
    setQuality,
    setBasin,
    setRegion,
    setScrollLayers,
    setDebugMode,
    dispose,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
