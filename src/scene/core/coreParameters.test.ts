import { describe, expect, it } from 'vitest';

import { deriveCoreVisualInput, getCoreParameters } from './coreParameters';
import { ROUTE_CLASS_ORDER } from '../routing/routeDash';
import { createCameraController } from '../camera/cameraController';

describe('deriveCoreVisualInput', () => {
  it('passes controller scalars and distinct interaction states to the views', () => {
    const controller = createCameraController({ reducedMotion: true });
    controller.setPointerTarget(0.4, -0.2);
    controller.setFocusTarget(-0.6, 0.3, 0.8);

    // Reduced motion dampens the transition rather than snapping, so the
    // controller has to be allowed to settle before its scalars are read.
    for (let frame = 0; frame < 60; frame += 1) controller.update(0.016);

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
    expect(idle.pointerX).toBeCloseTo(0.4, 3);
    expect(focus.focusZ).toBeCloseTo(0.8, 3);
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
  it('derives monotonically richer visual tiers from the quality profile', () => {
    const ultra = getCoreParameters('ultra');
    const high = getCoreParameters('high');
    const medium = getCoreParameters('medium');
    const safe = getCoreParameters('safe');

    for (const key of [
      'configuredFieldBudget',
      'structureDetail',
      'routeLanes',
      'domainDetail',
    ] as const) {
      expect(ultra[key]).toBeGreaterThanOrEqual(high[key]);
      expect(high[key]).toBeGreaterThanOrEqual(medium[key]);
      expect(medium[key]).toBeGreaterThanOrEqual(safe[key]);
    }

    // ULTRA is the only tier that pays for GPU advection.
    expect(ultra.advection).toBe(true);
    expect(safe.advection).toBe(false);
  });

  it('changes more than the point count between tiers', () => {
    const ultra = getCoreParameters('ultra');
    const safe = getCoreParameters('safe');

    // The brief's SAFE requirement is that the Hero silhouette, spine and main
    // route survive; a budget alone would not carry that.
    expect(safe.structureDetail).toBeGreaterThan(0);
    expect(safe.routeLanes).toBeGreaterThanOrEqual(1);
    expect(safe.domainDetail).toBeGreaterThan(0);
    expect(ultra.structureDetail).toBeGreaterThan(safe.structureDetail);
    expect(ultra.domainDetail).toBeGreaterThan(safe.domainDetail);
  });

  it('never exposes more route lanes than the packed class order can hold', () => {
    for (const profile of ['ultra', 'high', 'medium', 'safe'] as const) {
      const parameters = getCoreParameters(profile);

      expect(parameters.routeLanes).toBeLessThanOrEqual(ROUTE_CLASS_ORDER.length);
      expect(Number.isFinite(parameters.configuredFieldBudget)).toBe(true);
      expect(parameters.configuredFieldBudget).toBeGreaterThan(0);
    }
  });

  it('is deterministic and free of retired particle-era budgets', () => {
    const ultra = getCoreParameters('ultra');

    expect(getCoreParameters('ultra')).toEqual(ultra);
    for (const retired of [
      'shellRadius',
      'cageSegments',
      'orbitalCount',
      'topologyNodeBudget',
      'topologyEdgeBudget',
      'fragmentBudget',
      'trajectoryBudget',
      'fieldResolution',
      'particleBudget',
    ]) {
      expect(ultra).not.toHaveProperty(retired);
    }
  });
});
