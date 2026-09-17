import type { CommandEnvironment } from './commandEnvironment';
import {
  registerGraphCommandHandlers,
} from './adapters/graphCommands';
import {
  registerRendererCommandHandlers,
} from './adapters/rendererCommands';
import type { Command } from './types';

export type CommandType = Command['type'];
export type CommandFor<Type extends CommandType> = Extract<Command, { type: Type }>;

export type CommandHandlerOutput =
  | { readonly message?: string }
  | void;

export type CommandHandler<Type extends CommandType> = (
  command: CommandFor<Type>,
) => CommandHandlerOutput;

export class CommandRegistry {
  private readonly handlers = new Map<
    CommandType,
    CommandHandler<CommandType>
  >();

  public register<Type extends CommandType>(
    type: Type,
    handler: CommandHandler<Type>,
  ): void {
    if (this.handlers.has(type)) {
      throw new Error('Command handler already registered: ' + type);
    }

    this.handlers.set(type, handler as unknown as CommandHandler<CommandType>);
  }

  public get<Type extends CommandType>(
    type: Type,
  ): CommandHandler<Type> | undefined {
    return this.handlers.get(type) as CommandHandler<Type> | undefined;
  }
}

export function createCommandRegistry(
  environment: CommandEnvironment = {},
): CommandRegistry {
  const registry = new CommandRegistry();

  if (environment.graph) {
    registerGraphCommandHandlers(registry, environment.graph);
  }

  if (environment.renderer) {
    registerRendererCommandHandlers(registry, environment.renderer);
  }

  return registry;
}