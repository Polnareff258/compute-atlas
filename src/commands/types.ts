import type { GraphNodeId } from '@/graph/types';
import type { QualityProfile } from '@/renderer/types';

export type CommandSource = 'pointer' | 'keyboard' | 'palette' | 'agent' | 'system';

export type Command =
  | { readonly type: 'NAVIGATE_HOME'; readonly source: CommandSource }
  | { readonly type: 'HOVER_NODE'; readonly source: CommandSource; readonly nodeId: GraphNodeId }
  | { readonly type: 'CLEAR_HOVER'; readonly source: CommandSource; readonly nodeId: GraphNodeId }
  | { readonly type: 'FOCUS_NODE'; readonly source: CommandSource; readonly nodeId: GraphNodeId }
  | { readonly type: 'OPEN_SECTION'; readonly source: CommandSource; readonly sectionId: string }
  | { readonly type: 'SYSTEM_STATUS'; readonly source: CommandSource }
  | { readonly type: 'SET_QUALITY'; readonly source: CommandSource; readonly profile: QualityProfile }
  | { readonly type: 'SET_DEV_OVERLAY'; readonly source: CommandSource; readonly visible: boolean }
  | { readonly type: 'SURPRISE_ME'; readonly source: CommandSource };
