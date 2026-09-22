import { describe, expect, it } from 'vitest';

import {
  CUT_DISTANCE,
  SETTLE_DURATION,
  createCameraController,
  type CameraPose,
  type ShotSequence,
} from './cameraController';

/**
 * The rig, as a state machine.
 *
 * What this file is about is the *sequence*: which pose the camera is heading
 * for, when it hands off to the next one, and what it does when it is told to go
 * somewhere else part way. None of that is visible in a frame — a rig that
 * restarts its transition every time the caller re-asks for the shot it is
 * already in will settle eventually and look fine in a screenshot, having spent
 * the whole time at the start of its own move. That is the failure these are for.
 */

function pose(
  z: number,
  duration: number,
  easing: CameraPose['easing'] = 'linear',
): CameraPose {
  return {
    position: [0, 0, z],
    lookTarget: [0, 0, z - 100],
    fov: 48,
    duration,
    easing,
  };
}

/** Run the rig forward in the step the frame loop uses. */
function run(controller: ReturnType<typeof createCameraController>, seconds: number, step = 1 / 60): void {
  const steps = Math.round(seconds / step);
  for (let index = 0; index < steps; index += 1) controller.update(step);
}

function positionOf(controller: ReturnType<typeof createCameraController>): readonly number[] {
  return controller.getPose().position;
}

describe('CameraController', () => {
  it('clamps pointer targets and converges with damping without overshooting', () => {
    const controller = createCameraController();
    controller.setPointerTarget(4, -9);
    expect(controller.getPointerTargetX()).toBe(1);
    expect(controller.getPointerTargetY()).toBe(-1);

    let previous = { x: 0, y: 0 };
    for (let step = 0; step < 240; step += 1) {
      controller.update(1 / 60);
      const x = controller.getPointerX();
      const y = controller.getPointerY();
      // Monotone approach: an exponential approach that overshoots is a
      // different filter wearing this one's name.
      expect(x).toBeGreaterThanOrEqual(previous.x);
      expect(y).toBeLessThanOrEqual(previous.y);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(-1);
      previous = { x, y };
    }
    expect(previous.x).toBeCloseTo(1, 3);
    expect(previous.y).toBeCloseTo(-1, 3);
  });

  it('lands exactly on a pose it is given a duration for', () => {
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));
    controller.setSequence({ key: 'a', shots: [pose(-60, 2, 'easeInOut')] });

    run(controller, 1);
    expect(positionOf(controller)[2]).toBeLessThan(0);
    expect(controller.isSettled()).toBe(false);

    run(controller, 1.5);
    // Not "close to": the easing is a function of a clamped ratio and the ratio
    // reaches one, so the rig arrives rather than approaching for ever.
    expect(positionOf(controller)[2]).toBe(-60);
    expect(controller.isSettled()).toBe(true);
  });

  it('does not restart a sequence it is already running', () => {
    // The caller asks for its intent every frame, because it has no other way to
    // say "still this". A rig that restarted would sit at t=0 for ever and the
    // frame would be identical to a still.
    const controller = createCameraController();
    const sequence: ShotSequence = { key: 'a', shots: [pose(-60, 2, 'easeOut')] };
    controller.setSequence(sequence);
    run(controller, 1);
    const midway = positionOf(controller)[2];

    for (let step = 0; step < 60; step += 1) controller.setSequence(sequence);
    expect(positionOf(controller)[2]).toBe(midway);
  });

  it('chains from the pose it actually reached, not from the pose it aimed at', () => {
    // The whole reason the rig interpolates in state rather than in a curve: an
    // interruption has to continue from somewhere real. Here the second shot is
    // asked for while the first is still moving, so the chain must start from
    // the position the camera is at rather than from the first shot's target —
    // otherwise the camera jumps to the end of a move it never made.
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));
    // A first shot with a long duration, and a second asked for before it lands.
    controller.setSequence({ key: 'a', shots: [pose(-100, 4, 'linear')] });
    run(controller, 1);
    const reached = positionOf(controller)[2]!;
    expect(reached).toBeLessThan(0);
    expect(reached).toBeGreaterThan(-100);

    controller.setSequence({ key: 'b', shots: [pose(-200, 1, 'linear')] });
    // At the instant of the switch, before a frame has run. This is the claim:
    // the interrupting sequence starts where the camera *is*. The first version
    // of this test stepped a frame and compared, which measured the new
    // transition's first step rather than its starting point — and would have
    // passed with the chain beginning at the first shot's target, because that
    // step is small either way.
    expect(positionOf(controller)[2]).toBe(reached);

    run(controller, 1 / 60);
    const afterOneFrame = positionOf(controller)[2]!;
    expect(afterOneFrame).toBeLessThan(reached);
    expect(afterOneFrame).toBeGreaterThan(reached - 20);
  });

  it('moves through every shot of a sequence, in order', () => {
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));
    controller.setSequence({
      key: 'chain',
      shots: [pose(-50, 0.5), pose(-100, 0.5), pose(-150, 0.5)],
    });

    const visited: number[] = [];
    for (let step = 0; step < 120; step += 1) {
      controller.update(1 / 60);
      visited.push(positionOf(controller)[2]!);
    }

    // Monotone, and past the last shot's value: read as "it went through the
    // middle one on the way" rather than only as "it arrived".
    for (let index = 1; index < visited.length; index += 1) {
      expect(visited[index]!).toBeLessThanOrEqual(visited[index - 1]!);
    }
    expect(visited[visited.length - 1]).toBe(-150);
  });

  it('respects a shot that declares no duration', () => {
    // A resting pose, which is what `domainInspection` and `idleVista` are. The
    // distance decides whether that means a cut or a settle — see `SETTLE_DURATION`.
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));

    // Already there: a cut, and the rig is settled on the same frame.
    controller.setSequence({ key: 'near', shots: [pose(0, 0)] });
    run(controller, 1 / 60);
    expect(controller.isSettled()).toBe(true);
    expect(positionOf(controller)[2]).toBe(0);

    // Somewhere else: a settle, of the rig's own length rather than zero.
    controller.setSequence({ key: 'far', shots: [pose(-400, 0)] });
    expect(CUT_DISTANCE).toBeLessThan(400);
    run(controller, SETTLE_DURATION * 0.5);
    expect(controller.isSettled()).toBe(false);
    const midway = positionOf(controller)[2]!;
    expect(midway).toBeLessThan(0);
    expect(midway).toBeGreaterThan(-400);

    run(controller, SETTLE_DURATION);
    expect(positionOf(controller)[2]).toBe(-400);
  });

  it('snaps without travelling when told to', () => {
    const controller = createCameraController();
    controller.setSequence({ key: 'a', shots: [pose(-500, 3)] });
    run(controller, 0.5);
    controller.snapTo(pose(-9, 0));
    expect(positionOf(controller)[2]).toBe(-9);
    expect(controller.isSettled()).toBe(true);
  });

  it('settles within a short finite transition when reduced motion is enabled', () => {
    const controller = createCameraController({ reducedMotion: true });
    controller.snapTo(pose(0, 0));
    controller.setSequence({ key: 'a', shots: [pose(-60, 1)] });
    run(controller, 2);
    expect(controller.isSettled()).toBe(true);
    expect(positionOf(controller)[2]).toBe(-60);
  });

  it('lands on a sequence\u2019s destination rather than travelling through it', () => {
    // The entry, the focus and the escape are all multi-shot moves, and the pose
    // an intent *rests* in is the one it ends on. Sampling every frame is the
    // point of the test: a rig that arrived at the destination without passing
    // through the waypoints would satisfy a start/end assertion and would still
    // have played the move.
    const controller = createCameraController({ reducedMotion: true });
    controller.snapTo(pose(0, 0));
    controller.setSequence({ key: 'focus', shots: [pose(-40, 1.4), pose(-90, 0.8), pose(-150, 1.1)] });

    const visited: number[] = [];
    for (let step = 0; step < 240; step += 1) {
      controller.update(1 / 60);
      visited.push(positionOf(controller)[2]!);
    }

    expect(new Set(visited)).toEqual(new Set([-150]));
    expect(controller.isSettled()).toBe(true);
  });

  it('finishes a move already in flight when the preference turns on', () => {
    // The preference can arrive mid-visit, which is what a media-query
    // subscription means. A rig told to stop, that then carried on to a
    // destination it had just been told not to travel to, would be honouring
    // the letter of the setting and none of it.
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));
    controller.setSequence({ key: 'a', shots: [pose(-400, 4, 'linear')] });
    run(controller, 1);
    const travelling = positionOf(controller)[2]!;
    expect(travelling).toBeLessThan(0);
    expect(travelling).toBeGreaterThan(-400);

    controller.setReducedMotion(true);

    expect(positionOf(controller)[2]).toBe(-400);
    expect(controller.isSettled()).toBe(true);
  });

  it('finishes a whole queued sequence, not just the leg it is on', () => {
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));
    controller.setSequence({
      key: 'focus',
      shots: [pose(-40, 4, 'linear'), pose(-90, 4, 'linear'), pose(-150, 4, 'linear')],
    });
    run(controller, 1);

    controller.setReducedMotion(true);

    // The last shot, which is where the intent rests — not the one being moved
    // into when the preference arrived.
    expect(positionOf(controller)[2]).toBe(-150);
  });

  it('restores the whole mode when the preference is turned back off', () => {
    const controller = createCameraController({ reducedMotion: true });
    const reducedScale = controller.getAmplitudeScale();

    controller.setReducedMotion(false);

    expect(controller.getAmplitudeScale()).toBe(1);
    expect(controller.getAmplitudeScale()).toBeGreaterThan(reducedScale);

    // And motion is back: a move asked for now takes its own duration again.
    controller.snapTo(pose(0, 0));
    controller.setSequence({ key: 'a', shots: [pose(-60, 2, 'easeInOut')] });
    run(controller, 0.5);
    expect(controller.isSettled()).toBe(false);
    expect(positionOf(controller)[2]).toBeGreaterThan(-60);
  });

  it('reduces displacement authority under reduced motion and keeps it whole otherwise', () => {
    const normal = createCameraController();
    const reduced = createCameraController({ reducedMotion: true });
    expect(reduced.getAmplitudeScale()).toBeLessThan(normal.getAmplitudeScale());
    expect(normal.getAmplitudeScale()).toBe(1);
  });

  it('never lets the drift carry the camera away from its subject', () => {
    // The brief permits the idle camera to drift and forbids it to orbit. Ten
    // minutes of standing still is the interval over which an orbit would become
    // obvious and a bounded wobble would not.
    const controller = createCameraController();
    controller.snapTo(pose(0, 0));
    controller.setSequence({ key: 'rest', shots: [pose(0, 0)] });
    controller.setVisualState('idle');

    let furthest = 0;
    for (let step = 0; step < 10 * 60 * 60; step += 1) {
      controller.update(1 / 60);
      const position = controller.getPose().position;
      furthest = Math.max(furthest, Math.hypot(position[0], position[1], position[2]));
    }
    // The *held* pose never moves at all, which is a stronger statement than the
    // drawn one and the one that matters: the wobble is applied on top and is
    // bounded by `deriveHandheld`.
    expect(furthest).toBe(0);
  });

  it('stays finite for hostile inputs', () => {
    const controller = createCameraController();
    controller.setPointerTarget(Number.NaN, Number.POSITIVE_INFINITY);
    controller.setSequence({
      key: 'hostile',
      shots: [
        {
          position: [Number.NaN, 0, 0],
          lookTarget: [0, 0, Number.NEGATIVE_INFINITY],
          fov: 48,
          duration: Number.NaN,
          easing: 'linear',
        },
      ],
    });
    run(controller, 1);
    const resolved = controller.getResolvedPose();
    for (const value of Object.values(resolved)) {
      expect(Number.isFinite(value), JSON.stringify(resolved)).toBe(true);
    }
  });
});
