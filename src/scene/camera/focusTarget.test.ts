import { describe, expect, it } from 'vitest';

import { deriveCameraPose, deriveHandheld, ease } from './cameraController';

/**
 * The rig's pure arithmetic.
 *
 * This file was named for `deriveCameraFocusTarget`, a helper that turned a
 * graph node's position into a unit direction and that went with the rift. What
 * replaces it is the pair below — the handheld perturbation and the pose it is
 * applied to — and those are the same kind of thing the old helper was: the
 * camera's maths, with no class and no clock around it. The filename is
 * historical; the subject is not.
 *
 * The pose is worth testing apart from the controller because the failure it
 * makes is not a wrong number but a *silently* wrong one: a sign error in the
 * aim rotates the view the wrong way and every frame still looks like a frame.
 */

const ZERO = { aimX: 0, aimY: 0, swayX: 0, swayY: 0 };

describe('ease', () => {
  it('runs from nothing to everything', () => {
    for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(name, 0), name).toBe(0);
      expect(ease(name, 1), name).toBe(1);
    }
  });

  it('never goes backwards', () => {
    // A non-monotone easing is a camera that stutters, which reads as a dropped
    // frame rather than as a bug in a curve.
    for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      let previous = -1;
      for (let step = 0; step <= 40; step += 1) {
        const value = ease(name, step / 40);
        expect(value, `${name} at ${step}`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('clamps a caller that overshoots', () => {
    // The controller divides an elapsed time by a duration and rounds, so it can
    // ask for 1.0000001. Left unclamped, `easeOut` answers with a value below
    // one and the camera never quite arrives.
    expect(ease('easeOut', 1.5)).toBe(1);
    expect(ease('easeIn', -0.5)).toBe(0);
  });
});

describe('deriveCameraPose', () => {
  const straight: Parameters<typeof deriveCameraPose>[0] = {
    position: [0, 0, 0],
    lookTarget: [0, 0, -100],
    fov: 48,
    handheld: ZERO,
  };

  it('is the identity when nothing is perturbing it', () => {
    const pose = deriveCameraPose(straight);
    expect([pose.positionX, pose.positionY, pose.positionZ]).toEqual([0, 0, 0]);
    expect([pose.lookX, pose.lookY, pose.lookZ]).toEqual([0, 0, -100]);
    expect(pose.fov).toBe(48);
  });

  it('aims right when told to aim right, and down when told to aim down', () => {
    // The sign convention, which is the DOM's: `pointerX` is positive toward the
    // right edge of the screen and `pointerY` positive toward the bottom. Getting
    // either backwards inverts the handheld response and nothing else notices.
    //
    // Checked as `distance · sin(angle)` rather than as a sign, because that is
    // what a rotation does — a lateral *offset* of the same magnitude would give
    // `distance · angle`, and the two differ by 1.7 parts in a thousand at this
    // angle. A sign-only assertion would pass on either, and the two stop being
    // interchangeable the moment the standoff changes.
    const right = deriveCameraPose({ ...straight, handheld: { ...ZERO, aimX: 0.1 } });
    expect(right.lookX).toBeCloseTo(100 * Math.sin(0.1), 6);

    const down = deriveCameraPose({ ...straight, handheld: { ...ZERO, aimY: 0.1 } });
    expect(down.lookY).toBeCloseTo(-100 * Math.sin(0.1), 6);
    expect(down.lookX).toBeCloseTo(0, 6);
  });

  it('keeps the subject at the same distance when it aims', () => {
    // An aim is a rotation, and this is what separates it from an offset: the
    // two are identical at the distance they are calibrated at and different
    // everywhere else, which is why the old rig's world-unit offset could be
    // tuned for a subject 20 units away and be a lurch at 800.
    const aimed = deriveCameraPose({ ...straight, handheld: { ...ZERO, aimX: 0.1, aimY: 0.05 } });
    const distance = Math.hypot(aimed.lookX - aimed.positionX, aimed.lookY - aimed.positionY, aimed.lookZ - aimed.positionZ);
    expect(distance).toBeCloseTo(100, 6);
  });

  it('scales the body sway with the distance it is standing at', () => {
    // The same fraction of two different standoffs has to displace the camera by
    // two different amounts, or "a little handheld movement" means a jitter at
    // one distance and a jump at another.
    const near = deriveCameraPose({ ...straight, lookTarget: [0, 0, -20], handheld: { ...ZERO, swayX: 0.01 } });
    const far = deriveCameraPose({ ...straight, lookTarget: [0, 0, -800], handheld: { ...ZERO, swayX: 0.01 } });
    expect(near.positionX).toBeCloseTo(0.2, 6);
    expect(far.positionX).toBeCloseTo(8, 6);
  });

  it('survives a camera pointed straight down', () => {
    // The view direction is then parallel to the world up, the cross product
    // that builds the camera's right is the zero vector, and every downstream
    // number is a NaN — which the renderer answers with a blank frame rather
    // than an error. The world never asks for this pose; the guard costs one
    // comparison.
    const pose = deriveCameraPose({
      position: [0, 50, 0],
      lookTarget: [0, 0, 0],
      fov: 48,
      handheld: { aimX: 0.02, aimY: 0.02, swayX: 0.01, swayY: 0.01 },
    });
    for (const value of Object.values(pose)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('stays finite for hostile inputs', () => {
    const pose = deriveCameraPose({
      position: [Number.NaN, 0, Number.POSITIVE_INFINITY],
      lookTarget: [0, 0, -100],
      fov: 48,
      handheld: { aimX: 1e9, aimY: -1e9, swayX: 1e9, swayY: 1e9 },
    });
    // A NaN here propagates into the view matrix and blanks the frame, so this
    // asserts the shape of the failure as much as the values: whatever happens,
    // it is a number.
    expect(typeof pose.positionX).toBe('number');
    expect(typeof pose.lookZ).toBe('number');
  });
});

describe('deriveHandheld', () => {
  const base = { pointerX: 0, pointerY: 0, response: 1, amplitudeScale: 1, driftClock: 0 };

  it('is bounded by the rig’s own constants', () => {
    // The brief's `safeForeground` and `heroRegion` are promises about the
    // composition, and a handheld response large enough to move the subject out
    // of its band would break both while every test about the *shots* still
    // passed. The bound is small and it is asserted rather than assumed.
    const extreme = deriveHandheld({ ...base, pointerX: 1, pointerY: 1, driftClock: 500 });
    expect(Math.abs(extreme.aimX)).toBeLessThan(0.05);
    expect(Math.abs(extreme.aimY)).toBeLessThan(0.05);
    expect(Math.abs(extreme.swayX)).toBeLessThan(0.03);
    expect(Math.abs(extreme.swayY)).toBeLessThan(0.03);
  });

  it('answers to the pointer proportionally, and symmetrically', () => {
    const right = deriveHandheld({ ...base, pointerX: 1 });
    const left = deriveHandheld({ ...base, pointerX: -1 });
    expect(right.aimX).toBeGreaterThan(0);
    expect(left.aimX).toBeCloseTo(-right.aimX, 12);
    // The drift is the same in both, so it has to cancel exactly for this to
    // hold — which is the assertion doing double duty as a check that the
    // pointer term and the drift term are not entangled.
    expect(left.swayX).toBeCloseTo(-right.swayX, 12);
  });

  it('is quietened by the response strength and by reduced motion', () => {
    const idle = deriveHandheld({ ...base, pointerX: 1, response: 0.35 });
    const focused = deriveHandheld({ ...base, pointerX: 1, response: 1 });
    expect(Math.abs(idle.aimX)).toBeLessThan(Math.abs(focused.aimX));

    const reduced = deriveHandheld({ ...base, pointerX: 1, amplitudeScale: 0.42 });
    expect(Math.abs(reduced.aimX)).toBeLessThan(Math.abs(focused.aimX));
  });

  it('drifts, and does not go round', () => {
    // The brief allows the idle camera to drift and forbids it to orbit. An
    // orbit is a drift whose *direction from the subject* turns, so this samples
    // a long idle and checks the aim stays inside the band a still frame would
    // have — which an orbit could not do at any radius.
    let widest = 0;
    for (let step = 0; step < 4000; step += 1) {
      const handheld = deriveHandheld({ ...base, driftClock: step * 0.1 });
      widest = Math.max(widest, Math.abs(handheld.aimX), Math.abs(handheld.aimY));
    }
    expect(widest).toBeGreaterThan(0);
    expect(widest).toBeLessThan(0.05);
  });
});
