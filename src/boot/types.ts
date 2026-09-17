import type { RendererCapabilityReport } from '../renderer/capability';
import type {
  QualityProfile,
  RendererBackend,
  RendererStatus,
} from '../renderer/types';

export type BootPhase =
  | 'idle'
  | 'probing_graphics'
  | 'initializing_renderer'
  | 'checking_systems'
  | 'constructing_scene'
  | 'ready'
  | 'entering'
  | 'complete'
  | 'degraded';

export type BootEventKind =
  | 'phase_started'
  | 'capability_detected'
  | 'renderer_ready'
  | 'health_checked'
  | 'scene_constructed'
  | 'degraded'
  | 'enter_requested'
  | 'complete';

export type BootEvent = {
  readonly kind: BootEventKind;
  readonly at: number;
  readonly phase: BootPhase;
  readonly detail: string;
};

export type HealthStatus =
  | 'online'
  | 'ready'
  | 'offline'
  | 'not_initialized'
  | 'degraded'
  | 'unknown';

export type HealthCheck = {
  readonly status: HealthStatus;
  readonly detail: string;
  readonly checkedAt: number;
};

export type ManifestSnapshot = {
  readonly status: 'pending' | 'ready' | 'invalid';
  readonly detail: string;
  readonly checkedAt: number | null;
};

export type HealthSnapshot = {
  readonly overall: 'ready' | 'degraded';
  readonly backend: HealthCheck;
  readonly agent: HealthCheck;
  readonly projectManifest: HealthCheck;
};

export type BootRendererSnapshot = {
  readonly status: RendererStatus;
  readonly backend: RendererBackend;
  readonly rendererName: string | null;
  readonly adapterName: string | null;
  readonly quality: QualityProfile;
  readonly error: string | null;
  readonly startedAt: number | null;
};

export type BootState = {
  readonly phase: BootPhase;
  readonly startedAt: number | null;
  readonly phaseStartedAt: number | null;
  readonly minimumDurationMs: number;
  readonly reducedMotion: boolean;
  readonly skipRequested: boolean;
  readonly capability: RendererCapabilityReport | null;
  readonly renderer: BootRendererSnapshot | null;
  readonly health: HealthSnapshot | null;
  readonly manifest: ManifestSnapshot;
  readonly error: string | null;
  readonly events: readonly BootEvent[];
};

export type BootAction =
  | {
      readonly type: 'BOOT_BEGIN';
      readonly at: number;
      readonly minimumDurationMs: number;
      readonly reducedMotion: boolean;
    }
  | {
      readonly type: 'GRAPHICS_PROBED';
      readonly at: number;
      readonly capability: RendererCapabilityReport;
    }
  | {
      readonly type: 'RENDERER_INITIALIZED';
      readonly at: number;
      readonly renderer: BootRendererSnapshot;
    }
  | {
      readonly type: 'SYSTEMS_CHECKED';
      readonly at: number;
      readonly health: HealthSnapshot;
    }
  | {
      readonly type: 'SCENE_CONSTRUCTED';
      readonly at: number;
    }
  | {
      readonly type: 'ENTER_REQUESTED';
      readonly at: number;
    }
  | {
      readonly type: 'TRANSITION_COMPLETE';
      readonly at: number;
    }
  | {
      readonly type: 'SKIP_REQUESTED';
      readonly at: number;
    }
  | {
      readonly type: 'BOOT_DEGRADED';
      readonly at: number;
      readonly error: string;
    };