import { describe, expect, it } from 'vitest';

import { createCommandRegistry } from './registry';

describe('CommandRegistry', () => {
  it('registers and retrieves a typed handler', () => {
    const registry = createCommandRegistry();
    const handler = () => undefined;

    registry.register('FOCUS_NODE', handler);

    expect(registry.get('FOCUS_NODE')).toBe(handler);
  });

  it('rejects duplicate handler registration instead of overwriting', () => {
    const registry = createCommandRegistry();

    registry.register('FOCUS_NODE', () => undefined);

    expect(() => registry.register('FOCUS_NODE', () => undefined)).toThrow(
      'Command handler already registered: FOCUS_NODE',
    );
  });

  it('returns no handler for a valid but unregistered command type', () => {
    const registry = createCommandRegistry();

    expect(registry.get('OPEN_SECTION')).toBeUndefined();
  });
});
