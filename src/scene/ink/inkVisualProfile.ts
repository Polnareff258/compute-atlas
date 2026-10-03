/**
 * The small shared vocabulary for the river's optical motion.
 *
 * These values are data rather than scattered shader literals so the ground and
 * the suspended ink can move at related rates without becoming identical copies.
 */
export const FLOW_WAVE_PROFILE = {
  frequency: 16.5,
  seedInfluence: 2.6,
  rate: 0.42,
  height: 1.65,
  colourGain: 0.12,
  coverageDiffusionReach: 2.65,
  coverageNoiseFloor: 0.55,
  edgeColourFloor: 0.08,
} as const;

/**
 * The primary route owns one soft luminous body and a rarer internal glint.
 * A zero rim is intentional: a threshold outline becomes a saw-toothed neon
 * polyline when the scroll shot sees the field at a grazing angle.
 */
export const PRIMARY_ROUTE_LIGHT_PROFILE = {
  rimGain: 0,
  bodyGain: 0.075,
  glintGain: 0.18,
  coverageGain: 0.012,
} as const;

/** A moving, bank-local glint; the quieter body remains when the crest passes. */
export const GILDED_CURRENT_PROFILE = {
  frequency: 13,
  seedInfluence: 3.1,
  rate: 0.55,
  crestStart: 0.70,
  crestEnd: 0.96,
  bodyGain: 0.10,
  glintGain: 0.28,
} as const;

/** Broad advected striations inside the pigment, not outline strokes. */
export const INK_MARBLING_PROFILE = {
  alongFrequency: 6.4,
  acrossFrequency: 28,
  foldWarp: 5.2,
  fineWarp: 1.6,
  driftRate: 0.18,
  onset: 0.58,
  full: 0.94,
  opacityGain: 0.18,
} as const;

/** CPU mirror for deterministic visual-profile checks. */
export function sampleMarbling(
  along: number,
  across: number,
  fold: number,
  fineFold: number,
  time: number,
): number {
  const p = INK_MARBLING_PROFILE;
  const phase = along * p.alongFrequency + across * p.acrossFrequency +
    (fold - 0.5) * p.foldWarp + (fineFold - 0.5) * p.fineWarp - time * p.driftRate;
  const wave = Math.sin(phase) * 0.5 + 0.5;
  const t = Math.min(1, Math.max(0, (wave - p.onset) / (p.full - p.onset)));
  return t * t * (3 - 2 * t);
}

export function sampleCurrentGlint(along: number, seed: number, time: number): number {
  const phase =
    along * GILDED_CURRENT_PROFILE.frequency +
    seed * GILDED_CURRENT_PROFILE.seedInfluence -
    time * GILDED_CURRENT_PROFILE.rate;
  const wave = Math.sin(phase) * 0.5 + 0.5;
  const t = Math.min(1, Math.max(0,
    (wave - GILDED_CURRENT_PROFILE.crestStart) /
      (GILDED_CURRENT_PROFILE.crestEnd - GILDED_CURRENT_PROFILE.crestStart),
  ));
  return t * t * (3 - 2 * t);
}

/**
 * The simulation's middle densities must survive compositing. Previously the
 * visible river occupied the field, but its opacity was mapped as though only
 * near-saturation deserved to be seen; against a dark sky it disappeared.
 */
export const INK_COVERAGE_PROFILE = {
  start: 0,
  full: 0.44,
  curve: 0.75,
  ceiling: 0.78,
  colourExposure: 2.2,
} as const;

export function sampleDensityCoverage(presence: number): number {
  const t = Math.min(1, Math.max(0,
    (presence - INK_COVERAGE_PROFILE.start) /
      (INK_COVERAGE_PROFILE.full - INK_COVERAGE_PROFILE.start),
  ));
  return (t * t * (3 - 2 * t)) ** INK_COVERAGE_PROFILE.curve;
}

export type InkVeilLayer = {
  readonly heightScale: number;
  readonly gain: number;
  readonly phase: number;
  readonly reach: number;
  readonly worldOffset: readonly [x: number, z: number];
};

/**
 * Two unequal readings of the same field. The lower layer carries most of the
 * spatial continuity; the higher layer is thinner and later in phase, so their
 * overlap reads as suspended depth rather than duplicated ribbons.
 */
export const INK_VEIL_LAYERS: readonly InkVeilLayer[] = [
  {
    heightScale: 0.62,
    gain: 0.24,
    phase: 0.35,
    reach: 1.08,
    worldOffset: [-142, 92],
  },
  {
    heightScale: 1.42,
    gain: 0.15,
    phase: 2.15,
    reach: 1.58,
    worldOffset: [188, -126],
  },
] as const;

/** CPU mirror used by tests and capture diagnostics. The shader uses the same profile. */
export function sampleFlowWave(along: number, seed: number, time: number): number {
  return (
    Math.sin(
      along * FLOW_WAVE_PROFILE.frequency +
        seed * FLOW_WAVE_PROFILE.seedInfluence -
        time * FLOW_WAVE_PROFILE.rate,
    ) *
      0.5 +
    0.5
  );
}
