import type { QualityProfile, QualitySettings } from '@/renderer/types';

export const QUALITY_PROFILES: Readonly<Record<QualityProfile, QualitySettings>> = {
  ultra: {
    particleBudget: 120_000,
    maxDpr: 2,
    allowBloom: true,
    graphDensity: 1,
    pixelRatioScale: 1,
    coreParticleBudget: 72_000,
    coreCageSegments: 3,
    coreOrbitalCount: 3,
    coreFieldResolution: 48,
  },
  high: {
    particleBudget: 70_000,
    maxDpr: 1.75,
    allowBloom: true,
    graphDensity: 0.85,
    pixelRatioScale: 0.9,
    coreParticleBudget: 42_000,
    coreCageSegments: 2,
    coreOrbitalCount: 3,
    coreFieldResolution: 40,
  },
  medium: {
    particleBudget: 32_000,
    maxDpr: 1.5,
    allowBloom: false,
    graphDensity: 0.65,
    pixelRatioScale: 0.78,
    coreParticleBudget: 18_000,
    coreCageSegments: 2,
    coreOrbitalCount: 2,
    coreFieldResolution: 32,
  },
  safe: {
    particleBudget: 8_000,
    maxDpr: 1,
    allowBloom: false,
    graphDensity: 0.4,
    pixelRatioScale: 0.62,
    coreParticleBudget: 6_000,
    coreCageSegments: 1,
    coreOrbitalCount: 1,
    coreFieldResolution: 24,
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
