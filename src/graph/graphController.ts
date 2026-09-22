import type { GraphNodeId } from './types';
import type { GraphInteractionAction } from './interaction';

export type GraphController = {
  readonly hoverNode: (nodeId: GraphNodeId) => void;
  readonly clearHover: (nodeId: GraphNodeId) => void;
  readonly focusNode: (nodeId: GraphNodeId) => void;
  readonly clearFocus: () => void;
};

export function createGraphController(
  dispatch: (action: GraphInteractionAction) => void,
): GraphController {
  return {
    hoverNode: (nodeId) => {
      dispatch({ type: 'POINTER_ENTER_NODE', nodeId });
    },
    clearHover: (nodeId) => {
      dispatch({ type: 'POINTER_LEAVE_NODE', nodeId });
    },
    focusNode: (nodeId) => {
      dispatch({ type: 'FOCUS_NODE', nodeId });
    },
    clearFocus: () => {
      dispatch({ type: 'CLEAR_FOCUS' });
    },
  };
}
