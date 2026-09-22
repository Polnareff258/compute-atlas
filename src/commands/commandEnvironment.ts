import type { GraphNodeId } from '../graph/types';
import type { QualityProfile } from '../renderer/types';

export type GraphCommandEnvironment = {
  readonly hoverNode: (nodeId: GraphNodeId) => void;
  readonly clearHover: (nodeId: GraphNodeId) => void;
  readonly focusNode: (nodeId: GraphNodeId) => void;
  readonly clearFocus: () => void;
};

export type RendererCommandEnvironment = {
  readonly setQuality: (profile: QualityProfile) => void;
};

export type CommandEnvironment = {
  readonly graph?: GraphCommandEnvironment;
  readonly renderer?: RendererCommandEnvironment;
};
