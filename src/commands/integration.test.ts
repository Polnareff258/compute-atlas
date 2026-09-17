import { describe, expect, it } from 'vitest';

import { createCommandBus } from './bus';
import { createCommandRegistry } from './registry';
import { createGraphController } from '../graph/graphController';
import {
  createInitialGraphInteractionState,
  reduceGraphInteraction,
} from '../graph/interaction';

describe('command semantic adapters', () => {
  it('drives the same graph focus state for every command source', () => {
    const sources = ['pointer', 'palette', 'agent', 'system'] as const;

    for (const source of sources) {
      let state = createInitialGraphInteractionState();
      const graph = createGraphController((action) => {
        state = reduceGraphInteraction(state, action);
      });
      const bus = createCommandBus({
        registry: createCommandRegistry({ graph }),
      });

      const result = bus.dispatch({
        type: 'FOCUS_NODE',
        source,
        nodeId: 'graphics',
      });

      expect(result.status).toBe('executed');
      expect(state.hoveredNodeId).toBeNull();
      expect(state.focusedNodeId).toBe('graphics');
      expect(state.phase).toBe('focused');
    }
  });

  it('maps NAVIGATE_HOME to the graph clear-focus semantic', () => {
    let state = reduceGraphInteraction(createInitialGraphInteractionState(), {
      type: 'FOCUS_NODE',
      nodeId: 'graphics',
    });
    const graph = createGraphController((action) => {
      state = reduceGraphInteraction(state, action);
    });
    const bus = createCommandBus({
      registry: createCommandRegistry({ graph }),
    });

    const result = bus.dispatch({
      type: 'NAVIGATE_HOME',
      source: 'keyboard',
    });

    expect(result.status).toBe('executed');
    expect(state.hoveredNodeId).toBeNull();
    expect(state.focusedNodeId).toBeNull();
    expect(state.phase).toBe('idle');
  });

  it('preserves real pointer hover across programmatic focus and clear-focus', () => {
    let state = reduceGraphInteraction(createInitialGraphInteractionState(), {
      type: 'POINTER_ENTER_NODE',
      nodeId: 'ai',
    });
    const graph = createGraphController((action) => {
      state = reduceGraphInteraction(state, action);
    });
    const bus = createCommandBus({
      registry: createCommandRegistry({ graph }),
    });

    expect(
      bus.dispatch({
        type: 'FOCUS_NODE',
        source: 'palette',
        nodeId: 'graphics',
      }).status,
    ).toBe('executed');
    expect(state).toEqual({
      hoveredNodeId: 'ai',
      focusedNodeId: 'graphics',
      phase: 'focused',
    });

    expect(
      bus.dispatch({ type: 'NAVIGATE_HOME', source: 'keyboard' }).status,
    ).toBe('executed');
    expect(state).toEqual({
      hoveredNodeId: 'ai',
      focusedNodeId: null,
      phase: 'hovering',
    });
  });
  it('maps SET_QUALITY to the injected renderer quality seam', () => {
    let runtimeQuality = 'ultra';
    let sceneQuality = 'ultra';
    let rendererQuality = 'ultra';
    const bus = createCommandBus({
      registry: createCommandRegistry({
        renderer: {
          setQuality: (profile) => {
            runtimeQuality = profile;
            sceneQuality = profile;
            rendererQuality = profile;
          },
        },
      }),
    });

    const result = bus.dispatch({
      type: 'SET_QUALITY',
      source: 'palette',
      profile: 'high',
    });

    expect(result.status).toBe('executed');
    expect(runtimeQuality).toBe('high');
    expect(sceneQuality).toBe('high');
    expect(rendererQuality).toBe('high');
  });

  it.each([
    'OPEN_SECTION',
    'SYSTEM_STATUS',
    'SET_DEV_OVERLAY',
    'SURPRISE_ME',
  ] as const)('does not claim %s before its stage is implemented', (type) => {
    const bus = createCommandBus({ registry: createCommandRegistry() });
    const command =
      type === 'OPEN_SECTION'
        ? { type, source: 'system' as const, sectionId: 'research' }
        : type === 'SET_DEV_OVERLAY'
          ? { type, source: 'system' as const, visible: true }
          : { type, source: 'system' as const };

    const result = bus.dispatch(command);

    expect(result.status).toBe('unavailable');
  });
});
