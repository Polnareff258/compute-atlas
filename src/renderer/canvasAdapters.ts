import * as THREE from 'three';

import type {
  RendererAdapter,
  RendererAdapterBackend,
} from './runtime';
import { deriveEffectiveDpr } from '../config/quality';
import type { CanvasSurface } from './canvasSurface';
import type { QualitySettings } from './types';

export type CanvasRenderer = {
  render: (scene: THREE.Scene, camera: THREE.Camera) => unknown;
  setPixelRatio: (value: number) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  setClearColor: (color: THREE.ColorRepresentation, alpha?: number) => void;
  readonly info: { autoReset: boolean };
};

export type CanvasRendererRef = {
  current: CanvasRenderer | null;
};

/**
 * A renderer that says which backend it actually built.
 *
 * Read structurally, and from `unknown`, because the flags live on Three.js's
 * concrete backend classes rather than on the base `Backend` type the renderer
 * declares — a `Backend` and this shape have no properties in common, so a
 * structural parameter would be rejected. Narrowing at runtime is the honest
 * form for a cross-library shape probe anyway: an unrecognised renderer answers
 * "unknown" rather than failing to compile.
 */
type BackendAwareRenderer = {
  readonly backend?: unknown;
};

/**
 * Which backend the renderer really built, which is not always the one asked for.
 *
 * **The defect this closes, found by running it.** `new WebGPURenderer({...})`
 * installs a fallback of its own: if `WebGPUBackend.init` throws — no adapter, no
 * device, a validation failure — three catches it, warns
 * `WebGPURenderer: WebGPU is not available, running under WebGL2 backend.`, swaps
 * in a `WebGLBackend` and **resolves `init()` successfully**. So a failed WebGPU
 * start does not present itself as a rejected promise for the caller to catch;
 * it presents itself as a renderer that initialised and is quietly drawing with
 * the other backend.
 *
 * That mattered, and it was visible in the app's own readout before this existed:
 * a capture run that forced the WebGPU device request to fail came back with the
 * status line `WebGPU — Ultra` over a frame that the browser console was
 * simultaneously explaining was drawn by WebGL2. Every consequence of a wrong
 * backend name follows from that — the telemetry reports a backend that is not
 * running, `RendererRuntime` files the session as `ready` rather than `fallback`
 * so nobody is told a fallback happened, and the capture harness's backend
 * assertion compares the page against a name the page invented.
 *
 * So the caller asks the renderer what it built. A backend object that answers
 * neither flag leaves the requested value in place, which is the honest fallback:
 * this reports what it knows rather than guessing.
 */
export function resolveBuiltBackend(
  renderer: BackendAwareRenderer,
  requested: RendererAdapterBackend,
): RendererAdapterBackend {
  const backend = renderer?.backend;
  if (typeof backend !== 'object' || backend === null) return requested;

  const flags = backend as Record<string, unknown>;
  if (flags['isWebGPUBackend'] === true) return 'webgpu';
  if (flags['isWebGLBackend'] === true) return 'webgl2';
  return requested;
}

const WEBGL2_RENDERER_NAME = 'Three.js WebGPURenderer (WebGL2 backend)';
const WEBGPU_RENDERER_NAME = 'Three.js WebGPURenderer';

function configureRenderer(
  renderer: CanvasRenderer,
  canvas: HTMLCanvasElement,
  quality: QualitySettings,
): void {
  const devicePixelRatio = deriveEffectiveDpr(
    window.devicePixelRatio,
    quality,
  );
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);

  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(width, height, false);
  renderer.setClearColor('#050609', 1);

  /*
   * Who resets the render counter, and why it is never the renderer.
   *
   * By default Three.js zeroes `info` at the start of every `render()` call,
   * which is right when the renderer is the only thing drawing and wrong here:
   * a frame issues several renders — the ink field's advection and copy passes
   * before R3F draws the scene — so the default would leave `info` holding the
   * cost of whichever pass happened to go last, and the telemetry would report a
   * fullscreen quad and call it the frame.
   *
   * So the automatic reset is off at every tier and the *frame* owns the
   * counter: `SceneHost`'s loop reads it at the top of a frame and clears it
   * there, which is the only moment at which the counters hold exactly one
   * frame's work. See `readFrameCounters`.
   *
   * ## What this line used to be, and what that cost
   *
   * It was `!quality.allowBloom`, on the reasoning that a frame with bloom is a
   * frame with a post pipeline, and the pipeline would reset the counter once
   * per displayed frame. There is no pipeline: `allowBloom` is read nowhere else
   * in the tree, and no post-processing step exists at all. So for ULTRA and
   * HIGH — the two tiers the app runs by default and the two every capture is
   * taken at — nothing reset the counters, ever.
   *
   * The result was not a rounding error. A browser capture over twenty-three
   * seconds reported `drawCalls` climbing 467 → 740 → 1202 → … → 5360 and
   * `triangles` reaching 2,007,321,458, all of it reported through fields named
   * for a single frame. A readout that grows for as long as the page is open is
   * worse than a readout that is missing, because it looks like a measurement.
   */
  renderer.info.autoReset = false;
}

/**
 * The two backends, as adapters over one canvas surface.
 *
 * ## Why the fallback does not assume it can have the canvas
 *
 * Both adapters construct the *same* `WebGPURenderer`; the WebGL2 path is that
 * renderer with `forceWebGL`. Neither of them is told which context type it may
 * use — each one asks the element, and a `HTMLCanvasElement` answers once. So
 * the sequence "try WebGPU, fall back to WebGL2" is only sound if the second
 * attempt is handed an element the first one never touched, which is what
 * `CanvasSurface` is for and why the WebGL2 adapter calls `acquire()` rather
 * than using the element it was constructed with.
 *
 * ## Why the WebGPU failure path disposes before it rethrows
 *
 * `new WebGPURenderer({...})` allocates backend state eagerly and `init()`
 * completes it — a device, a queue, an adapter, in the WebGPU case a canvas
 * configuration. A constructor that succeeded followed by an `init()` that threw
 * therefore leaves a half-built renderer holding a device that nothing will ever
 * release. The runtime's own `stop()` cannot clean it up, because the runtime
 * never received a handle: the failure happened inside `initialize`, so from its
 * side there is nothing there. So the disposal belongs here, and it runs before
 * the error is rethrown so that the next backend starts from a released device
 * rather than from whatever the previous one was still holding.
 */
export function createCanvasRendererAdapters(
  surface: CanvasSurface,
  rendererRef: CanvasRendererRef,
): Partial<Record<RendererAdapterBackend, RendererAdapter>> {
  return {
    webgpu: {
      initialize: async ({ quality }) => {
        const canvas = surface.acquire();
        const { WebGPURenderer } = await import('three/webgpu');
        const renderer = new WebGPURenderer({
          alpha: true,
          antialias: true,
          canvas,
          powerPreference: 'high-performance',
        });

        // Declared before `init()` rather than after it succeeds, and declared
        // whether or not this attempt touched the context: the backend resolves
        // `canvas.getContext('webgpu')` lazily, so there is no point in this
        // sequence at which "it definitely has not been claimed yet" is a safe
        // assumption. One extra element, once per session, in exchange for never
        // having to reason about which of several failure paths got far enough.
        surface.markContextClaimed();

        try {
          await renderer.init();
        } catch (error) {
          rendererRef.current = null;
          try {
            await renderer.dispose();
          } catch {
            // Swallowed deliberately: the failure being reported is the one that
            // stopped this backend, and replacing it with a disposal error would
            // hide the actual reason the fallback is running.
          }
          throw error;
        }

        configureRenderer(renderer, canvas, quality);
        rendererRef.current = renderer;

        // What it actually built, not what was asked for. See `resolveBuiltBackend`.
        const built = resolveBuiltBackend(renderer, 'webgpu');

        return {
          backend: built,
          rendererName:
            built === 'webgl2' ? WEBGL2_RENDERER_NAME : WEBGPU_RENDERER_NAME,
          adapterName: null,
          // Said rather than implied: the runtime reports a fallback status, and a
          // fallback with no reason is a line of UI that tells a reader something
          // happened without telling them what.
          ...(built === 'webgl2'
            ? {
                fallbackReason:
                  'WebGPU reported no usable device; Three.js fell back to its WebGL2 backend inside the renderer',
              }
            : {}),
          setQuality: (nextQuality) =>
            configureRenderer(renderer, canvas, nextQuality),
          dispose: () => {
            rendererRef.current = null;
            void renderer.dispose();
          },
        };
      },
    },
    webgl2: {
      initialize: async ({ quality }) => {
        // The fallback runs the same renderer as the main path, in WebGL2 mode.
        //
        // It used to be a plain `WebGLRenderer`, and the two backends therefore
        // ran two different material systems: node materials on WebGPU, stock
        // `THREE.Material` on WebGL2. Every shader in the scene had to be
        // authored twice, and the one time that was tried the two paths disagreed
        // — the vertex-colour divergence recorded in `surfaceMaterial.ts`, which
        // cost a stage to find and ended with the whole scene retreating to stock
        // materials on both backends.
        //
        // The visual layer this stage adds cannot retreat to stock materials: the
        // data-matter field, the membranes and the post chain are all authored
        // shading. So the fallback is the same `WebGPURenderer` with
        // `forceWebGL`, which gives one shader graph for both backends instead of
        // two that drift. What WebGL2 still cannot do is compute and storage
        // buffers; those are gated on the real backend rather than on this one.
        const canvas = surface.acquire();
        const { WebGPURenderer } = await import('three/webgpu');
        const renderer = new WebGPURenderer({
          alpha: true,
          antialias: true,
          canvas,
          forceWebGL: true,
          powerPreference: 'high-performance',
        });

        try {
          await renderer.init();
        } catch (error) {
          rendererRef.current = null;
          try {
            await renderer.dispose();
          } catch {
            // Same rule as the WebGPU path: the reported failure is this one.
          }
          throw error;
        }

        configureRenderer(renderer, canvas, quality);
        rendererRef.current = renderer;

        return {
          backend: 'webgl2',
          // Named for what it is. The old string said "WebGLRenderer", which
          // stopped being true the moment the node renderer took over the
          // fallback, and a readout that is wrong is worse than a longer one.
          rendererName: WEBGL2_RENDERER_NAME,
          adapterName: null,
          setQuality: (nextQuality) =>
            configureRenderer(renderer, canvas, nextQuality),
          dispose: () => {
            rendererRef.current = null;
            void renderer.dispose();
          },
        };
      },
    },
  };
}
