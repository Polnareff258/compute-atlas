import { describe, expect, it } from 'vitest';

import {
  createInitialGraphInteractionState,
  reduceGraphInteraction,
} from './interaction';

describe('graph interaction reducer', () => {
  it('tracks hover enter and leave without introducing focus', () => {
    const initial = createInitialGraphInteractionState();
    const hovered = reduceGraphInteraction(initial, {
      type: 'POINTER_ENTER_NODE',
      nodeId: 'graphics',
    });
    const left = reduceGraphInteraction(hovered, {
      type: 'POINTER_LEAVE_NODE',
      nodeId: 'graphics',
    });

    expect(hovered).toEqual({
      hoveredNodeId: 'graphics',
      focusedNodeId: null,
      phase: 'hovering',
    });
    expect(left).toEqual(initial);
  });

  it('does not synthesize hover when focus is set programmatically', () => {
    const focused = reduceGraphInteraction(
      createInitialGraphInteractionState(),
      { type: 'FOCUS_NODE', nodeId: 'graphics' },
    );

    expect(focused).toEqual({
      hoveredNodeId: null,
      focusedNodeId: 'graphics',
      phase: 'focused',
    });
  });
  it('preserves focus while hover moves between nodes', () => {
    const initial = createInitialGraphInteractionState();
    const focused = reduceGraphInteraction(initial, {
      type: 'FOCUS_NODE',
      nodeId: 'ai',
    });
    const hovered = reduceGraphInteraction(focused, {
      type: 'POINTER_ENTER_NODE',
      nodeId: 'research',
    });
    const left = reduceGraphInteraction(hovered, {
      type: 'POINTER_LEAVE_NODE',
      nodeId: 'research',
    });

    expect(focused.focusedNodeId).toBe('ai');
    expect(hovered).toEqual({
      hoveredNodeId: 'research',
      focusedNodeId: 'ai',
      phase: 'focused',
    });
    expect(left).toEqual({
      hoveredNodeId: null,
      focusedNodeId: 'ai',
      phase: 'focused',
    });
  });

  it('switches focus deterministically and clears focus without losing active hover', () => {
    let state = reduceGraphInteraction(createInitialGraphInteractionState(), {
      type: 'FOCUS_NODE',
      nodeId: 'ai',
    });
    state = reduceGraphInteraction(state, {
      type: 'FOCUS_NODE',
      nodeId: 'graphics',
    });
    state = reduceGraphInteraction(state, {
      type: 'POINTER_ENTER_NODE',
      nodeId: 'graphics',
    });
    state = reduceGraphInteraction(state, { type: 'CLEAR_FOCUS' });

    expect(state).toEqual({
      hoveredNodeId: 'graphics',
      focusedNodeId: null,
      phase: 'hovering',
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
  it('keeps pointer hover independent from programmatic focus', () => {
    let state = reduceGraphInteraction(createInitialGraphInteractionState(), {
      type: 'POINTER_ENTER_NODE',
      nodeId: 'ai',
    });
    state = reduceGraphInteraction(state, {
      type: 'FOCUS_NODE',
      nodeId: 'graphics',
    });
    state = reduceGraphInteraction(state, { type: 'CLEAR_FOCUS' });

    expect(state).toEqual({
      hoveredNodeId: 'ai',
      focusedNodeId: null,
      phase: 'hovering',
    });
  });
});
