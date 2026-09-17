import { describe, expect, it } from 'vitest';

import { createCameraController } from './cameraController';

describe('CameraController', () => {
  it('clamps pointer targets and converges with damping without overshooting', () => {
    const controller = createCameraController();
    controller.setPointerTarget(4, -4);
    controller.update(1 / 60);

    expect(controller.getPointerTargetX()).toBe(1);
    expect(controller.getPointerTargetY()).toBe(-1);
    expect(controller.getPointerX()).toBeGreaterThan(0);
    expect(controller.getPointerX()).toBeLessThanOrEqual(1);

    for (let index = 0; index < 180; index += 1) {
      controller.update(1 / 60);
    }

    expect(controller.getPointerX()).toBeCloseTo(1, 2);
    expect(controller.getPointerY()).toBeCloseTo(-1, 2);
    expect(controller.getPointerX()).toBeLessThanOrEqual(1);
    expect(controller.getPointerY()).toBeGreaterThanOrEqual(-1);
  });

  it('interpolates focus direction independently from pointer parallax', () => {
    const controller = createCameraController();
    controller.setFocusTarget(1, -0.5, 0.8);
    controller.update(0.2);

    expect(controller.getFocusX()).toBeGreaterThan(0);
    expect(controller.getFocusY()).toBeLessThan(0);
    expect(controller.getFocusZ()).toBeGreaterThan(0);
  });

  it('settles immediately when reduced motion is enabled', () => {
    const controller = createCameraController({ reducedMotion: true });
    controller.setPointerTarget(0.75, -0.25);
    controller.setFocusTarget(-0.5, 0.4, 0.3);
    controller.update(1 / 60);

    expect(controller.getPointerX()).toBe(0.75);
    expect(controller.getPointerY()).toBe(-0.25);
    expect(controller.getFocusX()).toBe(-0.5);
    expect(controller.getFocusY()).toBe(0.4);
    expect(controller.getFocusZ()).toBe(0.3);
  });
});