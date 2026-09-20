/**
 * The watershed descriptor: the whole world, as pure data.
 *
 * No Three.js, no R3F, no DOM. Everything downstream — the terrain mesh, the
 * flow field, the four materials, the camera framings, the labels — reads from
 * the object this module returns, so there is exactly one answer to "where is
 * the basin" and "which way does the primary river run".
 *
 * Two rules govern what may vary:
 *
 *  - **Randomness proposes; the descriptor disposes.** A seed may change how
 *    many tributaries exist, where a river wanders, how many terraces the basin
 *    has. It may not change the composition: the basin is in the same place, the
 *    camera corridor is clear of flow, and the domains are in the same five
 *    directions for every seed. Art direction is not a random variable.
 *
 *  - **Detail changes counts, never positions.** A quality profile may drop the
 *    fourth stratum or thin the delta's runnels, and the frame it produces must
 *    still be the same picture. If detail moved a feature, switching profile
 *    would move the camera's subject, and the reduced-motion and fallback
 *    captures would stop being comparable with the ULTRA ones.
 */
import type { GraphNodeId } from '../../graph/types';
import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import {
  distanceToSpine,
  terrainHeight,
  type BasinShape,
  type ChannelShape,
  type DepositShape,
  type DomainTerrain,
  type TerrainFieldOptions,
  type Vector2,
} from './terrainField';

export type DomainId = Exclude<GraphNodeId, 'core'>;

/**
 * The order the five domains are declared in, and the order everything keyed by
 * domain iterates in. Exporting the order rather than letting each consumer
 * rediscover it is what keeps the terrain record, the material record and the
 * label record keyed the same way.
 */
export const DOMAIN_IDS = Object.freeze([
  'ai',
  'graphics',
  'game-analysis',
  'systems',
  'research',
] as const satisfies readonly DomainId[]);

/**
 * What a domain *does* to the world, as distinct from what it is called.
 *
 * These are the five different computational physics the brief asks for. A
 * behaviour decides which terrain generator runs, which flow generator runs and
 * how the material answers — so the five are distinguishable by silhouette and
 * motion alone, before any label is read.
 */
export type DomainBehaviour = 'delta' | 'terraces' | 'ravine' | 'strata' | 'expanse';

export type Vector3 = readonly [x: number, y: number, z: number];

export type DomainPalette = {
  /** The ground and low structure of the region. */
  readonly ground: string;
  /** Ambient wash and distant haze belonging to the region. */
  readonly ambient: string;
  /** The region's accent, used sparingly and never across a whole region. */
  readonly accent: string;
};

export type RiverPhase = 'particle' | 'filament' | 'band';

export type River = {
  readonly id: string;
  readonly spine: readonly Vector2[];
  /** Half-width of the flowing body at full strength, in world units. */
  readonly width: number;
  /** `0`..`1`. Scales advection speed, particle density and carve depth. */
  readonly flowRate: number;
  /** Where this river's water ends up. */
  readonly feeds: 'basin' | 'domain';
  readonly domainId?: DomainId;
  readonly phases: readonly RiverPhase[];
};

/**
 * A horizontal translucent sheet. These are what make the basin read as layered
 * rather than as a hole, and they are the only place `membraneMaterial` runs.
 */
export type Stratum = {
  readonly id: string;
  /** Absolute world Y. Derived from the basin floor, not chosen by hand. */
  readonly level: number;
  readonly radius: number;
  /** `0`..`1`. How much of the sheet is translucent film versus open. */
  readonly coverage: number;
  /** Angular bias of the sheet's internal flow, in radians. */
  readonly flowBias: number;
};

export type Deposit = DepositShape & {
  readonly id: string;
  readonly style: 'crystal' | 'silt';
  /** How many crystal sites the deposit carries at ULTRA detail. */
  readonly sites: number;
};

export type DomainRegion = {
  readonly id: DomainId;
  readonly label: string;
  readonly behaviour: DomainBehaviour;
  readonly centre: Vector2;
  readonly radius: number;
  readonly palette: DomainPalette;
  /** Where the domain's name is anchored in the world, above its centre. */
  readonly labelAnchor: Vector3;
  readonly terrain: DomainTerrain;
};

/**
 * A volume the camera is allowed to occupy.
 *
 * `from` and `to` are the ends of the corridor's axis and carry its true world
 * height, so this is a volume and not a footprint. Two promises are made here
 * and both are held by tests rather than by inspection:
 *
 *  1. the whole axis clears the ground under it by at least `minClearance`;
 *  2. no river spine passes within `minClearance` of the footprint.
 *
 * A corridor that named no height could not be checked against either, which is
 * why the height is measured from the terrain at build time instead of being
 * written down.
 */
export type CameraCorridor = {
  readonly id: string;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly radius: number;
  readonly minClearance: number;
};

export type InterestPoint = {
  readonly id: string;
  readonly position: Vector3;
  /** Relative importance, used to order the fallback when two are visible. */
  readonly weight: number;
  /** The shot this point exists to be seen by. */
  readonly shot: string;
};

export type WatershedDescriptor = {
  readonly seed: number;
  readonly detail: number;
  readonly extent: TerrainFieldOptions['extent'];
  /**
   * The height field's own options, built once here and shared.
   *
   * Exposed rather than rebuilt by each consumer so that the mesh, the flow
   * field, the label anchors and the camera-clearance assertions all evaluate
   * the *same* function. Two reconstructions of one descriptor is exactly the
   * divergence that puts a label in mid-air.
   */
  readonly field: TerrainFieldOptions;
  readonly basin: BasinShape;
  readonly basinFloor: number;
  readonly rivers: readonly River[];
  readonly channels: readonly ChannelShape[];
  readonly strata: readonly Stratum[];
  readonly deposits: readonly Deposit[];
  readonly domains: readonly DomainRegion[];
  readonly fog: { readonly density: number; readonly tint: string; readonly drift: Vector2 };
  readonly cameraCorridors: readonly CameraCorridor[];
  readonly interestPoints: readonly InterestPoint[];
  readonly terrainResolution: number;
};

// --- The fixed composition ---------------------------------------------------
//
// Everything in this block is art direction and is identical for every seed.
// The seed moves things *within* these decisions; it never makes one of them.

/** World-space XZ rectangle the field is defined over, with margin on each side. */
const EXTENT = { minX: -1000, maxX: 1000, minZ: -1200, maxZ: 300 } as const;

const BASIN_CENTRE: Vector2 = [0, -300];
const BASIN_RADIUS = 190;
const BASIN_DEPTH = 52;
const BASIN_TERRACES = 5;
const BASIN_RIM_WIDTH = 46;
const BASIN_RIM_HEIGHT = 7;

/**
 * Where the idle camera stands, in XZ, and how much air it needs under it.
 *
 * The whole near field is designed around this one number: every river source is
 * beyond `-1000` in Z and every river's conclusion is at the basin, so nothing
 * the descriptor can generate comes anywhere near the corridor. The test that
 * holds this is what makes the clearance a promise rather than a hope.
 */
const IDLE_CAMERA_XZ: Vector2 = [0, 170];
const IDLE_CLEARANCE = 22;
const IDLE_CORRIDOR_RADIUS = 46;
const IDLE_CORRIDOR_HALF_LENGTH = 40;

/**
 * What a sampled maximum can miss, added to every corridor floor.
 *
 * The clearing below samples the ground on a grid, and a grid samples a curve
 * rather than bounding it: the true maximum of a 21-unit wavelength sitting
 * between two samples is above both of them. At 49 samples over a 172-unit box
 * the spacing is 3.5 units, which bounds the miss at about 0.05 units — the
 * margin is ten times that, because the cost of being generous here is a camera
 * twenty centimetres higher and the cost of being wrong is a camera in a hill.
 */
const SAMPLING_MARGIN = 0.5;

/**
 * The five anchors, fixed for every seed.
 *
 * They are placed to satisfy two constraints at once: each is far enough from
 * the basin that its radius does not overlap the rim, and the five occupy
 * distinct depths and distinct sides of frame so the idle vista has something at
 * every distance. RESEARCH is the furthest and the emptiest, which is its whole
 * character.
 */
const DOMAIN_ANCHORS: Readonly<Record<DomainId, Vector2>> = Object.freeze({
  ai: [-440, -520],
  // GRAPHICS sits at the basin's own latitude rather than on the near bank. That
  // is a drainage decision before it is a compositional one: the near bank is
  // the *high* ground, so a region placed there could only be fed by a river
  // running uphill. `graphics-feed` did exactly that until the tests caught it.
  graphics: [520, -310],
  'game-analysis': [-440, -100],
  systems: [480, -640],
  research: [-40, -860],
});

const DOMAIN_RADII: Readonly<Record<DomainId, number>> = Object.freeze({
  ai: 220,
  graphics: 240,
  'game-analysis': 200,
  systems: 250,
  research: 280,
});

const DOMAIN_LABELS: Readonly<Record<DomainId, string>> = Object.freeze({
  ai: 'AI',
  graphics: 'GRAPHICS',
  'game-analysis': 'GAME ANALYSIS',
  systems: 'SYSTEMS',
  research: 'RESEARCH',
});

/**
 * Per-domain colour. One dominant hue per region plus one accent, which is
 * principle P1 from the reference study: an accent only reads as an accent while
 * it is scarce. None of these is a full-screen tint — each is a local emitter
 * that appears in the ground, the flow and the material of its own region.
 */
const DOMAIN_PALETTES: Readonly<Record<DomainId, DomainPalette>> = Object.freeze({
  // Warm white and ultraviolet: many near-identical candidates, none dominant.
  ai: { ground: '#1b1740', ambient: '#4a3aa8', accent: '#ffe9d2' },
  // Magenta, violet and iridescent white: dispersion made visible.
  graphics: { ground: '#2a0f38', ambient: '#a03ad0', accent: '#ff4fd8' },
  // Amber with coral: parallel futures, none of them settled.
  'game-analysis': { ground: '#2e1a10', ambient: '#b45a20', accent: '#ffab3d' },
  // Cold white and deep cyan: the most regular and the most pressure.
  systems: { ground: '#08202c', ambient: '#1f7fa8', accent: '#e8fbff' },
  // Indigo and mineral green: sparse, deep, mostly unread.
  research: { ground: '#0b1030', ambient: '#2f4a86', accent: '#6fe0b0' },
});

/**
 * The global palette. Ink, midnight and petroleum carry everything that is not
 * a region; cyan is the only hue permitted to be bright, and only inside a river
 * core. This is the whole reason the frame does not read as one cyan-grey wash:
 * the cyan is a *position in the world*, not a filter over it.
 */
export const WATERSHED_PALETTE = Object.freeze({
  /** Deepest background. The page never shows anything darker. */
  ink: '#04060c',
  /** Midnight blue: base terrain in shadow, the far field. */
  midnight: '#0a1226',
  /** Deep violet: the underside of the strata and the basin's interior. */
  violet: '#150f34',
  /** Petroleum blue: ambient fill and distant haze. */
  petroleum: '#123a52',
  /** Cobalt: the mid-tone of anything the key light reaches. */
  cobalt: '#2f6d9e',
  /** The bulk flow. The one bright hue, and it belongs to the water. */
  cyan: '#5fe4ff',
  /** The far end of the flow's own hue ramp, where it loses energy. */
  spectral: '#3f6bff',
  /** Compression inside the basin. Rationed: it appears once per frame at most. */
  compression: '#ffffff',
});

// --- Per-behaviour terrain ---------------------------------------------------

/**
 * What each behaviour does to the ground it sits in.
 *
 * The amplitudes are relative to `BASE_AMPLITUDE` (6.4), so a delta's runnels
 * are a fraction of the world's own relief while a ravine cuts considerably
 * deeper. `step: 0` means the pattern is never quantised, and the two domains
 * with a non-zero step are the two whose character *is* the stepping — the
 * spectral terraces and the throughput strata — which is what distinguishes them
 * from each other by silhouette rather than by colour.
 */
const BEHAVIOUR_TERRAIN: Readonly<Record<DomainBehaviour, Omit<DomainTerrain, 'centre' | 'radius'>>> =
  Object.freeze({
    // Many fine runnels, shallow and close together. Competing candidates.
    delta: { amplitude: 4.2, frequency: 0.062, terrace: 0, step: 0, invert: 0 },
    // Deep, wide, evenly spaced shelves.
    terraces: { amplitude: 14, frequency: 0.019, terrace: 0.9, step: 2.8, invert: 0 },
    // A hollow: the ravine is cut by its own channel, and this only roughens it.
    ravine: { amplitude: 7.5, frequency: 0.016, terrace: 0.3, step: 3.2, invert: -1 },
    // Shallower than the terraces and twice as regular. Throughput, not optics.
    strata: { amplitude: 9.5, frequency: 0.024, terrace: 1, step: 1.9, invert: 0 },
    // Almost nothing. The emptiness is the point, and it is load-bearing: it is
    // the frame's only large quiet area.
    expanse: { amplitude: 1.6, frequency: 0.009, terrace: 0, step: 0, invert: 0 },
  });

const DOMAIN_BEHAVIOUR: Readonly<Record<DomainId, DomainBehaviour>> = Object.freeze({
  ai: 'delta',
  graphics: 'terraces',
  'game-analysis': 'ravine',
  systems: 'strata',
  research: 'expanse',
});

// --- Rivers ------------------------------------------------------------------

/**
 * The rivers, in world XZ, before any seed offset.
 *
 * Four things are being composed here at once, and each one is a different part
 * of the brief: `primary` and `secondary` are the one or two rivers entering
 * from far that give the vista its scale; `ravine` cuts the prediction canyon
 * through GAME ANALYSIS with two parallel branches; `delta-feed` runs into the
 * AI region where the branching generator takes over; and `probe` is the only
 * flow in the world that does *not* reach the basin, because RESEARCH is where
 * things are sampled before they are understood.
 *
 * Every spine is monotone toward the basin in Z. That is not a stylistic
 * preference: water runs downhill, and the base tilt falls with Z, so a river
 * that ran back up the slope would have to be carved uphill.
 */
const RIVER_SEEDS: readonly {
  readonly id: string;
  readonly spine: readonly Vector2[];
  readonly width: number;
  readonly depth: number;
  readonly flowRate: number;
  readonly feeds: 'basin' | 'domain';
  readonly domainId?: DomainId;
  readonly optional: boolean;
}[] = Object.freeze([
  {
    id: 'primary',
    spine: [
      [-150, -1180],
      [-235, -940],
      [-300, -700],
      [-250, -540],
      [-150, -430],
      [-60, -360],
      [-15, -318],
    ],
    width: 46,
    depth: 17,
    flowRate: 1,
    feeds: 'basin',
    optional: false,
  },
  {
    id: 'secondary',
    spine: [
      [780, -1140],
      [640, -900],
      [520, -700],
      [390, -560],
      [230, -460],
      [130, -380],
      [55, -322],
    ],
    width: 33,
    depth: 13,
    flowRate: 0.74,
    feeds: 'basin',
    optional: false,
  },
  {
    id: 'ravine',
    spine: [
      [-760, -30],
      [-660, -90],
      [-560, -112],
      [-470, -120],
      [-370, -170],
      [-290, -240],
      [-200, -300],
      [-110, -336],
    ],
    width: 30,
    depth: 21,
    flowRate: 0.62,
    feeds: 'basin',
    domainId: 'game-analysis',
    optional: false,
  },
  // Every `feeds: 'domain'` river's last point is *exactly* its domain anchor.
  // `wanderSpine` holds the endpoints fixed, so this survives the seed, and it
  // buys an invariant a test can hold: a tributary either reaches its domain or
  // it was not generated. A mouth that stopped "near" the anchor would leave the
  // delta's runnels converging on a point the river never arrives at.
  {
    id: 'delta-feed',
    spine: [
      [-720, -840],
      [-640, -700],
      [-560, -610],
      [-500, -556],
      [-440, -520],
    ],
    width: 20,
    depth: 9,
    flowRate: 0.46,
    feeds: 'domain',
    domainId: 'ai',
    optional: false,
  },
  {
    id: 'graphics-feed',
    spine: [
      [880, -560],
      [780, -470],
      [680, -400],
      [600, -350],
      [520, -310],
    ],
    width: 18,
    depth: 8,
    flowRate: 0.4,
    feeds: 'domain',
    domainId: 'graphics',
    optional: true,
  },
  {
    id: 'strata-feed',
    spine: [
      [940, -820],
      [800, -750],
      [670, -700],
      [570, -668],
      [480, -640],
    ],
    width: 26,
    depth: 11,
    flowRate: 0.52,
    feeds: 'domain',
    domainId: 'systems',
    optional: true,
  },
  {
    id: 'probe',
    spine: [
      [-250, -1060],
      [-190, -990],
      [-130, -930],
      [-80, -890],
      [-40, -860],
    ],
    width: 9,
    depth: 5,
    flowRate: 0.18,
    feeds: 'domain',
    domainId: 'research',
    optional: true,
  },
]);

/** Which phases a river's units occupy. Slow rivers have no particle core. */
function phasesFor(flowRate: number): readonly RiverPhase[] {
  if (flowRate >= 0.9) return ['particle', 'filament', 'band'];
  if (flowRate >= 0.45) return ['particle', 'filament'];
  return ['filament', 'band'];
}

// --- Generation --------------------------------------------------------------

/**
 * A river's actual spine: the authored polyline with a per-seed lateral wander.
 *
 * The wander is applied to the *interior* points only. The first and last point
 * are the source and the mouth, and moving either would move where the river
 * comes from or whether it reaches the basin — both of which are composition,
 * not variation.
 */
function wanderSpine(spine: readonly Vector2[], seed: number, salt: number, amount: number): Vector2[] {
  return spine.map((point, index) => {
    if (index === 0 || index === spine.length - 1) return point;
    const offset = hashSigned(seed, salt + index * 31) * amount;

    // Offset perpendicular to the local direction, so the river wanders rather
    // than being pushed uniformly across its own course.
    const previous = spine[index - 1]!;
    const next = spine[index + 1]!;
    const dx = next[0] - previous[0];
    const dz = next[1] - previous[1];
    const length = Math.hypot(dx, dz) || 1;
    return [point[0] - (dz / length) * offset, point[1] + (dx / length) * offset] as Vector2;
  });
}

/**
 * The compass bearing from the basin to a point, in radians.
 *
 * Used to aim a region's own flow *away* from the basin. Derived rather than
 * written down because it was written down first and was wrong: a hand-picked
 * angle of `0.62π` pointed the AI delta's runnels at the basin instead of away
 * from it, which is the one direction water in that region cannot go.
 */
function awayFromBasin(centre: Vector2): number {
  return Math.atan2(centre[1] - BASIN_CENTRE[1], centre[0] - BASIN_CENTRE[0]);
}

/**
 * The highest ground under a capsule: the volume a corridor actually sweeps.
 *
 * Not a square centred on the corridor's middle. That was the first version and
 * it was wrong in the way that matters — a corridor runs *along* an axis, so its
 * footprint is a capsule 80 units long, and a square of the same radius covers
 * neither end of it. Sampling the bounding box and rejecting the points outside
 * the capsule is exact and costs one distance test.
 */
function highestGroundOverCapsule(
  from: Vector2,
  to: Vector2,
  radius: number,
  field: TerrainFieldOptions,
  samples = 49,
): number {
  const minX = Math.min(from[0], to[0]) - radius;
  const maxX = Math.max(from[0], to[0]) + radius;
  const minZ = Math.min(from[1], to[1]) - radius;
  const maxZ = Math.max(from[1], to[1]) + radius;

  let highest = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < samples; row += 1) {
    for (let column = 0; column < samples; column += 1) {
      const x = minX + (column / (samples - 1)) * (maxX - minX);
      const z = minZ + (row / (samples - 1)) * (maxZ - minZ);
      if (distanceToSpine(x, z, [from, to]).distance > radius) continue;
      highest = Math.max(highest, terrainHeight(x, z, field));
    }
  }
  return highest;
}

/**
 * The delta's runnels: fine competing branches fanning out from the region's
 * centre, away from the basin.
 *
 * This is the AI region's whole character — many candidate paths, each too small
 * to dominate — and it is generated rather than authored because the count is
 * per-seed, which is what stops two seeds producing the same density.
 */
function deltaBranches(centre: Vector2, radius: number, count: number, seed: number): ChannelShape[] {
  const branches: ChannelShape[] = [];
  const away = awayFromBasin(centre);

  for (let index = 0; index < count; index += 1) {
    // Fanned across the upstream half of the region, opposite the basin.
    const spread = (index / Math.max(count - 1, 1)) * 2 - 1;
    const wobble = hashSigned(seed, 6100 + index * 17) * 0.18;
    const direction = away + spread * 0.42 + wobble;

    const far = [
      centre[0] + Math.cos(direction) * radius * 0.94,
      centre[1] + Math.sin(direction) * radius * 0.94,
    ] as Vector2;

    const midpoint = [
      centre[0] + Math.cos(direction + 0.24) * radius * 0.5,
      centre[1] + Math.sin(direction + 0.24) * radius * 0.5,
    ] as Vector2;

    branches.push({
      // Runnels reconverge on the centre, which is what makes the delta read as
      // candidates meeting rather than as unrelated scratches.
      spine: [far, midpoint, centre],
      width: 7 + hashUnit(seed, 6200 + index * 13) * 5,
      depth: 3.2 + hashUnit(seed, 6300 + index * 11) * 2.4,
      fullFrom: 0.05,
      fullTo: 0.96,
    });
  }

  return branches;
}

/** The ravine's parallel branches: the futures that were not taken. */
function ravineBranches(spine: readonly Vector2[], width: number): ChannelShape[] {
  const branches: ChannelShape[] = [];

  for (const side of [-1, 1]) {
    const offset = width * 2.4 * side;
    branches.push({
      spine: spine.map(([x, z], index) => [
        x + offset * (0.35 + index * 0.08),
        z + offset * 0.25 * side,
      ] as Vector2),
      width: width * 0.42,
      depth: 9,
      fullFrom: 0.14,
      fullTo: 0.88,
    });
  }

  return branches;
}

/**
 * Build the whole watershed from a seed and a quality detail.
 *
 * `detail` is `0`..`1` and comes straight from the quality profile. It may only
 * reduce *how many* of something exists, never move one: see this module's
 * opening note for why that line is where it is.
 */
export function createWatershedDescriptor(seedInput: number, detailInput: number): WatershedDescriptor {
  const seed = normalizeSeed(seedInput);
  const detail = Math.min(Math.max(detailInput, 0), 1);

  // Per-seed, per-world constants. All of them are discrete or slow-moving, so
  // two seeds are genuinely different worlds rather than the same world nudged.
  const basinTerraces = BASIN_TERRACES + (hashUnit(seed, 101) < 0.5 ? 0 : 1);
  const basinDepth = BASIN_DEPTH * (0.88 + hashUnit(seed, 103) * 0.24);

  const basin: BasinShape = {
    centre: BASIN_CENTRE,
    radius: BASIN_RADIUS,
    depth: basinDepth,
    terraces: basinTerraces,
    rimWidth: BASIN_RIM_WIDTH,
    rimHeight: BASIN_RIM_HEIGHT,
  };

  // --- Rivers and the channels they carve ------------------------------------

  const rivers: River[] = [];
  const channels: ChannelShape[] = [];

  RIVER_SEEDS.forEach((definition, index) => {
    // The optional tributaries are the seed's variable density, and detail may
    // thin them further without touching the two that carry the composition.
    if (definition.optional) {
      if (hashUnit(seed, 200 + index * 7) < 0.3) return;
      if (detail < 0.45) return;
    }

    // The wander is scaled to the river's own width, not to a global constant.
    // A fixed 34 units was tried and is wrong for the same reason a fixed brush
    // size is wrong: it moves the nine-unit probe as far as the forty-six-unit
    // trunk, which both looks arbitrary and can bend a short course back on
    // itself. A river meanders within its own floodplain.
    const spine = wanderSpine(definition.spine, seed, 300 + index * 41, Math.min(30, definition.width * 0.7));
    const flowRate = definition.flowRate * (0.9 + hashUnit(seed, 400 + index * 19) * 0.2);
    const river: River = {
      id: definition.id,
      spine,
      width: definition.width,
      flowRate,
      feeds: definition.feeds,
      ...(definition.domainId ? { domainId: definition.domainId } : {}),
      phases: phasesFor(flowRate),
    };
    rivers.push(river);

    channels.push({
      spine,
      width: definition.width * 1.35,
      // The carve follows the flow rate, so a river that runs slower is also a
      // river that has cut less — one number, two consequences.
      depth: definition.depth * (0.85 + flowRate * 0.3),
      // A river enters the ground rather than starting in mid-air: full depth is
      // reached a little way in from the source and held until the mouth.
      fullFrom: 0.1,
      fullTo: 0.94,
    });
  });

  // The two domain-specific flow generations. Both hang off the rivers already
  // built, so a seed that omits a tributary omits its branches with it.
  const deltaRiver = rivers.find((river) => river.id === 'delta-feed');
  if (deltaRiver) {
    const count = Math.max(4, Math.round((7 + hashUnit(seed, 700) * 4) * (0.5 + detail * 0.5)));
    channels.push(
      ...deltaBranches(DOMAIN_ANCHORS.ai, DOMAIN_RADII.ai, count, seed),
    );
  }

  const ravineRiver = rivers.find((river) => river.id === 'ravine');
  if (ravineRiver) {
    channels.push(...ravineBranches(ravineRiver.spine, ravineRiver.width));
  }

  // --- The five domains ------------------------------------------------------

  const domains: DomainRegion[] = DOMAIN_IDS.map((id) => {
    const behaviour = DOMAIN_BEHAVIOUR[id];
    const centre = DOMAIN_ANCHORS[id];
    const radius = DOMAIN_RADII[id];

    return {
      id,
      label: DOMAIN_LABELS[id],
      behaviour,
      centre,
      radius,
      palette: DOMAIN_PALETTES[id],
      labelAnchor: [centre[0], 0, centre[1]] as Vector3,
      terrain: { ...BEHAVIOUR_TERRAIN[behaviour], centre, radius },
    };
  });

  // --- Deposits --------------------------------------------------------------
  //
  // Deposits are where material settles, and they are deliberately not uniformly
  // spread: one where the two trunk rivers meet, one on the inner rim, and one
  // per domain that has something to deposit. RESEARCH has none, which is what
  // leaves the far field quiet.

  const deposits: Deposit[] = [];

  const primary = rivers.find((river) => river.id === 'primary');
  const secondary = rivers.find((river) => river.id === 'secondary');
  if (primary && secondary) {
    // The confluence: the nearest point of the two spines.
    const mouth = primary.spine[primary.spine.length - 3]!;
    deposits.push({
      id: 'confluence',
      centre: mouth,
      radius: 74,
      height: 16,
      style: 'silt',
      sites: Math.round(6 * detail),
    });
  }

  deposits.push({
    id: 'rim-lip',
    centre: [BASIN_CENTRE[0] + BASIN_RADIUS * 0.72, BASIN_CENTRE[1] + BASIN_RADIUS * 0.72],
    radius: 62,
    height: 11,
    style: 'crystal',
    sites: Math.round(10 * detail),
  });

  // Salted by the domain's *index in `DOMAIN_IDS`*, never by its coordinates.
  // Salting by coordinate is the obvious thing and it is wrong here: AI and GAME
  // ANALYSIS share an X of -440, so `hashSigned(seed, 900 + domain.centre[0])`
  // returned the same angle for both and placed their deposits identically.
  DOMAIN_IDS.forEach((id, index) => {
    const domain = domains.find((candidate) => candidate.id === id);
    // RESEARCH has nothing to deposit. That is what leaves the far field quiet,
    // and the quiet is load-bearing — it is the frame's only large empty area.
    if (!domain || domain.behaviour === 'expanse') return;

    // Offset from the region's centre and away from the basin, so a deposit does
    // not sit on the thing the label points at.
    const angle = awayFromBasin(domain.centre) + hashSigned(seed, 900 + index * 37) * 0.8;
    deposits.push({
      id: `deposit-${domain.id}`,
      centre: [
        domain.centre[0] + Math.cos(angle) * domain.radius * 0.42,
        domain.centre[1] + Math.sin(angle) * domain.radius * 0.42,
      ],
      radius: 44 + hashUnit(seed, 920 + index * 41) * 26,
      height: 8 + hashUnit(seed, 940 + index * 43) * 7,
      style: domain.behaviour === 'terraces' ? 'crystal' : 'silt',
      sites: Math.round((domain.behaviour === 'terraces' ? 14 : 7) * detail),
    });

    // A satellite deposit, on about half of seeds and in about half of regions.
    // Counts are the one thing a seed is allowed to move, and this is what stops
    // two seeds having the same number of deposits.
    if (hashUnit(seed, 960 + index * 47) > 0.5) {
      const satelliteAngle = angle + 0.9 + hashSigned(seed, 980 + index * 53) * 0.5;
      deposits.push({
        id: `deposit-${domain.id}-satellite`,
        centre: [
          domain.centre[0] + Math.cos(satelliteAngle) * domain.radius * 0.7,
          domain.centre[1] + Math.sin(satelliteAngle) * domain.radius * 0.7,
        ],
        radius: 26 + hashUnit(seed, 990 + index * 59) * 18,
        height: 5 + hashUnit(seed, 995 + index * 61) * 4,
        style: 'silt',
        sites: Math.round(4 * detail),
      });
    }
  });

  // --- The terrain the descriptor actually describes -------------------------
  //
  // Built once, here, and handed to every consumer rather than rebuilt by each.
  // The basin floor and every structure placed *on* the ground is then placed by
  // asking the same function the mesh will use, which is the payoff of building
  // the height field on the CPU instead of in a vertex shader: the descriptor
  // does not have to guess where the ground is, and a label cannot end up
  // floating off it.

  const field: TerrainFieldOptions = {
    seed,
    basin,
    channels,
    deposits,
    domains: domains.map((domain) => domain.terrain),
    extent: EXTENT,
  };

  // Measured, not assumed, and measured with the deposits already in place: the
  // confluence mound sits inside the basin's outer slope, so a floor sampled
  // before the deposits existed would have been metres low and every stratum
  // would have hung above the bowl rather than crossing it.
  const basinFloor = terrainHeight(BASIN_CENTRE[0], BASIN_CENTRE[1], field);

  // --- Strata: the layered sheets over the basin -----------------------------

  // Levels are measured up from the basin floor rather than placed at absolute
  // heights, so a seed with a deeper basin still has its sheets inside the bowl.
  const STRATUM_OFFSETS = [4, 15, 27, 40] as const;
  const stratumCount = Math.max(1, Math.round(STRATUM_OFFSETS.length * (0.35 + detail * 0.65)));

  const strata: Stratum[] = STRATUM_OFFSETS.slice(0, stratumCount).map((offset, index) => ({
    id: `stratum-${index}`,
    level: basinFloor + offset,
    // Each sheet is smaller than the one below it, so the stack tapers into the
    // bowl instead of presenting four edges at once.
    radius: BASIN_RADIUS * (0.94 - index * 0.13),
    coverage: 0.34 + hashUnit(seed, 800 + index * 23) * 0.22,
    flowBias: hashSigned(seed, 850 + index * 29) * 0.9,
  }));

  // --- Camera corridors ------------------------------------------------------
  //
  // One corridor, because the idle vista is the only shot whose camera stays
  // still. Every other shot travels *along* a river it has just chosen, so its
  // path is defined by the flow rather than protected from it; the constraint
  // those shots carry is the one at the end of §8 of the spec, that the camera
  // never clips a surface, and that is a property of the path, not of the world.

  const corridorAxis: readonly [Vector2, Vector2] = [
    [IDLE_CAMERA_XZ[0], IDLE_CAMERA_XZ[1] + IDLE_CORRIDOR_HALF_LENGTH],
    [IDLE_CAMERA_XZ[0], IDLE_CAMERA_XZ[1] - IDLE_CORRIDOR_HALF_LENGTH],
  ];
  const corridorHeight =
    highestGroundOverCapsule(corridorAxis[0], corridorAxis[1], IDLE_CORRIDOR_RADIUS, field) +
    SAMPLING_MARGIN +
    IDLE_CLEARANCE;

  const cameraCorridors: CameraCorridor[] = [
    {
      id: 'idle',
      from: [corridorAxis[0][0], corridorHeight, corridorAxis[0][1]],
      to: [corridorAxis[1][0], corridorHeight, corridorAxis[1][1]],
      radius: IDLE_CORRIDOR_RADIUS,
      minClearance: IDLE_CLEARANCE,
    },
  ];

  // --- Interest points -------------------------------------------------------
  //
  // Candidates, not a selection. Which of them are actually used is decided by
  // the shot system, which is the only thing that knows where the frame is; the
  // descriptor's job is to say what is worth looking at.

  const interestPoints: InterestPoint[] = [
    { id: 'basin', position: [BASIN_CENTRE[0], basinFloor + 26, BASIN_CENTRE[1]], weight: 1, shot: 'idleVista' },
    { id: 'gate', position: [0, basinFloor + 34, 150], weight: 1, shot: 'entry' },
  ];

  for (const domain of domains) {
    interestPoints.push({
      id: `domain:${domain.id}`,
      position: [
        domain.centre[0],
        terrainHeight(domain.centre[0], domain.centre[1], field) + 18,
        domain.centre[1],
      ],
      // RESEARCH is deliberately the lightest: the camera should not prefer the
      // emptiest region just because it is the furthest away.
      weight: domain.behaviour === 'expanse' ? 0.55 : 0.8,
      shot: 'domainArrival',
    });
  }

  for (const river of rivers) {
    const middle = river.spine[Math.floor(river.spine.length / 2)]!;
    interestPoints.push({
      id: `route:${river.id}`,
      position: [middle[0], terrainHeight(middle[0], middle[1], field) + 12, middle[1]],
      weight: river.flowRate,
      shot: 'routeApproach',
    });
  }

  return {
    seed,
    detail,
    extent: EXTENT,
    field,
    basin,
    basinFloor,
    rivers,
    channels,
    strata,
    deposits,
    domains,
    fog: {
      // Denser than 3.5.4's `0.006`, because depth is now carried by the terrain
      // and the layers rather than by a bright object in the middle of frame.
      density: 0.0034 + hashUnit(seed, 1000) * 0.0006,
      tint: WATERSHED_PALETTE.petroleum,
      drift: [hashSigned(seed, 1001) * 0.4, -1] as Vector2,
    },
    cameraCorridors,
    interestPoints,
    // The mesh hint: how many segments per axis at this detail. ULTRA gets a
    // grid fine enough to hold the delta's runnels; SAFE keeps the silhouette.
    terrainResolution: Math.round(180 + detail * 260),
  };
}
