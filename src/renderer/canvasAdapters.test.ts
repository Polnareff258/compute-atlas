import { describe, expect, it } from 'vitest';

import { resolveBuiltBackend } from './canvasAdapters';

/**
 * The renderer's own answer to "which backend did you build".
 *
 * The case this exists for is not hypothetical and was not found by reading: a
 * captured run that forced the WebGPU device request to fail came back with the
 * status line `WebGPU — Ultra`, while the browser console explained in the same
 * breath that the picture was drawn under WebGL2. Three.js catches a failed
 * WebGPU backend itself, swaps in its own WebGL2 backend and resolves `init()`
 * — so a caller that trusts the backend it *asked for* reports a backend that is
 * not running, and everything downstream of that name is wrong with it.
 */
describe('resolveBuiltBackend', () => {
  it('reads the WebGPU flag off the backend the renderer built', () => {
    expect(resolveBuiltBackend({ backend: { isWebGPUBackend: true } }, 'webgpu')).toBe('webgpu');
  });

  it('reports WebGL2 when the renderer fell back internally', () => {
    // Asked for WebGPU, built WebGL2 — the whole point. A function that returned
    // its first argument would pass every other case in this file.
    expect(resolveBuiltBackend({ backend: { isWebGLBackend: true } }, 'webgpu')).toBe('webgl2');
  });

  it('reports WebGL2 for the forced path too', () => {
    expect(resolveBuiltBackend({ backend: { isWebGLBackend: true } }, 'webgl2')).toBe('webgl2');
  });

  it('prefers the WebGPU flag when a backend somehow answers both', () => {
    // Not a shape Three.js produces. Stated so the answer is decided here rather
    // than by the order two `if`s happen to be written in.
    expect(
      resolveBuiltBackend({ backend: { isWebGPUBackend: true, isWebGLBackend: true } }, 'webgl2'),
    ).toBe('webgpu');
  });

  it('falls back to what was requested when the renderer says nothing', () => {
    // A renderer whose shape this module does not recognise. Reporting the
    // request is the honest answer: inventing a fallback would be claiming an
    // event nobody observed.
    expect(resolveBuiltBackend({}, 'webgpu')).toBe('webgpu');
    expect(resolveBuiltBackend({ backend: {} }, 'webgl2')).toBe('webgl2');
  });

  it('does not mistake a falsy flag for a true one', () => {
    expect(
      resolveBuiltBackend(
        { backend: { isWebGPUBackend: false, isWebGLBackend: false } },
        'webgpu',
      ),
    ).toBe('webgpu');
  });
});
