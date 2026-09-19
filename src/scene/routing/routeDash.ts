import { hashUnit, normalizeSeed } from '../seedRandom';
import { MAX_ROUTE_GROUPS } from './routeContract';

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

/** The group ceiling is part of the routing contract, not of the dash maths. */
export { MAX_ROUTE_GROUPS } from './routeContract';

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

/**
 * The direction the whole field is authored against.
 *
 * Every band and every packet is a flat quad, so it only exists on screen if it
 * faces the viewer. The across-axis used to be `cross(tangent, worldUp)`, which
 * is *always horizontal* — and the camera looks along -Z, so each band was seen
 * exactly edge-on. That is why a channel 0.2 world units wide, thirty pixels at
 * this framing, resolved to the one-pixel scratches the entire routing field
 * read as, and why widening it changed nothing.
 *
 * It is a constant rather than the live camera direction because the camera
 * never rotates: it translates and dollies and keeps one presentation (see
 * `cameraController`), so a baked axis is exactly as correct as a per-frame one
 * and costs the CPU fallback nothing.
 */
export const ROUTE_FACING_AXIS: Vector = [0, 0, 1];

/**
 * How far a tangent must be off the view axis before the facing axis carries the
 * whole across-axis.
 *
 * A route running straight down the view axis has no screen-space width to give
 * — the cross product collapses — so it has to fall back to a second axis rather
 * than degenerate to a point. This is the top of that handover: below it the
 * fallback is mixed in, above it the facing axis is used alone.
 *
 * It is a *blend*, not a switch, and that is not a refinement. The two axes are a
 * quarter turn apart, so picking one or the other with a comparison tears the
 * ribbon at whatever tangent happens to sit on the threshold — which is where the
 * hooks and loops that made the hero look scribbled on came from. Shared with the
 * vertex shader, which blends between the same two axes over the same band.
 */
export const ROUTE_FACING_EPSILON = 0.2;

/**
 * How much of the fallback survives at the threshold.
 *
 * The handover has to be finished by the time the facing axis is genuinely
 * usable, so the blend starts from a degenerate tangent and reaches the facing
 * axis here.
 */
export const ROUTE_FACING_BLEND_FLOOR = 0.02;

/**
 * How wide a band each route class scatters its packets across, in world units.
 *
 * This is the whole of the volumetric weave. The field used to draw every packet
 * exactly on its curve, so a route was a line with dots on it however many dots
 * there were, and the only way to make traffic read as heavy was to draw more of
 * them. Scattering the packets of one route across a band instead turns that line
 * into a braid: many filaments travelling together, dense enough to accumulate
 * into a sheet under additive blending rather than resolving into separate marks.
 *
 * The classes differ because the things they stand for differ. `primary` is a
 * shared trunk carrying everything on its side of the graph, so it is a cable.
 * `secondary` is one domain's branch and is thinner. `signal` is the short
 * arrival at an ingress, which has to stay precise — an ingress that sprayed
 * would not read as a socket. `ambient` is the machine's own circulation, which
 * wants the least of all: it is the surface a braid is read *against*.
 */
export const ROUTE_CLASS_SPREAD: Readonly<Record<RouteClass, number>> =
  Object.freeze({
    primary: 0.085,
    secondary: 0.055,
    signal: 0.014,
    ambient: 0.035,
  });

/**
 * `ROUTE_CLASS_SPREAD` as four numbers in `ROUTE_CLASS_ORDER`.
 *
 * The vertex shader has no record type and no uniform array it wants to spend a
 * slot on, so it indexes the table the way it indexes every other per-class
 * quantity: a four-component constant dotted with the class basis. Kept derived
 * from the table rather than typed out again, so a class that is re-weighted
 * cannot be re-weighted on one backend only.
 */
export const ROUTE_CLASS_SPREAD_VECTOR: readonly [number, number, number, number] =
  Object.freeze([
    ROUTE_CLASS_SPREAD.primary,
    ROUTE_CLASS_SPREAD.secondary,
    ROUTE_CLASS_SPREAD.signal,
    ROUTE_CLASS_SPREAD.ambient,
  ] as const);

/**
 * How much of its band a packet occupies at a given point along its route.
 *
 * The band is not uniform, and the shape of it is the point. Both ends of every
 * curve in the scene are authored the same way round — progress 0 is the Core
 * end and progress 1 is the destination — so tightening at 0 and opening toward
 * 1 puts the compression zone exactly where the brief asks for it: many
 * filaments converging into one trunk as they approach the machine, and fanning
 * out into a sheet as they leave it. `ROUTE_SPREAD_OPENNESS_FLOOR` is what keeps
 * a packet near the Core from collapsing onto the centreline, which would put the
 * braid back to being a line at precisely the place it is most visible.
 */
export const ROUTE_SPREAD_OPENNESS_FLOOR = 0.15;

/**
 * How far the weave deploys as the field commits to a route.
 *
 * `compression` is reused rather than adding a second scalar, because it is
 * already the field's own statement of how committed it is: it is what bunches
 * packets in front of an ingress on hover and focus. A braid that takes its width
 * from the same number cannot disagree with the bunching it is carrying.
 */
export const ROUTE_SPREAD_COMMITMENT_FLOOR = 0.6;
export const ROUTE_SPREAD_COMMITMENT_GAIN = 0.8;

export function deriveDashSpread(
  route: RouteClass,
  progress: number,
  compression: number,
): number {
  const base = ROUTE_CLASS_SPREAD[route] ?? 0;
  const boundedProgress = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  const boundedCompression = Number.isFinite(compression)
    ? Math.min(1, Math.max(0, compression))
    : 0;
  const openness =
    ROUTE_SPREAD_OPENNESS_FLOOR +
    (1 - ROUTE_SPREAD_OPENNESS_FLOOR) * boundedProgress;
  const commitment =
    ROUTE_SPREAD_COMMITMENT_FLOOR +
    boundedCompression * ROUTE_SPREAD_COMMITMENT_GAIN;
  return base * openness * commitment;
}

/**
 * Where one packet's band offset comes from, in a form both backends can run.
 *
 * Two multipliers, not one, so the two axes get independent values: a band
 * scattered by a single hash would place every packet on a diagonal through its
 * own band and read as a stripe rather than as a braid. The multipliers are
 * irrational-looking primes for the same reason the rest of the field uses them —
 * they decorrelate from the phase's own value, so consecutive packets in a lane
 * do not land at consecutive offsets.
 */
export const ROUTE_SCATTER_ACROSS_FREQUENCY = 37.13;
export const ROUTE_SCATTER_THROUGH_FREQUENCY = 91.7;

/**
 * How thick the band is along the route's third axis, as a fraction of its width.
 *
 * Below 1 on purpose. A braid that is as deep as it is wide is a tube, and a tube
 * hides its own centre; the weave is meant to read as a sheet of filaments seen
 * slightly off-axis, where the near ones pass in front of the far ones.
 */
export const ROUTE_SCATTER_THROUGH_SCALE = 0.5;

/**
 * The two signed scatter values that place one packet inside its band.
 *
 * Derived from the packet's own `phase` rather than stored, which is what keeps
 * this a placement rule instead of another per-vertex channel: `phase` is already
 * hashed per packet and per lane, so two packets on one route never share an
 * offset, and one packet keeps its offset for its whole life — a packet that
 * wandered across its band while travelling would read as noise, not as flow.
 *
 * `across` places it laterally and `through` gives the band its thickness along
 * the route's third axis. Both are in [-1, 1).
 */
export function deriveDashScatter(phase: number): {
  readonly across: number;
  readonly through: number;
} {
  const bounded = Number.isFinite(phase) ? phase - Math.floor(phase) : 0;
  const across = fractional(bounded * ROUTE_SCATTER_ACROSS_FREQUENCY) * 2 - 1;
  const through = fractional(bounded * ROUTE_SCATTER_THROUGH_FREQUENCY) * 2 - 1;
  return { across, through };
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

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

/**
 * Stable across-axis for a ribbon quad: the direction the quad is widened in.
 *
 * Taken against the view axis so the quad faces the camera; a tangent parallel to
 * that axis has no width to project, so the world-up fallback is *mixed in* as
 * the facing axis degenerates rather than swapped for it. The two are a quarter
 * turn apart, and a comparison between them cuts whichever ribbon is sitting on
 * the threshold — the axis flips between two planes along the curve and the band
 * folds. Both backends blend over the same band, so a channel and its packets
 * cannot lie in different planes.
 */
export function deriveRouteAcross(
  tangent: Float32Array | number[],
  offset: number,
  target: Float32Array | number[],
  targetOffset = 0,
): void {
  const tx = tangent[offset]!;
  const ty = tangent[offset + 1]!;
  const tz = tangent[offset + 2]!;

  // Across the view axis, in the plane the camera can actually see.
  const primaryX = ty * ROUTE_FACING_AXIS[2] - tz * ROUTE_FACING_AXIS[1];
  const primaryY = tz * ROUTE_FACING_AXIS[0] - tx * ROUTE_FACING_AXIS[2];
  const primaryZ = tx * ROUTE_FACING_AXIS[1] - ty * ROUTE_FACING_AXIS[0];
  const primaryLength = Math.hypot(primaryX, primaryY, primaryZ);

  // Across world up: defined exactly where the first one collapses.
  const fallbackX = ty * UP[2] - tz * UP[1];
  const fallbackY = tz * UP[0] - tx * UP[2];
  const fallbackZ = tx * UP[1] - ty * UP[0];
  const fallbackLength = Math.hypot(fallbackX, fallbackY, fallbackZ);

  const faceX = primaryLength > TANGENT_EPSILON ? primaryX / primaryLength : 0;
  const faceY = primaryLength > TANGENT_EPSILON ? primaryY / primaryLength : 0;
  const faceZ = primaryLength > TANGENT_EPSILON ? primaryZ / primaryLength : 0;

  const backX = fallbackLength > TANGENT_EPSILON ? fallbackX / fallbackLength : 0;
  const backY = fallbackLength > TANGENT_EPSILON ? fallbackY / fallbackLength : 0;
  const backZ = fallbackLength > TANGENT_EPSILON ? fallbackZ / fallbackLength : 1;

  // 0 at a degenerate tangent, 1 once the facing axis is fully usable.
  const raw =
    (primaryLength - ROUTE_FACING_BLEND_FLOOR) /
    (ROUTE_FACING_EPSILON - ROUTE_FACING_BLEND_FLOOR);
  const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const blend = clamped * clamped * (3 - 2 * clamped);

  // The two unit vectors are orthogonal wherever both are defined, so the mix is
  // never the zero vector: its length runs from 1 down to 1/sqrt(2).
  const ax = backX + (faceX - backX) * blend;
  const ay = backY + (faceY - backY) * blend;
  const az = backZ + (faceZ - backZ) * blend;
  const length = Math.hypot(ax, ay, az);

  if (!(length > TANGENT_EPSILON)) {
    target[targetOffset] = 1;
    target[targetOffset + 1] = 0;
    target[targetOffset + 2] = 0;
    return;
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

/**
 * Below this combined lane-and-group weight a route is not participating, and
 * its packets are removed rather than dimmed.
 *
 * Dimming alone was not enough at additive blending. A route receded to a
 * twentieth of its brightness still hazed the frame with every packet it owned,
 * so "the other domains recede" arrived as "every route is faintly on" — and a
 * field where everything is faintly on has no subject. A floor makes receding
 * mean leaving.
 */
export const ROUTE_VISIBILITY_FLOOR = 0.12;

/**
 * Route weight → how much of the route survives, 0 .. 1.
 *
 * The square root matters. A plain linear ramp reads 0.34 — the weight every
 * idle domain carries — as a fifth of full, so every participating route in the
 * frame is dimmed to a fifth at once and the field disappears. This is a
 * presence curve, not a brightness curve: a route that is participating should
 * read at close to full strength, and only a route that is leaving should
 * vanish. The root keeps the floor and the shape while lifting the middle.
 *
 * Both ends are computed as `sqrt` — `Math.sqrt` here, `sqrt` in the shader —
 * because the two have to agree at the threshold, and a curve only one of them
 * can express is how they start disagreeing again.
 */
export function deriveRouteVisibility(routeWeight: number): number {
  const bounded = Number.isFinite(routeWeight) ? Math.max(0, routeWeight) : 0;
  if (bounded <= ROUTE_VISIBILITY_FLOOR) return 0;
  return Math.sqrt(
    Math.min(1, (bounded - ROUTE_VISIBILITY_FLOOR) / (1 - ROUTE_VISIBILITY_FLOOR)),
  );
}

/**
 * How much of the continuous channel survives underneath the packets.
 *
 * The channel exists to say "the route runs here", not to be the route. At full
 * strength it was the first thing the eye read, which is most of what made the
 * field look like glowing pipes that happened to have packets on them.
 */
export const RIBBON_CHANNEL_GAIN = 0.28;

/**
 * One packet's contribution, on whichever backend is drawing it.
 *
 * The visibility cull lives here rather than at either call site so a receded
 * route cannot be removed on the GPU and merely dimmed on the CPU. The vertex
 * shader reproduces this arithmetic exactly; `routeDashMaterial`'s floor
 * constant is the same number.
 */
export function deriveRouteDashIntensity(
  envelope: number,
  brightness: number,
  routeWeight: number,
  wakeBoost = 1,
): number {
  const amplitude = Number.isFinite(brightness) ? Math.max(0, brightness) : 0;
  const boost = Number.isFinite(wakeBoost) ? Math.max(0, wakeBoost) : 0;

  return deriveRouteVisibility(routeWeight) * envelope * amplitude * boost;
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
  /** Packets packed for each entry of `orderedCurves`, in the same order. */
  readonly orderedDashCounts: readonly number[];
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
 *
 * How many dashes each curve gets is decided per curve, from its own world
 * length; see `deriveCurveDashCounts`.
 */
export function deriveRouteDashAttributes(
  curves: readonly RouteCurve[],
  density: number,
  seed = 17,
  capacity?: number,
): RouteDashAttributes {
  const normalizedSeed = normalizeSeed(seed);
  const counts = deriveCurveDashCounts(curves, density, capacity);
  const buckets = ROUTE_CLASS_ORDER.map(() => [] as { curve: RouteCurve; count: number }[]);
  curves.forEach((curve, index) => {
    buckets[ROUTE_CLASS_INDEX[curve.route]]!.push({
      curve,
      count: counts[index] ?? 0,
    });
  });

  const ordered: RouteCurve[] = [];
  const orderedCounts: number[] = [];
  const routeOffsets = new Uint32Array(ROUTE_CLASS_ORDER.length + 1);
  let vertexCount = 0;

  for (const routeClass of ROUTE_CLASS_ORDER) {
    routeOffsets[ROUTE_CLASS_INDEX[routeClass]] = vertexCount;
    for (const entry of buckets[ROUTE_CLASS_INDEX[routeClass]]!) {
      ordered.push(entry.curve);
      orderedCounts.push(entry.count);
      vertexCount += entry.count * 4;
    }
  }
  routeOffsets[ROUTE_CLASS_ORDER.length] = vertexCount;

  const dashCount = vertexCount / 4;
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
  for (let curveIndex = 0; curveIndex < ordered.length; curveIndex += 1) {
    const curve = ordered[curveIndex]!;
    const packets = orderedCounts[curveIndex] ?? 0;
    // Length is in curve progress, width in world units. Progress is the wrong
    // unit for a packet's size: one curve is a two-and-a-half unit trunk and the
    // next is an eight-tenths loop inside the Core, so a fixed slice of progress
    // is a fifteen-pixel streak on one and a five-pixel blob on the other — which
    // is exactly what a Core full of blobs and a field of thin lines was. The
    // size is fixed in world units here and divided by the curve's own length, so
    // a packet is the same streak wherever it runs.
    const curveLength = deriveRouteCurveLength(curve);
    const packetLength = Math.min(
      ROUTE_PACKET_LENGTH,
      curveLength / PACKET_LENGTH_CURVE_SHARE,
    );

    for (let lane = 0; lane < packets; lane += 1) {
      const laneSeed = curve.id * 131 + lane * 17 + 7;
      const phase = hashUnit(normalizedSeed, laneSeed);
      const speed = 0.16 + hashUnit(normalizedSeed, laneSeed + 1) * 0.14;
      // Sizes are set from the framing rather than from taste. At the idle
      // distance a world unit is roughly 160 pixels on a 1920 frame, so this
      // lands at fourteen to twenty pixels long and three to five wide: long
      // enough that a packet reads as a streak with a direction, short enough
      // that the eye stops resolving single packets and starts reading the
      // field's density instead.
      const length =
        (packetLength * (0.8 + hashUnit(normalizedSeed, laneSeed + 2) * 0.5)) /
        curveLength;
      const width = 0.016 + hashUnit(normalizedSeed, laneSeed + 3) * 0.014;
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
    orderedDashCounts: orderedCounts,
    vertexCount,
    dashCount,
  };
}

/**
 * The curve a packed dash index belongs to.
 *
 * The walk is a prefix sum over the per-curve counts rather than a division,
 * because the counts differ: the packing is still contiguous per curve, so the
 * curve owning a dash index is the first one whose running total passes it.
 */
export function resolveDashCurve(
  attributes: Pick<RouteDashAttributes, 'orderedCurves' | 'orderedDashCounts'>,
  dashIndex: number,
): RouteCurve | undefined {
  if (!Number.isFinite(dashIndex) || dashIndex < 0) return undefined;

  let running = 0;
  for (let index = 0; index < attributes.orderedDashCounts.length; index += 1) {
    running += attributes.orderedDashCounts[index] ?? 0;
    if (dashIndex < running) return attributes.orderedCurves[index];
  }

  return undefined;
}

/** Packet length in world units. See the sizing note in the packer. */
export const ROUTE_PACKET_LENGTH = 0.1;

/**
 * A route with almost no length still gets a mark, or it is not a route.
 *
 * The Core's shortest runs — an ingress reach, a cross-link — are a sixth of a
 * world unit long, and a per-unit-length density alone would round them to one
 * packet or none. A route the field visits once is a dot, and a dot is not a
 * direction.
 *
 * Deliberately one, and not the three this used to be. A count floor is a floor
 * on *coverage* as much as on count: the reach is short, so its packet is
 * already capped to a third of it, and three of those light the reach end to
 * end. A saturated reach is not a sparse one; it renders as a solid bar, and a
 * bent one renders as the white hook this constant was raising over the hull.
 * Short runs are supposed to be the *sparsest* part of the field — the density
 * is per world unit, so a short route carrying less ink than a trunk is the
 * model working, not a route that has gone dark.
 */
const MIN_PACKETS_PER_CURVE = 1;

/**
 * The largest share of its own route a single packet may cover.
 *
 * The cap that keeps a mark a mark. The Core's ingress reaches are a sixth of a
 * world unit long and carry the same nominal packet as a two-and-a-half unit
 * trunk, so without this the packet overhung both ends of its own route and the
 * reach rendered as a white hook laid across the hull.
 */
const PACKET_LENGTH_CURVE_SHARE = 3;

/**
 * World length of a quadratic route curve.
 *
 * The average of the control polygon and the chord, which is exact for a straight
 * curve and within a couple of percent for the arcs a route actually is.
 * Precision is not the point: this decides how many packets a route is worth, and
 * being close to the arc length is all that buys.
 */
export function deriveRouteCurveLength(curve: RouteCurve): number {
  const { start, control, end } = curve;
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const polygon =
    Math.hypot(control[0] - start[0], control[1] - start[1], control[2] - start[2]) +
    Math.hypot(end[0] - control[0], end[1] - control[1], end[2] - control[2]);
  const length = (chord + polygon) * 0.5;

  return Number.isFinite(length) && length > 0.0001 ? length : 0.0001;
}

/**
 * Packets per world unit of route, for one implementation and profile.
 *
 * Per *unit of route*, not per route, and that is the whole point of the number.
 * A count per curve makes ink proportional to the count, so a two-and-a-half unit
 * trunk and an eight-tenths loop inside the Core carried identical coverage — and
 * coverage is what a route reads as. The Core's short runs saturated into solid
 * bright hooks while the trunks thinned into wire, which is the opposite of the
 * density structure a flowfield is supposed to have, and nothing in the field
 * said so.
 *
 * Measured per unit of length the structure comes out by itself: the Core is
 * small and its circulation is long, so the same linear density is a much higher
 * density *in the frame* there, and the long routes between domains read as
 * streams. No special case is needed to make the Core the dense end of the field.
 *
 * It takes whether the field is advected, not which backend is running. Those
 * were the same question until the profile's `coreAdvection` flag turned out to
 * be consumed by nothing and every WebGPU tier took the same path — the flag now
 * selects the implementation, so density has to follow the implementation rather
 * than the backend, or SAFE on WebGPU would pack the GPU field's density into the
 * CPU fallback.
 *
 * Exported because telemetry must count what the field actually draws, and a
 * second copy of this formula would be a second, drifting answer.
 */
export function deriveRouteDashDensity(advected: boolean, detail: number): number {
  const boundedDetail = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;

  // An advected field evaluates every packet in the vertex shader, so its density
  // is chosen for the read: about one and a half packet-lengths of ink per unit
  // of route at full detail, which is a stream with packets running over each
  // other rather than a dotted line with the route's own channel showing through
  // the gaps. Below about one, the field reads as a dashed wire — which is what a
  // count *per curve* produced, because a count per curve is a coverage of
  // three and a half on one route and a fifth on the next.
  //
  // The instanced fallback repositions each packet on the CPU every frame, so it
  // carries the same language at a bit over a third of the density: enough to
  // read a route's direction and to see the field respond, not enough to be the
  // same field. That difference is the point of the backend.
  return advected ? 2 + boundedDetail * 11 : 1 + boundedDetail * 4;
}

/**
 * Packets per curve, each proportional to its own world length.
 *
 * Returns one count per curve in the order given — not in packing order — so a
 * caller that only needs the counts does not have to reproduce the class-major
 * packing to read them. The packer and telemetry both go through here, which is
 * what keeps the reported count equal to the drawn one by construction.
 *
 * `capacity` bounds the *whole field*, which is how the CPU fallback's ceiling is
 * spent. Scaling every curve by one factor keeps the field's shape — which routes
 * are dense and which are sparse — where truncating a packed order cut the tail
 * routes off entirely, and spending the ceiling per curve instead flattened every
 * route to the same handful of packets. Neither of those is a lower-density
 * fallback; this is.
 */
export function deriveCurveDashCounts(
  curves: readonly RouteCurve[],
  density: number,
  capacity?: number,
): number[] {
  const perUnit = Number.isFinite(density) ? Math.max(0, density) : 0;
  // Zero density means the field is off, not that every route gets its minimum.
  // The floor below is a readability guarantee for a field that exists.
  const counts =
    perUnit <= 0
      ? curves.map(() => 0)
      : curves.map((curve) =>
          Math.max(MIN_PACKETS_PER_CURVE, Math.round(perUnit * deriveRouteCurveLength(curve))),
        );

  const budget =
    capacity === undefined || !Number.isFinite(capacity)
      ? Infinity
      : Math.max(0, Math.floor(capacity));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= budget || total === 0) return counts;

  const scale = budget / total;
  return counts.map((count) => Math.max(1, Math.floor(count * scale)));
}

/**
 * Hard ceiling on the WebGL2 instanced field.
 *
 * The ceiling is a budget for the whole field rather than for one route (see
 * `deriveCurveDashCounts`), and it is generous because the floor is what matters:
 * a cap so low that the density has to be flattened to meet it stops being a
 * sparser field and becomes a different one. 360 is a trivial per-frame cost — it
 * is one matrix composition per packet — and the field's real density on this
 * backend lands well under it, so the ceiling is a guard rather than a governor.
 */
export const WEBGL2_DASH_CEILING = 360;

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