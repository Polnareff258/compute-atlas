import {
  ROUTE_CLASS_ORDER,
  WEBGL2_DASH_CEILING,
  deriveCurveDashCounts,
  deriveRouteDashDensity,
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
  /** Packets per world unit of route, for the active implementation. */
  readonly density: number;
  /** Route classes this field exposes at the current interaction state. */
  readonly lanes: number;
  /**
   * Hard ceiling on dashes actually submitted, matching the view's own cap.
   * Omitted for the advected field, which has no CPU pass to bound.
   */
  readonly capacity?: number;
};

/**
 * How a field is configured before backend capacity is applied.
 *
 * The caller supplies the same `advected`, `detail` and `lanes` it hands the
 * view, and this resolves the rest the one way a field is ever resolved — so
 * telemetry cannot describe a density the renderer was never asked to draw.
 */
export type RouteFieldSpec = {
  readonly curves: readonly RouteCurve[];
  readonly detail: number;
  readonly lanes: number;
};

export function createRouteFieldSample(
  advected: boolean,
  spec: RouteFieldSpec,
): RouteFieldSample {
  const density = deriveRouteDashDensity(advected, spec.detail);
  if (advected) {
    return { curves: spec.curves, density, lanes: spec.lanes };
  }
  // The instanced fallback is the only implementation with a CPU pass, so it is
  // the only one with a ceiling to report.
  return {
    curves: spec.curves,
    density,
    lanes: spec.lanes,
    capacity: WEBGL2_DASH_CEILING,
  };
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
 * The packing is class-major, so the revealed subset is a walk of the classes in
 * `ROUTE_CLASS_ORDER` up to the active lane count. That equivalence is pinned by
 * a test against the packed attributes, so the two cannot drift apart silently.
 */
export function countFieldDashes(field: RouteFieldSample): {
  readonly rendered: number;
  readonly signal: number;
} {
  // The counts come from the same function the packer calls, so this cannot
  // describe a field the renderer was not asked to draw. Reproducing the density
  // formula here instead is what the previous version did, and a second copy of a
  // formula is a second answer waiting to drift.
  const counts = deriveCurveDashCounts(field.curves, field.density, field.capacity);
  const revealedClasses = Number.isFinite(field.lanes)
    ? Math.max(0, Math.min(ROUTE_CLASS_ORDER.length, Math.floor(field.lanes)))
    : 0;

  let rendered = 0;
  let signal = 0;

  for (let laneIndex = 0; laneIndex < revealedClasses; laneIndex += 1) {
    const routeClass = ROUTE_CLASS_ORDER[laneIndex]!;
    let drawn = 0;
    field.curves.forEach((curve, index) => {
      if (curve.route === routeClass) drawn += counts[index] ?? 0;
    });

    rendered += drawn;
    if (routeClass === 'signal') signal += drawn;
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
