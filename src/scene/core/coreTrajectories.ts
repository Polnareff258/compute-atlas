import type { CoreParameters } from './coreTypes';

export type CoreTrajectory = {
  readonly id: number;
  readonly points: readonly (readonly [number, number, number])[];
  readonly activationRank: number;
  readonly route: 'dormant' | 'local' | 'directional' | 'signal';
};

type Point = readonly [number, number, number];

const SAMPLE_COUNTS = [4, 6, 5, 7] as const;
const ROUTES = ['local', 'directional', 'signal', 'dormant'] as const;
const MAX_TRAJECTORIES = 24;

function hash(seed: number, index: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x45d9f3b)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function unit(seed: number, index: number): number {
  return hash(seed, index) / 0x100000000;
}

function safeBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(MAX_TRAJECTORIES, Math.floor(value));
}

function safeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : 17;
}

function add(first: Point, second: Point): Point {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function scale(point: Point, factor: number): Point {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function interpolateQuadratic(start: Point, control: Point, end: Point, progress: number): Point {
  const inverse = 1 - progress;

  return add(
    add(scale(start, inverse * inverse), scale(control, 2 * inverse * progress)),
    scale(end, progress * progress),
  );
}

function deriveEndpoints(index: number, seed: number): readonly [Point, Point] {
  const lane = index % 4;
  const layer = Math.floor(index / 4);
  const jitter = (offset: number, amplitude: number): number =>
    (unit(seed, index * 17 + offset) - 0.5) * amplitude;

  const start: Point = [
    -1.62 + lane * 0.57 + jitter(1, 0.22),
    -0.74 + (lane % 3) * 0.68 + jitter(2, 0.28) + layer * 0.06,
    lane % 2 === 0 ? -0.88 + jitter(3, 0.24) : 0.82 + jitter(3, 0.24),
  ];
  const end: Point = [
    1.48 - lane * 0.43 + jitter(4, 0.22) + layer * 0.04,
    0.72 - (lane % 3) * 0.55 + jitter(5, 0.3),
    lane % 2 === 0 ? 1.02 + jitter(6, 0.26) : -0.94 + jitter(6, 0.26),
  ];

  return [start, end];
}

function deriveControlPoint(start: Point, end: Point, index: number, seed: number): Point {
  const midpoint = scale(add(start, end), 0.5);
  const bend = (unit(seed, index * 23 + 7) - 0.5) * 1.15;
  const lift = 0.38 + unit(seed, index * 23 + 8) * 0.82;
  const depth = (unit(seed, index * 23 + 9) - 0.5) * 0.72;

  return [midpoint[0] + bend, midpoint[1] + lift, midpoint[2] + depth];
}

function samplePath(start: Point, control: Point, end: Point, sampleCount: number): readonly Point[] {
  return Array.from({ length: sampleCount }, (_, sampleIndex) =>
    interpolateQuadratic(start, control, end, sampleIndex / (sampleCount - 1)),
  );
}

/**
 * Produces deterministic partial paths for the V2 Compute Core.
 *
 * Each path begins and ends away from the nucleus and samples only one open
 * quadratic arc. The endpoint gap keeps these descriptors from reading as
 * closed orbital rings when later rendered as merged line geometry.
 */
export function deriveCoreTrajectories(
  parameters: Pick<CoreParameters, 'trajectoryBudget'>,
  seed = 17,
): readonly CoreTrajectory[] {
  const count = safeBudget(parameters.trajectoryBudget);
  const normalizedSeed = safeSeed(seed);

  return Array.from({ length: count }, (_, id): CoreTrajectory => {
    const [start, end] = deriveEndpoints(id, normalizedSeed);
    const control = deriveControlPoint(start, end, id, normalizedSeed);
    const sampleCount = SAMPLE_COUNTS[id % SAMPLE_COUNTS.length] ?? SAMPLE_COUNTS[0];
    const route = ROUTES[id % ROUTES.length] ?? 'local';

    return {
      id,
      points: samplePath(start, control, end, sampleCount),
      activationRank: id,
      route,
    };
  });
}
