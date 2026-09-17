import type {
  RendererRuntime,
  RendererRuntimeState,
} from '../renderer/runtime';
import { aggregateHealth } from './health';
import { bootReducer, createInitialBootState } from './bootMachine';
import { inspectProjectManifest } from './manifest';
import type {
  BootAction,
  BootRendererSnapshot,
  BootState,
} from './types';

export type BootMode = 'full' | 'skip';

export type BootCoordinatorOptions = {
  readonly runtime: RendererRuntime;
  readonly onStateChange: (state: BootState) => void;
  readonly onRendererInitialized: (state: RendererRuntimeState) => void | Promise<void>;
  readonly now?: () => number;
  readonly reducedMotion?: boolean;
  readonly mode?: BootMode;
  readonly fullDurationMs?: number;
  readonly reducedDurationMs?: number;
};

export type BootCoordinator = {
  readonly start: () => Promise<BootState>;
  readonly requestEnter: () => void;
  readonly requestSkip: () => void;
  readonly dispose: () => void;
  readonly getState: () => BootState;
};

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

function getRendererSnapshot(
  state: RendererRuntimeState,
): BootRendererSnapshot {
  return {
    status: state.status,
    backend: state.backend,
    rendererName: state.rendererName,
    adapterName: state.adapterName,
    quality: state.quality,
    error: state.error,
    startedAt: state.startedAt,
  };
}

function getDefaultReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function getDefaultMode(): BootMode {
  if (typeof window === 'undefined') {
    return 'full';
  }

  const mode = new URLSearchParams(window.location.search).get('boot');
  return mode === 'skip' ? 'skip' : 'full';
}

export function createBootCoordinator(
  options: BootCoordinatorOptions,
): BootCoordinator {
  const now = options.now ?? Date.now;
  const mode = options.mode ?? getDefaultMode();
  const reducedMotion = options.reducedMotion ?? getDefaultReducedMotion();
  const fullDurationMs = options.fullDurationMs ?? 2_600;
  const reducedDurationMs = options.reducedDurationMs ?? 450;
  let state = createInitialBootState(now());
  let disposed = false;
  let started = false;
  let pendingTransition: TimerHandle | null = null;

  function publish(action: BootAction): BootState {
    if (disposed) {
      return state;
    }

    state = bootReducer(state, action);
    options.onStateChange(state);
    return state;
  }

  function clearTransitionTimer(): void {
    if (pendingTransition !== null) {
      globalThis.clearTimeout(pendingTransition);
      pendingTransition = null;
    }
  }

  function requestEnter(): void {
    if (disposed || (state.phase !== 'ready' && state.phase !== 'degraded')) {
      return;
    }

    const currentTime = now();
    const enteringState = publish({ type: 'ENTER_REQUESTED', at: currentTime });

    if (
      enteringState.phase !== 'entering' ||
      enteringState.startedAt === null
    ) {
      return;
    }

    clearTransitionTimer();
    const remaining = Math.max(
      0,
      enteringState.startedAt + enteringState.minimumDurationMs - currentTime,
    );

    if (remaining === 0) {
      publish({ type: 'TRANSITION_COMPLETE', at: now() });
      return;
    }

    pendingTransition = globalThis.setTimeout(() => {
      pendingTransition = null;
      publish({ type: 'TRANSITION_COMPLETE', at: now() });
    }, remaining);
  }

  function requestSkip(): void {
    if (disposed || state.phase === 'complete') {
      return;
    }

    publish({ type: 'SKIP_REQUESTED', at: now() });
    if (state.phase === 'ready' || state.phase === 'degraded') {
      requestEnter();
    }
  }

  async function start(): Promise<BootState> {
    if (started) {
      return state;
    }

    started = true;
    publish({
      type: 'BOOT_BEGIN',
      at: now(),
      minimumDurationMs: reducedMotion ? reducedDurationMs : fullDurationMs,
      reducedMotion,
    });

    if (mode === 'skip') {
      requestSkip();
    }

    try {
      const runtimeState = await options.runtime.start();
      if (disposed) {
        return state;
      }

      if (runtimeState.capability) {
        publish({
          type: 'GRAPHICS_PROBED',
          at: now(),
          capability: runtimeState.capability,
        });
      }

      publish({
        type: 'RENDERER_INITIALIZED',
        at: now(),
        renderer: getRendererSnapshot(runtimeState),
      });

      await options.onRendererInitialized(runtimeState);

      const manifest = inspectProjectManifest(now());
      publish({
        type: 'SYSTEMS_CHECKED',
        at: now(),
        health: aggregateHealth({
          renderer: getRendererSnapshot(runtimeState),
          manifest,
          checkedAt: now(),
        }),
      });

      if (
        runtimeState.status === 'ready' ||
        runtimeState.status === 'fallback'
      ) {
        publish({ type: 'SCENE_CONSTRUCTED', at: now() });
      } else {
        publish({
          type: 'BOOT_DEGRADED',
          at: now(),
          error: runtimeState.error ?? 'Renderer is unavailable',
        });
      }
    } catch (error) {
      publish({
        type: 'BOOT_DEGRADED',
        at: now(),
        error: error instanceof Error ? error.message : 'Bootstrap failed',
      });
    }

    if (mode === 'skip' && (state.phase === 'ready' || state.phase === 'degraded')) {
      requestEnter();
    }

    return state;
  }

  function dispose(): void {
    disposed = true;
    clearTransitionTimer();
  }

  return {
    start,
    requestEnter,
    requestSkip,
    dispose,
    getState: () => state,
  };
}