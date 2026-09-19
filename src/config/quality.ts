import type { QualityProfile, QualitySettings } from '@/renderer/types';

export const QUALITY_PROFILES: Readonly<Record<QualityProfile, QualitySettings>> = {
  ultra: {
    particleBudget: 120_000,
    maxDpr: 2,
    allowBloom: true,
    graphDensity: 1,
    pixelRatioScale: 1,
    coreParticleBudget: 72_000,
    coreStructureDetail: 1,
    // Four classes exist to reveal, so four is the ceiling rather than a tier.
    coreRouteLanes: 4,
    coreAdvection: true,
    domainDetail: 1,
  },
  high: {
    particleBudget: 70_000,
    maxDpr: 1.75,
    allowBloom: true,
    graphDensity: 0.85,
    pixelRatioScale: 0.9,
    coreParticleBudget: 42_000,
    coreStructureDetail: 0.82,
    coreRouteLanes: 4,
    coreAdvection: false,
    domainDetail: 0.86,
  },
  medium: {
    particleBudget: 32_000,
    maxDpr: 1.5,
    allowBloom: false,
    graphDensity: 0.65,
    pixelRatioScale: 0.78,
    coreParticleBudget: 18_000,
    coreStructureDetail: 0.6,
    coreRouteLanes: 3,
    coreAdvection: false,
    domainDetail: 0.68,
  },
  safe: {
    particleBudget: 8_000,
    maxDpr: 1,
    allowBloom: false,
    graphDensity: 0.4,
    pixelRatioScale: 0.62,
    coreParticleBudget: 6_000,
    coreStructureDetail: 0.12,
    coreRouteLanes: 2,
    coreAdvection: false,
    domainDetail: 0.4,
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
