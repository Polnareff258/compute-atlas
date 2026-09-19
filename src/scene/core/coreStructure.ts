import { hashUnit, normalizeSeed } from '../seedRandom';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreStructureBand = 'background' | 'midground' | 'foreground';
export type CoreStructureTier =
  | 'anchor'
  | 'primary'
  | 'secondary'
  | 'detail'
  | 'recess';
export type CoreStructureShape = 'hull' | 'volume' | 'beam' | 'membrane' | 'port' | 'slice';

type Vector = readonly [number, number, number];

/** Axis-oriented member: a plate, socket or thin membrane. */
export type CoreStructureForm = {
  readonly shape: Exclude<CoreStructureShape, 'beam' | 'hull'>;
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

/**
 * A machined body: a profile lofted through sections between two endpoints.
 *
 * The hero's processing hulls are these rather than transformed unit boxes. A
 * box is the same silhouette from every angle and cannot taper; a hull's
 * sections differ, so a processing volume narrows where it meets the spine,
 * closes on a chamfered end and reads as one machined body instead of a slab
 * that happens to sit near other slabs.
 */
export type CoreStructureHull = {
  readonly shape: 'hull';
  readonly tier: CoreStructureTier;
  readonly band: CoreStructureBand;
  readonly start: Vector;
  readonly end: Vector;
  /** 0 for a chamfered rectangle section, 3+ for a regular n-gon prism. */
  readonly facets: number;
  readonly chamfer: number;
  readonly sections: readonly CoreHullSection[];
  readonly fade: 0;
  readonly rank: number;
};

export type CoreHullSection = {
  readonly t: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly offset: readonly [number, number];
};

export type CoreStructureMember =
  | CoreStructureForm
  | CoreStructureSpan
  | CoreStructureHull;

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

const LOCAL_BOUNDS: Vector = [1.5, 1.05, 0.85];

/**
 * Additive detail gates, in ascending order. SAFE keeps the hero silhouette,
 * the spine, the two processing hulls, the void between them and the primary
 * route ports; every later tier adds surfaces rather than turning anything up.
 */
const MEMBRANE_DETAIL = 0.25;
const SECONDARY_DETAIL = 0.5;
const LAYER_DETAIL = 0.72;
const TERTIARY_DETAIL = 0.9;

/**
 * The diagonal spine: the single gesture the whole structure descends from.
 *
 * It runs from below-left to above-right and passes *through* both processing
 * hulls, so the mass reads as hung on one member rather than assembled from
 * pieces that happen to sit near each other.
 */
const SPINE_START: Vector = [-1.12, -0.78, -0.3];
const SPINE_END: Vector = [1.16, 0.75, 0.44];
const SECOND_RAIL_START: Vector = [-1.02, -0.7, -0.54];
const SECOND_RAIL_END: Vector = [0.98, 0.5, -0.2];

type HullDefinition = Omit<
  CoreStructureHull,
  'shape' | 'band' | 'fade' | 'rank'
>;

/**
 * Upper processing hull: the long body above the void.
 *
 * It swells past a quarter of its length, holds a flat deck along the middle and
 * closes on a chamfered *end face* rather than a point. That last part is what
 * makes it read as machined: a section that collapses to a tip is a leaf, and two
 * leaves and a stick is a plant, not a computing structure. A real housing ends
 * on a plane with its corners cut, so the last two sections here are the cut and
 * the face — the taper lives in the last eighth of the length, where a machined
 * chamfer lives, instead of over the whole body.
 *
 * Nothing here is a scaled unit box.
 */
const HULL_UPPER: HullDefinition = {
  tier: 'anchor',
  start: [-0.78, 0.24, -0.06],
  end: [1.05, 0.74, 0.14],
  facets: 0,
  chamfer: 0.22,
  sections: [
    { t: 0, halfWidth: 0.21, halfHeight: 0.17, offset: [0, -0.02] },
    { t: 0.2, halfWidth: 0.33, halfHeight: 0.25, offset: [0, 0.02] },
    { t: 0.58, halfWidth: 0.31, halfHeight: 0.24, offset: [0, 0] },
    { t: 0.86, halfWidth: 0.27, halfHeight: 0.2, offset: [0, -0.01] },
    { t: 1, halfWidth: 0.21, halfHeight: 0.15, offset: [0, -0.02] },
  ],
};

/** Lower processing hull: shorter, heavier, and cranked the other way. */
const HULL_LOWER: HullDefinition = {
  tier: 'primary',
  start: [-0.8, -0.72, 0.1],
  end: [1.14, -0.42, -0.08],
  facets: 0,
  chamfer: 0.26,
  sections: [
    { t: 0, halfWidth: 0.18, halfHeight: 0.12, offset: [0, 0.02] },
    { t: 0.26, halfWidth: 0.31, halfHeight: 0.2, offset: [0, 0] },
    { t: 0.64, halfWidth: 0.29, halfHeight: 0.18, offset: [0, -0.01] },
    { t: 0.88, halfWidth: 0.24, halfHeight: 0.15, offset: [0, -0.01] },
    { t: 1, halfWidth: 0.18, halfHeight: 0.11, offset: [0, 0] },
  ],
};

/**
 * The void's two end walls.
 *
 * Without them the gap between the hulls would read as two separate slabs; with
 * them it reads as a window cut through one body, which is the whole point.
 */
const YOKE_LEFT: HullDefinition = {
  tier: 'anchor',
  start: [-0.78, 0.26, -0.04],
  end: [-0.72, -0.64, 0.08],
  facets: 0,
  chamfer: 0.24,
  sections: [
    { t: 0, halfWidth: 0.16, halfHeight: 0.14, offset: [0, 0] },
    { t: 0.5, halfWidth: 0.21, halfHeight: 0.19, offset: [-0.02, 0] },
    { t: 1, halfWidth: 0.15, halfHeight: 0.13, offset: [0.02, 0] },
  ],
};

const YOKE_RIGHT: HullDefinition = {
  tier: 'primary',
  start: [0.94, 0.64, 0.1],
  end: [1.12, -0.32, -0.02],
  facets: 0,
  chamfer: 0.24,
  sections: [
    { t: 0, halfWidth: 0.14, halfHeight: 0.16, offset: [0, 0] },
    { t: 0.5, halfWidth: 0.19, halfHeight: 0.21, offset: [0.02, 0] },
    { t: 1, halfWidth: 0.12, halfHeight: 0.13, offset: [-0.02, 0] },
  ],
};

/**
 * The spine as a tapered prism, so it is a member rather than a rod.
 *
 * It protrudes past both hulls, and deliberately: a member that stops flush with
 * the bodies it carries reads as a seam between them, and the point of the spine
 * is that the two hulls are hung on one member. What it must not do is run half a
 * world unit out into empty space past the far end, which is a stick laid on top
 * of a machine rather than a shaft through one.
 */
const SPINE: HullDefinition = {
  tier: 'anchor',
  start: SPINE_START,
  end: SPINE_END,
  facets: 0,
  chamfer: 0.24,
  sections: [
    { t: 0, halfWidth: 0.07, halfHeight: 0.09, offset: [0, 0] },
    { t: 0.28, halfWidth: 0.12, halfHeight: 0.15, offset: [0, 0] },
    { t: 0.62, halfWidth: 0.095, halfHeight: 0.115, offset: [0, 0] },
    { t: 1, halfWidth: 0.06, halfHeight: 0.075, offset: [0, 0] },
  ],
};

const SECOND_RAIL: HullDefinition = {
  tier: 'detail',
  start: SECOND_RAIL_START,
  end: SECOND_RAIL_END,
  facets: 0,
  chamfer: 0.3,
  sections: [
    { t: 0, halfWidth: 0.03, halfHeight: 0.04, offset: [0, 0] },
    { t: 0.5, halfWidth: 0.055, halfHeight: 0.07, offset: [0, 0.01] },
    { t: 1, halfWidth: 0.025, halfHeight: 0.03, offset: [0, 0] },
  ],
};

/**
 * Secondary processing pockets: turned prisms standing on the hulls, plus one
 * machined block let into the left yoke. These are the places the machine looks
 * like it does work in, as opposed to the hulls it is made of.
 */
const POCKETS: readonly HullDefinition[] = [
  {
    tier: 'secondary',
    start: [0.32, 0.78, 0.06],
    end: [0.36, 1.08, 0.1],
    facets: 6,
    chamfer: 0,
    sections: [
      { t: 0, halfWidth: 0.16, halfHeight: 0.16, offset: [0, 0] },
      { t: 0.5, halfWidth: 0.18, halfHeight: 0.18, offset: [0, 0] },
      { t: 1, halfWidth: 0.11, halfHeight: 0.11, offset: [0, 0] },
    ],
  },
  {
    tier: 'secondary',
    start: [0.3, -0.74, 0.28],
    end: [0.34, -0.98, 0.34],
    facets: 6,
    chamfer: 0,
    sections: [
      { t: 0, halfWidth: 0.15, halfHeight: 0.15, offset: [0, 0] },
      { t: 0.55, halfWidth: 0.17, halfHeight: 0.17, offset: [0, 0] },
      { t: 1, halfWidth: 0.09, halfHeight: 0.09, offset: [0, 0] },
    ],
  },
  {
    tier: 'secondary',
    start: [-0.98, -0.42, 0.28],
    end: [-0.9, -0.18, 0.44],
    facets: 0,
    chamfer: 0.28,
    sections: [
      { t: 0, halfWidth: 0.14, halfHeight: 0.16, offset: [0, 0] },
      { t: 0.5, halfWidth: 0.17, halfHeight: 0.19, offset: [0, 0] },
      { t: 1, halfWidth: 0.1, halfHeight: 0.12, offset: [0, 0] },
    ],
  },
];

/** The void's back wall. It is what gives the window depth instead of a hole. */
const VOID_RECESS: HullDefinition = {
  tier: 'recess',
  start: [-0.62, -0.1, -0.5],
  end: [0.52, 0.04, -0.42],
  facets: 0,
  chamfer: 0.2,
  sections: [
    { t: 0, halfWidth: 0.025, halfHeight: 0.3, offset: [0, 0] },
    { t: 0.5, halfWidth: 0.035, halfHeight: 0.36, offset: [0, 0.03] },
    { t: 1, halfWidth: 0.025, halfHeight: 0.26, offset: [0, 0] },
  ],
};

/**
 * Layered membranes inside the void, plus one behind the mass.
 *
 * They sit in the opening rather than across the front face: a membrane drawn
 * over the outside of the hull is a decal, whereas one seen through the window
 * reads as a layer inside a machine.
 */
const VOID_MEMBRANES = [
  { position: [-0.3, -0.14, 0.0], rotation: [0.16, -0.3, 0.2], scale: [0.62, 0.4, 0.008], fade: 0.5 },
  { position: [0.2, -0.1, -0.12], rotation: [0.1, -0.26, 0.14], scale: [0.54, 0.34, 0.008], fade: 0.34 },
  { position: [0.0, -0.22, 0.22], rotation: [0.2, -0.3, 0.24], scale: [0.46, 0.28, 0.008], fade: 0.42 },
] as const;
const BACK_MEMBRANE = {
  position: [-0.05, -0.08, -0.66],
  rotation: [0.12, -0.2, 0.3],
  scale: [1.7, 0.95, 0.01],
  fade: 0.24,
} as const;

/**
 * The one foreground element, and it is deliberately small.
 *
 * The previous round used two plates over a world unit across at z ≈ 1.2, which
 * at 1920x1080 swallowed a third of the frame and at 2560x1440 flattened the
 * whole composition. This is a single low-contrast chip that clips the corner.
 */
const FOREGROUND_CHIP = {
  position: [1.24, -1.02, 1.14],
  rotation: [-0.28, -0.42, -0.18],
  scale: [0.4, 0.14, 0.03],
} as const satisfies Omit<CoreStructureForm, 'shape' | 'tier' | 'band' | 'fade' | 'rank'>;

/**
 * Ports are placed where routes actually want to leave: left toward the
 * analysis domains, right toward SYSTEMS, up toward GAME ANALYSIS, down toward
 * RESEARCH, plus two depth ports so the field is not planar.
 *
 * Each one sits on a surface that exists in the composition above — the left
 * yoke's outer face, the upper hull's tip, a pocket's cap — so a route leaves an
 * opening rather than a point in empty space.
 */
const PORT_TABLE = [
  { position: [-0.98, -0.32, 0.02], direction: [-1, 0.05, 0.06] },
  { position: [0.3, -1.0, 0.26], direction: [0.3, -0.94, 0.1] },
  { position: [0.36, 1.12, 0.1], direction: [0.34, 0.92, -0.2] },
  { position: [1.26, 0.38, 0.0], direction: [0.94, 0.28, -0.18] },
  { position: [-0.74, -1.06, 0.2], direction: [-0.22, -0.92, 0.32] },
  { position: [0.12, -0.3, 0.62], direction: [0.16, -0.12, 0.98] },
  { position: [-0.9, 0.5, 0.28], direction: [-0.66, 0.72, 0.22] },
] as const;

/**
 * The hero is authored in design units and scaled once, here.
 *
 * The numbers above are easier to reason about at a size where the whole
 * machine is about three units across. The camera frames the Core against the
 * same world space the domains live in, so the scale that makes it read as the
 * first subject in the frame is applied in one place rather than baked into
 * every authored coordinate — and the ports, the centroid and the bounds move
 * with it, which is what keeps the routes attached to the hull they leave.
 */
const CORE_SCALE = 1.34;

function scaleVector(vector: Vector, scale: number): Vector {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function scaleHull(definition: HullDefinition, scale: number): HullDefinition {
  return {
    tier: definition.tier,
    start: scaleVector(definition.start, scale),
    end: scaleVector(definition.end, scale),
    facets: definition.facets,
    chamfer: definition.chamfer,
    sections: definition.sections.map((section) => ({
      t: section.t,
      halfWidth: section.halfWidth * scale,
      halfHeight: section.halfHeight * scale,
      offset: [section.offset[0] * scale, section.offset[1] * scale] as const,
    })),
  };
}

function scaleForm<T extends { position: Vector; scale: Vector }>(
  form: T,
  factor: number,
): T {
  return {
    ...form,
    position: scaleVector(form.position, factor),
    scale: scaleVector(form.scale, factor),
  };
}

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
 * The composition is one machine rather than a scatter of parts. A tapered
 * diagonal spine runs from below-left to above-right through two lofted
 * processing hulls, which are held apart by two end yokes so the gap between
 * them is a window cut through the body. Pockets, internal membranes, a recess
 * wall behind the opening and route ports sit on that body. Every solid hull is
 * lofted from its own sections; none of them is a transformed unit box.
 *
 * Detail gates only ever add surfaces, so SAFE keeps the same silhouette.
 */
export function deriveCoreStructure(
  parameters: Pick<CoreParameters, 'structureDetail'>,
  seed = 17,
): CoreStructure {
  const detail = normalizedDetail(parameters.structureDetail);
  const members: CoreStructureMember[] = [];

  const spineDirection = unitDirection([
    SPINE_END[0] - SPINE_START[0],
    SPINE_END[1] - SPINE_START[1],
    SPINE_END[2] - SPINE_START[2],
  ]);

  const hull = (
    definition: HullDefinition,
    band: CoreStructureBand,
    rank: number,
  ): CoreStructureHull => {
    const scaled = scaleHull(definition, CORE_SCALE);
    return { shape: 'hull', band, fade: 0, rank, ...scaled };
  };

  // Silhouette: the two hulls, the void's end walls and the spine that carries
  // them. Nothing below this line is needed for the Core to read as itself.
  members.push(
    hull(HULL_UPPER, 'midground', 0),
    hull(HULL_LOWER, 'midground', 1),
    hull(YOKE_LEFT, 'midground', 2),
    hull(YOKE_RIGHT, 'background', 3),
    hull(VOID_RECESS, 'background', 4),
    hull(SPINE, 'midground', 5),
  );

  if (detail >= SECONDARY_DETAIL) {
    POCKETS.forEach((pocket, index) => {
      members.push(hull(pocket, index === 2 ? 'foreground' : 'midground', 6 + index));
    });
  }

  if (detail >= TERTIARY_DETAIL) {
    members.push(hull(SECOND_RAIL, 'background', 9));
  }

  if (detail >= MEMBRANE_DETAIL) {
    members.push({
      shape: 'membrane',
      tier: 'detail',
      band: 'midground',
      rank: 10,
      ...scaleForm(VOID_MEMBRANES[0]!, CORE_SCALE),
    });
  }

  if (detail >= SECONDARY_DETAIL) {
    members.push({
      shape: 'membrane',
      tier: 'detail',
      band: 'background',
      rank: 11,
      ...scaleForm(BACK_MEMBRANE, CORE_SCALE),
    });
  }

  if (detail >= LAYER_DETAIL) {
    members.push(
      {
        shape: 'membrane',
        tier: 'detail',
        band: 'midground',
        rank: 12,
        ...scaleForm(VOID_MEMBRANES[1]!, CORE_SCALE),
      },
      {
        shape: 'membrane',
        tier: 'detail',
        band: 'midground',
        rank: 13,
        ...scaleForm(VOID_MEMBRANES[2]!, CORE_SCALE),
      },
    );
  }

  if (detail >= LAYER_DETAIL) {
    members.push({
      shape: 'slice',
      tier: 'recess',
      band: 'foreground',
      fade: 0,
      rank: 20,
      ...scaleForm(FOREGROUND_CHIP, CORE_SCALE),
    });
  }

  const ports: CoreStructurePort[] = selectPortIndices(detail, seed).map(
    (tableIndex) => {
      const port = PORT_TABLE[tableIndex]!;
      return {
        id: tableIndex,
        zone: tableIndex % 6,
        position: scaleVector(port.position, CORE_SCALE),
        direction: unitDirection(port.direction),
        rank: tableIndex,
      };
    },
  );

  return {
    members,
    ports,
    bounds: scaleVector(LOCAL_BOUNDS, CORE_SCALE),
    centroid: scaleVector([-0.02, -0.05, -0.02], CORE_SCALE),
    spineAxis: spineDirection,
    heroScale: 1.5 * CORE_SCALE,
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