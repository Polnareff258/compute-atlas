import { getQualityProfile } from '../../config/quality';
import type { QualityProfile } from '../../renderer/types';
import type { CoreParameters } from './coreTypes';

/**
 * Converts the existing quality settings into deterministic V2 structural budgets.
 * Semantic topology remains present at SAFE; graph density only scales detail.
 */
export function getCoreParameters(profile: QualityProfile): CoreParameters {
  const quality = getQualityProfile(profile);

  return {
    profile,
    particleBudget: quality.coreParticleBudget,
    topologyNodeBudget: Math.max(1, Math.round(12 * quality.graphDensity)),
    topologyEdgeBudget: Math.max(1, Math.round(10 * quality.graphDensity)),
    fragmentBudget: Math.max(1, Math.round(quality.coreParticleBudget / 600)),
    trajectoryBudget: Math.max(1, Math.round(12 * quality.graphDensity)),
    fieldResolution: quality.coreFieldResolution,
    allowBloom: quality.allowBloom,
    shellRadius: 2.18,
    cageSegments: quality.coreCageSegments,
    orbitalCount: quality.coreOrbitalCount,
  };
}