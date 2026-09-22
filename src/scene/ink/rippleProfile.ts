/**
 * The direct-manipulation response as one authored physical/chromatic profile.
 *
 * These values are shared by the fragment and vertex expressions in `inkMaterial`.
 * Keeping them together prevents the colour crest and the geometric rebound from
 * becoming two unrelated effects that merely happen at the pointer.
 */
export const RIPPLE_PROFILE = Object.freeze({
  phaseFrequency: 6.35,
  phaseRate: 0.38,
  crestStart: 0.70,
  crestEnd: 0.96,
  reboundStart: 0.66,
  reboundEnd: 0.94,
  leadingHueMix: 0.58,
  trailingHueMix: 0.14,
  chromaticGain: 0.22,
  interiorHueMix: 0.64,
  interiorGain: 0.08,
  surfaceTintGain: 0.06,
  coverageGain: 0.18,
  reboundGain: 0.18,
  spectralVariation: 0.16,
  interiorCoverageFloor: 0.02,
  edgeEmissionGain: 0.42,
  pressureLift: 0.22,
  reboundAmplitude: 0.045,
});

/**
 * Reference form of the vertex response used by the material.
 *
 * Pressure is an area, but displacement belongs to its moving front. Lifting the
 * full pressure body produces a solid oval mound at a grazing camera angle — the
 * exact "portal" silhouette the interaction must avoid. Multiplying by the local
 * pressure edge leaves the dense centre optically present while only the crest and
 * its weak rebound move the membrane.
 */
export function resolveRippleDisplacement(
  pressure: number,
  edge: number,
  wave: number,
): number {
  const p = Math.min(1, Math.max(0, pressure));
  const e = Math.min(1, Math.max(0, edge));
  const w = Math.min(1, Math.max(-1, wave));
  const front = p ** 0.62 * e ** 0.72;
  return Math.max(
    0,
    front * RIPPLE_PROFILE.pressureLift
      + front * w * RIPPLE_PROFILE.reboundAmplitude,
  );
}
