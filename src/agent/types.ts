export type AgentEventType =
  | 'request_started'
  | 'intent'
  | 'tool_call'
  | 'tool_result'
  | 'request_completed'
  | 'request_failed';

export type AgentEvent = {
  type: AgentEventType;
  requestId: string;
  timestamp: number;
  payload: Record<string, unknown>;
};
