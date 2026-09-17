import type { QualityProfile, QualitySettings } from '@/renderer/types';

export const QUALITY_PROFILES: Readonly<Record<QualityProfile, QualitySettings>> = {
  ultra: {
    particleBudget: 120_000,
    maxDpr: 2,
    allowBloom: true,
    graphDensity: 1,
    pixelRatioScale: 1,
  },
  high: {
    particleBudget: 70_000,
    maxDpr: 1.75,
    allowBloom: true,
    graphDensity: 0.85,
    pixelRatioScale: 0.9,
  },
  medium: {
    particleBudget: 32_000,
    maxDpr: 1.5,
    allowBloom: false,
    graphDensity: 0.65,
    pixelRatioScale: 0.78,
  },
  safe: {
    particleBudget: 8_000,
    maxDpr: 1,
    allowBloom: false,
    graphDensity: 0.4,
    pixelRatioScale: 0.62,
  },
};

export function getQualityProfile(profile: QualityProfile): QualitySettings {
  return QUALITY_PROFILES[profile];
}
