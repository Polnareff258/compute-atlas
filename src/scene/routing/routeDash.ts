import { hashUnit, normalizeSeed } from '../seedRandom';

/**
 * One route primitive for the whole scene.
 *
 * Core trunks, Core signals and Graph routes are all the same open quadratic
 * Bézier so a dash travelling one of them has identical curvature, speed and
 * brightness behaviour. WebGPU evaluates this in the vertex shader; WebGL2
 * evaluates the same formulas on the CPU at low density.
 */
export type RouteClass = 'primary' | 'secondary' | 'ambient' | 'signal';

type Vector = readonly [number, number, number];

export type RouteCurve = {
  readonly id: number;
  readonly rank: number;
  readonly route: RouteClass;
  /**
   * Route group index (0..7), used for per-route brightness so one hovered
   * branch can lift while the other domains recede. Group 0 is the Core's own
   * internal circulation.
   */
  readonly group: number;
  readonly start: Vector;
  readonly control: Vector;
  readonly end: Vector;
};

/** Groups are packed into two vec4 uniforms, so eight is the ceiling. */
export const MAX_ROUTE_GROUPS = 8;

/** In-house order matters: it defines the contiguous draw-range layout. */
export const ROUTE_CLASS_ORDER: readonly RouteClass[] = [
  'primary',
  'secondary',
  'signal',
  'ambient',
];

export const ROUTE_CLASS_INDEX: Readonly<Record<RouteClass, number>> = Object.freeze({
  primary: 0,
  secondary: 1,
  signal: 2,
  ambient: 3,
});

const TANGENT_EPSILON = 0.0001;
const UP: Vector = [0, 1, 0];

function quadratic(
  start: Vector,
  control: Vector,
  end: Vector,
  t: number,
  axis: 0 | 1 | 2,
): number {
  const inverse = 1 - t;
  return (
    inverse * inverse * start[axis] +
    2 * inverse * t * control[axis] +
    t * t * end[axis]
  );
}

/** Samples the curve into `target` to keep frame paths allocation-free. */
export function sampleRoutePoint(
  curve: RouteCurve,
  t: number,
  target: Float32Array | number[],
  offset = 0,
): void {
  const bounded = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  target[offset] = quadratic(curve.start, curve.control, curve.end, bounded, 0);
  target[offset + 1] = quadratic(curve.start, curve.control, curve.end, bounded, 1);
  target[offset + 2] = quadratic(curve.start, curve.control, curve.end, bounded, 2);
}

/**
 * Curve derivative. A dash is always stretched along this, which is what makes
 * the field read as directional flow instead of a cloud of dots.
 */
export function sampleRouteTangent(
  curve: RouteCurve,
  t: number,
  target: Float32Array | number[],
  offset = 0,
): void {
  const bounded = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const inverse = 1 - bounded;

  const axes = [0, 1, 2] as const;
  for (const axis of axes) {
    const derivative =
      2 * inverse * (curve.control[axis] - curve.start[axis]) +
      2 * bounded * (curve.end[axis] - curve.control[axis]);
    target[offset + axis] = derivative;
  }

  const length = Math.hypot(target[offset]!, target[offset + 1]!, target[offset + 2]!);
  if (length < TANGENT_EPSILON) {
    // Degenerate control point: fall back to the chord so the dash still has an
    // axis rather than collapsing to a point.
    const dx = curve.end[0] - curve.start[0];
    const dy = curve.end[1] - curve.start[1];
    const dz = curve.end[2] - curve.start[2];
    const chord = Math.hypot(dx, dy, dz);

    if (chord >= TANGENT_EPSILON) {
      target[offset] = dx / chord;
      target[offset + 1] = dy / chord;
      target[offset + 2] = dz / chord;
      return;
    }

    // Start, control and end coincide: no direction exists in the data. Use a
    // fixed axis so the quad stays unit-scaled and never produces NaN.
    target[offset] = 1;
    target[offset + 1] = 0;
    target[offset + 2] = 0;
    return;
  }

  target[offset] = target[offset]! / length;
  target[offset + 1] = target[offset + 1]! / length;
  target[offset + 2] = target[offset + 2]! / length;
}

/** Stable across-axis for the ribbon quad, derived from one up reference. */
export function deriveRouteAcross(
  tangent: Float32Array | number[],
  offset: number,
  target: Float32Array | number[],
  targetOffset = 0,
): void {
  const tx = tangent[offset]!;
  const ty = tangent[offset + 1]!;
  const tz = tangent[offset + 2]!;
  let ax = ty * UP[2] - tz * UP[1];
  let ay = tz * UP[0] - tx * UP[2];
  let az = tx * UP[1] - ty * UP[0];
  let length = Math.hypot(ax, ay, az);

  if (length < TANGENT_EPSILON) {
    ax = 1;
    ay = 0;
    az = 0;
    length = 1;
  }

  target[targetOffset] = ax / length;
  target[targetOffset + 1] = ay / length;
  target[targetOffset + 2] = az / length;
}

/**
 * Compresses curve progress toward the arrival end.
 *
 * This is the route compression zone: under hover and focus, dashes bunch up as
 * they approach the target ingress instead of travelling at constant spacing.
 */
export function compressRouteProgress(t: number, compression: number): number {
  const boundedT = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const boundedCompression = Number.isFinite(compression)
    ? Math.min(1, Math.max(0, compression))
    : 0;
  if (boundedCompression === 0) return boundedT;

  // A biased power curve: identity at 0, fixed at 1, and an exponent below one
  // so equal steps of arc length cover more progress as they near arrival.
  // Dashes therefore bunch in front of the ingress instead of spreading out.
  const exponent = 1 / (1 + boundedCompression * 1.6);
  return Math.pow(boundedT, exponent);
}

/**
 * Dash brightness envelope over its own lifetime.
 *
 * Source-to-target bursts appear, carry and then thin out on arrival, leaving a
 * short wake instead of popping out of existence.
 */
export function deriveDashEnvelope(
  t: number,
  wake: number,
  birthFraction = 0.14,
  arrivalFraction = 0.22,
): number {
  const boundedT = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const boundedWake = Number.isFinite(wake) ? Math.min(1, Math.max(0, wake)) : 0;
  const birth = Math.min(0.5, Math.max(TANGENT_EPSILON, birthFraction));
  const arrival = Math.min(0.5, Math.max(TANGENT_EPSILON, arrivalFraction));

  const rising = Math.min(1, boundedT / birth);
  const falling = Math.min(1, (1 - boundedT) / arrival);
  const base = Math.pow(Math.min(rising, falling), 0.7);

  // Arrival wake: a short bright overshoot as the packet reaches the ingress.
  const arrivalProximity = Math.max(0, 1 - Math.abs(boundedT - 1) / arrival);
  return Math.min(1.4, base + boundedWakeOvershoot(arrivalProximity, boundedWake));
}

function boundedWakeOvershoot(proximity: number, wake: number): number {
  return Math.pow(proximity, 2) * wake * 0.55;
}

export type RouteDashAttributes = {
  /** Ribbon-quad attributes, all length = vertexCount. */
  readonly corner: Float32Array;
  readonly start: Float32Array;
  readonly control: Float32Array;
  readonly end: Float32Array;
  readonly phase: Float32Array;
  readonly speed: Float32Array;
  readonly length: Float32Array;
  readonly width: Float32Array;
  readonly route: Float32Array;
  readonly group: Float32Array;
  readonly brightness: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  /** First vertex of each route class, plus a terminator. */
  readonly routeOffsets: Uint32Array;
  /**
   * Curves in packed order, and how many dashes each one contributed.
   *
   * The packing layout is this module's own concern, so the mapping a CPU
   * consumer needs to walk it is exposed here rather than re-derived by callers.
   */
  readonly orderedCurves: readonly RouteCurve[];
  readonly dashesPerRoute: number;
  readonly vertexCount: number;
  readonly dashCount: number;
};

const QUAD_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

/**
 * Packs one ribbon quad per dash, ordered by route class so a draw range can
 * reveal lanes progressively. Attributes are written once and never mutated;
 * motion comes entirely from uniform time in the material.
 */
export function deriveRouteDashAttributes(
  curves: readonly RouteCurve[],
  dashesPerRoute: number,
  seed = 17,
): RouteDashAttributes {
  const normalizedSeed = normalizeSeed(seed);
  const lanes = Math.max(0, Math.floor(Number.isFinite(dashesPerRoute) ? dashesPerRoute : 0));
  const ordered: RouteCurve[] = [];
  const routeOffsets = new Uint32Array(ROUTE_CLASS_ORDER.length + 1);

  for (const routeClass of ROUTE_CLASS_ORDER) {
    routeOffsets[ROUTE_CLASS_INDEX[routeClass]] = ordered.length * lanes * 4;
    for (const curve of curves) {
      if (curve.route === routeClass) ordered.push(curve);
    }
  }
  routeOffsets[ROUTE_CLASS_ORDER.length] = ordered.length * lanes * 4;

  const dashCount = ordered.length * lanes;
  const vertexCount = dashCount * 4;
  const IndexArray = vertexCount > 65_535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(dashCount * QUAD_INDICES.length);

  const attributes = {
    corner: new Float32Array(vertexCount * 2),
    start: new Float32Array(vertexCount * 3),
    control: new Float32Array(vertexCount * 3),
    end: new Float32Array(vertexCount * 3),
    phase: new Float32Array(vertexCount),
    speed: new Float32Array(vertexCount),
    length: new Float32Array(vertexCount),
    width: new Float32Array(vertexCount),
    route: new Float32Array(vertexCount),
    group: new Float32Array(vertexCount),
    brightness: new Float32Array(vertexCount),
  };

  let dashIndex = 0;
  for (const curve of ordered) {
    for (let lane = 0; lane < lanes; lane += 1) {
      const laneSeed = curve.id * 131 + lane * 17 + 7;
      const phase = hashUnit(normalizedSeed, laneSeed);
      const speed = 0.16 + hashUnit(normalizedSeed, laneSeed + 1) * 0.14;
      // Length is in curve progress, width in world units, and the ratio between
      // them is what the whole effect reads as: a packet has to be several times
      // longer than it is wide or it arrives as a speck sliding down a wire
      // instead of as the stretched dash the signal language is built on. Both
      // are sized against the channel it rides in — the packet is the brighter
      // core of the band rather than a bead sitting on a separate line, and the
      // arrival wake widens it further as it reaches the ingress.
      const length = 0.1 + hashUnit(normalizedSeed, laneSeed + 2) * 0.12;
      const width = 0.055 + hashUnit(normalizedSeed, laneSeed + 3) * 0.08;
      const brightness = 0.45 + hashUnit(normalizedSeed, laneSeed + 4) * 0.55;
      const routeIndex = ROUTE_CLASS_INDEX[curve.route];
      const groupIndex = Math.max(
        0,
        Math.min(MAX_ROUTE_GROUPS - 1, Math.floor(curve.group) || 0),
      );
      const rankBias = 1 - Math.min(0.4, curve.rank * 0.02);

      for (let cornerIndex = 0; cornerIndex < QUAD_CORNERS.length; cornerIndex += 1) {
        const vertex = dashIndex * 4 + cornerIndex;
        const corner = QUAD_CORNERS[cornerIndex]!;
        attributes.corner[vertex * 2] = corner[0];
        attributes.corner[vertex * 2 + 1] = corner[1];

        for (let axis = 0; axis < 3; axis += 1) {
          attributes.start[vertex * 3 + axis] = curve.start[axis]!;
          attributes.control[vertex * 3 + axis] = curve.control[axis]!;
          attributes.end[vertex * 3 + axis] = curve.end[axis]!;
        }

        attributes.phase[vertex] = phase;
        attributes.speed[vertex] = speed * rankBias;
        attributes.length[vertex] = length;
        attributes.width[vertex] = width;
        attributes.route[vertex] = routeIndex;
        attributes.group[vertex] = groupIndex;
        attributes.brightness[vertex] = brightness * rankBias;
      }

      const base = dashIndex * 4;
      for (let index = 0; index < QUAD_INDICES.length; index += 1) {
        indices[dashIndex * QUAD_INDICES.length + index] =
          base + QUAD_INDICES[index]!;
      }

      dashIndex += 1;
    }
  }

  return {
    ...attributes,
    indices,
    routeOffsets,
    orderedCurves: ordered,
    dashesPerRoute: lanes,
    vertexCount,
    dashCount,
  };
}

/** The curve a packed dash index belongs to. */
export function resolveDashCurve(
  attributes: Pick<RouteDashAttributes, 'orderedCurves' | 'dashesPerRoute'>,
  dashIndex: number,
): RouteCurve | undefined {
  const perRoute = Math.max(1, attributes.dashesPerRoute);
  const curveIndex = Math.floor(dashIndex / perRoute);
  if (!Number.isFinite(curveIndex) || curveIndex < 0) return undefined;
  return attributes.orderedCurves[curveIndex];
}

/**
 * Dashes per route for one backend and profile.
 *
 * WebGPU evaluates the field in the vertex shader, so density is nearly free and
 * scales with how many route classes the profile exposes. WebGL2 places every
 * dash on the CPU, so it stays a sparse channel carrying the same visual language
 * at lower density.
 *
 * Exported because telemetry must count what the field actually draws, and a
 * second copy of this formula would be a second, drifting answer.
 */
export function deriveDashesPerRoute(
  backend: 'webgpu' | 'webgl2',
  detail: number,
  lanes: number,
): number {
  const boundedDetail = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;
  const boundedLanes = Number.isFinite(lanes) ? Math.max(1, Math.round(lanes)) : 1;
  if (backend === 'webgpu') {
    return Math.max(2, Math.round(4 + boundedDetail * boundedLanes * 5));
  }
  return Math.max(1, Math.round(2 + boundedDetail * boundedLanes));
}

/**
 * Hard ceiling on the WebGL2 instanced field.
 *
 * WebGL2 repositions every dash on the CPU each frame, so its count is capped
 * rather than scaled. Shared with telemetry so the reported sample count matches
 * the instances actually submitted.
 */
export const WEBGL2_DASH_CEILING = 180;

/**
 * Draw range for the first `activeLaneCount` route classes. Idle exposes only
 * the primary lane; focus reveals the full connection.
 */
export function deriveRouteDashDrawRange(
  attributes: Pick<RouteDashAttributes, 'routeOffsets'>,
  activeLaneCount: number,
): { readonly start: number; readonly count: number } {
  const requested = Number.isFinite(activeLaneCount)
    ? Math.floor(activeLaneCount)
    : 0;
  const lanes = Math.max(
    0,
    Math.min(attributes.routeOffsets.length - 1, requested),
  );

  return { start: 0, count: attributes.routeOffsets[lanes] ?? 0 };
}

/**
 * Index-space draw range, which is what `BufferGeometry.setDrawRange` consumes on
 * an indexed geometry. Each dash is a four-vertex, six-index quad.
 */
export function deriveRouteDashIndexRange(
  attributes: Pick<RouteDashAttributes, 'routeOffsets'>,
  activeLaneCount: number,
): { readonly start: number; readonly count: number } {
  const vertices = deriveRouteDashDrawRange(attributes, activeLaneCount);
  return {
    start: (vertices.start / 4) * QUAD_INDICES.length,
    count: (vertices.count / 4) * QUAD_INDICES.length,
  };
}

/**
 * Live field state.
 *
 * Deliberately mutable: the scene owner writes into one instance every frame so
 * continuous scalars never cross a React boundary, and so the eased transition
 * out of focus costs no allocation.
 */
export type RouteFlowState = {
  /** Per-route-class weight, aligned with `ROUTE_CLASS_ORDER`. */
  laneWeights: number[];
  /** Per-route-group weight, packed into two vec4 uniforms. */
  groupWeights: number[];
  /** Curve-t units travelled per second. */
  advectionSpeed: number;
  compression: number;
  wake: number;
  /**
   * Unit direction the whole field leans toward, and how hard.
   *
   * This is the field deformation the GPU owns: a hover or focus does not
   * rebuild a single curve, it displaces every control point along one direction
   * so the interior visibly bends toward the targeted ingress.
   */
  bend: number[];
  bendAmount: number;
  /** 0 freezes the field entirely; used by reduced motion. */
  motionScale: number;
  reducedMotion: boolean;
};

/**
 * Packs route-group weights into the flat eight-slot buffer the material's two
 * vec4 uniforms read. Unlisted groups fall to `defaultWeight`, which is how the
 * non-target domains recede without the caller enumerating them.
 */
export function deriveRouteGroupWeights(
  entries: readonly { readonly group: number; readonly weight: number }[],
  defaultWeight = 0.08,
): Float32Array {
  const fallback = Number.isFinite(defaultWeight)
    ? Math.max(0, defaultWeight)
    : 0;
  const packed = new Float32Array(MAX_ROUTE_GROUPS).fill(fallback);

  for (const entry of entries) {
    const index = Math.floor(entry.group);
    if (!Number.isFinite(index) || index < 0 || index >= MAX_ROUTE_GROUPS) continue;
    packed[index] = Number.isFinite(entry.weight) ? Math.max(0, entry.weight) : 0;
  }

  return packed;
}

const STATIC_FLOW_STATE: RouteFlowState = {
  laneWeights: [0, 0, 0, 0],
  groupWeights: [0, 0, 0, 0, 0, 0, 0, 0],
  advectionSpeed: 0,
  compression: 0,
  wake: 0,
  bend: [0, 0, 0],
  bendAmount: 0,
  motionScale: 1,
  reducedMotion: false,
};

/**
 * Reduced motion keeps the route selection, compression shape and state
 * readability, but stops every dash in place at a representative phase.
 */
export function deriveStaticFlowState(
  overrides: Partial<RouteFlowState> = {},
): RouteFlowState {
  return { ...STATIC_FLOW_STATE, ...overrides, motionScale: 0, reducedMotion: true };
}

/** Dash cycle position for one dash at a given time, frozen-safe. */
export function deriveDashPhase(
  phase: number,
  speed: number,
  elapsedSeconds: number,
  motionScale: number,
): number {
  const frozen = !Number.isFinite(motionScale) || motionScale <= 0;
  const base = Number.isFinite(phase) ? phase : 0;
  if (frozen) {
    // A fixed representative phase keeps the still frame legible: dashes are
    // spread along the route rather than stacked at the source.
    return (base + 0.42) % 1;
  }

  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const safeSpeed = Number.isFinite(speed) ? speed : 0;
  return (base + elapsed * safeSpeed * motionScale) % 1;
}