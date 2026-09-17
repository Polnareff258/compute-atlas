import type { GraphNodeId } from './types';
import type { GraphInteractionAction } from './interaction';

export type GraphController = {
  readonly focusNode: (nodeId: GraphNodeId) => void;
  readonly clearFocus: () => void;
};

export function createGraphController(
  dispatch: (action: GraphInteractionAction) => void,
): GraphController {
  return {
    focusNode: (nodeId) => {
      dispatch({ type: 'FOCUS_NODE', nodeId });
    },
    clearFocus: () => {
      dispatch({ type: 'CLEAR_FOCUS' });
    },
  };
}
