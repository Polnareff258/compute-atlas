import type { QualityProfile } from '../../renderer/types';

export type ComputeCoreVisualState =
  | 'dormant'
  | 'awakening'
  | 'idle'
  | 'hover_response'
  | 'focusing'
  | 'agent_activity';

/**
 * Live Core visual input.
 *
 * Deliberately mutable: the frame loop writes into one instance so continuous
 * scalars reach materials without re-rendering a component or allocating a
 * fresh input object every frame.
 */
export type CoreVisualInput = {
  pointerX: number;
  pointerY: number;
  focusX: number;
  focusY: number;
  focusZ: number;
  intensity: number;
  visualState: ComputeCoreVisualState;
  reducedMotion: boolean;
};

export type CoreParameters = {
  readonly profile: QualityProfile;
  /** Configured upper bound on field samples; not necessarily emitted by the current draw range. */
  readonly configuredFieldBudget: number;
  /** 0..1 additive structure detail: silhouette only at 0. */
  readonly structureDetail: number;
  /** Distinct routing lanes the flowfield may expose. */
  readonly routeLanes: number;
  /** GPU advection, trails and surface wake. */
  readonly advection: boolean;
  /** Layered structure inside each domain sub-environment. */
  readonly domainDetail: number;
};
