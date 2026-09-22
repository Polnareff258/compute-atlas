import type { QualityProfile, QualitySettings } from '@/renderer/types';

/**
 * The four tiers.
 *
 * ## What a tier may change, after the audit
 *
 * Every number below drives something. That was not true before this pass, and
 * the table carried five settings whose per-tier values were fiction:
 * `graphDensity`, `membraneRegions`, `allowVolumetricFog`, `allowTrails` and
 * `allowBloom`. None of them had a reader anywhere in `src`, `scripts` or
 * `tests` — no volumetric pass, no trail pass, no bloom pass, no membrane
 * region count and no graph-density multiplier exists in this composition. They
 * were removed rather than kept pending, because a switch that reads as live and
 * is not is a standing invitation to change a picture that has been approved;
 * `allowBloom` in particular was the sole reason the frame counters' meaning
 * depended on the tier, and that is the telemetry defect this pass fixed.
 * `QualitySettings` carries the audit.
 *
 * What is left is a resolution-and-detail ladder: `pixelRatioScale` and `maxDpr`
 * (one reader, `deriveEffectiveDpr`), `terrainDetail` (the descriptor, and
 * through it the ink density and the world surface) and `particleBudget` (read
 * once, as the telemetry's *configured* budget, never as a measured count).
 *
 * ## Why the ladder is shaped the way it is
 *
 * ULTRA is the art target and the only tier at full detail. The *other* tiers are
 * derived by removing whole counts rather than by turning everything down — which
 * is what keeps SAFE an art-directed simplification instead of a dimmer copy of
 * the same frame.
 *
 * SAFE must still show the silhouette, the basin, at least one river and the
 * region transformation. It must not degrade into boxes and points: `terrainDetail`
 * of 0.28 keeps the basin at full radius with its terraces reduced to shelves and
 * its rivers at their own courses, because detail changes counts and never
 * positions.
 */
export const QUALITY_PROFILES: Readonly<Record<QualityProfile, QualitySettings>> = {
  ultra: {
    particleBudget: 320_000,
    maxDpr: 2,
    pixelRatioScale: 1,
    terrainDetail: 1,
  },
  high: {
    particleBudget: 180_000,
    maxDpr: 1.75,
    pixelRatioScale: 0.9,
    terrainDetail: 0.8,
  },
  medium: {
    particleBudget: 64_000,
    maxDpr: 1.5,
    pixelRatioScale: 0.78,
    terrainDetail: 0.55,
  },
  safe: {
    particleBudget: 14_000,
    maxDpr: 1,
    pixelRatioScale: 0.62,
    terrainDetail: 0.28,
  },
};

export function getQualityProfile(profile: QualityProfile): QualitySettings {
  return QUALITY_PROFILES[profile];
}
/**
 * Applies the profile's pixel ratio scale and ceiling to the browser DPR.
 * Keeping this policy pure makes the canvas and R3F owners use the same value.
 */
export function deriveEffectiveDpr(
  devicePixelRatio: number,
  settings: QualitySettings,
): number {
  const safeDevicePixelRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const safePixelRatioScale =
    Number.isFinite(settings.pixelRatioScale) && settings.pixelRatioScale > 0
      ? settings.pixelRatioScale
      : 1;
  const safeMaxDpr =
    Number.isFinite(settings.maxDpr) && settings.maxDpr > 0
      ? settings.maxDpr
      : 1;

  return Math.min(safeDevicePixelRatio * safePixelRatioScale, safeMaxDpr);
}
