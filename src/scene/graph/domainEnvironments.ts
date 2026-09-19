import type { GraphPosition } from '../../graph/types';
import type {
  StructurePart,
  StructureTier,
  SurfaceClass,
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
 *
 * The shared language is a specific one, and it is the hero's: **a body with
 * mass whose front is open, holding large layered surfaces**. Two earlier
 * revisions got this wrong from opposite sides — the first built each domain
 * around one wide slab, which reads as an icon of a machine, and the second
 * replaced the slab with a frame of thin members, which reads as a wireframe of
 * one. Both fail the same test: at the framing the scene is actually viewed at,
 * there is nothing with enough section to read as a manufactured volume. So the
 * rule the builders below follow is that every domain has a closed back face and
 * real side mass in the `anchor`..`secondary` tiers, nothing thinner than about
 * a tenth of a unit, and an interior of large plates rather than a scaffold.
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
  /**
   * What is baked into the domain's one merged mass — the frame, and only the
   * frame.
   *
   * This used to be `[...frame, ...movables]`, and the view bakes `parts` while
   * also drawing every movable as its own mesh. Both halves are right on their
   * own and together they are a defect: at rest `pose` is zero, so each movable
   * sat exactly on top of its own baked copy and every domain carried three to
   * five coplanar pairs fighting for the same depth — and once a movable did
   * move, the merged copy stayed behind as a ghost of where it had been. Five
   * domains each fighting themselves is most of why they read as broken frames
   * rather than as machines.
   */
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
  surface: SurfaceClass = 'shell',
): StructurePart {
  return { shape: 'form', tier, surface, position, rotation, scale };
}

function span(
  tier: StructureTier,
  start: Vector,
  end: Vector,
  width: number,
  depth = width,
  surface: SurfaceClass = 'shell',
): StructurePart {
  return { shape: 'span', tier, surface, start, end, width, depth };
}

/** Thin vertical plate: a membrane in the machine's own idiom. */
function plate(
  tier: StructureTier,
  position: Vector,
  scale: Vector,
  rotation: Vector = [0, 0, 0],
): StructurePart {
  return form(tier, position, scale, rotation, 'membrane');
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
  // The jaws have to part by enough to be read as a mouth opening in a still
  // frame, not by enough to be technically present. At the old 0.05 + 0.06·scale
  // they moved about a tenth of a unit at full activation, which is under a
  // pixel at the framing the scene is actually viewed at.
  const travel = 0.14 + scale * 0.2;

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
          local[0] + direction[0] * scale * 0.3,
          local[1] + direction[1] * scale * 0.3,
          local[2] + direction[2] * scale * 0.3,
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
          local[0] + direction[0] * scale * 0.3,
          local[1] + direction[1] * scale * 0.3,
          local[2] + direction[2] * scale * 0.3,
        ],
        ingress.halfWidth * 0.7,
        ingress.halfWidth * 0.7,
      ),
    },
  ];
}

/**
 * AI: a tall canted housing holding a bank of packet trays, with a read head.
 *
 * Every domain here is built the same way the hero is: a body with real mass
 * whose front is open, and large layered surfaces inside it. The five domains
 * previously differed mostly in which thin members they were drawn from — two
 * posts, a rail and a cage, at widths of three to seven hundredths of a unit —
 * and at the framing the scene is viewed at that is a handful of pixels. They
 * read as wireframes of machines, which is the same failure as reading as icons,
 * arrived at from the other side.
 *
 * The second attempt fixed the section and kept the arrangement, and the frame
 * said the arrangement was the problem. A domain is drawn at about 250 pixels
 * across, and an open front bounded by four members is, at that size, the
 * *outline* of a rectangle however thick the members are: the eye completes the
 * rectangle and reads a picture frame with a slab inside it, because that is
 * what is on the screen. GRAPHICS and RESEARCH both read that way in the
 * measured frame, and RESEARCH was the worst of the five while being the one
 * with the most careful truss.
 *
 * So each domain is a closed body with an opening cut into its front now, the
 * same construction as the monolith: walls on every side, a solid back, a dark
 * recessed interior panel, and the layered surfaces in the gap. The members that
 * used to *be* the frame are the mass at the corners of it, and the tiers are
 * spent on the two or three largest volumes rather than distributed over a ring
 * of small ones.
 */
function packetBuffer(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      // A closed body: back, two walls, cap and base, with the front left open
      // so the tray bank is read in depth rather than as a face.
      form('secondary', [0, 0.02 * s, -0.44 * s], [1.02 * s, 1.3 * s, 0.22 * s], [0.03, 0.06, 0.05]),
      form('anchor', [-0.52 * s, 0.06 * s, -0.08 * s], [0.22 * s, 1.22 * s, 0.66 * s], [0.04, 0.07, 0.05]),
      form('anchor', [0.52 * s, -0.02 * s, -0.04 * s], [0.22 * s, 1.26 * s, 0.62 * s], [-0.05, -0.1, -0.05]),
      form('primary', [0.02 * s, 0.68 * s, -0.08 * s], [1.2 * s, 0.22 * s, 0.64 * s], [0.03, 0.11, 0.03]),
      form('primary', [-0.02 * s, -0.66 * s, -0.04 * s], [1.12 * s, 0.24 * s, 0.66 * s], [-0.02, 0.05, 0.07]),
      // The interior panel, a tier down and set back: what the trays are read
      // against, and what keeps the inside of the body dark around them.
      form('secondary', [0, 0.02 * s, -0.3 * s], [0.92 * s, 1.12 * s, 0.06 * s], [0.03, 0.07, 0.05], 'recess'),
      // The read head, cantilevered over the mouth.
      form('secondary', [0.06 * s, 0.8 * s, 0.28 * s], [0.6 * s, 0.22 * s, 0.3 * s], [0.22, 0.16, 0.12]),
      plate('detail', [0, 0.02 * s, -0.26 * s], [0.9 * s, 1.1 * s, 0.014 * s], [0.03, 0.09, 0.06]),
    ],
    movables: [
      {
        id: 'tray-lower',
        role: 'interior',
        travel: [0.04 * s, 0.16 * s, 0.08 * s],
        part: form('anchor', [-0.02 * s, -0.36 * s, 0.1 * s], [0.8 * s, 0.17 * s, 0.44 * s], [0.02, 0.1, 0.02]),
      },
      {
        id: 'tray-mid',
        role: 'interior',
        travel: [0.12 * s, 0.28 * s, 0.03 * s],
        part: form('primary', [0.03 * s, 0.02 * s, 0.08 * s], [0.76 * s, 0.17 * s, 0.42 * s], [-0.02, -0.06, 0.03]),
      },
      {
        id: 'tray-upper',
        role: 'interior',
        travel: [0.2 * s, 0.4 * s, -0.02 * s],
        part: form('secondary', [-0.03 * s, 0.38 * s, 0.1 * s], [0.7 * s, 0.17 * s, 0.4 * s], [0.03, 0.14, -0.03]),
      },
      {
        // The bank itself, as one layered surface between the trays: the domain
        // is a buffer, so what it holds should read as a stack, not a scaffold.
        id: 'bank-sheet',
        role: 'interior',
        travel: [0.16 * s, 0.32 * s, 0.22 * s],
        part: plate('detail', [0, 0.02 * s, 0.18 * s], [0.86 * s, 1.0 * s, 0.014 * s], [0.02, 0.08, 0.04]),
      },
      {
        id: 'read-port',
        role: 'interior',
        travel: [0.3 * s, 0.46 * s, 0.12 * s],
        part: span('anchor', [0.34 * s, 0.8 * s, 0.28 * s], [0.66 * s, 0.86 * s, 0.32 * s], 0.12 * s),
      },
    ],
  };
}

/**
 * GRAPHICS: a wide, low closed housing holding four framebuffer layers, with a
 * scan rail crossing the mouth.
 *
 * The wide, low proportion is doing as much work as the construction is. Four of
 * the five domains are around a unit across in both axes and this one is nearly
 * half again as wide as it is tall, which is the only thing at domain scale that
 * survives the thumbnail — a silhouette difference reads further than a
 * structural one, and the brief asks for five bays rather than five of one bay.
 */
function framebuffer(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      // Jaws above and below, posts left and right, and a back wall behind them:
      // a closed box with the whole of its front open, so the stack of films is
      // seen through a slot rather than framed by a rectangle.
      form('secondary', [0, 0.02 * s, -0.46 * s], [1.34 * s, 0.9 * s, 0.2 * s], [0.02, 0.04, 0.02]),
      form('anchor', [-0.04 * s, 0.48 * s, 0.0 * s], [1.26 * s, 0.26 * s, 0.7 * s], [0.06, 0.12, 0.03]),
      form('anchor', [0.04 * s, -0.48 * s, -0.02 * s], [1.2 * s, 0.28 * s, 0.66 * s], [-0.05, -0.1, -0.04]),
      form('primary', [-0.6 * s, 0.0 * s, -0.14 * s], [0.24 * s, 0.9 * s, 0.54 * s], [0.03, 0.08, 0.05]),
      form('primary', [0.6 * s, 0.04 * s, -0.1 * s], [0.24 * s, 0.84 * s, 0.5 * s], [-0.04, -0.07, -0.05]),
      // The interior panel: the dark the films are read against.
      form('secondary', [0.02 * s, 0.02 * s, -0.34 * s], [0.96 * s, 0.64 * s, 0.06 * s], [0.02, 0.04, 0.01], 'recess'),
      // The scan rail crosses the mouth at an angle. The angle is what makes the
      // layers read as a volume being swept rather than as a flat stack.
      span('secondary', [-0.84 * s, 0.42 * s, 0.38 * s], [0.8 * s, -0.36 * s, 0.34 * s], 0.07 * s),
      plate('detail', [0.02 * s, 0.02 * s, -0.4 * s], [0.9 * s, 0.62 * s, 0.012 * s], [0.02, 0.04, 0.02]),
    ],
    movables: [
      {
        // Four layers, already separated in depth at rest and fanning apart
        // laterally as the domain engages. Depth alone would not be enough: the
        // stack faces the camera, so layers that only move in z sit exactly on
        // top of one another and the whole thing still reads as one slab.
        //
        // No layer is an `anchor`. The front one used to be, and it was also the
        // largest, so the brightest tier colour in the palette sat on the biggest
        // plate in the domain and a focused GRAPHICS was one blank white card
        // with three edges behind it. A stack has to read as a stack: the plates
        // are near the same size, all canted differently, and no one of them
        // carries the top tier on its own.
        id: 'layer-front',
        role: 'interior',
        travel: [0.14 * s, 0.34 * s, 0.46 * s],
        part: plate('primary', [-0.03 * s, 0.04 * s, 0.24 * s], [0.74 * s, 0.5 * s, 0.012 * s], [0.15, 0.24, 0.12]),
      },
      {
        id: 'layer-upper',
        role: 'interior',
        travel: [0.26 * s, 0.5 * s, 0.26 * s],
        part: plate('primary', [0.04 * s, 0.26 * s, 0.06 * s], [0.8 * s, 0.54 * s, 0.012 * s], [-0.13, -0.18, -0.11]),
      },
      {
        id: 'layer-mid',
        role: 'interior',
        travel: [-0.2 * s, -0.04 * s, 0.34 * s],
        part: plate('secondary', [0.02 * s, -0.02 * s, -0.12 * s], [0.84 * s, 0.58 * s, 0.012 * s], [0.11, 0.2, 0.13]),
      },
      {
        id: 'layer-back',
        role: 'interior',
        travel: [-0.34 * s, -0.46 * s, 0.16 * s],
        part: plate('secondary', [-0.04 * s, -0.24 * s, -0.3 * s], [0.76 * s, 0.5 * s, 0.012 * s], [-0.09, 0.15, 0.07]),
      },
    ],
  };
}

/**
 * GAME ANALYSIS: two comparison chambers side by side, converging on a junction.
 *
 * The pair is the whole read, so it is built as two bodies rather than as one
 * chamber with two arms attached: a domain that is *about* comparing has to show
 * two of something, and two closed housings with a seam between them say that at
 * any size the frame is looked at from. The arms then carry the convergence
 * out of the pair and into the junction behind it.
 */
function decisionChamber(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      // The junction the pair converge on: the domain's closed back.
      form('secondary', [0.02 * s, -0.04 * s, -0.48 * s], [1.0 * s, 0.8 * s, 0.2 * s], [0.02, 0.05, 0.04]),
      // The two chambers. Different heights and offsets, because a matched pair
      // reads as a part number rather than as two things being compared.
      form('anchor', [-0.36 * s, 0.04 * s, -0.12 * s], [0.58 * s, 0.96 * s, 0.6 * s], [0.04, 0.06, 0.03]),
      form('anchor', [0.38 * s, -0.06 * s, -0.08 * s], [0.56 * s, 0.9 * s, 0.56 * s], [-0.04, -0.07, -0.03]),
      form('primary', [0, -0.66 * s, -0.06 * s], [1.04 * s, 0.24 * s, 0.64 * s]),
      // Arms from each chamber's shoulder back to the junction.
      span('primary', [-0.74 * s, 0.58 * s, 0.06 * s], [-0.2 * s, 0.2 * s, -0.02 * s], 0.22 * s, 0.2 * s),
      span('primary', [0.76 * s, 0.54 * s, -0.1 * s], [0.22 * s, 0.18 * s, -0.04 * s], 0.22 * s, 0.2 * s),
      // The seam between the chambers, recessed: the one place the pair is
      // divided rather than joined.
      form('secondary', [0.01 * s, -0.1 * s, -0.26 * s], [0.1 * s, 0.72 * s, 0.5 * s], [0.02, 0.05, 0.02], 'recess'),
      plate('detail', [0, -0.24 * s, -0.22 * s], [0.82 * s, 0.6 * s, 0.014 * s], [0.02, 0.06, 0.03]),
    ],
    movables: [
      {
        id: 'verdict-left',
        role: 'interior',
        travel: [-0.24 * s, -0.06 * s, 0.1 * s],
        part: form('primary', [-0.2 * s, -0.34 * s, 0.18 * s], [0.28 * s, 0.3 * s, 0.16 * s], [0, 0.08, 0.04]),
      },
      {
        id: 'verdict-right',
        role: 'interior',
        travel: [0.24 * s, -0.08 * s, 0.1 * s],
        part: form('secondary', [0.2 * s, -0.36 * s, 0.18 * s], [0.28 * s, 0.3 * s, 0.16 * s], [0, -0.07, -0.04]),
      },
      {
        // The verdict sheet between them: what the chamber is actually holding.
        id: 'verdict-sheet',
        role: 'interior',
        travel: [0, -0.02 * s, 0.24 * s],
        part: plate('detail', [0, -0.34 * s, 0.16 * s], [0.62 * s, 0.42 * s, 0.014 * s], [0.02, 0.05, 0.03]),
      },
      {
        // The lid itself: the pair opens by lifting one common cap clear of both
        // chambers rather than by brightening. It spans the two, so the opening
        // is read as the bay opening and not as one chamber moving.
        id: 'chamber-lid',
        role: 'interior',
        travel: [0, 0.3 * s, 0.04 * s],
        part: form('anchor', [0.01 * s, 0.58 * s, -0.06 * s], [1.06 * s, 0.16 * s, 0.6 * s], [0.02, 0.04, 0.02]),
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
  // Four decks, each a solid slab with real thickness, offset alternately so the
  // stack reads as stepped rather than as a rack of shelves. They used to be a
  // tenth of a unit tall and a tenth of that deep, which is a shelf; a deck has
  // to have enough section to cast its own shadow line.
  const steps: readonly { y: number; width: number; depth: number; tier: StructureTier }[] = [
    { y: 0.62, width: 1.0, depth: 0.62, tier: 'anchor' },
    { y: 0.26, width: 1.14, depth: 0.68, tier: 'primary' },
    { y: -0.1, width: 1.2, depth: 0.72, tier: 'primary' },
    { y: -0.46, width: 1.06, depth: 0.66, tier: 'secondary' },
  ];

  return {
    frame: [
      // A closed back plane behind the decks: the stack's silhouette.
      form('secondary', [0, 0.06 * s, -0.48 * s], [1.24 * s, 1.34 * s, 0.22 * s], [0.02, 0.05, 0.06]),
      ...steps.map((step, index) =>
        form(
          step.tier,
          [((index % 2 === 0 ? -1 : 1) * 0.07 * s), step.y * s, index * 0.02 * s],
          [step.width * s, 0.2 * s, step.depth * s],
          [0.01 * index, 0.02 * index, 0],
        ),
      ),
      // The routing backplane: the surface the stack is mounted on and the one
      // the domain's own routing runs across.
      form('secondary', [0, 0.04 * s, -0.3 * s], [1.14 * s, 1.24 * s, 0.05 * s], [0.02, 0.05, 0.06], 'recess'),
      // The bus crosses the front of the stack, so the decks read as being
      // addressed by something rather than merely piled.
      span('anchor', [0.26 * s, 0.92 * s, 0.3 * s], [0.26 * s, -0.72 * s, 0.3 * s], 0.18 * s, 0.16 * s),
      span('primary', [-0.46 * s, 0.84 * s, -0.12 * s], [-0.46 * s, -0.62 * s, -0.12 * s], 0.14 * s),
      plate('detail', [0, -0.54 * s, 0.32 * s], [0.9 * s, 0.24 * s, 0.014 * s]),
    ],
    movables: [
      {
        id: 'stack-deck-a',
        role: 'interior',
        travel: [-0.08 * s, 0.12 * s, 0.16 * s],
        part: form('anchor', [-0.14 * s, 0.44 * s, 0.24 * s], [0.62 * s, 0.11 * s, 0.4 * s], [0.02, 0.06, 0.02]),
      },
      {
        id: 'stack-deck-b',
        role: 'interior',
        travel: [0.08 * s, 0.05 * s, 0.2 * s],
        part: form('primary', [0.16 * s, 0.11 * s, 0.26 * s], [0.68 * s, 0.11 * s, 0.42 * s], [-0.02, -0.05, 0.03]),
      },
      {
        id: 'stack-deck-c',
        role: 'interior',
        travel: [-0.06 * s, -0.05 * s, 0.24 * s],
        part: form('secondary', [-0.1 * s, -0.23 * s, 0.28 * s], [0.6 * s, 0.11 * s, 0.38 * s], [0.02, 0.08, -0.02]),
      },
    ],
  };
}

/**
 * RESEARCH: a small dense body inside a sparse cage, plus a probe arm.
 *
 * The brief asks for research to be the sparse, probing one, and sparse is a
 * *comparative* word: it only reads if the body is smaller than the others and
 * the members around it are fewer, not if the whole bay is drawn in hairlines.
 * So the mass here is a single compact canted volume — the densest of the five
 * against its own envelope — with open space and two long posts around it, which
 * is the one domain whose silhouette is a small thing in a large frame.
 */
function lattice(scale: number): {
  frame: StructurePart[];
  movables: DomainMovable[];
} {
  const s = scale;
  return {
    frame: [
      // The body the cage is built around, canted so it is read as a volume
      // under load rather than as a panel hung in a frame.
      form('anchor', [0, 0, -0.08 * s], [0.86 * s, 0.92 * s, 0.58 * s], [0.12, 0.18, 0.36]),
      // A closed back, so the cage is a bay with a wall rather than a truss
      // standing in the void.
      form('secondary', [0, 0, -0.48 * s], [1.0 * s, 1.02 * s, 0.2 * s], [0.1, 0.14, 0.3]),
      // Two posts and two rails: a cage, but a sparse one, and it stands off the
      // body rather than closing a rectangle around the front of it.
      span('anchor', [-0.68 * s, 0.74 * s, 0.2 * s], [-0.68 * s, -0.74 * s, -0.1 * s], 0.16 * s),
      span('anchor', [0.68 * s, 0.7 * s, -0.2 * s], [0.68 * s, -0.7 * s, 0.1 * s], 0.16 * s),
      span('primary', [-0.7 * s, 0.74 * s, 0.18 * s], [0.7 * s, 0.7 * s, -0.18 * s], 0.16 * s),
      form('secondary', [0, 0, -0.3 * s], [0.62 * s, 0.66 * s, 0.05 * s], [0.1, 0.14, 0.3], 'recess'),
      plate('detail', [0, 0, -0.38 * s], [0.92 * s, 0.9 * s, 0.014 * s], [0.1, 0.14, 0.3]),
    ],
    movables: [
      {
        id: 'lattice-panel',
        role: 'interior',
        travel: [0.1 * s, 0.06 * s, 0.3 * s],
        part: plate('primary', [-0.02 * s, 0, 0.22 * s], [0.76 * s, 0.72 * s, 0.014 * s], [0.1, 0.16, 0.32]),
      },
      {
        id: 'lattice-strut',
        role: 'interior',
        travel: [0.14 * s, 0.1 * s, 0.22 * s],
        part: span('anchor', [-0.4 * s, 0.34 * s, 0.26 * s], [0.02 * s, -0.06 * s, 0.24 * s], 0.1 * s),
      },
      {
        id: 'probe-arm',
        role: 'interior',
        travel: [0.3 * s, 0.22 * s, 0.12 * s],
        part: span('anchor', [0.5 * s, 0.4 * s, 0.16 * s], [0.84 * s, 0.64 * s, 0.24 * s], 0.1 * s),
      },
      {
        id: 'probe-tip',
        role: 'interior',
        travel: [0.36 * s, 0.26 * s, 0.14 * s],
        part: form('primary', [0.88 * s, 0.66 * s, 0.26 * s], [0.18 * s, 0.18 * s, 0.18 * s]),
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
  ai: { kind: 'packet-buffer', axis: [1, 0.22, 0.08], extent: 1.06, build: packetBuffer },
  graphics: { kind: 'framebuffer', axis: [0.06, 0.12, 1], extent: 1.12, build: framebuffer },
  'game-analysis': {
    kind: 'decision-chamber',
    axis: [0.82, 0.56, -0.08],
    extent: 0.94,
    build: decisionChamber,
  },
  systems: { kind: 'processing-stack', axis: [0.08, 1, 0.2], extent: 1.0, build: processingStack },
  research: { kind: 'lattice', axis: [0.68, 0.36, 0.62], extent: 1.1, build: lattice },
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
        : frame.filter((part) => part.surface !== 'membrane' || part.tier !== 'detail'),
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
    parts: trimmed.frame,
    ingress,
    ingressLocal: subtract(ingress.position, anchor),
    activationAxis: axis,
    extent: preset.extent * scale,
    scale,
  };
}
