import type { CommandRegistry } from '../registry';
import type { GraphCommandEnvironment } from '../commandEnvironment';

export function registerGraphCommandHandlers(
  registry: CommandRegistry,
  graph: GraphCommandEnvironment,
): void {
  registry.register('HOVER_NODE', (command) => {
    graph.hoverNode(command.nodeId);
  });
  registry.register('CLEAR_HOVER', (command) => {
    graph.clearHover(command.nodeId);
  });
  registry.register('FOCUS_NODE', (command) => {
    graph.focusNode(command.nodeId);
  });
  registry.register('NAVIGATE_HOME', () => {
    graph.clearFocus();
  });
}
