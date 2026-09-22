import { describe, expect, it } from 'vitest';

import {
  DRAG_CAPTURE_MODES,
  diffLuminance,
  dragCaptureMode,
  evaluateDynamicFrame,
  evaluateInteraction,
  readInteractionState,
  resolvePlan,
} from '../scripts/stage356-capture.mjs';

/**
 * The harness's own claims, tested where they are decidable.
 *
 * Everything here is a *rule* rather than a picture: how a URL is assembled, how
 * a frame that is expected to be moving is judged, and which of the drag triple's
 * three frames is waited for. All three were previously only visible in a run's
 * output, which means a regression in any of them looked like a capture that
 * happened to be a bit odd.
 */

const VIEWPORT = { label: '1920x1080', width: 1920, height: 1080 };

function planOptions(overrides = {}) {
  return {
    baseUrl: 'http://localhost:3000',
    outDir: 'D:\\Documents\\ClaudeCode\\WebDesign\\artifacts\\stage356',
    namePrefix: 'stage356',
    backend: 'webgpu',
    quality: 'ultra',
    sizes: [VIEWPORT],
    thumb: null,
    scrollSteps: [0, 50, 100],
    reverse: false,
    drag: false,
    ...overrides,
  };
}

describe('the capture URL carries its own parameters', () => {
  it('appends to a base URL that has no query', () => {
    const { url } = resolvePlan(planOptions());

    expect(url).toBe('http://localhost:3000/?boot=skip&telemetry=1');
  });

  it('merges into a base URL that already has one', () => {
    // The failure this exists for is not hypothetical: a `?debug=0` base URL used
    // to produce `?debug=0/?boot=skip&telemetry=1`, and the boot overlay was in
    // every frame of a whole bisection because `boot` was never applied.
    const { url } = resolvePlan(planOptions({ baseUrl: 'http://localhost:3000/?debug=7' }));
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/');
    expect(parsed.searchParams.get('debug')).toBe('7');
    expect(parsed.searchParams.get('boot')).toBe('skip');
    expect(parsed.searchParams.get('telemetry')).toBe('1');
  });

  it('keeps a nested path and does not double the separator', () => {
    const { url } = resolvePlan(planOptions({ baseUrl: 'http://localhost:3000/preview/' }));

    expect(url.startsWith('http://localhost:3000/preview/?')).toBe(true);
    expect(url).not.toContain('?/');
    expect(url).not.toContain('//?');
  });

  it('overrides a parameter the base URL already set, rather than repeating it', () => {
    // A URL with `boot=full` twice would resolve to whichever the browser picked
    // first, which is a capture run whose mode is decided by string order.
    const { url } = resolvePlan(planOptions({ baseUrl: 'http://localhost:3000/?boot=full' }));
    const parsed = new URL(url);

    expect(parsed.searchParams.getAll('boot')).toEqual(['skip']);
  });

  it('lists exactly the files it will write, including the drag triple', () => {
    const { files } = resolvePlan(planOptions({ drag: true }));
    const stages = files.map((file) => file.stage);

    expect(stages).toEqual([
      'idle',
      'scroll-00',
      'scroll-50',
      'scroll-100',
      'drag-before',
      'drag-during',
      'drag-after',
      'drag-mask',
    ]);
    for (const file of files) {
      expect(file.filePath.endsWith(file.name)).toBe(true);
    }
  });
});

/** A frame of one flat value, which is all these rules need to be decided. */
function flatFrame(width, height, value) {
  const data = Buffer.alloc(width * height * 3, value);
  return { width, height, channels: 3, data };
}

/** A frame that is `value` everywhere except a `block`-sized square. */
function framedFrame(width, height, base, block, value) {
  const data = Buffer.alloc(width * height * 3, base);
  for (let y = 0; y < block; y += 1) {
    for (let x = 0; x < block; x += 1) {
      const offset = (y * width + x) * 3;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  return { width, height, channels: 3, data };
}

const GATES = {
  changedMinPercent: 0.3,
  maxCoverage: 0.85,
  minDensity: 0.02,
  clipCeiling: 0.05,
  clipTolerance: 0.02,
};

describe('diffLuminance describes where the change is', () => {
  it('reports the bounding box of the changed pixels', () => {
    const before = flatFrame(64, 64, 10);
    const after = framedFrame(64, 64, 10, 8, 200);

    const diff = diffLuminance(before, after, { threshold: 8, clipLevel: 250 });

    expect(diff.changed).toBe(64);
    expect(diff.bounds).toEqual({ minX: 0, minY: 0, maxX: 7, maxY: 7, width: 8, height: 8 });
    expect(diff.coverageFraction).toBeCloseTo(64 / 4096, 6);
    expect(diff.densityInsideBounds).toBe(1);
  });

  it('counts clipped pixels on both sides of the pair', () => {
    const before = framedFrame(32, 32, 10, 4, 255);
    const after = flatFrame(32, 32, 255);

    const diff = diffLuminance(before, after, { threshold: 8, clipLevel: 250 });

    expect(diff.clippedFraction.before).toBeCloseTo(16 / 1024, 6);
    expect(diff.clippedFraction.after).toBe(1);
  });

  it('reports no box at all when nothing changed', () => {
    const same = flatFrame(16, 16, 40);

    const diff = diffLuminance(same, flatFrame(16, 16, 40), { threshold: 8 });

    expect(diff.changed).toBe(0);
    expect(diff.bounds).toBeNull();
    expect(diff.coverageFraction).toBe(0);
  });

  it('still refuses to diff two different sizes', () => {
    expect(() =>
      diffLuminance(flatFrame(8, 8, 0), flatFrame(8, 16, 0), { threshold: 8 }),
    ).toThrow(/different sizes/);
  });
});

describe('evaluateDynamicFrame', () => {
  const diffOf = (before, after) =>
    diffLuminance(before, after, { threshold: 8, clipLevel: 250 });

  function verdicts(diff) {
    return evaluateDynamicFrame({ diff, options: GATES }).map((finding) => finding.code);
  }

  it('accepts a local, unclipped change', () => {
    const diff = diffOf(flatFrame(64, 64, 10), framedFrame(64, 64, 10, 16, 90));

    expect(verdicts(diff)).toEqual([]);
  });

  it('keeps the changed-min floor, under the same failure kind', () => {
    // Two frames that are the same picture. This is the gate that was already
    // here, and the point of the assertion is that it still is: the dynamic path
    // replaced the *stability* requirement, not the visibility one.
    const diff = diffOf(flatFrame(64, 64, 40), framedFrame(64, 64, 40, 1, 200));

    expect(verdicts(diff)).toEqual(['too-little-change']);
  });

  it('refuses a frame-wide change, which is not direct manipulation', () => {
    // What a camera move, a resize or a scene rebuilt between the two captures
    // looks like: the change is real, large, and everywhere.
    const before = flatFrame(64, 64, 20);
    const after = (() => {
      const frame = flatFrame(64, 64, 20);
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          if ((x + y) % 2 === 0) {
            const offset = (y * 64 + x) * 3;
            frame.data[offset] = 200;
            frame.data[offset + 1] = 200;
            frame.data[offset + 2] = 200;
          }
        }
      }
      return frame;
    })();

    expect(verdicts(diffOf(before, after))).toEqual(['diffuse-coverage']);
  });

  it('refuses a scattering of changed pixels as noise rather than as a gesture', () => {
    // A handful of pixels changed over a wide area: the box is well inside the
    // frame, so the *coverage* test alone would pass it, and that is exactly why
    // the density test exists beside it. A gesture leaves a mark; this is grain.
    const before = flatFrame(64, 64, 30);
    const after = flatFrame(64, 64, 30);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const offset = ((row * 13) * 64 + column * 13) * 3;
        after.data[offset] = 200;
        after.data[offset + 1] = 200;
        after.data[offset + 2] = 200;
      }
    }

    const diff = diffOf(before, after);
    // The premise: enough pixels to clear the visibility floor, spread over a box
    // that is nowhere near the whole frame, and filling almost none of it.
    expect(diff.changedPercent).toBeGreaterThan(GATES.changedMinPercent);
    expect(diff.coverageFraction).toBeLessThan(GATES.maxCoverage);
    expect(diff.densityInsideBounds).toBeLessThan(GATES.minDensity);

    expect(verdicts(diff)).toEqual(['diffuse-coverage']);
  });

  it('refuses a drag that blew the frame out', () => {
    // The shape a runaway injection takes: not "nothing changed", but
    // "everything changed, to white".
    const before = framedFrame(64, 64, 10, 8, 180);
    const after = flatFrame(64, 64, 255);

    expect(verdicts(diffOf(before, after))).toContain('overexposed');
  });

  it('does not read a bright frame as a blown one when it was already bright', () => {
    // The tolerance is about the *rise*. A scene that renders near the clip level
    // everywhere is a scene with a rendering problem, and this gate is not the
    // one that should be reporting it — saying otherwise would fail every drag
    // capture on a machine whose output transform differs.
    const before = flatFrame(64, 64, 252);
    const after = framedFrame(64, 64, 252, 16, 40);

    expect(verdicts(diffOf(before, after))).toEqual([]);
  });
});

describe('the drag triple is captured two different ways', () => {
  it('waits for the resting frames and takes the held one as found', () => {
    // The held frame is the gesture; the other two are states. Waiting on the
    // held frame does not improve it — it *becomes* the released frame, which is
    // the third capture's job — so the distinction is the triple's whole point.
    expect(dragCaptureMode('drag-before')).toBe('stable');
    expect(dragCaptureMode('drag-during')).toBe('dynamic');
    expect(dragCaptureMode('drag-after')).toBe('stable');
  });

  it('has no mode for the mask, which is computed rather than captured', () => {
    expect(dragCaptureMode('drag-mask')).toBeNull();
    expect(dragCaptureMode('idle')).toBeNull();
    expect(Object.keys(DRAG_CAPTURE_MODES)).toEqual([
      'drag-before',
      'drag-during',
      'drag-after',
    ]);
  });
});

/**
 * The interaction stages: hover, focus, Escape.
 *
 * These three are the brief's camera-relevant inputs, and each fails in a way a
 * frame cannot show — a hover that never arrived looks exactly like a hover that
 * worked, and an Escape that cleared the focus but left the pointer resting on a
 * label leaves the composition bent toward that region with nothing "focused".
 * So the states are read back and judged here, and these are those judgements.
 *
 * The label shape is the one the page actually exposes:
 * `.graph-node-label[data-domain-id]` with `is-hovered` / `is-focused`, plus the
 * computed-style fields that say whether a pointer could reach it at all.
 */
function label(id, state = 'idle', overrides = {}) {
  return {
    id,
    text: id,
    hovered: state === 'hovered',
    focused: state === 'focused',
    hidden: false,
    interactive: true,
    centre: { x: 100, y: 200 },
    ...overrides,
  };
}

const FIVE = ['ai', 'graphics', 'game-analysis', 'systems', 'research'];

describe('readInteractionState', () => {
  it('reports which labels are held, and what every label is doing', () => {
    const state = readInteractionState(
      [label('ai'), label('graphics', 'hovered'), label('systems', 'focused')],
      'graphics',
    );

    expect(state.found).toBe(true);
    expect(state.count).toBe(3);
    expect(state.hoveredIds).toEqual(['graphics']);
    expect(state.focusedIds).toEqual(['systems']);
    expect(state.domain.id).toBe('graphics');
    expect(state.observed).toEqual(['ai:idle', 'graphics:hovered', 'systems:focused']);
  });

  it('answers with no domain when the id is not in the DOM', () => {
    const state = readInteractionState([label('ai')], 'graphics');

    expect(state.domain).toBeNull();
    expect(state.found).toBe(true);
  });

  it('distinguishes an empty page from a page with no container', () => {
    // `found: false` is "there is no label layer at all", which is a different
    // failure from "the layer is there and this region is not in it".
    expect(readInteractionState([], 'graphics').found).toBe(false);
  });
});

describe('evaluateInteraction', () => {
  const judge = (labels, expectation, domain = 'graphics') =>
    evaluateInteraction(readInteractionState(labels, domain), expectation, domain);

  it('accepts a hover that landed on a reachable label', () => {
    const verdict = judge(FIVE.map((id) => label(id, id === 'graphics' ? 'hovered' : 'idle')), 'hover');

    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain('hovered');
  });

  it('refuses a hover that never arrived', () => {
    expect(judge(FIVE.map((id) => label(id)), 'hover').ok).toBe(false);
    expect(judge(FIVE.map((id) => label(id)), 'hover').reason).toMatch(/idle, not hovered/);
  });

  it('refuses a hover on a label the pointer could not reach', () => {
    // A region behind the camera keeps its element: opacity 0, pointer-events
    // none. Clicking it would be clicking nothing, and the frame would look like
    // a successful hover on a region that is not there.
    const labels = FIVE.map((id) =>
      label(id, id === 'graphics' ? 'hovered' : 'idle', id === 'graphics' ? { interactive: false, hidden: true } : {}),
    );
    const verdict = judge(labels, 'hover');

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not reachable/);
  });

  it('refuses a hover that arrives while something is focused', () => {
    const labels = FIVE.map((id) =>
      label(id, id === 'graphics' ? 'hovered' : id === 'ai' ? 'focused' : 'idle'),
    );

    expect(judge(labels, 'hover').ok).toBe(false);
  });

  it('accepts a focus that holds exactly one region and no hover', () => {
    const labels = FIVE.map((id) => label(id, id === 'graphics' ? 'focused' : 'idle'));

    expect(judge(labels, 'focus').ok).toBe(true);
  });

  it('refuses a click that only hovered', () => {
    const labels = FIVE.map((id) => label(id, id === 'graphics' ? 'hovered' : 'idle'));
    const verdict = judge(labels, 'focus');

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/hovered, not focused/);
  });

  it('refuses a focus that left the pointer hover standing', () => {
    // Two inputs at once: the routing field would answer both, and the frame
    // would not show which one the composition was following.
    const labels = FIVE.map((id) =>
      label(id, id === 'graphics' ? 'focused' : id === 'ai' ? 'hovered' : 'idle'),
    );
    const verdict = judge(labels, 'focus');

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/hovered as well/);
  });

  it('refuses a focus that is not exclusive', () => {
    const labels = FIVE.map((id) =>
      label(id, id === 'graphics' || id === 'ai' ? 'focused' : 'idle'),
    );

    expect(judge(labels, 'focus').reason).toMatch(/focused at once/);
  });

  it('accepts an Escape that cleared both focus and hover', () => {
    expect(judge(FIVE.map((id) => label(id)), 'escape').ok).toBe(true);
  });

  it('refuses an Escape that only cleared the focus', () => {
    // The near-miss this exists for: nothing is focused any more, so a check on
    // the focus flag alone passes — and the composition is still bent toward the
    // region under the pointer.
    const labels = FIVE.map((id) => label(id, id === 'graphics' ? 'hovered' : 'idle'));
    const verdict = judge(labels, 'escape');

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/never left the scene/);
  });

  it('refuses an Escape that left a focus standing', () => {
    const labels = FIVE.map((id) => label(id, id === 'graphics' ? 'focused' : 'idle'));

    expect(judge(labels, 'escape').reason).toMatch(/left graphics focused/);
  });

  it('fails every expectation when the label layer is absent', () => {
    // The selector is a contract with the UI. If it stops matching, the harness
    // has to say so rather than capture three identical frames and call them
    // evidence.
    for (const expectation of ['hover', 'focus', 'escape']) {
      const verdict = evaluateInteraction(readInteractionState([], 'graphics'), expectation, 'graphics');
      expect(verdict.ok, expectation).toBe(false);
      expect(verdict.reason, expectation).toContain('.domain-labels');
    }
  });
});