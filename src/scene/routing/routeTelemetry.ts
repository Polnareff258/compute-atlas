import {
  ROUTE_CLASS_ORDER,
  WEBGL2_DASH_CEILING,
  deriveDashesPerRoute,
  type RouteCurve,
} from './routeDash';

/**
 * What the routing field actually draws, in the three counts the renderer
 * telemetry contract already reports.
 *
 * The particle-era numbers were budgets: how many samples a descriptor had
 * allocated. These are observations. `renderedFieldSamples` is the dash count the
 * current draw range reveals on the active backend, so it matches the instances
 * on screen rather than the size of the array behind them.
 */
export type RouteFieldTelemetryCounts = {
  readonly configuredFieldBudget: number;
  readonly renderedFieldSamples: number;
  readonly activeSignalSamples: number;
};

export type RouteFieldSample = {
  /** The field's curves, in the order they were handed to the view. */
  readonly curves: readonly RouteCurve[];
  /** Dashes packed per curve, as resolved for the active backend and profile. */
  readonly dashesPerRoute: number;
  /** Route classes this field exposes at the current interaction state. */
  readonly lanes: number;
  /**
   * Hard ceiling on dashes actually submitted, matching the view's own cap.
   * Omit for the unthrottled WebGPU path.
   */
  readonly capacity?: number;
};

/**
 * How a field is configured before backend capacity is applied.
 *
 * The caller supplies the same `detail` and `lanes` it hands the view, and this
 * resolves the rest the one way a field is ever resolved — so telemetry cannot
 * describe a density the renderer was never asked to draw.
 */
export type RouteFieldSpec = {
  readonly curves: readonly RouteCurve[];
  readonly detail: number;
  readonly lanes: number;
};

export function createRouteFieldSample(
  backend: 'webgpu' | 'webgl2',
  spec: RouteFieldSpec,
): RouteFieldSample {
  const dashesPerRoute = deriveDashesPerRoute(backend, spec.detail, spec.lanes);
  if (backend === 'webgl2') {
    return {
      curves: spec.curves,
      dashesPerRoute,
      lanes: spec.lanes,
      capacity: WEBGL2_DASH_CEILING,
    };
  }
  return { curves: spec.curves, dashesPerRoute, lanes: spec.lanes };
}

function finiteCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Dashes the field reveals, split into the total and the signal-class subset.
 *
 * Landed from the descriptors rather than from packed attributes: telemetry
 * samples several times a second, and packing the field just to count it would
 * allocate the whole ribbon buffer on every sample.
 *
 * The packing is class-major, so walking the classes in `ROUTE_CLASS_ORDER` and
 * spending the capacity as it goes reproduces the draw range exactly. That
 * equivalence is pinned by a test against the packed attributes, so the two
 * cannot drift apart silently.
 */
export function countFieldDashes(field: RouteFieldSample): {
  readonly rendered: number;
  readonly signal: number;
} {
  // Mirrors the packing exactly: a non-finite or zero stride packs no dashes at
  // all, so it must count as none rather than being floored up to one.
  const perRoute = Number.isFinite(field.dashesPerRoute)
    ? Math.max(0, Math.floor(field.dashesPerRoute))
    : 0;
  const capacity = field.capacity === undefined ? Infinity : finiteCount(field.capacity);
  const revealedClasses = Number.isFinite(field.lanes)
    ? Math.max(0, Math.min(ROUTE_CLASS_ORDER.length, Math.floor(field.lanes)))
    : 0;

  let remaining = capacity;
  let rendered = 0;
  let signal = 0;

  for (let laneIndex = 0; laneIndex < revealedClasses; laneIndex += 1) {
    const routeClass = ROUTE_CLASS_ORDER[laneIndex]!;
    let curveCount = 0;
    for (const curve of field.curves) {
      if (curve.route === routeClass) curveCount += 1;
    }

    const drawn = Math.min(curveCount * perRoute, remaining);
    rendered += drawn;
    if (routeClass === 'signal') signal += drawn;
    remaining -= drawn;

    if (remaining <= 0) break;
  }

  return { rendered, signal };
}

/**
 * Adds up every field the scene draws into one telemetry triple.
 *
 * The configured budget is reported as given — deliberately not clamped up to
 * the rendered count — so a profile that sizes the field far above what it emits
 * stays visible in the numbers instead of being rounded away.
 */
export function deriveRouteFieldTelemetryCounts(
  configuredBudget: number,
  fields: readonly RouteFieldSample[],
): RouteFieldTelemetryCounts {
  let renderedFieldSamples = 0;
  let activeSignalSamples = 0;

  for (const field of fields) {
    const counts = countFieldDashes(field);
    renderedFieldSamples += counts.rendered;
    activeSignalSamples += counts.signal;
  }

  return {
    configuredFieldBudget: finiteCount(configuredBudget),
    renderedFieldSamples,
    activeSignalSamples,
  };
}
