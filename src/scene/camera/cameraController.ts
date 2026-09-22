import { finiteOr } from '../seedRandom';

export type Vector3Tuple = readonly [x: number, y: number, z: number];

/**
 * The states the rig answers to.
 *
 * Owned here rather than imported from the scene. The camera's response to being
 * looked at is a property of the camera, and a rig that could not be reasoned
 * about without the thing it is pointed at would be a rig that has to be changed
 * every time the thing is. The scene's own vocabulary lives with the scene; this
 * is the subset that means something to a camera, and it is spelled out here so
 * the two can be read side by side and seen to be different things.
 *
 * `agent_activity` has no producer in this stage — the Agent Activity interface
 * exists and accepts the eight signals the brief names, but no agent drives it —
 * and it is kept because the camera's answer to it is part of what that interface
 * promises. A vocabulary that only contains what currently happens is a
 * vocabulary that has to be reopened every time something new happens.
 */
export type CameraVisualState =
  | 'dormant'
  | 'awakening'
  | 'idle'
  | 'hover_response'
  | 'focusing'
  | 'agent_activity';

/**
 * The canvas camera's near and far planes, in world units.
 *
 * **These were absent, and their absence was a rendering defect rather than a tuning
 * choice.** With no value given, the renderer used its default far of 1000 against a world
 * two thousand units across and a rig whose reveal station stands at an eye of about 1150.
 * The last act of the scroll story was therefore clipped away entirely, and the resting
 * shot was silently losing everything beyond a kilometre — which is what the "empty upper
 * third" of the frame has been. Both were being read as composition problems, and neither
 * was one.
 *
 * `FAR` is derived rather than picked: the worst camera station to the farthest corner of
 * the world is the world's own diagonal plus the reveal's height, with a margin. `NEAR` is
 * small because nothing in this composition is ever close to the lens — the nearest
 * geometry is the ground directly under a camera that is always scores of units above it.
 */
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 12000;

/** The canvas camera's field of view, in degrees. Owned here so it cannot drift. */
export const CAMERA_FOV_DEGREES = 48;

/**
 * Where the canvas camera stands for the one frame before `SceneHost` snaps the
 * rig to the entry approach.
 *
 * Deliberately outside the world, high and far back, so that frame is dark sky
 * rather than the inside of a hill. It is not a pose anything is authored
 * against — the entry shot is — and it exists only so that the renderer is never
 * asked for a frame from a camera in an unspecified place.
 */
export const BOOTSTRAP_CAMERA_POSITION: Vector3Tuple = [0, 96, 700];

export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/**
 * A pose the rig can hold or move to.
 *
 * Structurally a subset of the shot system's `ShotFraming`, and that is the
 * point: the shot system is pure data about the world and this is the part of it
 * the camera needs, so a shot can be handed to this module without either side
 * knowing about the other's remaining fields.
 */
export type CameraPose = {
  readonly position: Vector3Tuple;
  readonly lookTarget: Vector3Tuple;
  readonly fov: number;
  /**
   * Seconds to take to move *into* this pose. `0` means the pose is a resting
   * state — which is a claim about being already there, and is treated as one
   * below rather than as an instruction to cut.
   */
  readonly duration: number;
  readonly easing: EasingName;
};

/**
 * The duration a resting pose gets when the rig is *not* already there.
 *
 * A shot that declares no duration is declaring that it rests, not that it
 * snaps; the two are the same thing only when the camera has nowhere to travel.
 * Both real cases in this world are the second sort — arriving
 * `domainArrival` → `domainInspection` moves 168 units, and the entry's hand-off
 * to the vista moves further — and a cut at either is a visible glitch in a move
 * that is otherwise continuous. So an unspecified move gets this instead, and
 * `CUT_DISTANCE` below decides which of the two it was.
 *
 * 1.3s against the authored shots' 0.9 to 3.2, which keeps the whole focus
 * sequence — 1.4 + 1.1 + 1.3 — inside the brief's two-to-four seconds.
 */
export const SETTLE_DURATION = 1.3;
const SETTLE_EASING: EasingName = 'easeInOut';

/**
 * How close the rig has to already be for a resting pose to be a cut.
 *
 * In world units, and applied to the pose *and* its aim point summed, so a shot
 * that is in the right place pointing somewhere else still moves. Four units at
 * these distances is a nudge rather than a shot change.
 */
export const CUT_DISTANCE = 4;

/** Handheld aim at full response, in radians. */
const POINTER_AIM_X = 0.018;
const POINTER_AIM_Y = 0.014;
/**
 * Handheld body sway at full response, as a fraction of the shot's own distance.
 *
 * A fraction rather than the world units the old rig used, and the old rig's
 * numbers are what set it: 0.13 units of sway at a subject 20 units away is
 * 0.0065 of the distance, and that is the feel being carried over. Written as
 * world units it would be invisible at the watershed's 800-unit standoff and
 * would have to be retuned the next time the world is rebuilt.
 */
const POINTER_SWAY_FRACTION = 0.0065;
/** Idle drift, per second, as a fraction of the shot's distance. */
const DRIFT_RATE = 0.055;
const DRIFT_SWAY_FRACTION = 0.011;
const DRIFT_AIM = 0.004;

export type CameraControllerOptions = {
  readonly pointerDamping?: number;
  readonly reducedMotion?: boolean;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function approach(
  current: number,
  target: number,
  damping: number,
  deltaSeconds: number,
): number {
  const alpha = 1 - Math.exp(-damping * deltaSeconds);
  return current + (target - current) * alpha;
}

/** The authored easing, evaluated. `t` is clamped, so a caller may overshoot. */
export function ease(name: EasingName, t: number): number {
  const x = clamp(t, 0, 1);
  switch (name) {
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
    default:
      return x;
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerp3(from: Vector3Tuple, to: Vector3Tuple, t: number): Vector3Tuple {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

function distanceBetween(a: Vector3Tuple, b: Vector3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// --- Pose resolution ---------------------------------------------------------

export type HandheldInput = {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly response: number;
  readonly amplitudeScale: number;
  /** Seconds of drift clock. The idle's slow wander, never an orbit. */
  readonly driftClock: number;
};

/**
 * The rig's four perturbation scalars, as a pure function of its own inputs.
 *
 * Split out from the pose so that both halves are testable without a class, and
 * so the *character* of the wander is one place rather than two: the pointer and
 * the drift are the same kind of quantity and they compose here rather than
 * being added together somewhere downstream.
 */
export type Handheld = {
  /** Aim offset in radians. Right positive, down positive — the DOM's own sign. */
  readonly aimX: number;
  readonly aimY: number;
  /** Body offset, as a fraction of the shot's own distance. */
  readonly swayX: number;
  readonly swayY: number;
};

export function deriveHandheld(input: HandheldInput): Handheld {
  const pointerX = clamp(finiteOr(input.pointerX, 0), -1, 1);
  const pointerY = clamp(finiteOr(input.pointerY, 0), -1, 1);
  const swing = finiteOr(input.response, 0) * finiteOr(input.amplitudeScale, 1);
  const clock = finiteOr(input.driftClock, 0);

  // Two incommensurate periods, so the wander does not visibly repeat and never
  // returns to a pose it has already held. Note what is *not* here: no term
  // depends on elapsed time alone in a way that would carry the camera around
  // the subject. The brief permits drift and forbids an orbit.
  const driftX = Math.sin(clock * DRIFT_RATE);
  const driftY = Math.sin(clock * DRIFT_RATE * 0.63 + 1.7);

  return {
    aimX: pointerX * POINTER_AIM_X * swing + driftX * DRIFT_AIM * swing,
    aimY: pointerY * POINTER_AIM_Y * swing + driftY * DRIFT_AIM * 0.7 * swing,
    swayX: pointerX * POINTER_SWAY_FRACTION * swing + driftX * DRIFT_SWAY_FRACTION * swing,
    swayY: pointerY * POINTER_SWAY_FRACTION * swing + driftY * DRIFT_SWAY_FRACTION * 0.6 * swing,
  };
}

export type CameraPoseInput = {
  readonly position: Vector3Tuple;
  readonly lookTarget: Vector3Tuple;
  readonly fov: number;
  readonly handheld: Handheld;
};

export type ResolvedCameraPose = {
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly lookZ: number;
  readonly fov: number;
};

/**
 * A pose plus its handheld wobble, as the numbers a camera object is set from.
 *
 * `lookAt` is what the caller does with this, rather than a yaw and a pitch.
 * Three composes the view basis from the pose and the world up, and doing that
 * arithmetic a second time here is how the two come to disagree — the old rig
 * built a yaw and a pitch by hand because it never turned toward anything, and
 * this one turns toward something every frame by design.
 *
 * The aim is a genuine rotation of the view direction rather than a lateral
 * offset of the look target, because those differ by a factor of the distance:
 * an offset that reads as a glance at 20 units is a lurch at 800.
 */
export function deriveCameraPose(input: CameraPoseInput): ResolvedCameraPose {
  // Every scalar is filtered, which is the same posture the rig this replaced
  // took and for the same reason: a NaN reaching the view matrix blanks the
  // frame rather than raising, and a camera that falls back to its last sane
  // pose is a better failure than a black page.
  const px = finiteOr(input.position[0], 0);
  const py = finiteOr(input.position[1], 0);
  const pz = finiteOr(input.position[2], 0);
  const lx = finiteOr(input.lookTarget[0], 0);
  const ly = finiteOr(input.lookTarget[1], 0);
  const lz = finiteOr(input.lookTarget[2], -1);
  const distance = Math.hypot(lx - px, ly - py, lz - pz) || 1;

  const forward: Vector3Tuple = [(lx - px) / distance, (ly - py) / distance, (lz - pz) / distance];
  // `forward × up`, which for a camera looking down −Z gives +X — the world's
  // right, and the direction the screen's right edge points. Written out rather
  // than taken from three so this module stays free of it.
  const rightRaw: Vector3Tuple = [-forward[2], 0, forward[0]];
  const rightLength = Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]);
  // Looking straight up or down leaves the view direction parallel to the world
  // up, and the cross product there is the zero vector. The world never asks the
  // camera to do it, and a NaN projection is a bad way to find out otherwise.
  const right: Vector3Tuple =
    rightLength < 1e-6 ? [1, 0, 0] : [rightRaw[0] / rightLength, rightRaw[1] / rightLength, rightRaw[2] / rightLength];
  const up: Vector3Tuple = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];

  const aimX = finiteOr(input.handheld.aimX, 0);
  const aimY = finiteOr(input.handheld.aimY, 0);
  const swayX = finiteOr(input.handheld.swayX, 0);
  const swayY = finiteOr(input.handheld.swayY, 0);
  const bodyX = px + right[0] * swayX * distance + up[0] * swayY * distance;
  const bodyY = py + right[1] * swayX * distance + up[1] * swayY * distance;
  const bodyZ = pz + right[2] * swayX * distance + up[2] * swayY * distance;

  // Rodrigues about each axis. The signs are not arbitrary: with the camera
  // looking down −Z, a positive rotation about `up` swings the view toward −X,
  // so aiming right is a negative angle about it, and a positive rotation about
  // `right` swings the view up, so aiming down is a negative angle about that.
  const swung = rotate(rotate(forward, up, -aimX), right, -aimY);

  return {
    positionX: bodyX,
    positionY: bodyY,
    positionZ: bodyZ,
    lookX: bodyX + swung[0] * distance,
    lookY: bodyY + swung[1] * distance,
    lookZ: bodyZ + swung[2] * distance,
    fov: input.fov,
  };
}

function rotate(v: Vector3Tuple, axis: Vector3Tuple, angle: number): Vector3Tuple {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  const crossX = axis[1] * v[2] - axis[2] * v[1];
  const crossY = axis[2] * v[0] - axis[0] * v[2];
  const crossZ = axis[0] * v[1] - axis[1] * v[0];
  const k = dot * (1 - cos);
  return [
    v[0] * cos + crossX * sin + axis[0] * k,
    v[1] * cos + crossY * sin + axis[1] * k,
    v[2] * cos + crossZ * sin + axis[2] * k,
  ];
}

// --- The controller ----------------------------------------------------------

/** A pose with its handheld wobble stripped off: where the rig actually is. */
export type PoseState = {
  readonly position: Vector3Tuple;
  readonly lookTarget: Vector3Tuple;
  readonly fov: number;
};

/**
 * An ordered run of poses, and a name for it.
 *
 * The key is what makes re-requesting the same sequence a no-op. A caller in a
 * frame loop asks for its intent on every frame — it has no other way to say
 * "still this" — and without a key the rig would restart the move into its first
 * pose sixty times a second and never arrive anywhere.
 */
export type ShotSequence = {
  readonly key: string;
  readonly shots: readonly CameraPose[];
};

/**
 * Reduced motion keeps state causality readable without perpetual drift:
 * transitions still happen, but they are *cuts* rather than travels.
 *
 * It used to be "short and low-displacement" — the same transitions at 42% of
 * the amplitude — and that is a defensible reading of a preference about
 * animation until it is measured. What it produced was a camera that still
 * travelled: an entry that still began behind the gate and still flew in, a
 * focus that still took three and a half seconds, an escape that still
 * decompressed. Nobody who asks for reduced motion is asking for a smaller
 * version of the same move; they are asking not to be moved. So the rig lands
 * on the pose the sequence rests in and skips the ones it would have passed
 * through, and the amplitude scale below is what is left of the old reading —
 * it still softens the pointer's own response, which is input rather than
 * animation. See `setReducedMotion` for why the preference is a setter rather
 * than a constructor argument.
 */
const REDUCED_MOTION_POINTER_DAMPING = 12;
const DEFAULT_POINTER_DAMPING = 7;

/**
 * How fast the scroll's authority over the camera rises and falls, per second.
 *
 * Fast enough that the camera answers the wheel within a couple of frames — a scroll that
 * lags its own input feels broken — and slow enough that the transfer out of the resting
 * shot is a settle. The same rate in both directions, because a scroll that took over
 * quickly and let go slowly would be a camera that clung to the visitor at the bottom of
 * the page.
 */
const SCROLL_AUTHORITY_DAMPING = 6.5;
const REDUCED_MOTION_AMPLITUDE_SCALE = 0.42;

export class CameraController {
  /**
   * Mutable, and that is the whole of the reduced-motion toggle's cost.
   *
   * It used to be three `readonly` fields set once in the constructor, which
   * meant the only way for `SceneHost` to change the preference was to build a
   * new rig — and a new rig has no pose, which is what re-armed the entry and
   * sent a visitor who had already arrived back through the gate. A preference
   * is a change of mode, not a change of rig, so it is a setter.
   */
  private pointerDamping: number;
  private readonly pointerDampingOverride: number | null;
  private amplitudeScale: number;
  private reducedMotion: boolean;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerX = 0;
  private pointerY = 0;
  private pose: PoseState;
  private from: PoseState;
  private to: PoseState;
  private duration = 0;
  private easingName: EasingName = 'linear';
  private elapsed = 0;
  private queued: readonly CameraPose[] = [];
  private key: string | null = null;
  private driftClock = 0;
  private visualState: CameraVisualState = 'dormant';
  /**
   * The scroll's pose and how much of it to believe, `0`..`1`.
   *
   * Held here rather than passed into `getResolvedPose` so the frame loop has one place to
   * write each frame and the resolve has one place to read, which is the same shape the
   * pointer already uses. `scrollAuthority` is damped toward its target rather than set, so
   * a scroll that arrives in a single wheel event does not snatch the camera.
   */
  private scrollPose: PoseState | null = null;
  private scrollAuthority = 0;
  private scrollAuthorityTarget = 0;

  public constructor(options: CameraControllerOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.pointerDampingOverride = options.pointerDamping ?? null;
    this.pointerDamping = this.resolvePointerDamping();
    this.amplitudeScale = this.reducedMotion ? REDUCED_MOTION_AMPLITUDE_SCALE : 1;

    const start: PoseState = {
      position: BOOTSTRAP_CAMERA_POSITION,
      lookTarget: [0, 0, 0],
      fov: CAMERA_FOV_DEGREES,
    };
    this.pose = start;
    this.from = start;
    this.to = start;
  }

  private resolvePointerDamping(): number {
    if (this.pointerDampingOverride !== null) {
      return this.pointerDampingOverride;
    }
    return this.reducedMotion ? REDUCED_MOTION_POINTER_DAMPING : DEFAULT_POINTER_DAMPING;
  }

  /**
   * Changes the rig's mode without replacing it.
   *
   * **Why this is not a constructor argument any more.** The preference can
   * change while the page is open — that is what a media query subscription is
   * for — and the previous shape handled it by rebuilding the controller. A new
   * controller starts with no pose, so the scene host had to re-run the boot
   * snap and the entry, and toggling the preference mid-visit therefore replayed
   * the whole arrival: the camera flew back through the gate for somebody who had
   * been standing in the landscape for a minute. Keeping one rig and changing its
   * mode removes the failure by construction rather than by remembering not to
   * re-arm it.
   *
   * Turning it *on* also finishes whatever move is in flight, at the pose the
   * move was heading for. A rig that carried on travelling to a destination it
   * has just been told not to travel to would be honouring the letter of the
   * setting and none of it.
   */
  public setReducedMotion(prefersReducedMotion: boolean): void {
    if (prefersReducedMotion === this.reducedMotion) {
      return;
    }

    this.reducedMotion = prefersReducedMotion;
    this.pointerDamping = this.resolvePointerDamping();
    this.amplitudeScale = prefersReducedMotion ? REDUCED_MOTION_AMPLITUDE_SCALE : 1;

    if (prefersReducedMotion) {
      this.landOnTarget();
    }
  }

  public setPointerTarget(x: number, y: number): void {
    this.pointerTargetX = clamp(x, -1, 1);
    this.pointerTargetY = clamp(y, -1, 1);
  }

  /** Put the rig at a pose with no transition, and forget any sequence. */
  public snapTo(pose: CameraPose): void {
    const state = poseState(pose);
    this.pose = state;
    this.from = state;
    this.to = state;
    this.duration = 0;
    this.easingName = 'linear';
    this.elapsed = 0;
    this.queued = [];
    this.key = null;
  }

  /**
   * Run a sequence, starting with its first pose.
   *
   * A sequence already running under the same key is left alone, which is what
   * lets a caller ask every frame. A different key *interrupts* from wherever the
   * camera currently is rather than from the last pose it completed, so escaping
   * part way through a focus travels back along the path it came in on instead of
   * jumping to the arrival pose first.
   */
  public setSequence(sequence: ShotSequence): void {
    if (sequence.key === this.key) return;
    const [first, ...rest] = sequence.shots;
    if (first === undefined) return;

    this.key = sequence.key;
    this.queued = rest;
    this.begin(first);

    // Reduced motion takes the sequence's own destination and skips its way
    // points. The destination is the *last* pose rather than the first, and that
    // is not an arbitrary choice: `sequenceFor` is written so that the pose an
    // intent rests in is the one it ends on — `entry` chains into `idleVista`,
    // `escape` chains back to it, and `focus` ends on `domainInspection` — so the
    // last pose is exactly "where this intent is asking the camera to be".
    // Snapping to the first would leave the rig parked on a waypoint.
    if (this.reducedMotion) {
      this.landOnTarget();
    }
  }

  /**
   * Finish the current move and everything queued behind it, without travelling.
   *
   * The pose the sequence was heading for, which is its last queued shot when
   * there is one and the pose already being moved into when there is not.
   */
  private landOnTarget(): void {
    const lastQueued = this.queued[this.queued.length - 1];
    const destination: PoseState = lastQueued === undefined ? this.to : poseState(lastQueued);
    this.pose = destination;
    this.from = destination;
    this.to = destination;
    this.duration = 0;
    this.easingName = 'linear';
    this.elapsed = 0;
    this.queued = [];
  }

  public setVisualState(state: CameraVisualState): void {
    this.visualState = state;
  }

  /**
   * Offers the scroll's pose, and how much authority it should have.
   *
   * `null` withdraws the scroll entirely, which is what the scene host passes when the page
   * is at the top and again once the story has handed the frame back. The authority is
   * damped rather than assigned, at a rate high enough to feel attached to the wheel and low
   * enough that the transition out of the resting shot is a settle rather than a cut.
   */
  public setScrollTrack(pose: CameraPose | null, authority: number): void {
    this.scrollPose = pose === null ? null : poseState(pose);
    this.scrollAuthorityTarget = pose === null ? 0 : clamp(authority, 0, 1);
  }

  /** True once the current move has landed and nothing is queued behind it. */
  public isSettled(): boolean {
    return this.elapsed >= this.duration && this.queued.length === 0;
  }

  /** The pose the rig is holding, before the handheld wobble. */
  public getPose(): PoseState {
    return this.pose;
  }

  public update(deltaSeconds: number): void {
    const safeDelta = clamp(deltaSeconds, 0, 0.1);
    // The idle wander is motion, and under the preference it stops rather than shrinking.
    // The amplitude scale below still applies to the pointer's own response, which is
    // input rather than drift and must keep working.
    if (!this.reducedMotion) {
      this.driftClock += safeDelta;
    }
    this.pointerX = approach(this.pointerX, this.pointerTargetX, this.pointerDamping, safeDelta);
    this.pointerY = approach(this.pointerY, this.pointerTargetY, this.pointerDamping, safeDelta);

    // The scroll's authority, damped. A rate rather than a duration because the scroll is
    // continuous input: there is no moment at which the move "begins" to time from.
    this.scrollAuthority = approach(
      this.scrollAuthority,
      this.scrollAuthorityTarget,
      SCROLL_AUTHORITY_DAMPING,
      safeDelta,
    );

    this.elapsed = Math.min(this.duration, this.elapsed + safeDelta);
    const t = this.duration === 0 ? 1 : ease(this.easingName, this.elapsed / this.duration);
    // Straight lines, in world space, between the two poses. Not an arc and not
    // a spline, which for a camera in a landscape is a decision that has to be
    // checked rather than argued: the line between two clear poses can pass
    // through a hill neither of them touches. `shots.test.ts` flies every path
    // the choreography uses and asserts the camera stays clear of the ground and
    // is never aimed into it, so this stays a straight line by measurement.
    this.pose = {
      position: lerp3(this.from.position, this.to.position, t),
      lookTarget: lerp3(this.from.lookTarget, this.to.lookTarget, t),
      fov: lerp(this.from.fov, this.to.fov, t),
    };

    // Chained rather than queued-and-awaited: each pose starts from the one the
    // camera actually reached, so a sequence interrupted half way through still
    // continues from a pose that exists.
    if (this.elapsed >= this.duration && this.queued.length > 0) {
      const [next, ...rest] = this.queued;
      this.queued = rest;
      if (next !== undefined) this.begin(next);
    }
  }

  /** The pose to draw, with the pointer and the drift applied on top of it. */
  public getResolvedPose(): ResolvedCameraPose {
    /*
     * The scroll, blended over the shot.
     *
     * The shot's own pose is `this.pose` and it keeps advancing underneath — nothing here
     * writes to it — so when authority returns to zero the rig is exactly where the shot
     * system would have put it. That is the property that makes the reveal's hand-off and a
     * reverse scroll both work without special cases.
     *
     * The blend is on position, aim and field of view together, because they are one
     * framing: interpolating two of the three produces a pose the scroll's own stations
     * never asked for, which reads as the lens drifting away from the subject.
     */
    const authority = this.scrollPose === null ? 0 : this.scrollAuthority;
    const blended: PoseState =
      this.scrollPose === null || authority <= 0
        ? this.pose
        : {
            position: [
              lerp(this.pose.position[0], this.scrollPose.position[0], authority),
              lerp(this.pose.position[1], this.scrollPose.position[1], authority),
              lerp(this.pose.position[2], this.scrollPose.position[2], authority),
            ],
            lookTarget: [
              lerp(this.pose.lookTarget[0], this.scrollPose.lookTarget[0], authority),
              lerp(this.pose.lookTarget[1], this.scrollPose.lookTarget[1], authority),
              lerp(this.pose.lookTarget[2], this.scrollPose.lookTarget[2], authority),
            ],
            fov: lerp(this.pose.fov, this.scrollPose.fov, authority),
          };

    return deriveCameraPose({
      position: blended.position,
      lookTarget: blended.lookTarget,
      fov: blended.fov,
      handheld: deriveHandheld({
        pointerX: this.pointerX,
        pointerY: this.pointerY,
        response: this.getResponseStrength(),
        amplitudeScale: this.amplitudeScale,
        driftClock: this.driftClock,
      }),
    });
  }

  /**
   * Start moving into a pose, from wherever the camera is.
   *
   * The duration is the *shot's own* when it declares one, so the shot system
   * still authors the timing; this is the only place that decides how long a
   * move takes, which is what keeps a transition from being written twice and
   * disagreeing with itself at the moment the second copy starts.
   */
  private begin(pose: CameraPose): void {
    const travelled =
      distanceBetween(this.pose.position, pose.position) +
      distanceBetween(this.pose.lookTarget, pose.lookTarget);
    const duration =
      pose.duration > 0 ? pose.duration : travelled > CUT_DISTANCE ? SETTLE_DURATION : 0;

    this.from = this.pose;
    this.to = poseState(pose);
    this.duration = duration;
    this.easingName = pose.duration > 0 ? pose.easing : SETTLE_EASING;
    this.elapsed = 0;
  }

  public getPointerTargetX(): number {
    return this.pointerTargetX;
  }

  public getPointerTargetY(): number {
    return this.pointerTargetY;
  }

  public getPointerX(): number {
    return this.pointerX;
  }

  public getPointerY(): number {
    return this.pointerY;
  }

  public getResponseStrength(): number {
    switch (this.visualState) {
      case 'agent_activity':
        return 1.2;
      case 'hover_response':
      case 'focusing':
        return 1;
      case 'awakening':
        return 0.72;
      case 'idle':
        return 0.88;
      default:
        return 0.35;
    }
  }

  /**
   * Displacement authority for view layers. Reduced motion keeps the same
   * causality at a fraction of the travel distance.
   */
  public getAmplitudeScale(): number {
    return this.amplitudeScale;
  }
}

function poseState(pose: CameraPose): PoseState {
  return { position: pose.position, lookTarget: pose.lookTarget, fov: pose.fov };
}

/** The pose a sequence's own key is derived from, so a key and a sequence agree. */
export function sequenceKey(name: string, domainId?: string | null): string {
  return domainId ? `${name}:${domainId}` : name;
}

export function createCameraController(
  options: CameraControllerOptions = {},
): CameraController {
  return new CameraController(options);
}
