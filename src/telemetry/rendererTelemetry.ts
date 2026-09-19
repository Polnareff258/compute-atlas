import type {
  QualityProfile,
  RendererBackend,
} from '../renderer/types';

export type RendererInfoSource = {
  readonly info?: {
    readonly render?: {
      readonly calls?: number;
      readonly triangles?: number;
    };
    readonly memory?: {
      readonly geometries?: number;
      readonly textures?: number;
    };
  };
};

export type RendererTelemetrySnapshot = {
  readonly fps: number | null;
  readonly frameTimeMs: number | null;
  readonly drawCalls: number | null;
  readonly triangles: number | null;
  readonly geometries: number | null;
  readonly textures: number | null;
  readonly particleCount: number;
  readonly configuredFieldBudget: number;
  readonly renderedFieldSamples: number;
  readonly activeSignalSamples: number;
  readonly backend: RendererBackend;
  readonly quality: QualityProfile;
  readonly sampledAt: number;
};

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function rounded(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type RendererTelemetryInput = {
  readonly renderer: RendererInfoSource;
  readonly backend: RendererBackend;
  readonly quality: QualityProfile;
  /**
   * No `particleCount` input.
   *
   * The snapshot keeps the field for compatibility, but it is derived from
   * `renderedFieldSamples` rather than supplied. Both were always set to the
   * same value by the only caller, so the input was a second name for one
   * number — and a second name is somewhere for the two to diverge.
   */
  readonly configuredFieldBudget: number;
  readonly renderedFieldSamples: number;
  readonly activeSignalSamples: number;
  readonly deltaSeconds: number;
  readonly sampledAt: number;
};

export function sampleRendererTelemetry(
  input: RendererTelemetryInput,
): RendererTelemetrySnapshot {
  const delta = input.deltaSeconds > 0 ? input.deltaSeconds : null;

  return {
    fps: delta === null ? null : rounded(1 / delta, 2),
    frameTimeMs: delta === null ? null : rounded(delta * 1_000, 2),
    drawCalls: finiteOrNull(input.renderer.info?.render?.calls),
    triangles: finiteOrNull(input.renderer.info?.render?.triangles),
    geometries: finiteOrNull(input.renderer.info?.memory?.geometries),
    textures: finiteOrNull(input.renderer.info?.memory?.textures),
    particleCount: input.renderedFieldSamples,
    configuredFieldBudget: input.configuredFieldBudget,
    renderedFieldSamples: input.renderedFieldSamples,
    activeSignalSamples: input.activeSignalSamples,
    backend: input.backend,
    quality: input.quality,
    sampledAt: input.sampledAt,
  };
}
