import type { CommandRegistry } from '../registry';
import type { GraphCommandEnvironment } from '../commandEnvironment';

export function registerGraphCommandHandlers(
  registry: CommandRegistry,
  graph: GraphCommandEnvironment,
): void {
  registry.register('FOCUS_NODE', (command) => {
    graph.focusNode(command.nodeId);
  });
  registry.register('NAVIGATE_HOME', () => {
    graph.clearFocus();
  });
}
