import type {
  BootAction,
  BootEvent,
  BootPhase,
  BootState,
} from './types';

const MAX_PUBLIC_EVENTS = 32;

function appendEvent(
  state: BootState,
  kind: BootEvent['kind'],
  at: number,
  phase: BootPhase,
  detail: string,
): BootState {
  const event: BootEvent = { kind, at, phase, detail };
  return {
    ...state,
    events: [...state.events, event].slice(-MAX_PUBLIC_EVENTS),
  };
}

function setPhase(
  state: BootState,
  phase: BootPhase,
  at: number,
  detail: string,
): BootState {
  const next = {
    ...state,
    phase,
    phaseStartedAt: at,
  };
  return appendEvent(next, 'phase_started', at, phase, detail);
}

export function createInitialBootState(now = 0): BootState {
  return {
    phase: 'idle',
    startedAt: null,
    phaseStartedAt: now,
    minimumDurationMs: 0,
    reducedMotion: false,
    skipRequested: false,
    capability: null,
    renderer: null,
    health: null,
    manifest: {
      status: 'pending',
      detail: 'Project manifest pending',
      checkedAt: null,
    },
    error: null,
    events: [],
  };
}

export function bootReducer(state: BootState, action: BootAction): BootState {
  switch (action.type) {
    case 'BOOT_BEGIN': {
      if (state.phase !== 'idle') {
        return state;
      }

      const started = {
        ...state,
        phase: 'probing_graphics' as const,
        startedAt: action.at,
        phaseStartedAt: action.at,
        minimumDurationMs: action.minimumDurationMs,
        reducedMotion: action.reducedMotion,
        skipRequested: false,
        error: null,
      };

      return appendEvent(
        started,
        'phase_started',
        action.at,
        'probing_graphics',
        'Graphics capability probe started',
      );
    }

    case 'GRAPHICS_PROBED': {
      if (state.phase !== 'probing_graphics') {
        return state;
      }

      const next = setPhase(
        {
          ...state,
          capability: action.capability,
        },
        'initializing_renderer',
        action.at,
        'Renderer initialization started',
      );

      return appendEvent(
        next,
        'capability_detected',
        action.at,
        'initializing_renderer',
        action.capability.reason ??
          'Preferred backend: ' + action.capability.preferredBackend,
      );
    }

    case 'RENDERER_INITIALIZED': {
      if (state.phase !== 'initializing_renderer') {
        return state;
      }

      const next = {
        ...state,
        renderer: action.renderer,
        error: action.renderer.error,
      };

      if (
        action.renderer.status !== 'ready' &&
        action.renderer.status !== 'fallback'
      ) {
        return appendEvent(
          setPhase(next, 'degraded', action.at, 'Renderer entered degraded mode'),
          'degraded',
          action.at,
          'degraded',
          action.renderer.error ?? 'No renderer backend could be initialized',
        );
      }

      return appendEvent(
        setPhase(next, 'checking_systems', action.at, 'System health checks started'),
        'renderer_ready',
        action.at,
        'checking_systems',
        action.renderer.rendererName ?? 'Renderer initialized',
      );
    }

    case 'SYSTEMS_CHECKED': {
      if (
        state.phase !== 'checking_systems' &&
        state.phase !== 'degraded'
      ) {
        return state;
      }

      const next = {
        ...state,
        health: action.health,
        manifest: {
          status:
            action.health.projectManifest.status === 'ready'
              ? ('ready' as const)
              : ('invalid' as const),
          detail: action.health.projectManifest.detail,
          checkedAt: action.health.projectManifest.checkedAt,
        },
      };

      if (state.phase === 'degraded') {
        return appendEvent(
          next,
          'health_checked',
          action.at,
          'degraded',
          'Health aggregate: ' + action.health.overall,
        );
      }

      return appendEvent(
        setPhase(next, 'constructing_scene', action.at, 'Visual scene construction started'),
        'health_checked',
        action.at,
        'constructing_scene',
        'Health aggregate: ' + action.health.overall,
      );
    }

    case 'SCENE_CONSTRUCTED': {
      if (state.phase !== 'constructing_scene') {
        return state;
      }

      return appendEvent(
        setPhase(state, 'ready', action.at, 'Compute environment ready for entry'),
        'scene_constructed',
        action.at,
        'ready',
        'Renderer scene mounted',
      );
    }

    case 'ENTER_REQUESTED': {
      if (state.phase !== 'ready' && state.phase !== 'degraded') {
        return state;
      }

      return appendEvent(
        setPhase(state, 'entering', action.at, 'Entering compute environment'),
        'enter_requested',
        action.at,
        'entering',
        'User requested environment entry',
      );
    }

    case 'TRANSITION_COMPLETE': {
      if (state.phase !== 'entering' || state.startedAt === null) {
        return state;
      }

      const elapsed = action.at - state.startedAt;
      if (
        !state.reducedMotion &&
        !state.skipRequested &&
        elapsed < state.minimumDurationMs
      ) {
        return state;
      }

      return appendEvent(
        setPhase(state, 'complete', action.at, 'Compute environment active'),
        'complete',
        action.at,
        'complete',
        'Bootstrap overlay dismissed',
      );
    }

    case 'SKIP_REQUESTED': {
      if (state.phase === 'complete') {
        return state;
      }

      return {
        ...state,
        skipRequested: true,
        minimumDurationMs: 0,
      };
    }

    case 'BOOT_DEGRADED': {
      return appendEvent(
        setPhase(
          {
            ...state,
            error: action.error,
          },
          'degraded',
          action.at,
          'Bootstrap entered degraded mode',
        ),
        'degraded',
        action.at,
        'degraded',
        action.error,
      );
    }

    default:
      return state;
  }
}