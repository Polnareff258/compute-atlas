import type { QualityProfile } from '../../renderer/types';

export type ComputeCoreVisualState =
  | 'dormant'
  | 'awakening'
  | 'idle'
  | 'hover_response'
  | 'focusing'
  | 'agent_activity';

export type ComputeCoreInteraction = {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly focusX: number;
  readonly focusY: number;
  readonly focusZ: number;
  readonly intensity: number;
  readonly transitionProgress: number;
  readonly reducedMotion: boolean;
  readonly visualState: ComputeCoreVisualState;
};

export type CoreParameters = {
  readonly profile: QualityProfile;
  readonly particleBudget: number;
  readonly shellRadius: number;
  readonly cageSegments: number;
  readonly orbitalCount: number;
  readonly fieldResolution: number;
  readonly allowBloom: boolean;
};