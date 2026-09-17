import type { CommandRegistry } from '../registry';
import type { RendererCommandEnvironment } from '../commandEnvironment';

export function registerRendererCommandHandlers(
  registry: CommandRegistry,
  renderer: RendererCommandEnvironment,
): void {
  registry.register('SET_QUALITY', (command) => {
    renderer.setQuality(command.profile);
  });
}
