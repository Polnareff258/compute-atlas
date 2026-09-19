import { countVisibleCoreFieldSamples, deriveCoreFieldState, type CoreFieldDescriptor } from './coreField';
import { deriveCoreTrajectoryActivation, type CoreTrajectory } from './coreTrajectories';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreTelemetryCounts = {
  readonly configuredFieldBudget: number;
  readonly renderedFieldSamples: number;
  readonly activeSignalSamples: number;
};

function finiteCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Counts the samples represented by the current static draw range and the
 * bounded signal point batch. No field positions are rewritten or simulated.
 */
export function deriveCoreTelemetryCounts(
  parameters: Pick<CoreParameters, 'configuredFieldBudget' | 'particleBudget' | 'activeSignalBudget'>,
  field: CoreFieldDescriptor,
  trajectories: readonly CoreTrajectory[],
  visualInput: CoreVisualInput,
): CoreTelemetryCounts {
  const fieldState = deriveCoreFieldState(field, visualInput);
  const renderedFieldSamples = countVisibleCoreFieldSamples(field, fieldState.activeStreamCount);

  const activation = deriveCoreTrajectoryActivation(trajectories, visualInput);
  const activeSignalSamples = Math.min(
    finiteCount(parameters.activeSignalBudget),
    activation.signalTrajectoryIds.length,
  );

  return {
    configuredFieldBudget: finiteCount(
      parameters.configuredFieldBudget ?? parameters.particleBudget,
    ),
    renderedFieldSamples,
    activeSignalSamples,
  };
}
