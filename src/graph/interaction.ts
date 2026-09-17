import type { GraphNodeId } from './types';

export type GraphInteractionPhase = 'idle' | 'hovering' | 'focused';

export type GraphInteractionState = {
  readonly hoveredNodeId: GraphNodeId | null;
  readonly focusedNodeId: GraphNodeId | null;
  readonly phase: GraphInteractionPhase;
};

export type GraphInteractionAction =
  | { readonly type: 'POINTER_ENTER_NODE'; readonly nodeId: GraphNodeId }
  | { readonly type: 'POINTER_LEAVE_NODE'; readonly nodeId: GraphNodeId }
  | { readonly type: 'FOCUS_NODE'; readonly nodeId: GraphNodeId }
  | { readonly type: 'CLEAR_FOCUS' };

export function createInitialGraphInteractionState(): GraphInteractionState {
  return {
    hoveredNodeId: null,
    focusedNodeId: null,
    phase: 'idle',
  };
}

function phaseFor(
  hoveredNodeId: GraphNodeId | null,
  focusedNodeId: GraphNodeId | null,
): GraphInteractionPhase {
  if (focusedNodeId !== null) {
    return 'focused';
  }

  return hoveredNodeId === null ? 'idle' : 'hovering';
}

export function reduceGraphInteraction(
  state: GraphInteractionState,
  action: GraphInteractionAction,
): GraphInteractionState {
  switch (action.type) {
    case 'POINTER_ENTER_NODE':
      return {
        hoveredNodeId: action.nodeId,
        focusedNodeId: state.focusedNodeId,
        phase: phaseFor(action.nodeId, state.focusedNodeId),
      };
    case 'POINTER_LEAVE_NODE': {
      const hoveredNodeId =
        state.hoveredNodeId === action.nodeId ? null : state.hoveredNodeId;
      return {
        hoveredNodeId,
        focusedNodeId: state.focusedNodeId,
        phase: phaseFor(hoveredNodeId, state.focusedNodeId),
      };
    }
    case 'FOCUS_NODE':
      return {
        hoveredNodeId: action.nodeId,
        focusedNodeId: action.nodeId,
        phase: 'focused',
      };
    case 'CLEAR_FOCUS':
      return {
        hoveredNodeId: state.hoveredNodeId,
        focusedNodeId: null,
        phase: phaseFor(state.hoveredNodeId, null),
      };
    default:
      return state;
  }
}
