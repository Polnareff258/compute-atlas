import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import type { RouteCurve } from '../routing/routeDash';
import { CORE_ROUTE_GROUP } from '../routing/routeContract';
import type { CoreStructure, CoreStructureForm } from './coreStructure';

type Vector = readonly [number, number, number];

/**
 * The Core's own internal circulation, expressed in the scene's one signal
 * language.
 *
 * A Core that emitted its own point cloud would need its own shader, its own
 * motion rules and its own brightness envelope, and the result would read as a
 * separate effect sitting inside the hero. Emitting route curves instead means
 * the Core's interior and the Graph routes are literally the same kind of
 * object, drawn by the same field.
 *
 * What that sharing costs is a discipline this file got wrong once. The same
 * field means the same brightness for the same route class, and the same
 * geometry for the same curve — so a curve authored to run a long way outside
 * the hull is drawn exactly as brightly as a Graph route crossing open space,
 * and it reads as a luminous doodle hanging beside the machine rather than as
 * flow inside it. Two rules follow, and both are load-bearing:
 *
 *   - **Every run stays inside the mass.** The streams are clamped to the hull
 *     and the port runs are short enough to be a socket's glow rather than a
 *     cable. There is nothing to occlude a curve that leaves the body, and the
 *     field has no depth cue to fall back on.
 *   - **Nothing internal uses the `signal` class.** `signal` is the language's
 *     brightest and it belongs to a route that is actually carrying something
 *     somewhere. Used inside the hero it makes the Core look scribbled on. The
 *     interior runs `primary` and `ambient`.
 */
export type CoreCirculation = {
  readonly curves: readonly RouteCurve[];
};

/** Detail gates, matching the structure's own tiers. */
const CROSSLINK_DETAIL = 0.5;

/**
 * The Core's route ids are banded rather than numbered from a shared counter.
 *
 * Every route in the scene ends up in one uniform set keyed by id, so two
 * generators that both start counting near each other are one growth spurt away
 * from a collision. That is not hypothetical: the crosslinks used to run 40..52
 * and the ingress runs 60..66, and when the aperture was rebuilt with twice the
 * interior the crosslinks reached 64 and five ids quietly became shared —
 * which meant five streams drawn with another route's brightness. The bands are
 * named and separated here so the next generator added has somewhere to go, and
 * the Graph's own routes start at 100.
 */
const SPINE_ID_BASE = 10;
const CROSSLINK_ID_BASE = 40;
const INGRESS_ID_BASE = 70;

/**
 * How many links the interior circuit is allowed.
 *
 * The loop is capped because its length is a property of how many small parts
 * the aperture happens to contain, and the aperture's contents are a quality
 * setting. Left uncapped, ULTRA would draw a denser circuit than HIGH for no
 * reason the machine can express — the parts got smaller, the wiring did not
 * get longer.
 */
const MAX_CROSSLINKS = 10;

const SPINE_STREAMS = 3;
/**
 * How far a stream runs past the centroid along the spine.
 *
 * It used to be 1.14, roughly the length of the body, so every stream began and
 * ended in open space on either side of the hero. The overshoot is still here —
 * a stream that stops exactly at the hull looks capped — but it is small enough
 * to be read as the flow passing under the shell rather than as a rail.
 */
const SPINE_OVERSHOOT = 0.78;

/** How far a port run reaches into the body. Short: a socket, not a cable. */
const INGRESS_REACH_MIN = 0.14;
const INGRESS_REACH_MAX = 0.24;

function add(a: Vector, b: Vector, scale = 1): Vector {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function unit(vector: Vector): Vector {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-6) return [0, 0, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function boundedDetail(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Streams that run the length of the diagonal spine.
 *
 * Each is offset onto its own lane in the plane perpendicular to the spine, so
 * the interior reads as layered flow rather than one repeated line. The spine
 * overshoots the hull slightly at both ends, which is what makes the volume
 * look like it is being passed through rather than merely filled.
 */
function spineStreams(structure: CoreStructure, seed: number, detail: number): RouteCurve[] {
  const axis = unit(structure.spineAxis);
  const across = unit(cross(axis, [0, 1, 0]));
  const through = unit(cross(axis, across));
  const streamCount = detail >= CROSSLINK_DETAIL ? SPINE_STREAMS : 1;
  const curves: RouteCurve[] = [];

  for (let stream = 0; stream < streamCount; stream += 1) {
    const lane = stream - (streamCount - 1) * 0.5;
    const lateral = 0.1 + hashUnit(seed, 2100 + stream) * 0.12;
    const depth = hashSigned(seed, 2110 + stream) * 0.16;
    const bow = hashSigned(seed, 2120 + stream) * 0.2;

    const start = add(
      add(structure.centroid, across, lane * lateral),
      through,
      depth - SPINE_OVERSHOOT * 0.5,
    );
    const end = add(
      add(add(structure.centroid, axis, SPINE_OVERSHOOT), across, lane * lateral),
      through,
      depth + SPINE_OVERSHOOT * 0.5,
    );
    // The bow is what stops the stream from being a straight rail: it curves
    // through the void instead of appearing to be a drawn axis line.
    const control = add(
      add(
        add(structure.centroid, axis, SPINE_OVERSHOOT * 0.42),
        across,
        lane * lateral * 0.6,
      ),
      through,
      bow,
    );

    curves.push({
      id: SPINE_ID_BASE + stream,
      rank: stream,
      // Only the centre stream is a primary channel. The two on either side are
      // the body's background flow and sit a class down, so the interior has a
      // reading order instead of three equally loud lines.
      route: stream === 0 ? 'primary' : 'ambient',
      group: CORE_ROUTE_GROUP,
      start,
      control,
      end,
    });
  }

  return curves;
}

/**
 * A single circulation loop through the aperture's own volumes.
 *
 * This used to be a hub: one curve from every interior volume to a point at the
 * centre of the mass. At thirteen volumes that was already a fainter version of
 * the wrong idea, and at twenty-five — which is what a dense aperture costs —
 * it became a white starburst, the single most diagram-like thing in the frame
 * and the exact opposite of the flow it was standing in for. Nothing about a
 * machine's interior looks like everything radiating from one node.
 *
 * A loop is both truer and cheaper. The interior volumes are sorted by angle
 * around the aperture's own centre and each is joined to the next, so the
 * result is a circuit that visits the machine's working parts and closes on
 * itself: fewer curves than the hub had, drawn where the parts actually are,
 * and with no point that is brighter than its neighbours.
 *
 * The floor and the body's own plates are excluded by size, because a link that
 * runs to the back of the recess is a line drawn across the opening.
 */
function crossLinks(structure: CoreStructure, seed: number): RouteCurve[] {
  const aperture: Vector = [0.02, 0.02, 0];
  const extent = structure.bounds[0];
  const anchors = structure.members
    .filter((member): member is CoreStructureForm => member.shape === 'volume')
    .filter((member) => {
      const [x, y] = member.position;
      const width = Math.max(member.scale[0], member.scale[1]);
      // Interior volumes are small and near the middle; the aperture floor is
      // body-wide and the assembly plates sit outside the ring.
      return (
        width < extent * 0.3 &&
        Math.hypot(x - aperture[0], y - aperture[1]) < extent * 0.3
      );
    })
    .sort((left, right) => {
      const leftAngle = Math.atan2(
        left.position[1] - aperture[1],
        left.position[0] - aperture[0],
      );
      const rightAngle = Math.atan2(
        right.position[1] - aperture[1],
        right.position[0] - aperture[0],
      );
      if (leftAngle === rightAngle) return left.rank - right.rank;
      return leftAngle - rightAngle;
    });

  const curves: RouteCurve[] = [];
  const links = Math.min(anchors.length, MAX_CROSSLINKS);

  for (let index = 0; index < links; index += 1) {
    const from = anchors[index]!;
    const to = anchors[(index + 1) % links]!;
    if (to === from) continue;

    const bow = hashSigned(seed, 2200 + index) * 0.06;
    curves.push({
      id: CROSSLINK_ID_BASE + index,
      rank: 3 + index,
      route: 'ambient',
      group: CORE_ROUTE_GROUP,
      start: from.position,
      // The bow is small on purpose: this link runs between two parts inside
      // the recess, and a large bow lifts its midpoint out through the hull
      // where the field will happily draw it in mid-air.
      control: add(
        [
          (from.position[0] + to.position[0]) * 0.5,
          (from.position[1] + to.position[1]) * 0.5,
          (from.position[2] + to.position[2]) * 0.5,
        ],
        [0, 1, 0],
        bow,
      ),
      end: to.position,
    });
  }

  return curves;
}

/**
 * Short ingress runs from each port into the interior.
 *
 * These are what make a port read as connected to something: the routing field
 * leaves the hull from here, and the interior answers it.
 */
function portIngress(structure: CoreStructure, seed: number): RouteCurve[] {
  return structure.ports.map((port, index) => {
    const inward: Vector = [-port.direction[0], -port.direction[1], -port.direction[2]];
    const mouth = add(port.position, inward, 0.02);
    const reach =
      INGRESS_REACH_MIN +
      hashUnit(seed, 2300 + index) * (INGRESS_REACH_MAX - INGRESS_REACH_MIN);
    const inner = add(port.position, inward, reach);

    return {
      id: INGRESS_ID_BASE + index,
      rank: 8 + index,
      // A port run is the socket answering the route, not the route. It keeps
      // the `signal` class because the test of a live port is exactly that it is
      // brighter than the shell around it — but it is short enough now that it
      // reads as a lit socket rather than as a line drawn in the air beside the
      // Core, which is what it was at half a unit long.
      route: 'signal',
      group: CORE_ROUTE_GROUP,
      start: mouth,
      control: add(mouth, inward, reach * 0.4),
      end: add(inner, [0, 1, 0], hashSigned(seed, 2310 + index) * 0.08),
    };
  });
}

/**
 * Deterministic internal circulation for the hero.
 *
 * Writes exactly one route group — the Core's own — because the Graph's groups
 * are packed into the same uniform set and the Core must not be able to dim a
 * domain's branch by accident.
 *
 * There is no membrane sweep here any more. The membranes used to carry one
 * shallow arc each, authored to the membrane's own width, and the widest
 * membrane is the full width of the body — so the "sweep" was a luminous arc
 * spanning the entire hero, drawn at the front of the mass where nothing
 * occludes it. It was the single largest piece of geometry in the Core that was
 * not the Core. The membranes already answer state through their own openness,
 * which is the response they were given a fade curve for.
 */
export function deriveCoreCirculation(
  structure: CoreStructure,
  detail: number,
  seed = 17,
): CoreCirculation {
  const normalizedSeed = normalizeSeed(seed);
  const bounded = boundedDetail(detail);

  const curves: RouteCurve[] = [
    ...spineStreams(structure, normalizedSeed, bounded),
    ...portIngress(structure, normalizedSeed),
  ];

  if (bounded >= CROSSLINK_DETAIL) {
    curves.push(...crossLinks(structure, normalizedSeed));
  }

  return { curves };
}