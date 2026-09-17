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
        const { WebGLRenderer } = await import('three');
        const renderer = new WebGLRenderer({
          alpha: true,
          antialias: true,
          canvas,
          powerPreference: 'high-performance',
        });

        configureRenderer(renderer, canvas, quality);
        rendererRef.current = renderer;

        return {
          backend: 'webgl2',
          rendererName: 'Three.js WebGLRenderer',
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
