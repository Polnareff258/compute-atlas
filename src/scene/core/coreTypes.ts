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

export type CoreVisualInput = {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly focusX: number;
  readonly focusY: number;
  readonly focusZ: number;
  readonly intensity: number;
  readonly visualState: ComputeCoreVisualState;
  readonly reducedMotion: boolean;
};

export type CoreParameters = {
  readonly profile: QualityProfile;
  readonly particleBudget: number;
  readonly topologyNodeBudget: number;
  readonly topologyEdgeBudget: number;
  readonly fragmentBudget: number;
  readonly trajectoryBudget: number;
  readonly fieldResolution: number;
  readonly allowBloom: boolean;
  /** @deprecated Retained until Task 9 removes the V1 Core consumers. */
  readonly shellRadius: number;
  /** @deprecated Retained until Task 9 removes the V1 Core consumers. */
  readonly cageSegments: number;
  /** @deprecated Retained until Task 9 removes the V1 Core consumers. */
  readonly orbitalCount: number;
};