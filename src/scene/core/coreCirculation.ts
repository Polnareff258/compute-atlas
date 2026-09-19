import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import type { RouteCurve } from '../routing/routeDash';
import { CORE_ROUTE_GROUP } from '../routing/graphRoutes';
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
 */
export type CoreCirculation = {
  readonly curves: readonly RouteCurve[];
};

/** Detail gates, matching the structure's own tiers. */
const CROSSLINK_DETAIL = 0.5;
const LAYER_DETAIL = 0.72;

const SPINE_STREAMS = 3;
const SPINE_OVERSHOOT = 1.14;

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
  const streamCount = detail >= LAYER_DETAIL ? SPINE_STREAMS : 1;
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
      id: 10 + stream,
      rank: stream,
      route: stream === 0 ? 'primary' : 'secondary',
      group: CORE_ROUTE_GROUP,
      start,
      control,
      end,
    });
  }

  return curves;
}

/**
 * Links between the cut halves of the processing volume and the secondary
 * assemblies: the interior topology that makes the mass look computed-in rather
 * than hollow.
 */
function crossLinks(structure: CoreStructure, seed: number): RouteCurve[] {
  const anchors = structure.members.filter(
    (member): member is CoreStructureForm => member.shape === 'volume',
  );
  const curves: RouteCurve[] = [];
  const voidPoint = add(structure.centroid, [0.02, 0.06, -0.2]);

  anchors.forEach((anchor, index) => {
    const from: Vector = anchor.position;
    const bow = hashSigned(seed, 2200 + index) * 0.24;
    curves.push({
      id: 40 + index,
      rank: 3 + index,
      route: 'secondary',
      group: CORE_ROUTE_GROUP,
      start: from,
      control: add(
        [
          (from[0] + voidPoint[0]) * 0.5,
          (from[1] + voidPoint[1]) * 0.5,
          (from[2] + voidPoint[2]) * 0.5,
        ],
        [0, 1, 0],
        bow,
      ),
      end: voidPoint,
    });
  });

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
    const inner = add(port.position, inward, 0.42 + hashUnit(seed, 2300 + index) * 0.2);

    return {
      id: 60 + index,
      rank: 8 + index,
      route: 'signal',
      group: CORE_ROUTE_GROUP,
      start: mouth,
      control: add(mouth, inward, 0.2),
      end: add(inner, [0, 1, 0], hashSigned(seed, 2310 + index) * 0.14),
    };
  });
}

/**
 * Shallow sweeps that run across the layered membranes.
 *
 * These sit at the front of the mass so the surface reads as disturbed by the
 * flow passing beneath it, rather than as a static panel.
 */
function membraneSweeps(structure: CoreStructure, seed: number): RouteCurve[] {
  const membranes = structure.members.filter(
    (member): member is CoreStructureForm => member.shape === 'membrane',
  );
  return membranes.slice(0, 2).map((membrane, index) => {
    const half: Vector = [membrane.scale[0] * 0.5, membrane.scale[1] * 0.5, 0];
    const center: Vector = membrane.position;
    const lift = hashSigned(seed, 2400 + index) * 0.05;

    return {
      id: 80 + index,
      rank: 12 + index,
      route: 'ambient',
      group: CORE_ROUTE_GROUP,
      start: [center[0] - half[0], center[1] - half[1] * 0.4, center[2] + lift],
      control: [center[0], center[1] + half[1] * 0.5, center[2] + lift * 2],
      end: [center[0] + half[0], center[1] - half[1] * 0.4, center[2] + lift],
    };
  });
}

/**
 * Deterministic internal circulation for the hero.
 *
 * Writes exactly one route group — the Core's own — because the Graph's groups
 * are packed into the same uniform set and the Core must not be able to dim a
 * domain's branch by accident.
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

  if (bounded >= LAYER_DETAIL) {
    curves.push(...membraneSweeps(structure, normalizedSeed));
  }

  return { curves };
}