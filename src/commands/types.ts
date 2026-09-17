import type { GraphNodeId } from '@/graph/types';
import type { QualityProfile } from '@/renderer/types';

export type CommandSource = 'pointer' | 'keyboard' | 'palette' | 'agent' | 'system';

export type Command =
  | { type: 'NAVIGATE_HOME'; source: CommandSource }
  | { type: 'FOCUS_NODE'; source: CommandSource; nodeId: GraphNodeId }
  | { type: 'OPEN_SECTION'; source: CommandSource; sectionId: string }
  | { type: 'SYSTEM_STATUS'; source: CommandSource }
  | { type: 'SET_QUALITY'; source: CommandSource; profile: QualityProfile }
  | { type: 'SET_DEV_OVERLAY'; source: CommandSource; visible: boolean }
  | { type: 'SURPRISE_ME'; source: CommandSource };
