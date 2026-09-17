import type { RendererBackend } from './types';

export type WebGpuAdapterDetails = {
  readonly name?: string;
};

export type CapabilityProbe = {
  requestWebGpuAdapter: () => Promise<WebGpuAdapterDetails | null>;
  createWebGl2Context: () => WebGL2RenderingContext | null;
};

export type RendererCapabilityReport = {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly preferredBackend: RendererBackend;
  readonly adapterName?: string;
  readonly reason?: string;
};

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: (options?: {
      powerPreference?: 'low-power' | 'high-performance';
    }) => Promise<{
      info?: {
        device?: string;
        description?: string;
        vendor?: string;
      };
    } | null>;
  };
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export async function detectRendererCapabilities(
  probe: CapabilityProbe,
): Promise<RendererCapabilityReport> {
  let webGpuAdapter: WebGpuAdapterDetails | null = null;
  let webGpuFailure: string | undefined;

  try {
    webGpuAdapter = await probe.requestWebGpuAdapter();
  } catch (error) {
    webGpuFailure = `WebGPU probe failed: ${getErrorMessage(error)}`;
  }

  let webgl2 = false;
  let webGl2Failure: string | undefined;

  try {
    webgl2 = probe.createWebGl2Context() !== null;
  } catch (error) {
    webGl2Failure = `WebGL2 probe failed: ${getErrorMessage(error)}`;
  }

  const webgpu = webGpuAdapter !== null;
  const preferredBackend: RendererBackend = webgpu
    ? 'webgpu'
    : webgl2
      ? 'webgl2'
      : 'unavailable';
  const report: RendererCapabilityReport = {
    webgpu,
    webgl2,
    preferredBackend,
  };

  if (webGpuAdapter?.name) {
    return { ...report, adapterName: webGpuAdapter.name };
  }

  if (!webgpu && webGpuFailure) {
    return { ...report, reason: webGpuFailure };
  }

  if (!webgpu && !webgl2 && webGl2Failure) {
    return { ...report, reason: webGl2Failure };
  }

  if (!webgpu && !webgl2) {
    return { ...report, reason: 'WebGPU and WebGL2 are unavailable' };
  }

  return report;
}

export function createBrowserCapabilityProbe(): CapabilityProbe {
  return {
    requestWebGpuAdapter: async () => {
      if (typeof navigator === 'undefined') {
        return null;
      }

      const navigatorWithGpu = navigator as NavigatorWithGpu;
      if (!navigatorWithGpu.gpu) {
        return null;
      }

      const adapter = await navigatorWithGpu.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        return null;
      }

      const adapterInfo = adapter.info;
      const adapterName = [
        adapterInfo?.device,
        adapterInfo?.description,
        adapterInfo?.vendor,
      ].find((value): value is string => Boolean(value));

      return adapterName ? { name: adapterName } : {};
    },
    createWebGl2Context: () => {
      if (typeof document === 'undefined') {
        return null;
      }

      const canvas = document.createElement('canvas');
      return canvas.getContext('webgl2');
    },
  };
}
