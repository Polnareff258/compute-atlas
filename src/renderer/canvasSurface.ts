/**
 * The canvas, as a thing that can be replaced.
 *
 * ## Why this exists
 *
 * A `HTMLCanvasElement` is single-context: the first `getContext(type)` call
 * fixes the element to that type, and every later call with a *different* type
 * returns `null` rather than throwing. Both of this app's backends are one
 * `WebGPURenderer` — the WebGL2 path is the same renderer with `forceWebGL` —
 * and each one reaches for the element's context when it initialises
 * (`WebGLBackend.init` calls `domElement.getContext('webgl2', …)`;
 * `WebGPUBackend` calls `domElement.getContext('webgpu')` the first time it
 * resolves a canvas target).
 *
 * So a WebGPU attempt that fails *after* it reached for the context leaves
 * behind an element the WebGL2 fallback cannot use, and the fallback's own
 * `init()` then dies on a `null` context. That is the failure this module
 * exists to make impossible: the second attempt gets a canvas that has never
 * been asked for anything.
 *
 * ## Why the claim is declared rather than probed
 *
 * The obvious alternative is to ask the live element what it is — but there is
 * no non-destructive way to do that. In WebGL, `getContext('webgpu')` *creates*
 * a context when none exists, so a probe is itself a claim; and
 * `getContext('webgl2')` on a WebGPU canvas returns `null`, which is
 * indistinguishable from "this browser has no WebGL2". Declaring the claim at
 * the moment a renderer is constructed against the element is therefore both
 * the honest form and the deterministic one: a backend that may have taken the
 * context says so, and the next backend rebuilds unconditionally.
 *
 * It is deliberately conservative. A WebGPU attempt that failed before it ever
 * touched the context still forces one rebuild — one element, once per session,
 * in exchange for never having to reason about which of several failure paths
 * got far enough to claim it.
 */
export type CanvasSurface = {
  /** The element a backend should draw into right now. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Declares that the live canvas may have been handed to a context type.
   *
   * Idempotent, and never cleared by acquiring: the claim belongs to the element
   * that was claimed, and acquiring hands back a different one.
   */
  markContextClaimed: () => void;
  /**
   * The canvas to draw into, rebuilt first if the live one has been claimed.
   *
   * Creating the replacement and putting it in the document happen together, so
   * a caller can never end up holding a well-formed canvas that is not on the
   * page.
   */
  acquire: () => HTMLCanvasElement;
};

export function createCanvasSurface(initial: HTMLCanvasElement): CanvasSurface {
  let canvas = initial;
  let claimed = false;

  function replace(): HTMLCanvasElement {
    const parent = canvas.parentNode;

    if (parent === null) {
      // The element is not in a document, so there is nowhere to put a
      // replacement. Handing back a detached element would be worse than handing
      // back a claimed one: the fallback would initialise successfully and draw
      // into a canvas nothing is displaying, which is exactly the silent black
      // screen this whole path is supposed to prevent.
      return canvas;
    }

    const next = canvas.ownerDocument.createElement('canvas');
    // Everything the host put on the element, because those attributes *are* the
    // host's contract with it — the class that sizes and hides it, and any ARIA
    // marker. What the renderer wrote (a drawing-buffer size, an inline style) is
    // copied too and then overwritten by `configureRenderer`, which is harmless
    // and keeps this a single rule rather than a list of exceptions.
    for (const attribute of Array.from(canvas.attributes)) {
      next.setAttribute(attribute.name, attribute.value);
    }

    parent.replaceChild(next, canvas);
    canvas = next;
    return next;
  }

  return {
    get canvas() {
      return canvas;
    },
    markContextClaimed() {
      claimed = true;
    },
    acquire() {
      if (!claimed) {
        return canvas;
      }
      const previous = canvas;
      const next = replace();
      // Cleared only when a replacement was actually made. If `replace` had to
      // give up, the claim is still true and the next caller must try again
      // rather than be handed the element that is known to be unusable.
      if (next !== previous) {
        claimed = false;
      }
      return next;
    },
  };
}
