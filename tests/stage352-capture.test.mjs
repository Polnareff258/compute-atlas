import { describe, expect, it } from 'vitest';
import {
  buildSearchCandidates,
  captureVariants,
  evaluateExpectation,
  findDomainLabel,
  formatCaptureName,
  readDomainState,
} from '../scripts/stage352-capture.mjs';

const VIEWPORT = { label: '1920x1080', width: 1920, height: 1080 };

/** A label as the DOM probe reports it: right half of the frame, text above its anchor. */
const graphicsLabel = {
  name: 'GRAPHICS',
  state: 'idle',
  hasDescription: false,
  rect: { left: 900, top: 600, width: 200, height: 24 },
  wrapper: { left: 900, top: 600, width: 200, height: 24 },
};

describe('domain label lookup', () => {
  it('matches regardless of case, spacing or separators', () => {
    const labels = [{ name: 'GAME ANALYSIS' }, { name: 'GRAPHICS' }];
    expect(findDomainLabel(labels, 'graphics')?.name).toBe('GRAPHICS');
    expect(findDomainLabel(labels, 'game-analysis')?.name).toBe('GAME ANALYSIS');
    expect(findDomainLabel(labels, 'gameanalysis')?.name).toBe('GAME ANALYSIS');
    expect(findDomainLabel(labels, 'systems')).toBeUndefined();
  });

  it('reports what every label is doing, so a failure names the actual state', () => {
    const state = readDomainState(
      [
        { name: 'AI', state: 'idle', hasDescription: false },
        { name: 'GRAPHICS', state: 'focused', hasDescription: true },
      ],
      'graphics',
    );
    expect(state).toMatchObject({
      found: true,
      state: 'focused',
      hasDescription: true,
      labelCount: 2,
      focusedNames: ['GRAPHICS'],
    });
    expect(state.observed).toEqual(['AI:idle', 'GRAPHICS:focused']);
  });
});

describe('candidate pointer positions', () => {
  it('searches outward from the label toward its anchor, below the text', () => {
    const candidates = buildSearchCandidates(graphicsLabel, VIEWPORT);
    expect(candidates.length).toBeGreaterThan(1);
    const [first] = candidates;
    // The label is right of centre, so its anchor is further right and lower.
    expect(first.x).toBeGreaterThan(graphicsLabel.rect.left + graphicsLabel.rect.width);
    expect(first.y).toBeGreaterThan(graphicsLabel.rect.top + graphicsLabel.rect.height);
  });

  it('keeps every candidate inside the viewport and free of duplicates', () => {
    const candidates = buildSearchCandidates(
      { ...graphicsLabel, rect: { left: 0, top: 0, width: 40, height: 12 }, wrapper: null },
      VIEWPORT,
    );
    const keys = new Set(candidates.map((point) => `${point.x},${point.y}`));
    expect(keys.size).toBe(candidates.length);
    for (const point of candidates) {
      expect(point.x).toBeGreaterThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(1);
      expect(point.x).toBeLessThan(VIEWPORT.width - 1);
      expect(point.y).toBeLessThan(VIEWPORT.height - 1);
    }
  });
});

describe('interaction expectations', () => {
  const hovered = {
    found: true,
    state: 'hovered',
    hasDescription: true,
    labelCount: 5,
    focusedNames: [],
    observed: [],
  };
  const focused = {
    found: true,
    state: 'focused',
    hasDescription: true,
    labelCount: 1,
    focusedNames: ['GRAPHICS'],
    observed: [],
  };
  const idle = {
    found: true,
    state: 'idle',
    hasDescription: false,
    labelCount: 5,
    focusedNames: [],
    observed: [],
  };

  it('refuses a hover that never arrived', () => {
    const verdict = evaluateExpectation(idle, 'hover', 'graphics');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/idle, not hovered/);
  });

  it('refuses a hover that arrived without its description', () => {
    expect(evaluateExpectation({ ...hovered, hasDescription: false }, 'hover', 'graphics').ok).toBe(
      false,
    );
    expect(evaluateExpectation(hovered, 'hover', 'graphics').ok).toBe(true);
  });

  it('requires focus to withdraw the other domains as well as arrive', () => {
    expect(evaluateExpectation({ ...focused, labelCount: 5 }, 'focus', 'graphics').ok).toBe(false);
    expect(evaluateExpectation(focused, 'focus', 'graphics').ok).toBe(true);
    expect(evaluateExpectation(hovered, 'focus', 'graphics').ok).toBe(false);
  });

  it('treats Escape as restoring the idle composition, not merely dropping focus', () => {
    expect(evaluateExpectation(focused, 'escape', 'graphics').ok).toBe(false);
    expect(evaluateExpectation(idle, 'escape', 'graphics').ok).toBe(true);
    // A frame that still shows a single label has not left the focus composition.
    expect(evaluateExpectation({ ...idle, labelCount: 1 }, 'escape', 'graphics').ok).toBe(false);
  });

  it('does not invent a verdict for a state that drives no input', () => {
    expect(evaluateExpectation({ found: false }, 'none', 'graphics').ok).toBe(true);
  });
});

describe('capture modes and naming', () => {
  it('captures each state once unless a variant is requested', () => {
    expect(captureVariants({ textHidden: false, grayscale: false })).toEqual([
      { key: 'plain', suffix: '' },
    ]);
    expect(captureVariants({ textHidden: true, grayscale: true }).map((v) => v.suffix)).toEqual([
      '',
      '-notext',
      '-gray',
    ]);
  });

  it('keeps the variant in the file name so a text-hidden frame cannot pass as the real one', () => {
    const base = {
      prefix: 'stage352',
      backend: 'webgpu',
      quality: 'ultra',
      sizeLabel: '1920x1080',
      stateName: 'hover-graphics',
      reducedMotion: false,
    };
    expect(formatCaptureName(base)).toBe('stage352-webgpu-ultra-1920x1080-hover-graphics.png');
    expect(formatCaptureName({ ...base, suffix: '-notext' })).toBe(
      'stage352-webgpu-ultra-1920x1080-hover-graphics-notext.png',
    );
    expect(formatCaptureName({ ...base, reducedMotion: true, suffix: '-gray' })).toBe(
      'stage352-webgpu-ultra-1920x1080-hover-graphics-reduced-gray.png',
    );
  });
});
