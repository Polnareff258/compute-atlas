import type { GraphNodeId } from '../../graph/types';

/**
 * The visual interface a future Agent would drive.
 *
 * This stage does not implement an Agent, an Ollama client, an SSE channel or a
 * trace view, and it must not — but the scene has to be *capable* of showing what
 * one would produce, or the whole visual layer is a picture of computation
 * rather than a surface computation could be shown on. So the interface is
 * defined here, in full, as data: a named, serializable, finite-valued record
 * that the field system already reads every frame.
 *
 * It is deliberately a *superset* of what the interaction currently produces.
 * `FieldState` — what the scene actually drives today — is derived from hover,
 * focus and pointer state, and every activity field below has a defined resting
 * value. When an Agent is eventually wired in, it fills the same record and
 * nothing in the visual layer changes.
 *
 * The eight fields are not decoration. Each one names a distinct thing that can
 * go wrong or go well in a multi-step computation, and each maps to a different
 * visual channel, because the point of the interface is that a viewer can tell
 * them apart:
 *
 * - `activityStrength` — how much work is in flight. The master gain.
 * - `activityPhase` — where in its cycle the work is, 0..1. Drives the wave that
 *   travels through the structure, so a still frame still says "in progress".
 * - `semanticTarget` — which region the work is about. Bends the field toward it.
 * - `signalOrigin` / `signalTarget` — the two ends of the route currently
 *   carrying traffic. Defines the corridor.
 * - `routeCongestion` — 0..1 contention. Shifts the route's energy toward amber
 *   and widens its bundle: a contended path is a path that has spread out.
 * - `domainActivity` — per-region load, in the stable manifest order. A region
 *   with load generates local structure; one without does not.
 * - `operationProgress` — 0..1 within the current operation. Drives compression
 *   at the target end: the field condenses as the operation completes.
 * - `operationResult` — whether the last operation succeeded, was interrupted,
 *   or failed. `interrupted` and `failed` are the only states allowed to spend
 *   magenta and a hard cut, which is what keeps those two readable.
 */
export type AgentActivityPhase = 'idle' | 'running' | 'awaiting' | 'complete';
export type AgentOperationResult = 'none' | 'success' | 'interrupted' | 'failed';

export type AgentActivitySignal = {
  /** 0..1. Total work in flight. */
  readonly activityStrength: number;
  /** 0..1. Position in the current cycle. */
  readonly activityPhase: number;
  /** The region the work concerns, or null when it is not about one region. */
  readonly semanticTarget: GraphNodeId | null;
  /** World position the signal leaves from. */
  readonly signalOrigin: readonly [number, number, number];
  /** World position the signal is going to. */
  readonly signalTarget: readonly [number, number, number];
  /** 0..1. Path contention. */
  readonly routeCongestion: number;
  /** Per-region load, in `GRAPH_MANIFEST` node order. Always five entries. */
  readonly domainActivity: readonly number[];
  /** 0..1. Progress within the current operation. */
  readonly operationProgress: number;
  readonly operationResult: AgentOperationResult;
  readonly phase: AgentActivityPhase;
};

/**
 * Which energy colour an operation result is allowed to spend.
 *
 * Kept here rather than in the shader so the rule is testable and so the same
 * rule holds on both backends. `none` and `success` are not colours at all —
 * they are the absence of an anomaly, and the field's normal cyan is what they
 * look like.
 */
export function resolveResultHue(
  result: AgentOperationResult,
): 'none' | 'amber' | 'magenta' {
  switch (result) {
    case 'interrupted':
      return 'amber';
    case 'failed':
      return 'magenta';
    case 'none':
    case 'success':
      return 'none';
  }
}

/** The resting signal: a foundry that is running but has nothing in flight. */
export function createRestingAgentActivity(): AgentActivitySignal {
  return {
    activityStrength: 0.22,
    activityPhase: 0,
    semanticTarget: null,
    signalOrigin: [0, 0, 0],
    signalTarget: [0, 0, 0],
    routeCongestion: 0,
    domainActivity: [0, 0, 0, 0, 0],
    operationProgress: 0,
    operationResult: 'none',
    phase: 'idle',
  };
}
