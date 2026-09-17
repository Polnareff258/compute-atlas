import type {
  CommandExecutionEvent,
  CommandExecutionResult,
} from './result';
import type { Command } from './types';
import type { CommandRegistry } from './registry';

export type CommandBusOptions = {
  readonly registry: CommandRegistry;
  readonly onDispatch?: (event: CommandExecutionEvent) => void;
};

export type CommandBus = {
  readonly dispatch: (command: Command) => CommandExecutionResult;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function notify(
  onDispatch: CommandBusOptions['onDispatch'],
  command: Command,
  result: CommandExecutionResult,
): void {
  try {
    onDispatch?.({ command, result });
  } catch {
    // Observability must never change the command result or crash the caller.
  }
}

export function createCommandBus(options: CommandBusOptions): CommandBus {
  function dispatch(command: Command): CommandExecutionResult {
    const handler = options.registry.get(command.type);

    if (!handler) {
      const result: CommandExecutionResult = {
        status: 'unavailable',
        command,
        message: command.type + ' is not available in this stage',
      };
      notify(options.onDispatch, command, result);
      return result;
    }

    try {
      const output = handler(command);
      const result: CommandExecutionResult = {
        status: 'executed',
        command,
        message: output?.message ?? command.type + ' executed',
      };
      notify(options.onDispatch, command, result);
      return result;
    } catch (error) {
      const result: CommandExecutionResult = {
        status: 'failed',
        command,
        message: command.type + ' failed: ' + getErrorMessage(error),
      };
      notify(options.onDispatch, command, result);
      return result;
    }
  }

  return { dispatch };
}
