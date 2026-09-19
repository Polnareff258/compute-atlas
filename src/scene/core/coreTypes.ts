import type { QualityProfile } from '../../renderer/types';

export type ComputeCoreVisualState =
  | 'dormant'
  | 'awakening'
  | 'idle'
  | 'hover_response'
  | 'focusing'
  | 'agent_activity';

export type CoreVisualInput = {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly focusX: number;
  readonly focusY: number;
  readonly focusZ: number;
  readonly intensity: number;
  readonly visualState: ComputeCoreVisualState;
  readonly reducedMotion: boolean;
  /** Optional field-local target passed only at the CoreFlowField material seam. */
  readonly targetZone?: number;
  readonly activeZoneCount?: number;
};

export type CoreParameters = {
  readonly profile: QualityProfile;
  /** Configured upper bound; not necessarily emitted by the current draw range. */
  readonly configuredFieldBudget: number;
  /** Static field samples allocated by the descriptor. */
  readonly fieldSampleBudget: number;
  /** Maximum number of moving source-to-target signal points. */
  readonly activeSignalBudget: number;
  /** Compatibility alias for the configured core particle budget. */
  readonly particleBudget: number;
  readonly topologyNodeBudget: number;
  readonly topologyEdgeBudget: number;
  readonly fragmentBudget: number;
  readonly trajectoryBudget: number;
  readonly fieldResolution: number;
  readonly allowBloom: boolean;
};
