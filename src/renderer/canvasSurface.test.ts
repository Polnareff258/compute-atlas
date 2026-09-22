// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { createCanvasSurface } from './canvasSurface';

/**
 * The ownership question, stated as a test.
 *
 * A `HTMLCanvasElement` answers a context request once. Ask it for `webgpu` and
 * every later `getContext('webgl2')` returns `null` — not an exception, a `null`
 * — so a fallback that keeps using the same element does not fail loudly, it
 * fails by never being able to create its backend at all. These assertions are
 * about the element the fallback is handed, not about any renderer.
 */

function mountCanvas(): { host: HTMLElement; canvas: HTMLCanvasElement } {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.className = 'renderer-host__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  document.body.appendChild(host);
  return { host, canvas };
}

describe('createCanvasSurface', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hands out the live canvas while nothing has claimed it', () => {
    const { canvas } = mountCanvas();
    const surface = createCanvasSurface(canvas);

    expect(surface.canvas).toBe(canvas);
    expect(surface.acquire()).toBe(canvas);
    expect(surface.acquire()).toBe(canvas);
  });

  it('rebuilds the canvas once a context type has claimed it', () => {
    const { host, canvas } = mountCanvas();
    const surface = createCanvasSurface(canvas);
    surface.markContextClaimed();

    const rebuilt = surface.acquire();

    expect(rebuilt).not.toBe(canvas);
    expect(rebuilt.tagName).toBe('CANVAS');
    // In the same place, or the fallback renders into nothing on screen.
    expect(host.firstElementChild).toBe(rebuilt);
    expect(canvas.parentNode).toBeNull();
    expect(surface.canvas).toBe(rebuilt);
  });

  it('carries the host\u2019s own attributes onto the rebuilt element', () => {
    // The host styles the canvas by class and marks it aria-hidden. A rebuilt
    // element that lost either would be an un-styled, screen-reader-visible
    // canvas occupying the top-left corner of the page.
    const { canvas } = mountCanvas();
    const surface = createCanvasSurface(canvas);
    surface.markContextClaimed();

    const rebuilt = surface.acquire();

    expect(rebuilt.className).toBe('renderer-host__canvas');
    expect(rebuilt.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not rebuild a second time for the same claim', () => {
    // Acquiring is what the fallback does; marking is what the failed attempt
    // does. If acquiring re-armed the claim, a backend that asked twice would
    // get two elements and draw into the one nobody can see.
    const { canvas } = mountCanvas();
    const surface = createCanvasSurface(canvas);
    surface.markContextClaimed();

    const first = surface.acquire();
    const second = surface.acquire();

    expect(second).toBe(first);
  });

  it('returns the same element when the canvas is not in a document', () => {
    // Not replaceable, so not replaced: the caller still gets an element it can
    // try to use, and whatever happens next is reported as a failure rather than
    // hidden behind a detached canvas nobody is looking at.
    const orphan = document.createElement('canvas');
    const surface = createCanvasSurface(orphan);
    surface.markContextClaimed();

    expect(surface.acquire()).toBe(orphan);
  });
});
