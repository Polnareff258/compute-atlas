import type { SurfaceClass } from '../materials/structureGeometry';
import { hashUnit, normalizeSeed } from '../seedRandom';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreStructureBand = 'background' | 'midground' | 'foreground';
export type CoreStructureTier =
  | 'anchor'
  | 'primary'
  | 'secondary'
  | 'detail'
  | 'recess';
export type CoreStructureShape =
  | 'hull'
  | 'volume'
  | 'beam'
  | 'membrane'
  | 'port'
  | 'slice'
  | 'path';

type Vector = readonly [number, number, number];

/**
 * The finish a member bakes into, named with the same word as the material role
 * that will render it.
 *
 * A structure this size cannot answer a state through one material: a single
 * merged mass has exactly one lever, so everything about it moves together or
 * nothing does, and the result is a machine that has been tinted rather than one
 * that is doing something. Splitting the members by finish is what lets a hover
 * reach the aperture while the shell holds still.
 */
export type CoreSurfaceClass = SurfaceClass;

type MemberBase = {
  readonly tier: CoreStructureTier;
  readonly band: CoreStructureBand;
  readonly surface: CoreSurfaceClass;
  /** Membrane openness at rest; 0 for every solid class. */
  readonly fade: number;
  /** Structural rank inside its band, used only for stable draw ordering. */
  readonly rank: number;
};

/** Axis-oriented member: a plate, wafer, die or socket. */
export type CoreStructureForm = MemberBase & {
  readonly shape: Exclude<CoreStructureShape, 'beam' | 'hull' | 'path'>;
  readonly position: Vector;
  readonly rotation: Vector;
  readonly scale: Vector;
};

/** Endpoint-defined member: a liner, a rail, a buttress. */
export type CoreStructureSpan = MemberBase & {
  readonly shape: 'beam';
  readonly start: Vector;
  readonly end: Vector;
  /** Cross-section across and through the span axis. */
  readonly width: number;
  readonly depth: number;
};

/**
 * A machined body: a profile lofted through sections between two endpoints.
 *
 * A box is the same silhouette from every angle and cannot taper; a hull's
 * sections differ, so a body narrows where it meets its shoulder, closes on a
 * chamfered end and reads as one machined part. A hull is always a closed
 * convex prism, which is exactly what it is for — and exactly why it cannot
 * express the aperture this Core is built around.
 */
export type CoreStructureHull = MemberBase & {
  readonly shape: 'hull';
  readonly start: Vector;
  readonly end: Vector;
  /** 0 for a chamfered rectangle section, 3+ for a regular n-gon prism. */
  readonly facets: number;
  readonly chamfer: number;
  readonly sections: readonly CoreHullSection[];
};

export type CoreHullSection = {
  readonly t: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly offset: readonly [number, number];
};

/**
 * A profile swept along a polyline, open or closed.
 *
 * This is the member the monolith is built from, and it is the only one here
 * that can express a hole. A closed path swept with a wall section is a ring of
 * solid material around an opening: the central computational aperture is that
 * opening, and the depth of the aperture is the section's own depth rather than
 * a second part placed behind a flat frame. An open path is a folded shell, a
 * manifold channel or a conduit depending only on its profile, which is why one
 * generator covers the whole family instead of three that resemble each other.
 */
export type CoreStructurePath = MemberBase & {
  readonly shape: 'path';
  readonly points: readonly Vector[];
  readonly closed: boolean;
  /** Wall half-thickness in the path's own plane, or one value per point. */
  readonly halfWidth: number | readonly number[];
  /** Section half-depth, or one value per point. */
  readonly halfHeight: number | readonly number[];
  readonly chamfer: number;
  /** Reference for the section's local +y, projected perpendicular to the path. */
  readonly reference: Vector;
};

export type CoreStructureMember =
  | CoreStructureForm
  | CoreStructureSpan
  | CoreStructureHull
  | CoreStructurePath;

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
  /** Long axis of the aperture, which is the direction its internal flow runs. */
  readonly spineAxis: Vector;
  /** Luminance-weighted extent, used to keep the hero at 55–65% of frame. */
  readonly heroScale: number;
};

/** Half-extents of the mass including its folds, in design units. */
const LOCAL_BOUNDS: Vector = [2.11, 1.2, 0.62];

/**
 * Additive detail gates, in ascending order. SAFE keeps the monolith, its
 * aperture, both folded shells, the aperture floor and the two attached
 * processing assemblies; every later tier adds surfaces inside the body rather
 * than turning anything up or changing the outline.
 */
const WAFER_DETAIL = 0.25;
const MANIFOLD_DETAIL = 0.45;
const MEMBRANE_DETAIL = 0.6;
const ASSEMBLY_DETAIL = 0.72;
const DIE_DETAIL = 0.88;

/**
 * The hero is authored in design units and scaled once, here.
 *
 * The numbers below are written at a size where the whole body is about four
 * units across, which is the size at which the wall thicknesses and the
 * aperture's proportions can be reasoned about directly. The scale that makes
 * the mass read at roughly three fifths of the frame is applied in one place,
 * and the ports, the centroid and the bounds move with it — which is what keeps
 * the routes attached to the surface they leave.
 */
const CORE_SCALE = 1.9;

/**
 * The monolith: the whole main mass as one closed ring, and the reason this
 * Core has an aperture rather than a gap between two parts.
 *
 * The outline is deliberately asymmetric in both axes. It is wider at the right
 * shoulder than at the left, heavier along the bottom than the top, and its
 * wall thickness walks from 0.11 to 0.22 around the ring — a wall that carries
 * one thickness all the way round a closed path is an extruded picture frame,
 * whereas a wall that is heavy at the foot and thin at the shoulder is a
 * machined body that happens to have an opening through it.
 *
 * Depth comes from `halfHeight`, the section's extent along the view axis: the
 * ring is a third of a unit deep, so the opening is a recess with its own floor
 * and its own darkening rather than a hole cut in a card.
 */
const MONOLITH = {
  points: [
    [-1.86, -0.14, 0.05],
    [-1.52, -0.62, 0.02],
    [-0.42, -0.8, -0.02],
    [0.8, -0.66, -0.03],
    [1.46, -0.08, 0.01],
    [1.2, 0.54, 0.06],
    [0.36, 0.78, 0.08],
    [-0.94, 0.62, 0.07],
  ],
  halfWidth: [0.22, 0.22, 0.19, 0.21, 0.22, 0.15, 0.11, 0.13],
  halfHeight: [0.3, 0.28, 0.26, 0.28, 0.34, 0.34, 0.28, 0.24],
  chamfer: 0.3,
  reference: [0, 0, 1],
} as const;

/**
 * The crown fold: a ribbon that rides over the top of the monolith and past its
 * right shoulder.
 *
 * It is a shell rather than a trim: it stands off the monolith's own surface,
 * varies in width along its length, and leaves the body's outline at both ends,
 * so the mass reads as layered plate rather than as one extruded block. Its
 * height is what gives the silhouette its one asymmetric peak.
 */
const CROWN_FOLD = {
  points: [
    [-1.3, 0.7, 0.28],
    [-0.76, 0.96, 0.33],
    [0.18, 1.04, 0.31],
    [0.96, 0.9, 0.25],
    [1.44, 0.46, 0.18],
  ],
  halfWidth: [0.07, 0.14, 0.16, 0.13, 0.08],
  halfHeight: 0.05,
  chamfer: 0.32,
  reference: [0, 0, 1],
} as const;

/**
 * The flank fold: the counterweight, folding down the left edge and forward
 * under the foot.
 *
 * The composition needs one corner where the machine is heavy, and this is it.
 * The weight is in the placement rather than in a thicker section: the ribbon
 * leaves the monolith's outline on the left and below, so the eye reads mass
 * piling up at the lower left while the upper right stays open. Restraint there
 * is what makes the density at the aperture legible.
 */
const FLANK_FOLD = {
  points: [
    [-1.66, 0.44, 0.24],
    [-1.96, -0.1, 0.14],
    [-1.82, -0.6, 0.02],
    [-1.24, -1.0, -0.06],
    [-0.52, -1.1, -0.12],
  ],
  halfWidth: [0.09, 0.15, 0.17, 0.15, 0.09],
  halfHeight: 0.07,
  chamfer: 0.3,
  reference: [0, 0, 1],
} as const;

type PathDefinition = Omit<CoreStructurePath, 'shape' | 'band' | 'fade' | 'rank' | 'tier' | 'surface'>;

type HullDefinition = Omit<
  CoreStructureHull,
  'shape' | 'band' | 'fade' | 'rank' | 'tier' | 'surface'
>;

/**
 * The aperture floor.
 *
 * Without it the opening would be a hole through to the background, which reads
 * as a picture frame; with it the opening is a recess with a back, and the
 * depth baked into the `recess` class darkens that back further than anything
 * on the front plane. It is the single largest surface inside the body, and it
 * is the one the routing field runs across.
 */
const APERTURE_FLOOR = {
  position: [0, 0.02, -0.4],
  rotation: [0, 0, 0],
  scale: [2.52, 1.36, 0.05],
} as const;

/**
 * Wafers: thin plates carried inside the aperture, at their own depths and
 * angles. They are the scale contrast the composition needs — the body is four
 * units across and these are a third of a unit, so the eye gets a dense local
 * region to read rather than one uniform level of detail everywhere.
 */
const WAFERS = [
  { position: [-0.62, 0.1, -0.1], rotation: [0.06, -0.22, 0.1], scale: [1.05, 0.62, 0.035], surface: 'accent' },
  { position: [0.32, -0.08, 0.02], rotation: [-0.05, 0.18, -0.08], scale: [0.92, 0.5, 0.03], surface: 'recess' },
  { position: [0.86, 0.16, -0.16], rotation: [0.1, 0.3, 0.12], scale: [0.6, 0.4, 0.028], surface: 'accent' },
  { position: [-1.05, -0.22, -0.2], rotation: [-0.08, -0.3, -0.1], scale: [0.5, 0.34, 0.03], surface: 'recess' },
] as const;

/**
 * Compute dies: the small solid blocks the interior links run between.
 *
 * They are volumes rather than slices so the Core's own circulation has
 * something to connect, which is what makes the inside of the aperture read as
 * computed-in rather than hollow.
 */
const DIES = [
  { position: [-0.1, -0.16, -0.06], rotation: [0.1, 0.2, 0.06], scale: [0.22, 0.16, 0.12], surface: 'accent' },
  { position: [0.68, 0.22, -0.02], rotation: [-0.08, -0.16, -0.1], scale: [0.18, 0.14, 0.1], surface: 'accent' },
  { position: [-0.98, 0.34, -0.14], rotation: [0.05, 0.24, 0.12], scale: [0.16, 0.2, 0.09], surface: 'recess' },
] as const;

/** Layered membranes inside the aperture. The only class that blends. */
const APERTURE_MEMBRANES = [
  { position: [-0.3, 0.02, 0.16], rotation: [0.08, -0.26, 0.14], scale: [1.25, 0.7, 0.01], fade: 0.42 },
  { position: [0.55, -0.02, -0.22], rotation: [-0.06, 0.2, -0.1], scale: [0.95, 0.55, 0.01], fade: 0.3 },
] as const;

/**
 * Routing manifolds: the channels cut into the body.
 *
 * These are the one place the model of the machine and the model of the routing
 * field agree, which is the point of having them at all. The field does not
 * float beside the Core or run along a dashed line to it; it is carried in
 * channels that are part of the mass, so the flow has a wall to be inside. Each
 * one starts in the aperture, crosses the monolith's wall and leaves along an
 * outer surface.
 */
const MANIFOLDS = [
  {
    points: [
      [-0.7, 0.3, 0.1],
      [0.2, 0.44, 0.14],
      [0.92, 0.6, 0.16],
      [1.34, 0.78, 0.2],
    ],
    halfWidth: 0.055,
    halfHeight: 0.055,
  },
  {
    points: [
      [-1.3, -0.52, 0.16],
      [-0.4, -0.62, 0.22],
      [0.7, -0.5, 0.24],
      [1.4, -0.22, 0.22],
    ],
    halfWidth: 0.06,
    halfHeight: 0.06,
  },
  {
    points: [
      [1.06, -0.34, -0.3],
      [1.1, 0.1, -0.28],
      [0.96, 0.5, -0.24],
    ],
    halfWidth: 0.045,
    halfHeight: 0.045,
  },
] as const;

/**
 * Secondary processing assemblies: the places the machine visibly does work in,
 * as opposed to the body it is made of.
 *
 * They are attached to the outline rather than set inside it, so they read as
 * additions to one mass instead of as parts of the same extrusion. The shoulder
 * prism crosses the monolith's right wall and carries two canted plates; the
 * foot block is the heavy end of the lower-left corner; the stack is three
 * plates of decreasing size sitting on the crown.
 */
const ASSEMBLY_SHOULDER: HullDefinition = {
  start: [1.24, 0.3, 0.26],
  end: [1.34, 0.8, 0.3],
  facets: 6,
  chamfer: 0,
  sections: [
    { t: 0, halfWidth: 0.15, halfHeight: 0.15, offset: [0, 0] },
    { t: 0.55, halfWidth: 0.17, halfHeight: 0.17, offset: [0, 0] },
    { t: 1, halfWidth: 0.09, halfHeight: 0.09, offset: [0, 0] },
  ],
};

const ASSEMBLY_FOOT: HullDefinition = {
  start: [-1.3, -0.86, 0.24],
  end: [-0.66, -1.18, 0.16],
  facets: 0,
  chamfer: 0.24,
  sections: [
    { t: 0, halfWidth: 0.24, halfHeight: 0.2, offset: [0, 0] },
    { t: 0.5, halfWidth: 0.28, halfHeight: 0.24, offset: [0, 0.02] },
    { t: 1, halfWidth: 0.18, halfHeight: 0.15, offset: [0, 0] },
  ],
};

const SHOULDER_PLATES = [
  { position: [1.3, 0.55, 0.26], rotation: [0.2, 0.3, 1.35], scale: [0.34, 0.24, 0.02], surface: 'accent' },
  { position: [1.28, 0.66, 0.3], rotation: [-0.15, 0.4, 1.3], scale: [0.3, 0.2, 0.018], surface: 'recess' },
] as const;

const ASSEMBLY_STACK = [
  { position: [-0.2, 0.9, 0.1], rotation: [0.05, 0.1, 0.04], scale: [0.5, 0.05, 0.22], surface: 'recess' },
  { position: [-0.2, 0.97, 0.1], rotation: [0.05, 0.1, 0.04], scale: [0.42, 0.04, 0.18], surface: 'accent' },
  { position: [-0.2, 1.03, 0.1], rotation: [0.05, 0.1, 0.04], scale: [0.34, 0.035, 0.15], surface: 'recess' },
] as const;

/**
 * Machined edge liners: thin strips laid along the two long silhouette corners.
 *
 * They are the `edge` class, and the class is defined by view geometry rather
 * than by position: these are the surfaces whose grazing angle against the
 * camera changes most when the camera moves, so they are where a restrained
 * view-dependent response belongs. That is why there are two of them and why
 * they are thin — a wide strip would make the response a flash instead of an
 * edge.
 */
const EDGE_LINERS = [
  { start: [-1.74, 0.56, 0.32], end: [1.32, 0.4, 0.28], width: 0.03, depth: 0.03 },
  { start: [-1.62, -0.86, 0.3], end: [0.94, -0.58, 0.26], width: 0.028, depth: 0.028 },
] as const;

/**
 * The one foreground element, and it is deliberately small.
 *
 * A folded blade clipping the lower right corner, well in front of the mass. At
 * this scale it is a compositional slice — something the frame is seen past —
 * and its size is the whole reason it is allowed to exist: an element an order
 * of magnitude larger is a plate laid over the composition, which is what this
 * replaced.
 */
const FOREGROUND_BLADE = {
  points: [
    [1.3, -1.0, 1.3],
    [1.72, -0.82, 1.36],
    [1.86, -0.44, 1.28],
  ],
  halfWidth: [0.06, 0.07, 0.05],
  halfHeight: 0.02,
  chamfer: 0.3,
  reference: [0, 0, 1],
} as const;

/**
 * Ports are placed where routes actually want to leave: left toward GRAPHICS
 * and AI, right toward SYSTEMS, up toward GAME ANALYSIS, down toward RESEARCH,
 * plus a forward port out of the aperture and one through the right shoulder.
 *
 * Each one sits on a surface that exists in the composition above — the
 * monolith's own outer wall, the aperture's front, the shoulder prism's cap —
 * so a route leaves an opening rather than a point in empty space. The
 * directions are the outward normals of those surfaces, which is what keeps a
 * departing route from cutting back through the body it just left.
 */
const PORT_TABLE = [
  { position: [-2.02, -0.14, 0.1], direction: [-0.96, -0.12, 0.24] },
  { position: [-0.42, -0.96, 0.0], direction: [0.04, -0.96, 0.26] },
  { position: [0.8, -0.88, 0.02], direction: [0.42, -0.88, 0.2] },
  { position: [1.62, -0.08, 0.1], direction: [0.93, -0.02, 0.36] },
  { position: [0.36, 0.86, 0.14], direction: [0.05, 0.95, 0.3] },
  { position: [0.1, -0.05, 0.46], direction: [0.14, -0.06, 0.98] },
  { position: [1.3, 0.46, 0.28], direction: [0.7, 0.68, 0.2] },
] as const;

function scaleVector(vector: Vector, scale: number): Vector {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function scaleExtent(
  value: number | readonly number[],
  scale: number,
): number | readonly number[] {
  return typeof value === 'number' ? value * scale : value.map((entry) => entry * scale);
}

function scaleHull(definition: HullDefinition, scale: number): HullDefinition {
  return {
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

function scalePath(definition: PathDefinition, scale: number): PathDefinition {
  return {
    points: definition.points.map((point) => scaleVector(point, scale)),
    closed: definition.closed,
    halfWidth: scaleExtent(definition.halfWidth, scale),
    halfHeight: scaleExtent(definition.halfHeight, scale),
    chamfer: definition.chamfer,
    reference: definition.reference,
  };
}

/** How many ports the profile exposes. SAFE keeps the primary routes only. */
function portBudgetFor(detail: number): number {
  if (detail >= DIE_DETAIL) return PORT_TABLE.length;
  if (detail >= MEMBRANE_DETAIL) return 6;
  if (detail >= MANIFOLD_DETAIL) return 5;
  if (detail >= WAFER_DETAIL) return 4;
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
 * The composition is one asymmetric monolith rather than an assembly. A closed
 * swept path forms the main mass and cuts a deep central aperture through it;
 * two folded shells ride over its crown and down its flank, leaving the outline
 * at both ends so the body reads as layered plate; an aperture floor, wafers,
 * membranes and compute dies give that opening its own density and its own
 * darkening; three manifolds are cut into the mass as channels; and two
 * processing assemblies are attached to the shoulder and the foot.
 *
 * There is no member that crosses the body at an angle and no member that is a
 * transformed unit box standing in for a machined form. The only box-shaped
 * members are the wafers, dies and membranes inside the aperture, where being
 * thin, flat and precisely placed is the entire job.
 *
 * Detail gates only ever add surfaces inside the body, so SAFE keeps the same
 * silhouette at the same place in the frame.
 */
export function deriveCoreStructure(
  parameters: Pick<CoreParameters, 'structureDetail'>,
  seed = 17,
): CoreStructure {
  const detail = normalizedDetail(parameters.structureDetail);
  const members: CoreStructureMember[] = [];

  const path = (
    definition: PathDefinition,
    tier: CoreStructureTier,
    surface: CoreSurfaceClass,
    band: CoreStructureBand,
    rank: number,
  ): CoreStructurePath => ({
    shape: 'path',
    tier,
    surface,
    band,
    fade: 0,
    rank,
    ...scalePath(definition, CORE_SCALE),
  });

  const form = (
    definition: { readonly position: Vector; readonly rotation: Vector; readonly scale: Vector },
    tier: CoreStructureTier,
    surface: CoreSurfaceClass,
    band: CoreStructureBand,
    rank: number,
    fade = 0,
  ): CoreStructureForm => ({
    shape: 'volume',
    tier,
    surface,
    band,
    fade,
    rank,
    position: scaleVector(definition.position, CORE_SCALE),
    rotation: definition.rotation,
    scale: scaleVector(definition.scale, CORE_SCALE),
  });

  const hull = (
    definition: HullDefinition,
    tier: CoreStructureTier,
    surface: CoreSurfaceClass,
    band: CoreStructureBand,
    rank: number,
  ): CoreStructureHull => ({
    shape: 'hull',
    tier,
    surface,
    band,
    fade: 0,
    rank,
    ...scaleHull(definition, CORE_SCALE),
  });

  const liner = (
    definition: { start: Vector; end: Vector; width: number; depth: number },
    tier: CoreStructureTier,
    band: CoreStructureBand,
    rank: number,
  ): CoreStructureSpan => ({
    shape: 'beam',
    tier,
    surface: 'edge',
    band,
    fade: 0,
    rank,
    start: scaleVector(definition.start, CORE_SCALE),
    end: scaleVector(definition.end, CORE_SCALE),
    width: definition.width * CORE_SCALE,
    depth: definition.depth * CORE_SCALE,
  });

  // Silhouette: the monolith, both folded shells, the aperture floor and the two
  // attached assemblies. Nothing below this line is needed for the Core to read
  // as itself, and nothing below it changes the outline.
  members.push(
    path({ ...MONOLITH, closed: true }, 'anchor', 'shell', 'midground', 0),
    path({ ...CROWN_FOLD, closed: false }, 'primary', 'shell', 'midground', 1),
    path({ ...FLANK_FOLD, closed: false }, 'primary', 'shell', 'midground', 2),
    form(APERTURE_FLOOR, 'recess', 'recess', 'background', 3),
    hull(ASSEMBLY_SHOULDER, 'primary', 'shell', 'midground', 4),
    hull(ASSEMBLY_FOOT, 'secondary', 'shell', 'foreground', 5),
  );

  if (detail >= WAFER_DETAIL) {
    members.push(
      form(WAFERS[0], 'anchor', 'accent', 'midground', 10),
      liner(EDGE_LINERS[0], 'detail', 'foreground', 11),
    );
  }

  if (detail >= MANIFOLD_DETAIL) {
    members.push(
      path({ points: MANIFOLDS[0].points, closed: false, halfWidth: MANIFOLDS[0].halfWidth, halfHeight: MANIFOLDS[0].halfHeight, chamfer: 0.4, reference: [0, 0, 1] }, 'primary', 'edge', 'midground', 12),
      path({ points: MANIFOLDS[1].points, closed: false, halfWidth: MANIFOLDS[1].halfWidth, halfHeight: MANIFOLDS[1].halfHeight, chamfer: 0.4, reference: [0, 0, 1] }, 'primary', 'edge', 'midground', 13),
      form(WAFERS[1], 'detail', 'recess', 'midground', 14),
    );
  }

  if (detail >= MEMBRANE_DETAIL) {
    members.push(
      form(APERTURE_MEMBRANES[0], 'detail', 'membrane', 'midground', 20, APERTURE_MEMBRANES[0].fade),
      form(APERTURE_MEMBRANES[1], 'detail', 'membrane', 'midground', 21, APERTURE_MEMBRANES[1].fade),
      form(SHOULDER_PLATES[0], 'anchor', 'accent', 'midground', 22),
    );
  }

  if (detail >= ASSEMBLY_DETAIL) {
    members.push(
      path({ points: MANIFOLDS[2].points, closed: false, halfWidth: MANIFOLDS[2].halfWidth, halfHeight: MANIFOLDS[2].halfHeight, chamfer: 0.4, reference: [0, 0, 1] }, 'secondary', 'edge', 'background', 23),
      form(ASSEMBLY_STACK[0], 'detail', 'recess', 'midground', 24),
      form(ASSEMBLY_STACK[1], 'anchor', 'accent', 'midground', 25),
      form(SHOULDER_PLATES[1], 'detail', 'recess', 'midground', 26),
      liner(EDGE_LINERS[1], 'detail', 'midground', 27),
    );
  }

  if (detail >= DIE_DETAIL) {
    members.push(
      form(WAFERS[2], 'anchor', 'accent', 'midground', 30),
      form(WAFERS[3], 'secondary', 'recess', 'background', 31),
      form(DIES[0], 'anchor', 'accent', 'foreground', 32),
      form(DIES[1], 'anchor', 'accent', 'foreground', 33),
      form(DIES[2], 'secondary', 'recess', 'background', 34),
      form(ASSEMBLY_STACK[2], 'detail', 'recess', 'midground', 35),
      path({ ...FOREGROUND_BLADE, closed: false }, 'recess', 'edge', 'foreground', 36),
    );
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
    centroid: scaleVector([-0.02, -0.02, 0.0], CORE_SCALE),
    // The aperture's long axis, which is the direction its internal flow runs.
    // It is not a beam: nothing crosses the body, and this is a reading of the
    // opening rather than a member.
    spineAxis: unitDirection([1, 0.18, 0.06]),
    heroScale: 1.6 * CORE_SCALE,
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
