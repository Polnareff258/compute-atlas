import { finiteOr } from '../seedRandom';

export type CameraFocusTarget = readonly [x: number, y: number, z: number];

/**
 * The states the rig answers to.
 *
 * Owned here rather than imported from the hero. The camera's response to being
 * looked at is a property of the camera, and a rig that could not be reasoned
 * about without the thing it is pointed at would be a rig that has to be
 * changed every time the thing is. The scene's own vocabulary lives with the
 * scene; this is the subset that means something to a camera, and it is spelled
 * out here so the two can be read side by side and seen to be different things.
 *
 * `agent_activity` has no producer in this stage — the Agent Activity interface
 * exists and accepts the eight signals the brief names, but no agent drives it —
 * and it is kept because the camera's answer to it is part of what that
 * interface promises. A vocabulary that only contains what currently happens is
 * a vocabulary that has to be reopened every time something new happens.
 */
export type CameraVisualState =
  | 'dormant'
  | 'awakening'
  | 'idle'
  | 'hover_response'
  | 'focusing'
  | 'agent_activity';

/** The canvas camera's field of view, in degrees. Owned here so it cannot drift. */
export const CAMERA_FOV_DEGREES = 48;

/**
 * Idle camera distance, and the number the whole composition is set against.
 *
 * The composition is authored for a frame roughly ±13.5 by ±9 world units, and
 * at 48° of vertical field of view `20 · tan(24°)` gives 8.9 of half-height and
 * 15.8 of half-width at 16:9. The height is the number the distance was derived
 * from and it is the axis that binds: the hero is a fault that enters from
 * off-frame at both ends, so its width is not a quantity the frame is trying to
 * contain, while its height decides whether the rift reads as a split in
 * something large or as a band across the middle of an empty page.
 *
 * A previous revision of this constant carried a paragraph about the Core's own
 * half-extents and the 55–65% band of the frame it was meant to occupy. The
 * number was 9.1, it was right for the hero it was measured against, that hero
 * was rebuilt with bounds half again as large, and nobody re-measured — so for a
 * stage the rig drew a monolith that filled the frame edge to edge while five
 * domains were pushed out to the margins. The lesson is not that the ratio
 * mattered. It is that the number lives in a different file from the thing it is
 * about, and a comment saying so is not the same thing as a test that reads
 * both. `cameraController.test.ts` now does, and a composition that outgrows
 * this distance fails a test rather than quietly becoming a close-up.
 */
export const BASE_CAMERA_DISTANCE = 20;
/** Where the camera sits when nothing is bound: negative, so the Core reads right of centre. */
const IDLE_CAMERA_OFFSET_X = -0.9;
/** The frame's half-angle, in tangent. Named because the dolly divides by it. */
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);

/**
 * How much room the dolly leaves either side of the route's midpoint.
 *
 * The reframe is required to hold *both ends of the active route* inside the
 * frame, on opposite sides of its centre, without either of them reaching an
 * edge — the brief's "the final framing keeps part of the Core plus the whole
 * Domain local environment". That is a solvable constraint rather than a taste,
 * and this is its solution: the camera sits back far enough that the route's own
 * reach subtends `2 · FOCUS_HALF_FRAMES` half-frames, which puts each end at
 * about a third of the half-frame once the pivot below takes half of it.
 *
 * The value is in half-frames because that is the unit the constraint is
 * expressed in, and the `spread` correction below converts it into the two
 * different clearances the two screen axes actually need.
 */
const FOCUS_HALF_FRAMES = 1.5;
/** Where the frame centres along the route. Half way puts the ends on the two thirds. */
const FOCUS_PIVOT_FRACTION = 0.5;
/**
 * The near end of the dolly's usable range.
 *
 * `FOCUS_HALF_FRAMES` is a *ratio* — the route subtends this many half-frames —
 * so on its own it answers "how much room does the route need" and not "how
 * close is the camera allowed to come". For the five domains that currently
 * exist the ratio always resolves well outside this floor, and the floor is
 * therefore invisible in the shipped composition. It exists because the rig's
 * contract is about the frame, not about any one layout: a bound domain whose
 * reach is small enough would otherwise be framed from a few units away, and a
 * camera four units from the Core is not a reframe, it is a different picture of
 * a different subject. Stated as a fraction of the idle distance so the two move
 * together — the whole point of the band is the relationship between a close-up
 * and the establishing shot, and a floor written as a bare number would drift out
 * of that relationship the next time the hero is rebuilt.
 *
 * `MIN_CAMERA_DISTANCE` below is the separate, much lower backstop that keeps the
 * projection matrix itself from degenerating; this is a composition bound, and
 * the difference matters when reading a failure.
 */
const MIN_FOCUS_DISTANCE = BASE_CAMERA_DISTANCE * 0.6;
const MIN_CAMERA_DISTANCE = 5;
/**
 * The backstop on the dolly, twice the idle distance.
 *
 * No legal focus resolves anywhere near it — the furthest of the five domains
 * asks for well under two thirds of it — so this exists only to keep a hostile or
 * future input from dissolving the composition into a wide shot. It tracks the
 * idle distance, since the only thing it has to be is comfortably outside
 * anything a focus can ask for and comfortably inside the range where the layout
 * is still on screen.
 */
const MAX_CAMERA_DISTANCE = BASE_CAMERA_DISTANCE * 2;
/** Handheld response to the pointer, in world units at full response. */
const POINTER_SWING_X = 0.13;
const POINTER_SWING_Y = 0.1;
const POINTER_YAW = 0.018;
const POINTER_PITCH = 0.014;

export type CameraControllerOptions = {
  readonly pointerDamping?: number;
  readonly focusDamping?: number;
  readonly reducedMotion?: boolean;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function deriveCameraFocusTarget(
  position: readonly [number, number, number],
): CameraFocusTarget {
  const length = Math.hypot(position[0], position[1], position[2]);
  if (length === 0 || !Number.isFinite(length)) {
    return [0, 0, 0];
  }

  return [
    position[0] / length,
    position[1] / length,
    position[2] / length,
  ];
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

/**
 * `-0` is a different value from `0` to `Object.is`, and an angle at rest is the
 * common case here. Normalizing keeps the rig's output comparable by value.
 */
function signedZero(value: number): number {
  return value === 0 ? 0 : value;
}

export type CameraFramingInput = {
  readonly pointerX: number;
  readonly pointerY: number;
  /** Eased direction of the bound domain; its magnitude is the focus handle. */
  readonly focusX: number;
  readonly focusY: number;
  readonly focusZ: number;
  /** Eased world distance to the bound domain. Zero means nothing is bound. */
  readonly focusDistance: number;
  readonly response: number;
  readonly amplitudeScale: number;
  readonly aspect: number;
};

export type CameraFraming = {
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly yaw: number;
  readonly pitch: number;
  /** Eased focus handle, from 0 (idle framing) to 1 (fully reframed). */
  readonly focus: number;
};

/**
 * The camera rig, as a pure function of the controller's scalars.
 *
 * Focus is a genuine reframe: the camera *translates* half way to the bound
 * domain and *dollies in* toward it. Nothing yaws toward the target and the
 * hero's own group is never rotated, so the rift is seen from the same angle
 * throughout and only its place in the frame changes. That is what keeps a
 * focused frame a picture of the whole machine rather than a picture of one bay
 * — the brief's "must not become 相机对准一个图标" is a statement about the rig,
 * and it is enforced here rather than in the choreography.
 *
 * The distance resolves as an idle fraction plus a term that grows with the
 * domain's own reach, corrected per axis by the aspect: a domain above the Core
 * is framed by the frame's height and one beside it by its width, so the two
 * directions need different amounts of room behind them and the correction is
 * `max(|dirX|/aspect, |dirY|)`. Reach enters linearly rather than as a ratio, so
 * the five domains land at five slightly different distances instead of all at
 * one — which is what keeps the arrival somewhere specific rather than generic.
 */
export function deriveCameraFraming(input: CameraFramingInput): CameraFraming {
  const pointerX = finiteOr(input.pointerX, 0);
  const pointerY = finiteOr(input.pointerY, 0);
  const focusX = finiteOr(input.focusX, 0);
  const focusY = finiteOr(input.focusY, 0);
  const focusZ = finiteOr(input.focusZ, 0);
  const aspect = input.aspect > 1e-3 ? finiteOr(input.aspect, 16 / 9) : 16 / 9;
  const swing = finiteOr(input.response, 0) * finiteOr(input.amplitudeScale, 1);

  // The handle is the full magnitude of the eased direction, so a domain with
  // depth still commits the reframe fully; the screen-plane components are the
  // direction's own, which is what makes the travel follow the target's side.
  const focus = Math.min(1, Math.hypot(focusX, focusY, focusZ));
  const bound = focus > 1e-6;
  const reach = bound ? Math.max(0, finiteOr(input.focusDistance, 0)) : 0;
  const dirX = bound ? focusX / focus : 0;
  const dirY = bound ? focusY / focus : 0;

  // The distance a bound domain is approached to. `spread` is the route's extent
  // measured in the unit each screen axis actually uses — a domain above the
  // Core is framed by the frame's height and one beside it by its width — so the
  // same formula gives a domain in either direction exactly the clearance that
  // direction needs.
  const spread = Math.max(Math.abs(dirX) / aspect, Math.abs(dirY));
  const framedDistance =
    (FOCUS_HALF_FRAMES * reach * spread) / HALF_FOV_TAN;
  const framedZ = clamp(
    bound ? framedDistance : BASE_CAMERA_DISTANCE,
    bound ? MIN_FOCUS_DISTANCE : MIN_CAMERA_DISTANCE,
    MAX_CAMERA_DISTANCE,
  );

  return {
    // The idle offset fades out as the reframe takes over rather than adding to
    // it, so the Core stays on its third at full focus instead of drifting past it.
    positionX:
      IDLE_CAMERA_OFFSET_X * (1 - focus) +
      dirX * FOCUS_PIVOT_FRACTION * reach +
      pointerX * POINTER_SWING_X * swing,
    positionY: dirY * FOCUS_PIVOT_FRACTION * reach + pointerY * POINTER_SWING_Y * swing,
    positionZ: BASE_CAMERA_DISTANCE + (framedZ - BASE_CAMERA_DISTANCE) * focus,
    // Rotation stays pointer-only: a reframe may not turn the subject.
    yaw: signedZero(-pointerX * POINTER_YAW * swing),
    pitch: signedZero(pointerY * POINTER_PITCH * swing),
    focus,
  };
}

/**
 * Reduced motion keeps state causality readable without perpetual drift:
 * transitions still happen, but they are short, finite and low-displacement
 * instead of snapping instantly or easing continuously.
 */
const REDUCED_MOTION_POINTER_DAMPING = 12;
const REDUCED_MOTION_FOCUS_DAMPING = 11;
const REDUCED_MOTION_AMPLITUDE_SCALE = 0.42;

export class CameraController {
  private readonly pointerDamping: number;
  private readonly focusDamping: number;
  private readonly amplitudeScale: number;
  private readonly reducedMotion: boolean;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerX = 0;
  private pointerY = 0;
  private focusTargetX = 0;
  private focusTargetY = 0;
  private focusTargetZ = 0;
  private focusX = 0;
  private focusY = 0;
  private focusZ = 0;
  private focusDistanceTarget = 0;
  private focusDistance = 0;
  private visualState: CameraVisualState = 'dormant';

  public constructor(options: CameraControllerOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.pointerDamping =
      options.pointerDamping ??
      (this.reducedMotion ? REDUCED_MOTION_POINTER_DAMPING : 7);
    this.focusDamping =
      options.focusDamping ??
      (this.reducedMotion ? REDUCED_MOTION_FOCUS_DAMPING : 5);
    this.amplitudeScale = this.reducedMotion
      ? REDUCED_MOTION_AMPLITUDE_SCALE
      : 1;
  }

  public setPointerTarget(x: number, y: number): void {
    this.pointerTargetX = clamp(x, -1, 1);
    this.pointerTargetY = clamp(y, -1, 1);
  }

  public setFocusTarget(x: number, y: number, z: number): void {
    this.focusTargetX = clamp(x, -1, 1);
    this.focusTargetY = clamp(y, -1, 1);
    this.focusTargetZ = clamp(z, -1, 1);
  }

  /**
   * World distance to the bound domain.
   *
   * The reframe is sized from this rather than from a tuned constant, because
   * how far the frame has to widen is exactly the question of how far away the
   * other end of the active route is. Eased with the focus damping so binding and
   * releasing a domain travel the same path.
   */
  public setFocusDistance(distance: number): void {
    this.focusDistanceTarget = clamp(
      Number.isFinite(distance) ? distance : 0,
      0,
      MAX_CAMERA_DISTANCE,
    );
  }

  public setVisualState(state: CameraVisualState): void {
    this.visualState = state;
  }

  public update(deltaSeconds: number): void {
    const safeDelta = clamp(deltaSeconds, 0, 0.1);
    this.pointerX = approach(
      this.pointerX,
      this.pointerTargetX,
      this.pointerDamping,
      safeDelta,
    );
    this.pointerY = approach(
      this.pointerY,
      this.pointerTargetY,
      this.pointerDamping,
      safeDelta,
    );
    this.focusX = approach(
      this.focusX,
      this.focusTargetX,
      this.focusDamping,
      safeDelta,
    );
    this.focusY = approach(
      this.focusY,
      this.focusTargetY,
      this.focusDamping,
      safeDelta,
    );
    this.focusZ = approach(
      this.focusZ,
      this.focusTargetZ,
      this.focusDamping,
      safeDelta,
    );
    this.focusDistance = approach(
      this.focusDistance,
      this.focusDistanceTarget,
      this.focusDamping,
      safeDelta,
    );
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

  public getFocusX(): number {
    return this.focusX;
  }

  public getFocusY(): number {
    return this.focusY;
  }

  public getFocusZ(): number {
    return this.focusZ;
  }

  public getFocusDistance(): number {
    return this.focusDistance;
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

export function createCameraController(
  options: CameraControllerOptions = {},
): CameraController {
  return new CameraController(options);
}