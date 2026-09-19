import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';
import { deriveCoreField } from './coreField';
import { deriveCoreTelemetryCounts } from './coreTelemetry';
import { deriveCoreTrajectories } from './coreTrajectories';
import type { CoreVisualInput } from './coreTypes';

const idleInput: CoreVisualInput = {
  pointerX: 0.12,
  pointerY: -0.18,
  focusX: 0.4,
  focusY: -0.2,
  focusZ: 0.7,
  intensity: 0.65,
  visualState: 'idle',
  reducedMotion: false,
};

describe('deriveCoreTelemetryCounts', () => {
  it('reports actual visible field samples below the configured budget when voids are present', () => {
    const parameters = getCoreParameters('ultra');
    const field = deriveCoreField(parameters, 17);
    const trajectories = deriveCoreTrajectories(parameters, 17);
    const counts = deriveCoreTelemetryCounts(parameters, field, trajectories, idleInput);

    expect(counts.configuredFieldBudget).toBe(parameters.configuredFieldBudget);
    expect(counts.renderedFieldSamples).toBeGreaterThan(0);
    expect(counts.renderedFieldSamples).toBeLessThan(counts.configuredFieldBudget);
  });

  it('reports more active signal samples during agent activity than while idle', () => {
    const parameters = getCoreParameters('ultra');
    const field = deriveCoreField(parameters, 17);
    const trajectories = deriveCoreTrajectories(parameters, 17);
    const idle = deriveCoreTelemetryCounts(parameters, field, trajectories, idleInput);
    const agent = deriveCoreTelemetryCounts(parameters, field, trajectories, {
      ...idleInput,
      visualState: 'agent_activity',
    });

    expect(agent.activeSignalSamples).toBeGreaterThan(idle.activeSignalSamples);
    expect(agent.activeSignalSamples).toBeLessThanOrEqual(parameters.activeSignalBudget);
  });
});
