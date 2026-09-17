import { detectRendererCapabilities } from './capability';
import type {
  CapabilityProbe,
  RendererCapabilityReport,
} from './capability';
import { getQualityProfile } from '../config/quality';
import type {
  QualityProfile,
  RendererBackend,
  RendererStatus,
  QualitySettings,
} from './types';

export type RendererAdapterBackend = Exclude<RendererBackend, 'unavailable'>;

export type RendererHandle = {
  readonly backend: RendererAdapterBackend;
  readonly rendererName: string;
  readonly adapterName: string | null;
  dispose: () => void;
};

export type RendererAdapterInitialization = {
  readonly quality: QualitySettings;
  readonly capability: RendererCapabilityReport;
};

export type RendererAdapter = {
  initialize: (
    options: RendererAdapterInitialization,
  ) => Promise<RendererHandle>;
};

export type RendererRuntimeState = {
  readonly status: RendererStatus;
  readonly backend: RendererBackend;
  readonly rendererName: string | null;
  readonly adapterName: string | null;
  readonly quality: QualityProfile;
  readonly capability: RendererCapabilityReport | null;
  readonly error: string | null;
  readonly startedAt: number | null;
};

export type RendererRuntimeOptions = {
  readonly capabilityProbe: CapabilityProbe;
  readonly adapters: Partial<Record<RendererAdapterBackend, RendererAdapter>>;
  readonly initialQuality?: QualityProfile;
  readonly now?: () => number;
};

export type RendererRuntime = {
  start: () => Promise<RendererRuntimeState>;
  stop: () => void;
  setQuality: (profile: QualityProfile) => void;
  getState: () => RendererRuntimeState;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function getBackendOrder(report: RendererCapabilityReport): RendererAdapterBackend[] {
  const order: RendererAdapterBackend[] = [];

  if (report.webgpu) {
    order.push('webgpu');
  }

  if (report.webgl2) {
    order.push('webgl2');
  }

  return order;
}

function isReadyStatus(status: RendererStatus): boolean {
  return status === 'ready' || status === 'fallback';
}

export function createRendererRuntime(
  options: RendererRuntimeOptions,
): RendererRuntime {
  const now = options.now ?? Date.now;
  let activeHandle: RendererHandle | null = null;
  let pendingStart: Promise<RendererRuntimeState> | null = null;
  let state: RendererRuntimeState = {
    status: 'idle',
    backend: 'unavailable',
    rendererName: null,
    adapterName: null,
    quality: options.initialQuality ?? 'ultra',
    capability: null,
    error: null,
    startedAt: null,
  };

  function getState(): RendererRuntimeState {
    return { ...state };
  }

  function setQuality(profile: QualityProfile): void {
    getQualityProfile(profile);
    state = { ...state, quality: profile };
  }

  function stop(): void {
    if (state.status === 'stopped') {
      return;
    }

    if (activeHandle) {
      try {
        activeHandle.dispose();
      } catch (error) {
        state = {
          ...state,
          error: `Renderer disposal failed: ${getErrorMessage(error)}`,
        };
      }
      activeHandle = null;
    }

    state = {
      ...state,
      status: 'stopped',
      backend: 'unavailable',
      rendererName: null,
      adapterName: null,
      startedAt: null,
    };
  }

  async function startInternal(): Promise<RendererRuntimeState> {
    state = {
      ...state,
      status: 'probing',
      backend: 'unavailable',
      rendererName: null,
      adapterName: null,
      capability: null,
      error: null,
      startedAt: null,
    };

    let report: RendererCapabilityReport;

    try {
      report = await detectRendererCapabilities(options.capabilityProbe);
    } catch (error) {
      state = {
        ...state,
        status: 'degraded',
        error: `Capability detection failed: ${getErrorMessage(error)}`,
      };
      return getState();
    }

    state = {
      ...state,
      capability: report,
    };

    const backendOrder = getBackendOrder(report);
    let lastError = report.reason ?? null;

    for (const backend of backendOrder) {
      const adapter = options.adapters[backend];

      if (!adapter) {
        lastError = `${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} adapter is not configured`;
        continue;
      }

      state = {
        ...state,
        status: 'initializing',
        backend,
      };

      try {
        const handle = await adapter.initialize({
          quality: getQualityProfile(state.quality),
          capability: report,
        });
        activeHandle = handle;
        const isFallback = backend !== report.preferredBackend;

        state = {
          ...state,
          status: isFallback ? 'fallback' : 'ready',
          backend: handle.backend,
          rendererName: handle.rendererName,
          adapterName: handle.adapterName ?? report.adapterName ?? null,
          error: isFallback ? lastError : null,
          startedAt: now(),
        };

        return getState();
      } catch (error) {
        lastError = `${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} initialization failed: ${getErrorMessage(error)}`;
      }
    }

    state = {
      ...state,
      status: 'degraded',
      backend: 'unavailable',
      rendererName: null,
      adapterName: null,
      error: lastError ?? 'No renderer backend could be initialized',
      startedAt: null,
    };

    return getState();
  }

  async function start(): Promise<RendererRuntimeState> {
    if (isReadyStatus(state.status)) {
      return getState();
    }

    if (pendingStart) {
      return pendingStart;
    }

    pendingStart = startInternal();

    try {
      return await pendingStart;
    } finally {
      pendingStart = null;
    }
  }

  return {
    start,
    stop,
    setQuality,
    getState,
  };
}
