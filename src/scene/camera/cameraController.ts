import type { ComputeCoreVisualState } from '../core/coreTypes';

export type CameraControllerOptions = {
  readonly pointerDamping?: number;
  readonly focusDamping?: number;
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

export class CameraController {
  private readonly pointerDamping: number;
  private readonly focusDamping: number;
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
  private visualState: ComputeCoreVisualState = 'dormant';

  public constructor(options: CameraControllerOptions = {}) {
    this.pointerDamping = options.pointerDamping ?? 7;
    this.focusDamping = options.focusDamping ?? 5;
    this.reducedMotion = options.reducedMotion ?? false;
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

  public setVisualState(state: ComputeCoreVisualState): void {
    this.visualState = state;
  }

  public update(deltaSeconds: number): void {
    if (this.reducedMotion) {
      this.pointerX = this.pointerTargetX;
      this.pointerY = this.pointerTargetY;
      this.focusX = this.focusTargetX;
      this.focusY = this.focusTargetY;
      this.focusZ = this.focusTargetZ;
      return;
    }

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
}

export function createCameraController(
  options: CameraControllerOptions = {},
): CameraController {
  return new CameraController(options);
}