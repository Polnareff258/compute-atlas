import type { QualityProfile, QualitySettings } from '@/renderer/types';

/**
 * The four tiers, from the reconstruction spec's degradation table.
 *
 * ULTRA is the art target and the only tier with the full route: volumetric fog,
 * temporal trails and screen-space distortion all cost a pass each, and the brief
 * is explicit that WebGPU is the target rather than a ceiling to design under. So
 * the decision of what ULTRA may spend is made on the picture, and the *other*
 * tiers are derived by removing whole effects rather than by turning everything
 * down — which is what keeps SAFE an art-directed simplification instead of a
 * dimmer copy of the same frame.
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
    allowBloom: true,
    graphDensity: 1,
    pixelRatioScale: 1,
    terrainDetail: 1,
    membraneRegions: 5,
    allowVolumetricFog: true,
    allowTrails: true,
  },
  high: {
    particleBudget: 180_000,
    maxDpr: 1.75,
    allowBloom: true,
    graphDensity: 0.85,
    pixelRatioScale: 0.9,
    terrainDetail: 0.8,
    membraneRegions: 5,
    allowVolumetricFog: false,
    allowTrails: false,
  },
  medium: {
    particleBudget: 64_000,
    maxDpr: 1.5,
    allowBloom: false,
    graphDensity: 0.65,
    pixelRatioScale: 0.78,
    terrainDetail: 0.55,
    membraneRegions: 1,
    allowVolumetricFog: false,
    allowTrails: false,
  },
  safe: {
    particleBudget: 14_000,
    maxDpr: 1,
    allowBloom: false,
    graphDensity: 0.4,
    pixelRatioScale: 0.62,
    terrainDetail: 0.28,
    membraneRegions: 0,
    allowVolumetricFog: false,
    allowTrails: false,
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
