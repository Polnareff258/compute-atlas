import { describe, expect, it } from 'vitest';

import { createCommandBus } from './bus';
import { createCommandRegistry } from './registry';

describe('CommandBus', () => {
  it('dispatches a registered command and returns an executed result', () => {
    const calls: string[] = [];
    const registry = createCommandRegistry();
    registry.register('FOCUS_NODE', (command) => {
      calls.push(command.nodeId);
    });
    const bus = createCommandBus({ registry });
    const command = {
      type: 'FOCUS_NODE' as const,
      source: 'system' as const,
      nodeId: 'graphics' as const,
    };

    const result = bus.dispatch(command);

    expect(calls).toEqual(['graphics']);
    expect(result).toEqual({
      status: 'executed',
      command,
      message: 'FOCUS_NODE executed',
    });
  });

  it('returns unavailable for a command without a registered handler', () => {
    const bus = createCommandBus({ registry: createCommandRegistry() });
    const command = {
      type: 'OPEN_SECTION' as const,
      source: 'palette' as const,
      sectionId: 'graphics-lab',
    };

    expect(bus.dispatch(command)).toEqual({
      status: 'unavailable',
      command,
      message: 'OPEN_SECTION is not available in this stage',
    });
  });

  it('contains handler failures as failed results', () => {
    const registry = createCommandRegistry();
    registry.register('NAVIGATE_HOME', () => {
      throw new Error('graph controller unavailable');
    });
    const bus = createCommandBus({ registry });
    const command = {
      type: 'NAVIGATE_HOME' as const,
      source: 'keyboard' as const,
    };

    expect(bus.dispatch(command)).toEqual({
      status: 'failed',
      command,
      message: 'NAVIGATE_HOME failed: graph controller unavailable',
    });
  });

  it('isolates subscriber failures from command execution', () => {
    const registry = createCommandRegistry();
    registry.register('NAVIGATE_HOME', () => undefined);
    const bus = createCommandBus({
      registry,
      onDispatch: () => {
        throw new Error('subscriber failed');
      },
    });
    const command = {
      type: 'NAVIGATE_HOME' as const,
      source: 'system' as const,
    };

    expect(bus.dispatch(command).status).toBe('executed');
  });
});
