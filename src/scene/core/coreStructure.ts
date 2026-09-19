import { hashUnit, normalizeSeed } from '../seedRandom';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreStructureBand = 'background' | 'midground' | 'foreground';
export type CoreStructureTier =
  | 'anchor'
  | 'primary'
  | 'secondary'
  | 'detail'
  | 'recess';
export type CoreStructureShape = 'volume' | 'beam' | 'membrane' | 'port' | 'slice';

type Vector = readonly [number, number, number];

/** Axis-oriented member: a slab, plate, socket or slice. */
export type CoreStructureForm = {
  readonly shape: Exclude<CoreStructureShape, 'beam'>;
  readonly tier: CoreStructureTier;
  readonly band: CoreStructureBand;
  readonly position: Vector;
  readonly rotation: Vector;
  readonly scale: Vector;
  /** Membrane openness at rest; 0 for every solid role. */
  readonly fade: number;
  /** Structural rank inside its band, used only for stable draw ordering. */
  readonly rank: number;
};

/** Endpoint-defined member: the structural spine and its rails. */
export type CoreStructureSpan = {
  readonly shape: 'beam';
  readonly tier: CoreStructureTier;
  readonly band: CoreStructureBand;
  readonly start: Vector;
  readonly end: Vector;
  /** Cross-section across and through the span axis. */
  readonly width: number;
  readonly depth: number;
  readonly fade: 0;
  readonly rank: number;
};

export type CoreStructureMember = CoreStructureForm | CoreStructureSpan;

/** A route port: where the Core's routing field leaves the hull. */
export type CoreStructurePort = {
  readonly id: number;
  readonly zone: number;
  /** Socket centre on the hull, in Core-local space. */
  readonly position: Vector;
  /** Outward unit normal the routing field departs along. */
  readonly direction: Vector;
  readonly rank: number;
};

export type CoreStructure = {
  readonly members: readonly CoreStructureMember[];
  readonly ports: readonly CoreStructurePort[];
  readonly bounds: Vector;
  /** Local point the idle framing treats as the Core's centre of mass. */
  readonly centroid: Vector;
  /** Unit direction of the diagonal structural spine. */
  readonly spineAxis: Vector;
  /** Luminance-weighted extent, used to keep the hero at 50–60% of frame. */
  readonly heroScale: number;
};

const LOCAL_BOUNDS: Vector = [1.45, 1.15, 1.0];

/**
 * Additive detail gates, in ascending order. SAFE keeps the hero silhouette,
 * the spine, the primary route ports and the void; every later tier adds
 * surfaces rather than turning anything up.
 */
const MEMBRANE_DETAIL = 0.25;
const SECONDARY_DETAIL = 0.5;
const LAYER_DETAIL = 0.72;
const TERTIARY_DETAIL = 0.9;

/** The diagonal spine: the single gesture the whole structure descends from. */
const SPINE_START: Vector = [-1.24, -0.68, -0.32];
const SPINE_END: Vector = [1.14, 0.6, 0.46];
const SECOND_RAIL_START: Vector = [-1.06, -0.84, 0.06];
const SECOND_RAIL_END: Vector = [0.98, 0.44, 0.64];

/** The hero volume is cut in two; the gap between the halves is the void. */
const HERO_UPPER = {
  position: [0.34, 0.25, 0.02],
  rotation: [0.1, -0.24, 0.16],
  scale: [0.96, 0.44, 0.62],
} as const satisfies Omit<CoreStructureForm, 'shape' | 'tier' | 'band' | 'fade' | 'rank'>;
const HERO_LOWER = {
  position: [0.16, -0.31, 0.1],
  rotation: [0.14, -0.2, 0.12],
  scale: [0.86, 0.36, 0.54],
} as const satisfies Omit<CoreStructureForm, 'shape' | 'tier' | 'band' | 'fade' | 'rank'>;
const HERO_RECESS = {
  position: [0.25, -0.03, -0.12],
  rotation: [0.12, -0.22, 0.14],
  scale: [0.98, 0.2, 0.44],
} as const satisfies Omit<CoreStructureForm, 'shape' | 'tier' | 'band' | 'fade' | 'rank'>;

const SECONDARY_ASSEMBLIES = [
  {
    position: [-0.68, -0.54, 0.24],
    rotation: [0.06, 0.3, -0.14],
    scale: [0.54, 0.28, 0.36],
  },
  {
    position: [0.86, 0.56, -0.28],
    rotation: [-0.1, -0.42, 0.1],
    scale: [0.44, 0.24, 0.3],
  },
] as const satisfies readonly Omit<
  CoreStructureForm,
  'shape' | 'tier' | 'band' | 'fade' | 'rank'
>[];

const FRONT_MEMBRANES = [
  { position: [0.3, 0.23, 0.38], rotation: [0.1, -0.24, 0.16], scale: [0.92, 0.4, 0.012], fade: 0.55 },
  { position: [0.22, -0.02, 0.46], rotation: [0.12, -0.22, 0.14], scale: [0.86, 0.52, 0.01], fade: 0.34 },
  { position: [0.42, 0.42, 0.3], rotation: [0.08, -0.26, 0.18], scale: [0.72, 0.3, 0.01], fade: 0.44 },
] as const;
const BACK_MEMBRANE = {
  position: [0.0, -0.04, -0.58],
  rotation: [0.1, -0.18, 0.34],
  scale: [1.9, 0.92, 0.01],
  fade: 0.22,
} as const;

/** Large plates held close to the camera so the viewport genuinely clips them. */
const FOREGROUND_SLICES = [
  {
    position: [-1.38, -1.06, 1.36],
    rotation: [0.42, 0.55, 0.18],
    scale: [1.52, 0.52, 0.05],
  },
  {
    position: [1.46, 1.04, 1.2],
    rotation: [-0.35, -0.48, -0.22],
    scale: [1.26, 0.42, 0.05],
  },
] as const satisfies readonly Omit<
  CoreStructureForm,
  'shape' | 'tier' | 'band' | 'fade' | 'rank'
>[];

/**
 * Ports are placed where routes actually want to leave: left toward the
 * analysis domains, right toward SYSTEMS, up toward GAME ANALYSIS, down toward
 * RESEARCH, plus two depth ports so the field is not planar.
 */
const PORT_TABLE = [
  { position: [-1.2, 0.02, 0.1], direction: [-1, 0.05, 0.06] },
  { position: [0.98, -0.64, 0.18], direction: [0.3, -0.94, 0.1] },
  { position: [0.74, 0.78, -0.12], direction: [0.34, 0.92, -0.2] },
  { position: [1.18, 0.3, -0.38], direction: [0.94, 0.28, -0.18] },
  { position: [-0.44, -0.88, 0.32], direction: [-0.22, -0.92, 0.32] },
  { position: [0.36, -0.1, 0.88], direction: [0.16, -0.12, 0.98] },
  { position: [-0.9, 0.72, 0.42], direction: [-0.66, 0.72, 0.22] },
] as const;

/** How many ports the profile exposes. SAFE keeps the primary route only. */
function portBudgetFor(detail: number): number {
  if (detail >= TERTIARY_DETAIL) return PORT_TABLE.length;
  if (detail >= LAYER_DETAIL) return 6;
  if (detail >= SECONDARY_DETAIL) return 5;
  if (detail >= MEMBRANE_DETAIL) return 4;
  return 3;
}

/**
 * Which ports a partial-detail profile exposes, as table indices.
 *
 * The seed permutes the emission order, so a lower profile routes through a
 * different but equally well-distributed subset of exits. At full detail every
 * port is present, so the seed can never change the hero silhouette; the result
 * is re-sorted by table index so port identity and rank stay stable.
 */
function selectPortIndices(detail: number, seed: number): number[] {
  const budget = portBudgetFor(detail);
  const indices = PORT_TABLE.map((_, index) => index);
  if (budget >= indices.length) return indices;

  const normalizedSeed = normalizeSeed(seed);
  return indices
    .sort((left, right) => {
      const leftKey = hashUnit(normalizedSeed, 1200 + left);
      const rightKey = hashUnit(normalizedSeed, 1200 + right);
      return leftKey === rightKey ? left - right : leftKey - rightKey;
    })
    .slice(0, budget)
    .sort((left, right) => left - right);
}

function unitDirection(vector: Vector): Vector {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 0.0001) {
    return [0, 0, 1];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function normalizedDetail(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Deterministic hero structure for the Compute Core.
 *
 * The structure is deliberately asymmetric and reads front-to-back: a diagonal
 * spine carries a cut processing volume with an explicit void, supported by
 * smaller assemblies, layered membranes and viewport-clipped foreground slices.
 * Detail gates only ever add surfaces, so SAFE keeps the same silhouette.
 */
export function deriveCoreStructure(
  parameters: Pick<CoreParameters, 'structureDetail'>,
  seed = 17,
): CoreStructure {
  const detail = normalizedDetail(parameters.structureDetail);
  const members: CoreStructureMember[] = [];

  const spineStart: Vector = [...SPINE_START];
  const spineEnd: Vector = [...SPINE_END];
  const spineDirection = unitDirection([
    spineEnd[0] - spineStart[0],
    spineEnd[1] - spineStart[1],
    spineEnd[2] - spineStart[2],
  ]);

  // Silhouette: the spine, the cut hero volume, its recess and the primary ports.
  members.push({
    shape: 'beam',
    tier: 'anchor',
    band: 'midground',
    start: spineStart,
    end: spineEnd,
    width: 0.13,
    depth: 0.17,
    fade: 0,
    rank: 0,
  });

  if (detail >= TERTIARY_DETAIL) {
    members.push({
      shape: 'beam',
      tier: 'primary',
      band: 'background',
      start: [...SECOND_RAIL_START],
      end: [...SECOND_RAIL_END],
      width: 0.05,
      depth: 0.07,
      fade: 0,
      rank: 1,
    });
  }

  members.push(
    { shape: 'volume', tier: 'anchor', band: 'midground', fade: 0, rank: 2, ...HERO_UPPER },
    { shape: 'volume', tier: 'primary', band: 'midground', fade: 0, rank: 3, ...HERO_LOWER },
    { shape: 'volume', tier: 'recess', band: 'background', fade: 0, rank: 4, ...HERO_RECESS },
  );

  if (detail >= SECONDARY_DETAIL) {
    SECONDARY_ASSEMBLIES.forEach((assembly, index) => {
      members.push({
        shape: 'volume',
        tier: index === 0 ? 'secondary' : 'primary',
        band: index === 0 ? 'midground' : 'background',
        fade: 0,
        rank: 5 + index,
        ...assembly,
      });
    });
  }

  if (detail >= MEMBRANE_DETAIL) {
    members.push({
      shape: 'membrane',
      tier: 'detail',
      band: 'midground',
      rank: 10,
      ...FRONT_MEMBRANES[0]!,
    });
  }

  if (detail >= SECONDARY_DETAIL) {
    members.push({
      shape: 'membrane',
      tier: 'detail',
      band: 'background',
      rank: 11,
      ...BACK_MEMBRANE,
    });
  }

  if (detail >= LAYER_DETAIL) {
    members.push(
      { shape: 'membrane', tier: 'detail', band: 'midground', rank: 12, ...FRONT_MEMBRANES[1]! },
      { shape: 'membrane', tier: 'detail', band: 'midground', rank: 13, ...FRONT_MEMBRANES[2]! },
    );
  }

  if (detail >= LAYER_DETAIL) {
    FOREGROUND_SLICES.forEach((slice, index) => {
      members.push({
        shape: 'slice',
        tier: 'secondary',
        band: 'foreground',
        fade: 0,
        rank: 20 + index,
        ...slice,
      });
    });
  }

  const ports: CoreStructurePort[] = selectPortIndices(detail, seed).map(
    (tableIndex) => {
      const port = PORT_TABLE[tableIndex]!;
      return {
        id: tableIndex,
        zone: tableIndex % 6,
        position: [...port.position],
        direction: unitDirection(port.direction),
        rank: tableIndex,
      };
    },
  );

  return {
    members,
    ports,
    bounds: LOCAL_BOUNDS,
    centroid: [-0.04, -0.02, 0.06],
    spineAxis: spineDirection,
    heroScale: 1.55,
  };
}

/**
 * Selects the port best aligned with an incoming direction.
 *
 * This is how the Core stays graph-blind: the integration boundary hands it a
 * direction, and the Core resolves that to one of its own local route zones.
 */
export function selectCorePortForDirection(
  structure: CoreStructure,
  direction: readonly [number, number, number],
): CoreStructurePort | undefined {
  const target = unitDirection([direction[0], direction[1], direction[2]]);
  let selected: CoreStructurePort | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const port of structure.ports) {
    const score =
      port.direction[0] * target[0] +
      port.direction[1] * target[1] +
      port.direction[2] * target[2] -
      port.rank * 0.0001;
    if (score > selectedScore) {
      selected = port;
      selectedScore = score;
    }
  }

  return selected;
}

export type CorePortActivation = {
  readonly sourcePortId: number;
  readonly sourceZone: number;
  readonly sourcePosition: Vector;
  readonly sourceDirection: Vector;
  /** 1 while a target is bound, 0 when the Core is only circulating locally. */
  readonly routingAuthority: number;
  /** Compression builds before packets are emitted, then relaxes on arrival. */
  readonly compression: number;
};

/**
 * Maps state plus incoming direction to the active source port and its routing
 * authority. Idle keeps a low-authority internal circulation; hover bends the
 * field; focus commits a continuous source-to-target flow.
 */
export function deriveCorePortActivation(
  structure: CoreStructure,
  input: CoreVisualInput,
): CorePortActivation {
  const fallback = structure.ports[0];
  const hasFocus =
    input.focusX !== 0 || input.focusY !== 0 || input.focusZ !== 0;
  const inboundDirection: Vector = hasFocus
    ? [input.focusX, input.focusY, input.focusZ]
    : [input.pointerX, input.pointerY, 0.2];
  const port = selectCorePortForDirection(structure, inboundDirection) ?? fallback;

  if (!port) {
    return {
      sourcePortId: -1,
      sourceZone: 0,
      sourcePosition: [0, 0, 0],
      sourceDirection: [0, 0, 1],
      routingAuthority: 0,
      compression: 0,
    };
  }

  const intensity = Number.isFinite(input.intensity)
    ? Math.min(1, Math.max(0, input.intensity))
    : 0;

  switch (input.visualState) {
    case 'dormant':
      return {
        sourcePortId: port.id,
        sourceZone: port.zone,
        sourcePosition: port.position,
        sourceDirection: port.direction,
        routingAuthority: 0,
        compression: 0,
      };
    case 'awakening':
      return {
        sourcePortId: port.id,
        sourceZone: port.zone,
        sourcePosition: port.position,
        sourceDirection: port.direction,
        routingAuthority: input.reducedMotion ? 0.25 : 0.32 + intensity * 0.2,
        compression: 0.3,
      };
    case 'hover_response':
      return {
        sourcePortId: port.id,
        sourceZone: port.zone,
        sourcePosition: port.position,
        sourceDirection: port.direction,
        routingAuthority: 0.62 + intensity * 0.18,
        compression: 0.62,
      };
    case 'focusing':
      return {
        sourcePortId: port.id,
        sourceZone: port.zone,
        sourcePosition: port.position,
        sourceDirection: port.direction,
        routingAuthority: 1,
        compression: 0.9,
      };
    case 'agent_activity':
      return {
        sourcePortId: port.id,
        sourceZone: port.zone,
        sourcePosition: port.position,
        sourceDirection: port.direction,
        routingAuthority: 1,
        compression: 0.74,
      };
    case 'idle':
    default:
      return {
        sourcePortId: port.id,
        sourceZone: port.zone,
        sourcePosition: port.position,
        sourceDirection: port.direction,
        routingAuthority: input.reducedMotion ? 0.18 : 0.26 + intensity * 0.12,
        compression: 0.22,
      };
  }
}