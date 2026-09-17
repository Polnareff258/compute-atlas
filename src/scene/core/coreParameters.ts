import { getQualityProfile } from '../../config/quality';
import type { QualityProfile } from '../../renderer/types';
import type { CoreParameters } from './coreTypes';

export function getCoreParameters(profile: QualityProfile): CoreParameters {
  const quality = getQualityProfile(profile);

  return {
    profile,
    particleBudget: quality.coreParticleBudget,
    shellRadius: 2.18,
    cageSegments: quality.coreCageSegments,
    orbitalCount: quality.coreOrbitalCount,
    fieldResolution: quality.coreFieldResolution,
    allowBloom: quality.allowBloom,
  };
}