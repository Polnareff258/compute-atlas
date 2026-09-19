import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import type { RouteClass, RouteCurve } from '../routing/routeDash';
import type { DomainEnvironment, DomainEnvironmentKind } from './domainEnvironments';

type Vector = readonly [number, number, number];

/** Curve ids from the Core's circulation and the Graph's routing own 0..999. */
const DOMAIN_ID_BASE = 1000;
/** No builder emits more runs than this, so the per-domain id blocks cannot meet. */
const DOMAIN_ID_STRIDE = 8;

/**
 * Stable id offset for one domain.
 *
 * Curve ids seed the packer's per-lane jitter, so two domains sharing an offset
 * would draw their interiors with identical phase — a visible correlation
 * between sub-environments that are supposed to behave differently. Hashing the
 * node id makes the offset follow the domain's identity rather than the length
 * of its name, which is what the previous length-derived constant accidentally
 * tied together for `graphics` and `research`.
 */
function idBaseFor(nodeId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash = Math.imul(hash ^ nodeId.charCodeAt(index), 0x01000193);
  }
  return DOMAIN_ID_BASE + (hash >>> 0) % 100_000 * DOMAIN_ID_STRIDE;
}

/**
 * A domain's own internal flow, in the scene's one signal language.
 *
 * Each domain's circuits describe the computation it is named for — a buffer
 * filling, a framebuffer being swept, a branch converging on a chamber — so the
 * field inside a domain reads as that domain working rather than as generic
 * motion placed near it. They carry the domain's own route group, which is what
 * makes hover and focus lift its interior while the other domains recede.
 */
type LocalRun = {
  readonly start: Vector;
  readonly control: Vector;
  readonly end: Vector;
  readonly route: RouteClass;
  readonly rank: number;
};

function add(anchor: Vector, local: Vector): Vector {
  return [anchor[0] + local[0], anchor[1] + local[1], anchor[2] + local[2]];
}

/**
 * A run whose control point is bowed away from the straight line, so the circuit
 * curves through the architecture instead of looking like a drawn rail.
 */
function run(
  start: Vector,
  end: Vector,
  route: RouteClass,
  rank: number,
  bow: number,
  bowLift = 0,
): LocalRun {
  return {
    start,
    end,
    route,
    rank,
    control: [
      (start[0] + end[0]) * 0.5 + bow,
      (start[1] + end[1]) * 0.5 + bowLift,
      (start[2] + end[2]) * 0.5 + bow * 0.6,
    ],
  };
}

function packetBufferRuns(scale: number, seed: number): LocalRun[] {
  const s = scale;
  const fork: Vector = [0, -0.04 * s, 0];
  const trunk: Vector = [0, -0.6 * s, 0];
  const slats: readonly Vector[] = [
    [-0.02 * s, 0.28 * s, 0.02 * s],
    [0.01 * s, 0.42 * s, 0],
    [-0.01 * s, 0.56 * s, -0.02 * s],
  ];

  return [
    run(trunk, fork, 'primary', 0, 0.02 * s),
    ...slats.map((slat, index) =>
      run(fork, slat, 'secondary', 1 + index, hashSigned(seed, 5100 + index) * 0.06 * s),
    ),
    // The read run leaves the buffer for the port: the packet actually leaving.
    run(slats[2]!, [0.34 * s, 0.64 * s, 0.08 * s], 'signal', 5, 0.05 * s),
  ];
}

function framebufferRuns(scale: number, seed: number): LocalRun[] {
  const s = scale;
  const layers: readonly number[] = [0.16, 0.02, -0.12];

  return [
    ...layers.map((y, index) =>
      run(
        [-0.52 * s, y * s, (0.2 - index * 0.1) * s],
        [0.52 * s, y * s, (0.18 - index * 0.1) * s],
        'ambient',
        0 + index,
        hashSigned(seed, 5200 + index) * 0.04 * s,
        0.06 * s,
      ),
    ),
    // One scan line crosses the stack at the scan plane's own angle: the
    // interference that makes the layers read as a volume being read out.
    run(
      [-0.44 * s, 0.38 * s, -0.12 * s],
      [0.44 * s, -0.34 * s, 0.12 * s],
      'signal',
      4,
      0.02 * s,
    ),
  ];
}

function decisionChamberRuns(scale: number, seed: number): LocalRun[] {
  const s = scale;
  const chamber: Vector = [0, -0.26 * s, 0];

  return [
    run([-0.5 * s, 0.44 * s, 0.08 * s], chamber, 'secondary', 0, hashSigned(seed, 5300) * 0.05 * s),
    run([0.5 * s, 0.42 * s, -0.08 * s], chamber, 'secondary', 1, hashSigned(seed, 5301) * 0.05 * s),
    // The two verdict runs are the decision leaving the chamber.
    run(chamber, [-0.42 * s, -0.52 * s, 0.1 * s], 'signal', 2, 0.04 * s),
    run(chamber, [0.42 * s, -0.52 * s, 0.1 * s], 'signal', 3, -0.04 * s),
  ];
}

function processingStackRuns(scale: number, seed: number): LocalRun[] {
  const s = scale;
  const steps: readonly number[] = [0.52, 0.24, -0.06, -0.36];
  const bus: Vector = [0.18 * s, 0, 0.06 * s];

  return [
    ...steps.map((y, index) =>
      run(
        [0.18 * s, y * s, 0.06 * s],
        [-0.14 * s, y * s - 0.06 * s, 0.18 * s],
        index === 0 ? 'primary' : 'secondary',
        0 + index,
        hashSigned(seed, 5400 + index) * 0.03 * s,
      ),
    ),
    // The bus itself: one run climbing the whole stack, so the parts read as
    // served by a shared spine rather than as four unrelated shelves.
    run([0.18 * s, -0.62 * s, 0.06 * s], [bus[0], 0.74 * s, bus[2]], 'primary', 4, 0.03 * s),
  ];
}

function latticeRuns(scale: number, seed: number): LocalRun[] {
  const s = scale;

  return [
    run([-0.44 * s, -0.32 * s, -0.04 * s], [0.42 * s, 0.34 * s, 0.06 * s], 'secondary', 0, 0.05 * s),
    run([-0.4 * s, 0.32 * s, 0.04 * s], [0.38 * s, -0.28 * s, -0.02 * s], 'secondary', 1, -0.05 * s),
    // The probe run reaches the endpoint, which is what makes the tip an
    // endpoint rather than a last box.
    run([0.06 * s, 0.04 * s, 0.14 * s], [0.76 * s, 0.52 * s, 0.18 * s], 'signal', 2, 0.08 * s),
    run(
      [-0.5 * s, -0.36 * s, 0.2 * s],
      [0.5 * s, 0.4 * s, 0.2 * s],
      'ambient',
      3,
      hashSigned(seed, 5500) * 0.04 * s,
      0.08 * s,
    ),
  ];
}

const RUN_BUILDERS: Readonly<
  Record<DomainEnvironmentKind, (scale: number, seed: number) => LocalRun[]>
> = {
  'packet-buffer': packetBufferRuns,
  framebuffer: framebufferRuns,
  'decision-chamber': decisionChamberRuns,
  'processing-stack': processingStackRuns,
  lattice: latticeRuns,
};

/**
 * The domain's circuits in world space, carrying the domain's route group.
 *
 * Group, not class, is what carries the identity here: the shared field lifts a
 * whole group when its domain is targeted, so the interior and the branch that
 * feeds it move together.
 */
export function deriveDomainCircuits(
  environment: DomainEnvironment,
  group: number,
  seed = 17,
): readonly RouteCurve[] {
  const normalizedSeed = normalizeSeed(seed);
  const anchor: Vector = environment.anchor;
  const runs = RUN_BUILDERS[environment.kind](environment.scale, normalizedSeed);
  const baseId = idBaseFor(environment.nodeId);

  return runs.map((local, index) => {
    const jitter = (hashUnit(normalizedSeed, baseId + index) - 0.5) * 0.02;
    return {
      id: baseId + index,
      rank: local.rank,
      route: local.route,
      group,
      start: add(anchor, local.start),
      control: add(anchor, [
        local.control[0] + jitter,
        local.control[1],
        local.control[2] - jitter,
      ]),
      end: add(anchor, local.end),
    };
  });
}
