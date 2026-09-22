import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as capture from '../scripts/stage352-capture.mjs';

const {
  buffersEqual,
  buildSearchCandidates,
  CAPTURE_MODE_CSS,
  captureVariants,
  evaluateExpectation,
  findDomainLabel,
  LABEL_STATE_EXPRESSION,
  formatCaptureName,
  readDomainState,
} = capture;

const VIEWPORT = { label: '1920x1080', width: 1920, height: 1080 };

/** A label as the DOM probe reports it: right half of the frame, text above its anchor. */
const graphicsLabel = {
  name: 'GRAPHICS',
  state: 'idle',
  rect: { left: 900, top: 600, width: 200, height: 24 },
  wrapper: null,
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
        { name: 'AI', state: 'idle' },
        { name: 'GRAPHICS', state: 'focused' },
      ],
      'graphics',
    );
    expect(state).toMatchObject({
      found: true,
      state: 'focused',
      labelCount: 2,
      focusedNames: ['GRAPHICS'],
    });
    expect(state.observed).toEqual(['AI:idle', 'GRAPHICS:focused']);
  });
});

describe('current DomainLabels DOM probe', () => {
  it('recognizes hover, focus, and Escape on the current domain-label buttons', () => {
    expect(typeof CAPTURE_MODE_CSS).toBe('string');
    expect(typeof LABEL_STATE_EXPRESSION).toBe('string');
    const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div class="domain-labels" aria-label="Compute regions">
        <button class="graph-node-label" data-domain-id="ai"><span class="graph-node-label__name">AI</span></button>
        <button class="graph-node-label" data-domain-id="graphics"><span class="graph-node-label__name">Graphics</span></button>
        <button class="graph-node-label" data-domain-id="game-analysis"><span class="graph-node-label__name">Game analysis</span></button>
        <button class="graph-node-label" data-domain-id="systems"><span class="graph-node-label__name">Systems</span></button>
        <button class="graph-node-label" data-domain-id="research"><span class="graph-node-label__name">Research</span></button>
      </div>
    </body></html>`);
    const { document } = dom.window;
    const style = document.createElement('style');
    style.textContent = CAPTURE_MODE_CSS;
    document.head.append(style);

    const observe = () =>
      readDomainState(
        new Function('document', `return ${LABEL_STATE_EXPRESSION}`)(document),
        'graphics',
      );

    const graphics = document.querySelector('[data-domain-id="graphics"]');
    expect(observe().state).toBe('idle');

    graphics.classList.add('is-hovered');
    const hovered = observe();
    expect(hovered.state).toBe('hovered');
    expect(evaluateExpectation(hovered, 'hover', 'graphics').ok).toBe(true);

    graphics.classList.remove('is-hovered');
    graphics.classList.add('is-focused');
    const focused = observe();
    expect(focused.labelCount).toBe(5);
    expect(focused.focusedNames).toEqual(['Graphics']);
    expect(evaluateExpectation(focused, 'focus', 'graphics').ok).toBe(true);

    graphics.classList.remove('is-focused');
    const escaped = observe();
    expect(evaluateExpectation(escaped, 'escape', 'graphics').ok).toBe(true);

    document.documentElement.classList.add('capture-text-hidden');
    expect(dom.window.getComputedStyle(document.querySelector('.domain-labels')).display).toBe('none');
    dom.window.close();
  });
});

describe('candidate pointer positions', () => {
  it('tries the current button itself before searching around its former scene anchor', () => {
    expect(buildSearchCandidates(graphicsLabel, VIEWPORT)[0]).toEqual({ x: 1000, y: 612 });
  });

  it('keeps the scene-anchor search as a fallback below the text', () => {
    const candidates = buildSearchCandidates(graphicsLabel, VIEWPORT);
    expect(candidates.length).toBeGreaterThan(1);
    const firstFallback = candidates[1];
    // The label is right of centre, so its anchor is further right and lower.
    expect(firstFallback.x).toBeGreaterThan(graphicsLabel.rect.left + graphicsLabel.rect.width);
    expect(firstFallback.y).toBeGreaterThan(graphicsLabel.rect.top + graphicsLabel.rect.height);
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
    labelCount: 5,
    focusedNames: [],
    hoveredNames: ['GRAPHICS'],
    observed: [],
  };
  const focused = {
    found: true,
    state: 'focused',
    labelCount: 5,
    focusedNames: ['GRAPHICS'],
    hoveredNames: [],
    observed: [],
  };
  const idle = {
    found: true,
    state: 'idle',
    labelCount: 5,
    focusedNames: [],
    hoveredNames: [],
    observed: [],
  };

  it('refuses a hover that never arrived', () => {
    const verdict = evaluateExpectation(idle, 'hover', 'graphics');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/idle, not hovered/);
  });

  it('recognizes a hovered label without obsolete description markup', () => {
    expect(evaluateExpectation(hovered, 'hover', 'graphics').ok).toBe(true);
  });

  it('requires exactly the requested domain to carry the focus state', () => {
    expect(evaluateExpectation(focused, 'focus', 'graphics').ok).toBe(true);
    expect(
      evaluateExpectation(
        { ...focused, focusedNames: ['GRAPHICS', 'AI'] },
        'focus',
        'graphics',
      ).ok,
    ).toBe(false);
    expect(evaluateExpectation(hovered, 'focus', 'graphics').ok).toBe(false);
  });

  it('treats Escape as restoring the idle composition, not merely dropping focus', () => {
    expect(evaluateExpectation(focused, 'escape', 'graphics').ok).toBe(false);
    expect(evaluateExpectation(idle, 'escape', 'graphics').ok).toBe(true);
    // The label buttons remain mounted in focus and idle; the probe must judge state classes.
    expect(evaluateExpectation({ ...idle, focusedNames: ['GRAPHICS'] }, 'escape', 'graphics').ok).toBe(false);
    // And a pointer still resting on a domain leaves it hovered, which keeps the
    // routing field bent toward it even though focus is gone. Idle is a claim
    // about hover as well as about focus, so Escape has to clear both.
    expect(evaluateExpectation({ ...idle, hoveredNames: ['GRAPHICS'] }, 'escape', 'graphics').ok).toBe(
      false,
    );
  });

  it('does not invent a verdict for a state that drives no input', () => {
    expect(evaluateExpectation({ found: false }, 'none', 'graphics').ok).toBe(true);
  });
});

describe('reduced-motion readiness', () => {
  it('compares frames exactly rather than by coarse signature', () => {
    // Reduced motion claims the scene has stopped. "Stopped much" is not that
    // claim: an asymptotically easing camera moves less than one signature cell
    // between samples, and two captures taken under that bar came back differing
    // on 174 pixels of scene.
    const a = Buffer.from([1, 2, 3, 4]);
    expect(buffersEqual(a, Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(buffersEqual(a, Buffer.from([1, 2, 3, 5]))).toBe(false);
    expect(buffersEqual(a, Buffer.from([1, 2, 3]))).toBe(false);
    expect(buffersEqual(null, a)).toBe(false);
    expect(buffersEqual(a, null)).toBe(false);
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
