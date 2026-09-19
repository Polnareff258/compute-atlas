import { getQualityProfile } from '../../config/quality';
import type { QualityProfile } from '../../renderer/types';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

/** Compatibility helper: the configured core budget remains available to callers. */
export function deriveCoreTelemetryParticleCount(
  parameters: Pick<CoreParameters, 'configuredFieldBudget' | 'particleBudget'>,
): number {
  return parameters.configuredFieldBudget ?? parameters.particleBudget;
}

/** Sanitizes controller scalars at the serializable visual boundary. */
export function deriveCoreVisualInput(input: CoreVisualInput): CoreVisualInput {
  const finiteClamp = (value: number, minimum: number, maximum: number) =>
    Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : 0;
  return {
    pointerX: finiteClamp(input.pointerX, -1, 1),
    pointerY: finiteClamp(input.pointerY, -1, 1),
    focusX: finiteClamp(input.focusX, -1, 1),
    focusY: finiteClamp(input.focusY, -1, 1),
    focusZ: finiteClamp(input.focusZ, -1, 1),
    intensity: finiteClamp(input.intensity, 0, 1.2),
    visualState: input.visualState,
    reducedMotion: input.reducedMotion,
  };
}

/**
 * Converts the existing quality settings into deterministic V2 structural budgets.
 * Semantic topology remains present at SAFE; graph density only scales detail.
 */
export function getCoreParameters(profile: QualityProfile): CoreParameters {
  const quality = getQualityProfile(profile);

  return {
    profile,
    configuredFieldBudget: quality.coreParticleBudget,
    fieldSampleBudget: Math.min(
      quality.coreParticleBudget,
      quality.coreFieldResolution * quality.coreFieldResolution * 10,
    ),
    activeSignalBudget: Math.max(1, Math.round(quality.graphDensity * 4)),
    particleBudget: quality.coreParticleBudget,
    topologyNodeBudget: Math.max(12, Math.round(20 * quality.graphDensity)),
    topologyEdgeBudget: Math.max(11, Math.round(20 * quality.graphDensity)),
    fragmentBudget: Math.max(1, Math.round(quality.coreParticleBudget / 600)),
    trajectoryBudget: Math.max(8, Math.round(12 * quality.graphDensity)),
    fieldResolution: quality.coreFieldResolution,
    allowBloom: quality.allowBloom,
  };
}
