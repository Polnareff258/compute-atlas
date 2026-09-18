import { describe, expect, it } from 'vitest';

import { deriveCoreVisualInput, getCoreParameters } from './coreParameters';
import { createCameraController } from '../camera/cameraController';

describe('deriveCoreVisualInput', () => {
  it('passes controller scalars and distinct interaction states to the views', () => {
    const controller = createCameraController({ reducedMotion: true });
    controller.setPointerTarget(0.4, -0.2);
    controller.setFocusTarget(-0.6, 0.3, 0.8);
    controller.update(0.016);
    const read = (visualState: 'idle' | 'hover_response' | 'focusing') => {
      controller.setVisualState(visualState);
      return deriveCoreVisualInput({
        pointerX: controller.getPointerX(), pointerY: controller.getPointerY(),
        focusX: controller.getFocusX(), focusY: controller.getFocusY(),
        focusZ: controller.getFocusZ(), intensity: controller.getResponseStrength(),
        visualState, reducedMotion: true,
      });
    };
    const idle = read('idle');
    const hover = read('hover_response');
    const focus = read('focusing');
    expect(idle.pointerX).toBe(0.4);
    expect(focus.focusZ).toBe(0.8);
    expect(hover.visualState).toBe('hover_response');
    expect(focus.visualState).toBe('focusing');
    expect(hover.intensity).toBeGreaterThan(idle.intensity);
    expect(focus.intensity).toBeGreaterThan(idle.intensity);
    expect(focus.reducedMotion).toBe(true);
    expect(JSON.parse(JSON.stringify(focus))).toEqual(focus);
  });
  it('bounds invalid controller scalars without losing the semantic state', () => {
    expect(deriveCoreVisualInput({
      pointerX: Infinity, pointerY: -3, focusX: NaN, focusY: 2,
      focusZ: -Infinity, intensity: Infinity,
      visualState: 'agent_activity', reducedMotion: false,
    })).toEqual({
      pointerX: 0, pointerY: -1, focusX: 0, focusY: 1, focusZ: 0,
      intensity: 0, visualState: 'agent_activity', reducedMotion: false,
    });
  });
});

describe('getCoreParameters', () => {
  it('derives deterministic V2 budgets from the renderer quality profile', () => {
    const ultra = getCoreParameters('ultra');
    const high = getCoreParameters('high');
    const medium = getCoreParameters('medium');
    const safe = getCoreParameters('safe');

    for (const key of [
      'particleBudget',
      'topologyNodeBudget',
      'topologyEdgeBudget',
      'fragmentBudget',
      'trajectoryBudget',
    ] as const) {
      expect(ultra[key]).toBeGreaterThanOrEqual(high[key]);
      expect(high[key]).toBeGreaterThanOrEqual(medium[key]);
      expect(medium[key]).toBeGreaterThanOrEqual(safe[key]);
    }

    expect(ultra.fieldResolution).toBeGreaterThanOrEqual(high.fieldResolution);
    expect(high.fieldResolution).toBeGreaterThanOrEqual(medium.fieldResolution);
    expect(medium.fieldResolution).toBeGreaterThanOrEqual(safe.fieldResolution);
    expect(ultra.allowBloom).toBe(true);
    expect(safe.allowBloom).toBe(false);
    expect(getCoreParameters('ultra')).toEqual(getCoreParameters('ultra'));
  });

  it('keeps every V2 budget finite and positive', () => {
    for (const profile of ['ultra', 'high', 'medium', 'safe'] as const) {
      const parameters = getCoreParameters(profile);

      for (const key of [
        'particleBudget',
        'topologyNodeBudget',
        'topologyEdgeBudget',
        'fragmentBudget',
        'trajectoryBudget',
        'fieldResolution',
      ] as const) {
        expect(Number.isFinite(parameters[key])).toBe(true);
        expect(parameters[key]).toBeGreaterThan(0);
      }
    }
  });

  it('keeps SAFE structural budgets non-zero', () => {
    const safe = getCoreParameters('safe');

    expect(safe.topologyNodeBudget).toBeGreaterThan(0);
    expect(safe.topologyEdgeBudget).toBeGreaterThan(0);
    expect(safe.fragmentBudget).toBeGreaterThan(0);
    expect(safe.trajectoryBudget).toBeGreaterThan(0);
    expect(safe.fieldResolution).toBeGreaterThan(0);
  });

  it('exposes V2 budgets without retired spherical layer parameters', () => {
    const ultra = getCoreParameters('ultra');
    const safe = getCoreParameters('safe');

    for (const parameters of [ultra, safe]) {
      expect(parameters).not.toHaveProperty('shellRadius');
      expect(parameters).not.toHaveProperty('cageSegments');
      expect(parameters).not.toHaveProperty('orbitalCount');
    }
  });
});
