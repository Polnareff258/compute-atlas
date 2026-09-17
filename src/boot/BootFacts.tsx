'use client';

import type {
  BootPhase,
  BootState,
  HealthStatus,
} from './types';

type FactTone = 'pending' | 'ready' | 'fallback' | 'degraded' | 'neutral';

type Fact = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: FactTone;
};

function healthValue(status: HealthStatus): {
  readonly value: string;
  readonly tone: FactTone;
} {
  switch (status) {
    case 'ready':
    case 'online':
      return { value: 'READY', tone: 'ready' };
    case 'not_initialized':
      return { value: 'NOT INITIALIZED', tone: 'neutral' };
    case 'offline':
      return { value: 'OFFLINE', tone: 'degraded' };
    case 'degraded':
      return { value: 'DEGRADED', tone: 'degraded' };
    default:
      return { value: 'UNKNOWN', tone: 'pending' };
  }
}

function sceneFact(phase: BootPhase): Fact {
  if (phase === 'complete' || phase === 'entering') {
    return {
      label: 'COMPUTE SCENE',
      value: 'ACTIVE',
      detail: 'Visual environment mounted',
      tone: 'ready',
    };
  }

  if (phase === 'ready') {
    return {
      label: 'COMPUTE SCENE',
      value: 'READY',
      detail: 'Visual environment waiting for input',
      tone: 'ready',
    };
  }

  if (phase === 'constructing_scene') {
    return {
      label: 'COMPUTE SCENE',
      value: 'CONSTRUCTING',
      detail: 'Mounting local scene graph',
      tone: 'pending',
    };
  }

  if (phase === 'degraded') {
    return {
      label: 'COMPUTE SCENE',
      value: 'LIMITED',
      detail: 'Renderer shell retained',
      tone: 'degraded',
    };
  }

  return {
    label: 'COMPUTE SCENE',
    value: 'PENDING',
    detail: 'Waiting for renderer',
    tone: 'pending',
  };
}

function getFacts(state: BootState): readonly Fact[] {
  const capability = state.capability;
  const renderer = state.renderer;
  const graphicsValue =
    renderer?.status === 'fallback'
      ? { value: 'WEBGL2 FALLBACK', tone: 'fallback' as const }
      : renderer?.backend === 'webgpu' && renderer.status === 'ready'
        ? { value: 'WEBGPU READY', tone: 'ready' as const }
        : capability?.preferredBackend === 'webgpu'
          ? { value: 'WEBGPU AVAILABLE', tone: 'pending' as const }
          : capability?.preferredBackend === 'webgl2'
            ? { value: 'WEBGL2 AVAILABLE', tone: 'pending' as const }
            : capability?.preferredBackend === 'unavailable'
              ? { value: 'UNAVAILABLE', tone: 'degraded' as const }
              : { value: 'PROBING', tone: 'pending' as const };

  const graphicsDetail =
    renderer?.rendererName ??
    capability?.adapterName ??
    'Capability probe in progress';

  const pipelineValue =
    renderer?.status === 'ready' || renderer?.status === 'fallback'
      ? {
          value: renderer.status === 'fallback' ? 'FALLBACK READY' : 'READY',
          tone: renderer.status === 'fallback' ? ('fallback' as const) : ('ready' as const),
        }
      : renderer?.status === 'degraded'
        ? { value: 'DEGRADED', tone: 'degraded' as const }
        : { value: 'PENDING', tone: 'pending' as const };

  const backend = state.health?.backend
    ? healthValue(state.health.backend.status)
    : { value: 'PENDING', tone: 'pending' as const };
  const agent = state.health?.agent
    ? healthValue(state.health.agent.status)
    : { value: 'PENDING', tone: 'pending' as const };
  const manifest = state.health?.projectManifest
    ? healthValue(state.health.projectManifest.status)
    : { value: 'PENDING', tone: 'pending' as const };

  return [
    {
      label: 'GRAPHICS BACKEND',
      value: graphicsValue.value,
      detail: graphicsDetail,
      tone: graphicsValue.tone,
    },
    {
      label: 'RENDER PIPELINE',
      value: pipelineValue.value,
      detail: renderer?.error ?? 'Shader and render pipeline state',
      tone: pipelineValue.tone,
    },
    {
      label: 'LOCAL BACKEND',
      value: backend.value,
      detail: state.health?.backend.detail ?? 'Health check pending',
      tone: backend.tone,
    },
    {
      label: 'OLLAMA AGENT',
      value: agent.value,
      detail: state.health?.agent.detail ?? 'Gateway health check pending',
      tone: agent.tone,
    },
    {
      label: 'PROJECT MANIFEST',
      value: manifest.value,
      detail: state.health?.projectManifest.detail ?? state.manifest.detail,
      tone: manifest.tone,
    },
    sceneFact(state.phase),
  ];
}

export function BootFacts({ state }: { readonly state: BootState }) {
  return (
    <ul className="boot-facts" aria-label="Bootstrap facts">
      {getFacts(state).map((fact) => (
        <li className="boot-facts__row" key={fact.label}>
          <span className="boot-facts__label">{fact.label}</span>
          <span className={'boot-facts__value boot-facts__value--' + fact.tone}>
            {fact.value}
          </span>
          <span className="boot-facts__detail">{fact.detail}</span>
        </li>
      ))}
    </ul>
  );
}