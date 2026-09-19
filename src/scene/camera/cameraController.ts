import type { ComputeCoreVisualState } from '../core/coreTypes';
import { finiteOr } from '../seedRandom';

export type CameraFocusTarget = readonly [x: number, y: number, z: number];

/** The canvas camera's field of view, in degrees. Owned here so it cannot drift. */
export const CAMERA_FOV_DEGREES = 48;
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);

/**
 * Idle camera distance, and the number the whole composition is set against.
 *
 * The Core is a monolith several world units across, and this distance is what
 * makes it read at 55–65% of the frame — the band at which the page is a
 * computational environment rather than a diagram of one. It is deliberately
 * tied to `CORE_SCALE` rather than to the layout: the ratio of the two is what
 * sets the fraction of the frame the mass occupies, so rescaling the hero
 * without moving the camera here would silently change the composition.
 *
 * That paragraph was here before, and the composition drifted anyway. The value
 * was 9.1 and it was right for the hero it was measured against; the Core was
 * then rebuilt, `LOCAL_BOUNDS` grew by half again, and nobody re-measured. By
 * the bounds the mass read at 0.81 of the frame's height, and counting the folds
 * that leave the outline it filled the height edge to edge on screen — the hero
 * was the page, and the five domains around it had been pushed out to the
 * margins where they read as marginalia rather than as bays. A comment saying
 * the ratio matters is not the same thing as a test that measures it, which is
 * the part worth remembering: the number that has to be re-checked is the one
 * that lives in a different file from the thing it is about.
 *
 * 11.5 puts the mass at 0.64 of the frame's height and 0.45 of its width. The
 * height is the number that matters and the width cannot be the one that does:
 * the hero is 4.05 by 3.3 half-extents, so it is nearly square inside a frame
 * that is not, and a distance that fills the width will always have run out of
 * height first. Derived rather than measured would be better still, and the
 * reason it is not is that the constant lives here and the extent lives in the
 * Core; until the two are joined by something a test can read, the value has to
 * be re-measured off a capture whenever the Core's bounds move.
 */
export const BASE_CAMERA_DISTANCE = 11.5;
/** Where the camera sits when nothing is bound: negative, so the Core reads right of centre. */
const IDLE_CAMERA_OFFSET_X = -0.55;
/**
 * Half-frames either side of the pivot the active route has to fit inside.
 *
 * This is the number that puts the two ends of the active route on the thirds,
 * and it is worth being explicit about why, because it looks like a taste
 * setting and is not one. The camera slides half way to the bound domain and
 * pulls back until the frame holds `FOCUS_HALF_FRAMES · reach` either side of
 * that midpoint; the origin is then `reach/2` from the optical axis and the
 * frame's half-width is `FOCUS_HALF_FRAMES · reach`, so the Core lands at
 * `1/(2 · FOCUS_HALF_FRAMES)` of the half-frame. At 1.5 that is exactly a third.
 *
 * It was tried at 1.15 while the hero was being rebuilt, on the reasoning that a
 * tighter frame is the dolly-in the choreography calls for. The arithmetic says
 * otherwise on both counts: 1/2.3 puts the Core at 0.43 of the half-frame, which
 * with a Core half a frame wide leaves its whole left side outside the frame,
 * and the pair stops reading as a diagonal and becomes a close-up of the hero.
 * The subject of a focus frame is the Core *and* the domain, so the frame has to
 * be wide enough for both, and the movement toward the subject is the camera's
 * own slide along the route rather than a change of distance.
 */
const FOCUS_HALF_FRAMES = 1.5;
/** Where the frame centres along the route. Half way puts the ends on the two thirds. */
const FOCUS_PIVOT_FRACTION = 0.5;
const MIN_CAMERA_DISTANCE = 5;
/**
 * The backstop on the dolly, twice the idle distance.
 *
 * No legal focus resolves anywhere near it — the furthest of the five domains
 * asks for well under a third of it against the idle distance — so this exists
 * only to keep a hostile or future input from dissolving the composition into a
 * wide shot. It tracks the idle distance, since the only thing it has to be is
 * comfortably outside anything a focus can ask for and comfortably inside the
 * range where the layout is still on screen.
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
 * domain and *dollies* back until the frame is wide enough to hold both ends of
 * the active route. Nothing yaws toward the target and the Core's own group is
 * never rotated, so the hero is seen from the same angle throughout and only its
 * place in the frame changes.
 *
 * The arithmetic that makes the thirds fall out: the camera slides half way to
 * the bound domain and pulls back until the frame is wide enough that a point at
 * the origin lands on a third. Both ends are then `reach/2` either side of the
 * optical axis, so the dolly has to show `FOCUS_HALF_FRAMES · reach` in the
 * *offset direction* — and because the frame is wider than it is tall, that
 * resolves per axis to the larger of `|dirX|/aspect` and `|dirY|`. The ratio is
 * independent of `reach`, which is why one rig frames all five domains at their
 * own distances instead of being tuned against one of them.
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

  // The dolly the offset direction needs: a domain above the Core is framed by
  // the frame's height and one beside it by its width, so the two axes are
  // resolved against the aspect rather than both against the width.
  const spread = Math.max(Math.abs(dirX) / aspect, Math.abs(dirY));
  const framedDistance = (FOCUS_HALF_FRAMES * reach * spread) / HALF_FOV_TAN;
  const framedZ = clamp(framedDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);

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
  private visualState: ComputeCoreVisualState = 'dormant';

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

  public setVisualState(state: ComputeCoreVisualState): void {
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