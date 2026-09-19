import type { GraphPosition } from '../../graph/types';
import type {
  StructurePart,
  StructureTier,
} from '../materials/structureGeometry';
import type { DomainIngress, DomainVisualNodeId } from '../routing/graphRoutes';

type Vector = readonly [number, number, number];

/**
 * A domain is a sub-environment, not an icon.
 *
 * All five share one machine language — the same tiers, the same membrane
 * treatment, the same baking as the hero — and differ in their *local
 * computational behaviour*: what the parts are arranged as, which ones move when
 * the domain is engaged, and where its ingress is. That is the distinction the
 * brief draws between five unrelated art styles and one machine rendered five
 * ways.
 */
export type DomainEnvironmentKind =
  | 'packet-buffer'
  | 'framebuffer'
  | 'decision-chamber'
  | 'processing-stack'
  | 'lattice';

/** A slab or membrane that travels when the domain is engaged. */
export type DomainMovable = {
  readonly id: string;
  readonly part: StructurePart;
  /** Local offset at full activity. */
  readonly travel: Vector;
  /**
   * Ingress movables form the opening mouth, so they widen the seam rather than
   * drifting with the interior layers.
   */
  readonly role: 'ingress' | 'interior';
};

export type DomainEnvironment = {
  readonly nodeId: DomainVisualNodeId;
  readonly kind: DomainEnvironmentKind;
  readonly anchor: GraphPosition;
  /** Static mass: the infrastructure the whole domain is built on. */
  readonly frame: readonly StructurePart[];
  /** Moving interior layers, in activation order. */
  readonly movables: readonly DomainMovable[];
  /** Everything baked into one mass, frame first so draw order is stable. */
  readonly parts: readonly StructurePart[];
  /** Ingress mouth, in domain-local space. */
  readonly ingress: DomainIngress;
  /** Local point the domain's routing arrives at, in local space. */
  readonly ingressLocal: Vector;
  /** Unit direction the domain separates along as it engages. */
  readonly activationAxis: Vector;
  /** Radius of the domain's own envelope, used for framing and labels. */
  readonly extent: number;
  /**
   * The profile's build-out factor. Exposed so the domain's internal flow is
   * laid out on the same scale as its architecture rather than on a second,
   * drifting copy of the same arithmetic.
   */
  readonly scale: number;
};

function form(
  tier: StructureTier,
  position: Vector,
  scale: Vector,
  rotation: Vector = [0, 0, 0],
  membrane = false,
): StructurePart {
  return { shape: 'form', tier, membrane, position, rotation, scale };
}

function span(
  tier: StructureTier,
  start: Vector,
  end: Vector,
  width: number,
  depth = width,
  membrane = false,
): StructurePart {
  return { shape: 'span', tier, membrane, start, end, width, depth };
}

/** Thin vertical plate: a membrane in the machine's own idiom. */
function plate(
  tier: StructureTier,
  position: Vector,
  scale: Vector,
  rotation: Vector = [0, 0, 0],
): StructurePart {
  return form(tier, position, scale, rotation, true);
}

function normalize(vector: Vector): Vector {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-6) return [0, 1, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function subtract(from: Vector, to: Vector): Vector {
  return [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
}

/**
 * The ingress assembly: a socket the route arrives at, plus two jaws that open.
 *
 * Every domain gets one, because the brief requires each to have a real ingress
 * rather than a line that stops near a box.
 */
function ingressAssembly(
  ingress: DomainIngress,
  anchor: GraphPosition,
  axis: Vector,
  scale: number,
): DomainMovable[] {
  const local: Vector = subtract(ingress.position, anchor);
  const direction = normalize(ingress.direction);
  // The jaws sit across the mouth, so they part perpendicular to the axis the
  // domain separates along as well as to the incoming direction.
  const across = normalize([
    direction[1] * axis[2] - direction[2] * axis[1],
    direction[2] * axis[0] - direction[0] * axis[2],
    direction[0] * axis[1] - direction[1] * axis[0],
  ]);
  const travel = 0.05 + scale * 0.06;

  return [
    {
      id: 'ingress-upper',
      role: 'ingress',
      travel: [across[0] * travel, across[1] * travel, across[2] * travel],
      part: span(
        'primary',
        [
          local[0] - across[0] * ingress.halfWidth,
          local[1] - across[1] * ingress.halfWidth,
          local[2] - across[2] * ingress.halfWidth,
        ],
        [
          local[0] + direction[0] * scale * 0.22,
          local[1] + direction[1] * scale * 0.22,
          local[2] + direction[2] * scale * 0.22,
        ],
        ingress.halfWidth * 0.7,
        ingress.halfWidth * 0.7,
      ),
    },
    {
      id: 'ingress-lower',
      role: 'ingress',
      travel: [-across[0] * travel, -across[1] * travel, -across[2] * travel],
      part: span(
        'primary',
        [
          local[0] + across[0] * ingress.halfWidth,
          local[1] + across[1] * ingress.halfWidth,
          local[2] + across[2] * ingress.halfWidth,
        ],
        [
          local[0] + direction[0] * scale * 0.22,
          local[1] + direction[1] * scale * 0.22,
          local[2] + direction[2] * scale * 0.22,
        ],
        ingress.halfWidth * 0.7,
        ingress.halfWidth * 0.7,
      ),
    },
  ];
}

/** AI: a trunk that forks, feeding a packet buffer of stacked slats. */
function packetBuffer(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      span('anchor', [0, -0.6 * s, 0], [0, -0.04 * s, 0], 0.08 * s),
      span('primary', [0, -0.04 * s, 0], [-0.36 * s, 0.3 * s, 0.04 * s], 0.06 * s),
      span('primary', [0, -0.04 * s, 0], [0.36 * s, 0.28 * s, -0.04 * s], 0.06 * s),
      form('recess', [0, 0.46 * s, -0.1 * s], [0.82 * s, 0.56 * s, 0.18 * s]),
      form('secondary', [0, 0.18 * s, 0], [0.74 * s, 0.05 * s, 0.3 * s]),
      plate('detail', [0, 0.46 * s, 0.16 * s], [0.7 * s, 0.52 * s, 0.012 * s]),
    ],
    movables: [
      {
        id: 'slat-lower',
        role: 'interior',
        travel: [0.06 * s, 0.02 * s, 0.02 * s],
        part: form('anchor', [-0.02 * s, 0.28 * s, 0.02 * s], [0.62 * s, 0.05 * s, 0.22 * s]),
      },
      {
        id: 'slat-mid',
        role: 'interior',
        travel: [0.1 * s, 0.05 * s, 0],
        part: form('primary', [0.01 * s, 0.42 * s, 0], [0.58 * s, 0.05 * s, 0.21 * s]),
      },
      {
        id: 'slat-upper',
        role: 'interior',
        travel: [0.14 * s, 0.09 * s, -0.02 * s],
        part: form('secondary', [-0.01 * s, 0.56 * s, -0.02 * s], [0.52 * s, 0.05 * s, 0.2 * s]),
      },
      {
        id: 'read-port',
        role: 'interior',
        travel: [0.2 * s, 0.12 * s, 0.04 * s],
        part: span('anchor', [0.3 * s, 0.62 * s, 0.06 * s], [0.46 * s, 0.66 * s, 0.1 * s], 0.05 * s),
      },
    ],
  };
}

/** GRAPHICS: a layered framebuffer crossed by an interference scan plane. */
function framebuffer(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      form('recess', [-0.04 * s, 0.02 * s, -0.22 * s], [1.0 * s, 0.82 * s, 0.14 * s]),
      span('anchor', [-0.52 * s, -0.42 * s, 0.1 * s], [0.5 * s, 0.46 * s, -0.12 * s], 0.07 * s),
      // The scan plane cuts the stack at an angle: that angle is what makes the
      // layers read as a volume being swept rather than as a flat stack.
      form('primary', [0, 0.04 * s, -0.02 * s], [1.16 * s, 0.02 * s, 0.62 * s], [0.06, 0.24, 0.34]),
      form('secondary', [-0.3 * s, -0.34 * s, 0.16 * s], [0.34 * s, 0.06 * s, 0.26 * s]),
      form('secondary', [0.32 * s, -0.32 * s, 0.14 * s], [0.3 * s, 0.06 * s, 0.24 * s]),
    ],
    movables: [
      {
        // The three layers separate along the view axis *and* fan apart
        // laterally. Depth alone is not enough: the domain faces the camera, so
        // layers that only move in z sit exactly on top of one another and the
        // whole stack still reads as the single flat plate this rebuild exists
        // to get away from.
        id: 'layer-front',
        role: 'interior',
        travel: [0.05 * s, 0.2 * s, 0.3 * s],
        part: plate('anchor', [0, 0.16 * s, 0.2 * s], [0.92 * s, 0.62 * s, 0.012 * s], [0.05, 0.12, 0.02]),
      },
      {
        id: 'layer-mid',
        role: 'interior',
        travel: [0, 0.02 * s, 0.12 * s],
        part: plate('primary', [-0.03 * s, 0.02 * s, 0.1 * s], [0.86 * s, 0.58 * s, 0.012 * s], [-0.06, -0.08, -0.06]),
      },
      {
        id: 'layer-back',
        role: 'interior',
        travel: [-0.04 * s, -0.16 * s, 0.03 * s],
        part: plate('secondary', [0.02 * s, -0.12 * s, 0], [0.78 * s, 0.52 * s, 0.012 * s], [0.04, 0.14, 0.06]),
      },
    ],
  };
}

/** GAME ANALYSIS: a comparison branch converging on a decision chamber. */
function decisionChamber(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      span('anchor', [-0.5 * s, 0.44 * s, 0.08 * s], [0, 0.02 * s, 0], 0.065 * s),
      span('anchor', [0.5 * s, 0.42 * s, -0.08 * s], [0, 0.02 * s, 0], 0.065 * s),
      form('primary', [0, -0.26 * s, 0], [0.5 * s, 0.4 * s, 0.34 * s], [0.05, 0.08, 0]),
      form('recess', [0, -0.3 * s, -0.16 * s], [0.62 * s, 0.5 * s, 0.16 * s]),
      form('secondary', [-0.4 * s, -0.5 * s, 0.1 * s], [0.26 * s, 0.07 * s, 0.2 * s]),
      form('secondary', [0.4 * s, -0.5 * s, 0.1 * s], [0.26 * s, 0.07 * s, 0.2 * s]),
      plate('detail', [0, -0.26 * s, 0.2 * s], [0.52 * s, 0.42 * s, 0.012 * s]),
    ],
    movables: [
      {
        id: 'verdict-left',
        role: 'interior',
        travel: [-0.12 * s, -0.04 * s, 0.04 * s],
        part: form('primary', [-0.16 * s, -0.24 * s, 0.14 * s], [0.16 * s, 0.16 * s, 0.08 * s]),
      },
      {
        id: 'verdict-right',
        role: 'interior',
        travel: [0.12 * s, -0.06 * s, 0.04 * s],
        part: form('primary', [0.16 * s, -0.26 * s, 0.14 * s], [0.16 * s, 0.16 * s, 0.08 * s]),
      },
      {
        id: 'chamber-lid',
        role: 'interior',
        travel: [0, -0.08 * s, 0.06 * s],
        part: form('anchor', [0, -0.46 * s, 0], [0.56 * s, 0.06 * s, 0.3 * s]),
      },
    ],
  };
}

/** SYSTEMS: a stepped processing stack crossed by a vertical bus. */
function processingStack(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  const steps: readonly { y: number; width: number; depth: number }[] = [
    { y: 0.52, width: 0.66, depth: 0.34 },
    { y: 0.24, width: 0.76, depth: 0.4 },
    { y: -0.06, width: 0.88, depth: 0.46 },
    { y: -0.36, width: 0.7, depth: 0.36 },
  ];
  const tiers: readonly StructureTier[] = ['anchor', 'primary', 'secondary', 'recess'];

  return {
    frame: [
      ...steps.map((step, index) =>
        form(
          tiers[index] ?? 'secondary',
          [((index % 2 === 0 ? -1 : 1) * step.width * 0.06), step.y * s, 0],
          [step.width * s, 0.1 * s, step.depth * s],
        ),
      ),
      span('primary', [0.18 * s, 0.72 * s, 0.06 * s], [0.18 * s, -0.62 * s, 0.06 * s], 0.06 * s),
      span('detail', [-0.3 * s, 0.62 * s, -0.12 * s], [-0.3 * s, -0.5 * s, -0.12 * s], 0.035 * s),
      plate('detail', [0, -0.58 * s, 0.14 * s], [0.78 * s, 0.22 * s, 0.012 * s]),
    ],
    movables: [
      {
        id: 'stack-step-a',
        role: 'interior',
        travel: [-0.06 * s, 0.1 * s, 0.05 * s],
        part: form('anchor', [-0.16 * s, 0.38 * s, 0.14 * s], [0.42 * s, 0.08 * s, 0.24 * s]),
      },
      {
        id: 'stack-step-b',
        role: 'interior',
        travel: [0.06 * s, 0.04 * s, 0.07 * s],
        part: form('primary', [0.14 * s, 0.08 * s, 0.16 * s], [0.46 * s, 0.08 * s, 0.26 * s]),
      },
      {
        id: 'stack-step-c',
        role: 'interior',
        travel: [-0.05 * s, -0.04 * s, 0.09 * s],
        part: form('secondary', [-0.12 * s, -0.22 * s, 0.18 * s], [0.4 * s, 0.08 * s, 0.22 * s]),
      },
    ],
  };
}

/** RESEARCH: an open interference sheet, a lattice, and a probe endpoint. */
function lattice(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      // The sheet is the domain's whole face: large, thin, and clearly a surface
      // rather than a box.
      form('primary', [0, 0, 0], [1.06 * s, 0.78 * s, 0.03 * s], [0.16, 0.2, 0.42]),
      plate('detail', [0.02 * s, 0.02 * s, 0.06 * s], [0.94 * s, 0.7 * s, 0.012 * s], [0.14, 0.18, 0.38]),
      span('anchor', [-0.46 * s, -0.34 * s, -0.06 * s], [0.44 * s, 0.36 * s, 0.06 * s], 0.035 * s),
      span('secondary', [-0.42 * s, 0.34 * s, 0.04 * s], [0.4 * s, -0.3 * s, -0.04 * s], 0.03 * s),
      form('recess', [-0.06 * s, -0.04 * s, -0.24 * s], [0.8 * s, 0.62 * s, 0.12 * s], [0.1, 0.14, 0.3]),
    ],
    movables: [
      {
        id: 'lattice-strut',
        role: 'interior',
        travel: [0.08 * s, 0.06 * s, 0.12 * s],
        part: span('primary', [-0.3 * s, 0.3 * s, 0.16 * s], [0.34 * s, -0.26 * s, 0.14 * s], 0.032 * s),
      },
      {
        id: 'probe-arm',
        role: 'interior',
        travel: [0.24 * s, 0.16 * s, 0.06 * s],
        part: span('anchor', [0.44 * s, 0.3 * s, 0.1 * s], [0.72 * s, 0.5 * s, 0.16 * s], 0.04 * s),
      },
      {
        id: 'probe-tip',
        role: 'interior',
        travel: [0.3 * s, 0.2 * s, 0.08 * s],
        part: form('anchor', [0.76 * s, 0.52 * s, 0.18 * s], [0.1 * s, 0.1 * s, 0.1 * s]),
      },
    ],
  };
}

const BUILDERS: Readonly<
  Record<
    DomainVisualNodeId,
    {
      readonly kind: DomainEnvironmentKind;
      readonly axis: Vector;
      readonly extent: number;
      readonly build: (scale: number) => {
        frame: StructurePart[];
        movables: DomainMovable[];
      };
    }
  >
> = {
  ai: { kind: 'packet-buffer', axis: [1, 0.22, 0.08], extent: 0.92, build: packetBuffer },
  graphics: { kind: 'framebuffer', axis: [0.06, 0.12, 1], extent: 1.02, build: framebuffer },
  'game-analysis': {
    kind: 'decision-chamber',
    axis: [0.82, 0.56, -0.08],
    extent: 0.88,
    build: decisionChamber,
  },
  systems: { kind: 'processing-stack', axis: [0.08, 1, 0.2], extent: 0.96, build: processingStack },
  research: { kind: 'lattice', axis: [0.68, 0.36, 0.62], extent: 1.0, build: lattice },
};

/** A richer profile grows the whole sub-environment, not just its brightness. */
function scaleForDetail(detail: number): number {
  const bounded = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;
  return 0.86 + bounded * 0.14;
}

/**
 * How far a domain is built out at this detail level.
 *
 * SAFE keeps the silhouette whole — a domain that lost its buffered layers would
 * stop being a sub-environment and become an icon again — so detail scales the
 * envelope and adds interior layers, and never subtracts the frame.
 *
 * The thresholds are the tiers' own values: SAFE (0.4) keeps one moving layer,
 * MEDIUM (0.68) two, and HIGH and ULTRA (0.86, 1) the whole interior. A tier
 * progression that stepped between none of them would be a brightness knob
 * wearing a quality profile's name.
 */
const FULL_INTERIOR_DETAIL = 0.8;
const PAIRED_INTERIOR_DETAIL = 0.5;

function trimForDetail(
  frame: readonly StructurePart[],
  movables: readonly DomainMovable[],
  detail: number,
): { frame: readonly StructurePart[]; movables: readonly DomainMovable[] } {
  const bounded = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;
  if (bounded >= FULL_INTERIOR_DETAIL) return { frame, movables };

  const kept = bounded >= PAIRED_INTERIOR_DETAIL ? 2 : 1;
  return {
    frame:
      bounded >= PAIRED_INTERIOR_DETAIL
        ? frame
        : frame.filter((part) => !part.membrane || part.tier !== 'detail'),
    movables: movables.filter((movable) => movable.role === 'ingress').concat(
      movables.filter((movable) => movable.role === 'interior').slice(0, kept),
    ),
  };
}

/**
 * Deterministic sub-environment for one semantic domain.
 *
 * The ingress comes from the routing layer because the opening has to be where
 * the route actually arrives; everything else is the domain's own architecture.
 */
export function deriveDomainEnvironment(
  nodeId: DomainVisualNodeId,
  anchor: GraphPosition,
  ingress: DomainIngress,
  detail: number,
): DomainEnvironment {
  const preset = BUILDERS[nodeId];
  const axis = normalize(preset.axis);
  const scale = scaleForDetail(detail);
  const built = preset.build(scale);
  const trimmed = trimForDetail(built.frame, built.movables, detail);
  const jaws = ingressAssembly(ingress, anchor, axis, scale);
  const movables = [...jaws, ...trimmed.movables];

  return {
    nodeId,
    kind: preset.kind,
    anchor,
    frame: trimmed.frame,
    movables,
    parts: [...trimmed.frame, ...movables.map((movable) => movable.part)],
    ingress,
    ingressLocal: subtract(ingress.position, anchor),
    activationAxis: axis,
    extent: preset.extent * scale,
    scale,
  };
}
