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
  /**
   * Why the handle is not the backend that was asked for, when the adapter can
   * say.
   *
   * `RendererRuntime` is the backend owner and the only thing that decides what a
   * fallback means, so it is the only thing that should be reporting one — but
   * the reason can only come from the adapter, which is the only thing that was
   * there when it happened. A backend that falls over inside a dependency is a
   * case the runtime cannot see at all: Three.js catches a failed WebGPU device
   * itself, swaps in its WebGL2 backend and resolves the initialisation, so by
   * the time the handle comes back the only evidence left is the backend it says
   * it built. See `resolveBuiltBackend`.
   */
  readonly fallbackReason?: string;
  readonly setQuality: (quality: QualitySettings) => void;
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

/**
 * Releases a handle that arrived after its runtime was stopped.
 *
 * The disposal is the point; the swallowing is not laziness. There is no state
 * left to report a failure into — the runtime is `stopped`, and its `error` field
 * belongs to the teardown that just happened rather than to a renderer nobody
 * will use. Throwing here would turn a correct teardown into an unhandled
 * rejection in a component that is on its way out.
 */
function disposeQuietly(handle: RendererHandle): void {
  try {
    handle.dispose();
  } catch {
    // See above: there is nothing left to tell.
  }
}

export function createRendererRuntime(
  options: RendererRuntimeOptions,
): RendererRuntime {
  const now = options.now ?? Date.now;
  let activeHandle: RendererHandle | null = null;
  let pendingStart: Promise<RendererRuntimeState> | null = null;
  let pendingGeneration = -1;

  /**
   * Invalidates every initialization that is already in flight.
   *
   * ## The race this exists for, and why it is not hypothetical
   *
   * `start()` is a chain of awaits — a capability probe, then the adapter's
   * `initialize` — and none of them can be cancelled. `stop()` can arrive at any
   * point in that chain, and it does: it is what `RendererHost` calls from its
   * effect cleanup, which runs on unmount and in development on every
   * double-invoked mount. Without a token, the sequence is:
   *
   *   1. `stop()` disposes nothing (no handle exists yet) and sets `stopped`.
   *   2. The awaited probe or renderer resolves.
   *   3. `startInternal` writes its result into `state` regardless — `probing`,
   *      then `initializing`, then `ready` — and adopts the handle.
   *
   * So a runtime that was stopped comes back to life holding a renderer, the
   * status readout claims a running backend over a torn-down host, and the
   * handle it adopted owns a device and a canvas configuration that no owner
   * will ever release. Every one of those three is fixed by the same check: the
   * token is read after each await, and a stale attempt publishes nothing and
   * disposes anything it was handed.
   *
   * A counter rather than an `AbortSignal`, because there is nothing to abort:
   * the probe and the adapter are plain promises with no cancellation channel,
   * and inventing one would mean threading a signal through `CapabilityProbe`
   * and `RendererAdapter` — two interfaces whose only job is to answer questions
   * — to express something the caller of `start()` can already say by bumping an
   * integer.
   */
  let generation = 0;
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
    const settings = getQualityProfile(profile);

    if (activeHandle) {
      activeHandle.setQuality(settings);
    }

    state = { ...state, quality: profile };
  }

  function stop(): void {
    if (state.status === 'stopped') {
      return;
    }

    // Everything already awaiting is stale from here on. Bumped before the
    // disposal rather than after, so an attempt that resolves during this
    // function cannot land between the two.
    generation += 1;

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

  async function startInternal(token: number): Promise<RendererRuntimeState> {
    const isCurrent = (): boolean => token === generation;

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
      if (!isCurrent()) {
        return getState();
      }
      state = {
        ...state,
        status: 'degraded',
        error: `Capability detection failed: ${getErrorMessage(error)}`,
      };
      return getState();
    }

    if (!isCurrent()) {
      return getState();
    }

    state = {
      ...state,
      capability: report,
    };

    const backendOrder = getBackendOrder(report);
    let lastError = report.reason ?? null;

    for (const backend of backendOrder) {
      if (!isCurrent()) {
        return getState();
      }

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

        if (!isCurrent()) {
          // Stopped while this backend was coming up. The handle is live — a
          // device, a queue, a configured canvas — and the runtime it was built
          // for is gone, so the only correct owner is the one throwing it away.
          disposeQuietly(handle);
          return getState();
        }

        activeHandle = handle;
        /*
         * Judged on what the handle *is*, not on which adapter produced it.
         *
         * Those are usually the same and are not always: the WebGPU adapter can
         * come back holding a WebGL2 renderer, because Three.js swaps in its own
         * fallback backend when the device cannot be created and resolves the
         * initialisation anyway — see `resolveBuiltBackend`. Comparing the
         * attempt rather than the result files that case as `ready`, which puts
         * `WebGPU` on screen over a picture that WebGL2 drew.
         */
        const isFallback = handle.backend !== report.preferredBackend;
        const builtBackendFallback = handle.backend !== backend;
        const fallbackError = builtBackendFallback
          ? (handle.fallbackReason ??
            `${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} built ${handle.backend} instead`)
          : lastError;

        state = {
          ...state,
          status: isFallback ? 'fallback' : 'ready',
          backend: handle.backend,
          rendererName: handle.rendererName,
          adapterName: handle.adapterName ?? report.adapterName ?? null,
          error: isFallback ? fallbackError : null,
          startedAt: now(),
        };

        return getState();
      } catch (error) {
        if (!isCurrent()) {
          return getState();
        }
        lastError = `${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} initialization failed: ${getErrorMessage(error)}`;
      }
    }

    if (!isCurrent()) {
      return getState();
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

    // Only a start belonging to the *current* generation may be joined. After a
    // stop, the previous attempt is still settling and still holds this slot;
    // returning it would answer a fresh `start()` with a promise that resolves to
    // `stopped` and never begins, which is worse than either outcome alone.
    if (pendingStart !== null && pendingGeneration === generation) {
      return pendingStart;
    }

    const token = generation;
    const attempt = startInternal(token);
    pendingStart = attempt;
    pendingGeneration = token;

    try {
      return await attempt;
    } finally {
      // Cleared only if the slot is still this attempt's: a restart may have
      // taken it while this one was settling, and clearing it then would strand
      // the live start with no way for a second caller to join it.
      if (pendingGeneration === token) {
        pendingStart = null;
        pendingGeneration = -1;
      }
    }
  }

  return {
    start,
    stop,
    setQuality,
    getState,
  };
}
