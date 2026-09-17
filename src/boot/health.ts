import type { RendererRuntimeState } from '../renderer/runtime';
import type {
  BootRendererSnapshot,
  HealthCheck,
  HealthSnapshot,
  ManifestSnapshot,
} from './types';

export type HealthAggregationInput = {
  readonly renderer: BootRendererSnapshot | RendererRuntimeState;
  readonly manifest: ManifestSnapshot;
  readonly checkedAt: number;
};

function rendererIsUsable(
  renderer: BootRendererSnapshot | RendererRuntimeState,
): boolean {
  return renderer.status === 'ready' || renderer.status === 'fallback';
}

function createNotInitializedCheck(detail: string, checkedAt: number): HealthCheck {
  return {
    status: 'not_initialized',
    detail,
    checkedAt,
  };
}

export function aggregateHealth(
  input: HealthAggregationInput,
): HealthSnapshot {
  const backend = createNotInitializedCheck(
    'Local backend gateway not initialized',
    input.checkedAt,
  );
  const agent = createNotInitializedCheck(
    'Local Ollama gateway not initialized',
    input.checkedAt,
  );
  const projectManifest: HealthCheck = {
    status: input.manifest.status === 'ready' ? 'ready' : 'degraded',
    detail: input.manifest.detail,
    checkedAt: input.manifest.checkedAt ?? input.checkedAt,
  };

  return {
    overall:
      rendererIsUsable(input.renderer) && projectManifest.status === 'ready'
        ? 'ready'
        : 'degraded',
    backend,
    agent,
    projectManifest,
  };
}