import type { Command } from './types';

export type CommandExecutionStatus =
  | 'executed'
  | 'rejected'
  | 'unavailable'
  | 'failed';

export type CommandExecutionResult = {
  readonly status: CommandExecutionStatus;
  readonly command: Command;
  readonly message: string;
};

export type CommandExecutionEvent = {
  readonly command: Command;
  readonly result: CommandExecutionResult;
};
