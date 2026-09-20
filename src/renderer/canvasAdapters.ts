import * as THREE from 'three';

import type {
  RendererAdapter,
  RendererAdapterBackend,
} from './runtime';
import { deriveEffectiveDpr } from '../config/quality';
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

  // Who resets the render counter is decided here, because the renderer's
  // ownership and the counter's meaning are the same question.
  //
  // By default the renderer zeroes `info` at the start of every `render()` call,
  // which is right when it is the only thing drawing. When the post pipeline
  // owns the frame it issues several renders — one per internal pass — and the
  // default would leave `info` holding the cost of whichever fullscreen quad
  // happened to go last, so the telemetry would report a fullscreen quad and
  // call it the frame. In that configuration the pipeline resets the counter
  // itself, once per displayed frame, and the renderer must not.
  //
  // It is set from the quality profile rather than by the pipeline because the
  // pipeline is a subscriber that comes and goes, and a flag whose correct value
  // depends on which subscribers happen to be mounted is a flag that is wrong
  // for one frame at every mount and unmount.
  renderer.info.autoReset = !quality.allowBloom;
}

export function createCanvasRendererAdapters(
  canvas: HTMLCanvasElement,
  rendererRef: CanvasRendererRef,
): Partial<Record<RendererAdapterBackend, RendererAdapter>> {
  return {
    webgpu: {
      initialize: async ({ quality }) => {
        const { WebGPURenderer } = await import('three/webgpu');
        const renderer = new WebGPURenderer({
          alpha: true,
          antialias: true,
          canvas,
          powerPreference: 'high-performance',
        });

        await renderer.init();
        configureRenderer(renderer, canvas, quality);
        rendererRef.current = renderer;

        return {
          backend: 'webgpu',
          rendererName: 'Three.js WebGPURenderer',
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
        const { WebGPURenderer } = await import('three/webgpu');
        const renderer = new WebGPURenderer({
          alpha: true,
          antialias: true,
          canvas,
          forceWebGL: true,
          powerPreference: 'high-performance',
        });

        await renderer.init();
        configureRenderer(renderer, canvas, quality);
        rendererRef.current = renderer;

        return {
          backend: 'webgl2',
          // Named for what it is. The old string said "WebGLRenderer", which
          // stopped being true the moment the node renderer took over the
          // fallback, and a readout that is wrong is worse than a longer one.
          rendererName: 'Three.js WebGPURenderer (WebGL2 backend)',
          adapterName: null,
          setQuality: (nextQuality) =>
            configureRenderer(renderer, canvas, nextQuality),
          dispose: () => {
            rendererRef.current = null;
            renderer.dispose();
          },
        };
      },
    },
  };
}
