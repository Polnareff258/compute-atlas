import type {
  QualityProfile,
  RendererBackend,
} from '../renderer/types';

export type RendererInfoSource = {
  readonly info?: {
    readonly render?: {
      /**
       * Draw calls *of the current frame*, and the only one of the two counters
       * on `Info.render` that may be reported as a cost.
       *
       * `calls` sits beside it and is documented upstream as "the number of
       * render calls since the app has been started" — it is not cleared by
       * `Info.reset()`, which the renderer's own source makes explicit: `reset()`
       * zeroes `drawCalls`, `frameCalls`, `triangles`, `points` and `lines`, and
       * leaves `calls` alone. Reading it as a per-frame figure therefore yields a
       * number that climbs for as long as the page is open, and a sixty-second
       * run of this scene reported three hundred and nineteen thousand of them
       * against a real cost of about twenty-five. It is not a wrong number so
       * much as a number about a different thing, and the telemetry panel is a
       * claim about what the frame costs.
       */
      readonly drawCalls?: number;
      /**
       * Declared because the renderer really does expose it, and never read.
       *
       * A field that exists and is deliberately ignored is worth naming here: a
       * later revision that reached for `calls` out of habit would be reaching
       * for the cumulative total, and the test that pins the snapshot would be
       * the only thing that noticed.
       */
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
    drawCalls: finiteOrNull(input.renderer.info?.render?.drawCalls),
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

/** Anything whose frame counters can be handed back empty. */
export type FrameCounterOwner = {
  readonly info: { reset: () => void };
};

/**
 * The frame boundary: read what the frame that just finished cost, then hand the
 * counters back empty for the one about to be drawn.
 *
 * ## Why this is a function rather than a line at the call site
 *
 * Because its absence was a defect that no type could catch and no screenshot
 * could show. `drawCalls` and `triangles` are only meaningful as *the cost of a
 * frame*; Three.js produces them by resetting its own `info` at the start of
 * every `render()` call, and `canvasAdapters` deliberately turns that off —
 * because with several renders per frame the default leaves the counters holding
 * whichever pass happened to go last, and the telemetry then reports a
 * fullscreen quad and calls it the frame. The comment there said the *pipeline*
 * would reset the counters once per displayed frame instead.
 *
 * There is no pipeline. Nothing reset them. So `info` was never cleared at all:
 * a capture run over twenty-three seconds reported `drawCalls` climbing
 * 467 → 740 → 1202 → … → 5360 and `triangles` reaching 2,007,321,458, and the
 * only thing wrong with those numbers was that they were totals from page load
 * wearing a per-frame field's name.
 *
 * Reading and clearing in one function is what makes the order assertable, and
 * the order is the whole contract: clearing first would report the frame that has
 * not been drawn yet, and clearing never would report the whole session. The
 * `finally` covers the third case — a read that throws must still leave the
 * counters empty, or the next report is a total again.
 */
export function readFrameCounters<T>(
  owner: FrameCounterOwner,
  read: () => T,
): T {
  try {
    return read();
  } finally {
    owner.info.reset();
  }
}
