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

/**
 * Half-extents of the mass including its folds, in design units.
 *
 * The width is deliberately held where it was while the height nearly doubles.
 * The framing contracts are written against the width — the idle rig puts the
 * Core at a little over half the frame across, and `BASE_CAMERA_DISTANCE` is
 * derived from that — so widening the body would move every one of them. Making
 * it taller instead costs nothing and fixes the composition: at 16:9 a body that
 * is twice as wide as it is tall can only ever occupy a horizontal band, which
 * is what left the lower third of the frame empty.
 *
 * Depth is the monolith's own, and it grew when the ring's profile started
 * carrying its asymmetry in `halfHeight`. The body now reaches further behind
 * the front plane down the left flank than it ever did, so the bound has to
 * follow it — a member outside these numbers would be cropped by whatever reads
 * them next rather than by the frame.
 */
const LOCAL_BOUNDS: Vector = [1.84, 1.5, 0.68];

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
const CORE_SCALE = 2.2;

/**
 * The monolith: the whole main mass as one closed ring, and the reason this
 * Core has an aperture rather than a gap between two parts.
 *
 * Two ratios decide whether a ring reads as a machine with an opening in it or
 * as a picture frame, and this one is authored against both.
 *
 * The first is the section. A heavily chamfered section on a path whose normals
 * sweep continuously is a torus: the facets differ so little from their
 * neighbours that the tone walks smoothly round the body, which is why the
 * previous version read as grey plastic rather than as machined mass. A shallow
 * chamfer on a near-square section gives every face one normal, so adjacent
 * faces land on different tiers and the mass reads in steps.
 *
 * The second is where the opening is and how thick the material around it is.
 * An opening in the middle of an even wall is a doughnut whatever its aspect:
 * the eye reads the wall, finds it the same everywhere, and stops. So the wall
 * is heaviest down the left flank — 1.32 — and the opening ends up left of the
 * body's own centre and low in it. The mass is a heavy lower-left shoulder with
 * a slot cut toward its light corner, which is what an asymmetric body actually
 * is.
 *
 * Two captures were spent learning which number makes that true, and the first
 * answer was wrong in a way worth recording. The wall's *thickness ratio* was
 * taken to be the lever: 0.23 to 0.56 is 2.4:1 and read as a torus, so the wall
 * was walked out to 0.32 to 1.32 — 4.4:1 — on the argument that a rim and a
 * shoulder are different objects. The frame got an asymmetric rim and the
 * thumbnail still read as a ring, and the reason is that the ratio describes the
 * *rim* while the torus read comes from the *hole*. At 2.12 by 1.51 the opening
 * was 59% of the body's width and 52% of its height: the mass was the border of
 * the picture, however unevenly its border was drawn.
 *
 * So the crown was thickened — 0.16 half-width at the crown walked out to 0.40,
 * and the shoulder and right wall with it — and the opening is 1.86 by 1.03 now,
 * 52% of the body's width and 36% of its height. The ratio fell to 2.1:1 as a
 * consequence and it does not matter, because the deck's stepped lands carry the
 * asymmetry the ratio was bought for. What is left is a heavy body with a
 * low-set, off-centre slot in it, which is the read the wall-thickness argument
 * was trying to buy and could not: a thin crown is a rim, and a rim is a ring.
 *
 * The outer boundary did not move to get there. Each point was solved from the
 * outline it had — `point = outline − halfWidth × normal`, taking the outline
 * from the previous revision — so the silhouette, the bounds every framing
 * contract is written against, and the position of every port are all exactly
 * where they were. What changed is only how much of the body is *inside* that
 * outline, which is the one thing the previous ring could not vary.
 *
 * There is a third ratio, and it took a capture to find it: the wall's *depth*.
 *
 * Width alone was not enough, and the reason is worth recording because it is
 * not obvious from the numbers. A closed path swept from a section whose depth
 * is the same at every point presents the camera one extruded band, and the band
 * around this opening is between a sixth and a third of the frame tall — so the
 * three quarters of the body that are not the aperture resolved as one large
 * flat surface, evenly lit, with no interior. That is the exact failure the
 * surface language exists to avoid, and no amount of surface response fixes it,
 * because a single face has a single normal and therefore a single value.
 *
 * So `halfHeight` carries the asymmetry, and the profile walks from a third of a
 * unit deep at the crown to over a whole unit down the left. But the first
 * attempt put all of that variation on the *back* face, and the back face is the
 * one surface of the ring the camera never sees. Every point was solved so that
 * `z + halfHeight` came out at exactly 0.30, which made the front a plane to six
 * decimal places: a large, evenly lit, perfectly flat annulus, and a capture that
 * did not move a single pixel when the depth was doubled. The asymmetry was real
 * and it was entirely behind the machine.
 *
 * The deck is therefore authored on the side the camera is on. `z + halfHeight`
 * now steps rather than sitting still — 0.44 across the left shoulder, down to
 * 0.22 over the crown, back out to 0.40 at the right shoulder, 0.28 down the
 * flank, 0.42 at the foot and 0.20 along the left. Paired points share a value,
 * so each height is a flat *land* with a genuine step to the next one, and the
 * quads that bridge those steps are tilted rather than flat. A face whose normal
 * is 28 degrees off the view axis bakes at 0.34 where the flat plane baked at
 * 0.65, so the annulus resolves as a ladder of distinct plate values instead of
 * one number — which is the internal layering the surface language could not
 * produce on a single normal and the geometry has to carry instead.
 *
 * The steps are not free. Between two points the front face rotates about the
 * run between them, so a step of 0.22 over a run of 0.41 is the same 28 degrees as
 * the same step over a run of 0.82 is sixteen — the crown and the left flank tilt
 * gently, the shoulder tilts hard, and the distribution of those angles round the
 * body is what keeps the result reading as cut plate rather than as a wave. The
 * outer boundary, the wall widths in `halfWidth` and the entire back face are
 * exactly what they were: the silhouette, the aperture and every framing contract
 * derived from them are untouched.
 */
const MONOLITH = {
  points: [
    [-1.215, 0.596, 0.12],
    [-1.12, 0.9, 0.11],
    [-0.745, 0.959, 0.03],
    [-0.003, 1.01, 0.11],
    [0.807, 0.938, 0.17],
    [1.325, 0.783, 0.14],
    [1.429, 0.215, 0.03],
    [1.379, -0.447, -0.03],
    [0.787, -0.845, -0.03],
    [-0.088, -0.861, -0.09],
    [-0.903, -0.737, -0.22],
    [-1.182, -0.227, -0.18],
  ],
  halfWidth: [0.52, 0.5, 0.46, 0.4, 0.36, 0.34, 0.32, 0.34, 0.44, 0.58, 0.66, 0.62],
  halfHeight: [0.32, 0.33, 0.19, 0.17, 0.23, 0.26, 0.25, 0.31, 0.45, 0.51, 0.42, 0.38],
  chamfer: 0.1,
  reference: [0, 0, 1],
} as const;

/**
 * The front bezel: the parting rail inset into the ring's front deck.
 *
 * This is what stops the body reading as a stone. A ring swept with one section
 * presents one band to the camera, and however its facets are shaded it is a
 * single continuous surface — at the idle framing a large, round, evenly lit
 * one, which the eye resolves as a rock rather than as a machined part. A second,
 * much thinner ring laid into it breaks that band into an edge and a face at two
 * depths, which is the cheapest way to say "this was cut" without adding a single
 * moving part.
 *
 * That was the intent, and for two revisions the part did the opposite of it.
 * The rib was authored *wider* than the wall at every point — 0.32 to 0.60
 * against the ring's 0.26 to 0.54 — so although it is drawn in front, what it
 * does is hide. The ring's front face is the only `anchor`-tier surface the body
 * has, and it was covered end to end by a `secondary` plate, which left the
 * largest surface in the frame a single flat value at a single depth: the very
 * "large grey surface with no interior" this part was added to prevent. Measured
 * off the frame, a quarter of the composition sat at one luminance to within
 * four percent, and the bright tier the whole shell ladder is tuned around
 * appeared nowhere outside the aperture.
 *
 * So the rib is half the wall's width now and runs down the middle of it. That is
 * the one arrangement where both parts are visible and both are doing a job: the
 * deck reads as machined land on either side of the rail, the rail reads as a
 * feature laid into it, and the annulus around the aperture becomes land, rail,
 * land at two depths instead of one plane. The inset is proportional so the rail
 * keeps its scale against the wall round the whole body, and the floor at the
 * crown keeps a hairline rather than closing it where the wall is thinnest.
 *
 * Two things changed with the deck, and both matter more than the width.
 *
 * The first is that the rail *follows* it — `z` is the deck's own front height
 * plus a constant, so the rail is the same 0.065 proud all the way round instead
 * of standing on stilts over the low end and sinking into the high one. Because
 * the deck is stepped, the rail is stepped with it, and its top face carries the
 * same tilts the deck does; what it does not share is their value, because a tier
 * down is a different colour and not a darker shade of the same one.
 *
 * The second is that it is a `recess` tier rather than a `secondary` one, and
 * that is the point of it rather than a detail. The deck it sits on bakes between
 * 0.34 and 0.65 of the pale shell tier; a rail that was merely a shade darker
 * would vanish into the darker lands and read only on the brightest ones, which
 * is a feature that appears and disappears as it goes round. At the interior
 * tier it is a dark line whatever it crosses — the same value over a 0.65 land as
 * over a 0.34 one — and a dark line that holds its value across a stepped surface
 * is exactly what a parting line is. It is the one place in the body where a
 * *cut* is drawn rather than implied.
 *
 * Its height is derived from the deck rather than written out beside it. The two
 * numbers are the same twelve points and the same twelve heights, and a copy kept
 * by hand is a copy that stops agreeing the first time the deck is re-solved —
 * which is precisely the failure this part has already been through once.
 */
const BEZEL_RAIL_OFFSET = 0.035;
const BEZEL_HALF_HEIGHT = 0.03;

/**
 * The rail's width as a fraction of the wall it is cut into.
 *
 * This is the number that decides whether the body is a mass with a line cut
 * across it or a bullseye, and both of the obvious answers were wrong.
 *
 * At half the wall's width the annulus resolves as a quarter bright land, a half
 * dark channel and another quarter bright land. A fifth was the next attempt, on
 * the argument that it leaves four fifths of the deck as plate — and the
 * measured frame says the argument was about the wrong quantity. The rail holds
 * one value whatever it crosses, so what decides whether it reads as a *line* is
 * not the fraction of the wall it takes but the absolute width it lands at on
 * the heavy side: a fifth of the 1.32-wide flank is 0.29 world units, and on
 * screen a 0.29-unit band of interior-tier value against lands four times
 * brighter is not a groove, it is a hole. The body was a bright ring, a black
 * ring and a bright ring, and the black one was the widest shape in the
 * composition.
 *
 * An eighth keeps the same ratio at the crown and lands at 0.16 on the flank,
 * which is 47 pixels at the idle framing — wide enough to read as a cut at any
 * distance the frame is actually looked at from, narrow enough that the two
 * lands are one surface with a line in it.
 */
const BEZEL_WALL_FRACTION = 0.125;

/**
 * Where across the deck the rail runs, as a fraction of the wall's own width.
 *
 * The rail used to run down the middle of the deck, which is the obvious place
 * for a parting line and the wrong one here, because of what is on the other
 * side of the deck. Inboard of the rail is the aperture: the opening is a dark
 * recess, and it was immediately against the rail's dark line, so the two read
 * as one outline and the body resolved as a bright ring with a black band drawn
 * round its inner edge — a picture frame with a heavy mount, which is the exact
 * shape a monolith is not.
 *
 * A line in the middle of a surface divides it into two equal halves and says
 * "two surfaces". A line near an edge says "this is one plate, and that is its
 * edge" — and that is what this body is. Moved outward the rail draws the rim
 * off the deck, the deck becomes one broad bright land running all the way to
 * the aperture's edge, and the aperture is bounded by lit plate instead of by a
 * dark line. Nothing about the opening changed; what changed is which surface
 * the eye finds at its lip.
 *
 * Two thirds, and not more: the rail plus its own half-width has to stay inside
 * the wall at every point, and the wall is not the same width all the way round.
 */
const BEZEL_RAIL_OUTSET = 0.66;

/**
 * The rail's points, pushed outward along the ring's own radius.
 *
 * Radial rather than along the true normal. The normal is derived inside
 * `path()` from the bisector of the two neighbouring segments and is not
 * available to a constant, and for a ring this nearly convex the radius is the
 * same direction to within a few degrees at every point — a tenth of a wall's
 * width of error on a line whose whole job is to sit somewhere particular on the
 * deck, with the silhouette it is cut into unchanged either way.
 */
function bezelPoint(point: Vector, half: number): Vector {
  const radius = Math.hypot(point[0], point[1]);
  if (radius < 1e-6) return point;
  const outset = half * BEZEL_RAIL_OUTSET;
  return [point[0] + (point[0] / radius) * outset, point[1] + (point[1] / radius) * outset, point[2]];
}

const FRONT_BEZEL = {
  points: MONOLITH.points.map(
    (point, index): Vector => {
      const rail = bezelPoint(point, MONOLITH.halfWidth[index] ?? 0);
      return [rail[0], rail[1], rail[2] + (MONOLITH.halfHeight[index] ?? 0) + BEZEL_RAIL_OFFSET];
    },
  ),
  halfWidth: MONOLITH.halfWidth.map((half) => half * BEZEL_WALL_FRACTION),
  halfHeight: BEZEL_HALF_HEIGHT,
  chamfer: 0.2,
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
    [-1.34, 1.02, 0.32],
    [-0.54, 1.3, 0.38],
    [0.4, 1.32, 0.34],
    [1.1, 1.04, 0.26],
    [1.4, 0.58, 0.2],
  ],
  halfWidth: [0.1, 0.17, 0.18, 0.15, 0.1],
  halfHeight: 0.05,
  chamfer: 0.16,
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
    [-1.38, 0.74, 0.3],
    [-1.56, 0.04, 0.22],
    [-1.42, -0.6, 0.14],
    [-0.86, -1.0, 0.06],
    [-0.18, -1.14, 0.0],
  ],
  halfWidth: [0.1, 0.18, 0.2, 0.18, 0.11],
  halfHeight: 0.06,
  chamfer: 0.16,
  reference: [0, 0, 1],
} as const;

/**
 * The inner shelf and the lower lip: the two folds that break the aperture's
 * outline.
 *
 * Everything above this point bounds the opening with the ring, and a ring
 * bounds an opening evenly — which is precisely the read this stage has to get
 * away from, because an opening with a regular boundary is a frame no matter
 * how thick its wall is. These two sit across the mouth of the aperture at
 * different depths and stop at different distances from the centre, so the
 * visible edge of the opening is a stack of plate ends at three depths rather
 * than one swept curve.
 *
 * Both leave the aperture more than half open, and neither is large: they are
 * the near edges of folds that continue over the body, and the eye reads them
 * as such because they do not close.
 *
 * The shelf's height is set by the opening, not chosen. When the crown was
 * thickened the aperture's roof came down from 1.09 to 0.61 and the shelf was
 * left sitting inside the wall it was supposed to cross — a fold that had become
 * a layer of the shell. It is placed 0.22 lower for that reason, which puts its
 * near edge back across the mouth, and its lower face is held clear of the disc
 * the geometry contract proves empty: measured from the opening's centre, that
 * disc reaches 0.324 and the shelf's lowest vertex is 0.39.
 */
const INNER_SHELF = {
  points: [
    [-1.07, 0.56, 0.34],
    [-0.27, 0.63, 0.4],
    [0.57, 0.54, 0.34],
  ],
  halfWidth: [0.16, 0.22, 0.18],
  halfHeight: 0.05,
  chamfer: 0.2,
  reference: [0, 0, 1],
} as const;

const LOWER_LIP = {
  points: [
    [-0.75, -0.4, 0.36],
    [0.11, -0.48, 0.42],
    [1.03, -0.28, 0.32],
    [1.37, -0.02, 0.22],
  ],
  halfWidth: [0.14, 0.2, 0.18, 0.12],
  halfHeight: 0.045,
  chamfer: 0.2,
  reference: [0, 0, 1],
} as const;

/**
 * Deck plates: the small laid-in panels that give the front face a scale of its
 * own.
 *
 * The deck is the largest lit surface on the machine and it was one value from
 * the rail to the lip of the aperture. Everything else on the body is a feature
 * measured in whole units — a fold, a hull, a rail — so the front face had no
 * detail smaller than a quarter of the body, and a surface with nothing on it
 * below that scale reads as untextured however carefully its outline is
 * faceted. These are the scale contrast for the outside of the machine, in the
 * same way the wafers are for the inside.
 *
 * Placed off the ring's own points and sized off its own wall widths, so they
 * follow the ring rather than being sprinkled on it, and made uneven three ways
 * — a deterministic subset of the twelve points, a different radial offset per
 * point, and a hash-derived size — because a repeating pattern of equal parts is
 * a diagram. Only one panel per point for the same reason: a ring of twelve
 * equally spaced plates is a gear.
 *
 * Inboard of the rail, and that is what they are for. The rail divides the deck;
 * every one of these sits on the wide land between the rail and the aperture, so
 * they break up exactly the surface that has nothing on it and leave the narrow
 * outer rim as a clean machined edge.
 */
const DECK_PLATE_INDICES = [1, 3, 5, 8, 10] as const;
const DECK_PLATE_DETAIL = MANIFOLD_DETAIL;

const DECK_PLATES = DECK_PLATE_INDICES.map((index, order) => {
  const point = MONOLITH.points[index] ?? [0, 0, 0];
  const halfWidth = MONOLITH.halfWidth[index] ?? 0.4;
  const halfHeight = MONOLITH.halfHeight[index] ?? 0.2;
  const radius = Math.hypot(point[0], point[1]);
  const nx = radius > 1e-6 ? point[0] / radius : 0;
  const ny = radius > 1e-6 ? point[1] / radius : 0;
  const radial = hashUnit(17, 700 + order * 5) - 0.5;
  const across = 0.5 + hashUnit(17, 702 + order * 5) * 0.55;
  const tangent = radius > 1e-6 ? Math.atan2(ny, nx) : 0;
  return {
    // Half way between the rail and the aperture's lip, plus a jitter so no two
    // panels sit at the same radius.
    position: [
      point[0] + nx * (halfWidth * (radial * 0.5 + 0.05)),
      point[1] + ny * (halfWidth * (radial * 0.5 + 0.05)),
      point[2] + halfHeight + 0.008,
    ] as Vector,
    // Local x is radial, so the plate is laid along the deck rather than across
    // it. The z rotation is the ring's own tangent direction at this point.
    rotation: [0, 0, tangent] as Vector,
    scale: [halfWidth * across * 1.5, halfWidth * (0.8 + order * 0.1), 0.022] as Vector,
  };
});

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
 *
 * It is sized twice over, and both bounds are load-bearing. Large enough to
 * cover the whole of the opening, or the aperture would show background through
 * its own corners; small enough that its edges stay buried inside the wall all
 * the way round, or a flat plate would stick out past the body's outline on the
 * thin side. The ring's inner boundary runs from 0.61 out of the centre at the
 * crown to 0.29 at the foot, so the opening's own centroid is at (0.11, 0.19)
 * and the back is placed there rather than at the body's centre — the body
 * centre is now inside the heavy shoulder, which the opening is not.
 */
const APERTURE_FLOOR = {
  position: [0.11, 0.19, -0.36],
  rotation: [0, 0, 0],
  scale: [1.6, 1.12, 0.05],
} as const;

/**
 * Wafers: thin plates carried inside the aperture, at their own depths and
 * angles. They are the scale contrast the composition needs — the body is four
 * units across and these are a third of a unit, so the eye gets a dense local
 * region to read rather than one uniform level of detail everywhere.
 *
 * They were also the brightest thing in the frame, and that was the wrong way
 * round. Every one of them was authored at the pale tier, so the aperture — the
 * one part of the body the camera is meant to look *into* — sat two and a half
 * times the value of the mass around it, and the eye went straight through the
 * opening to a handful of flat cards while the machine they were cut into stayed
 * at one dark number. The mass is the subject; an opening is deep because what is
 * inside it is darker than what surrounds it, and no amount of layering survives
 * a hierarchy that is inverted. So the wafers are smaller and most of them are a
 * tier or two down, the aperture's internal range now runs below the deck's
 * rather than above it, and the two that stayed pale are small enough to read as
 * signal rather than as the subject.
 *
 * Three of them were moved inboard when the aperture shrank, and the move is the
 * part worth keeping: at the old opening's size they sat clear of the wall, and
 * against the new one the same coordinates put them a third to two thirds buried
 * in it. A wafer that is inside the shell is not a small wafer, it is a wafer
 * that is not there, and the composition loses it silently — nothing fails, the
 * density at the aperture just quietly drops by three parts in eight.
 */
const WAFERS = [
  { position: [-0.43, 0.36, -0.24], rotation: [0.06, -0.22, 0.1], scale: [0.74, 0.4, 0.028], surface: 'accent' },
  { position: [0.45, 0.1, -0.06], rotation: [-0.05, 0.18, -0.08], scale: [0.66, 0.34, 0.024], surface: 'recess' },
  { position: [0.95, 0.4, -0.2], rotation: [0.1, 0.3, 0.12], scale: [0.42, 0.26, 0.024], surface: 'accent' },
  { position: [-0.46, -0.06, -0.14], rotation: [-0.08, -0.3, -0.1], scale: [0.44, 0.28, 0.024], surface: 'recess' },
  { position: [-0.11, 0.4, 0.1], rotation: [0.14, -0.34, 0.18], scale: [0.58, 0.24, 0.018], surface: 'recess' },
  { position: [0.71, -0.22, 0.16], rotation: [-0.12, 0.26, -0.16], scale: [0.5, 0.22, 0.016], surface: 'accent' },
  { position: [-0.65, 0.28, 0.16], rotation: [0.18, 0.4, 0.08], scale: [0.36, 0.42, 0.016], surface: 'recess' },
  { position: [0.31, 0.4, -0.34], rotation: [-0.16, -0.2, 0.22], scale: [0.4, 0.28, 0.014], surface: 'recess' },
] as const;

/**
 * Compute dies: the small solid blocks the interior links run between.
 *
 * They are volumes rather than slices so the Core's own circulation has
 * something to connect, which is what makes the inside of the aperture read as
 * computed-in rather than hollow. There are twice as many as the aperture's own
 * width suggests they need, and their sizes are deliberately uneven: a dense
 * local region reads as density, whereas a region of equal parts reads as a
 * pattern, and a pattern is a diagram.
 *
 * Only one of them stays at the pale tier, and it is the one in the middle of the
 * opening. A single pale block at the centre of a dark chamber is a focal point;
 * two of them, which is what this was, is a pair of lights competing with the
 * mass they are set into.
 */
const DIES = [
  { position: [0.07, 0.02, -0.14], rotation: [0.1, 0.2, 0.06], scale: [0.22, 0.16, 0.12], surface: 'accent' },
  { position: [0.79, 0.46, -0.1], rotation: [-0.08, -0.16, -0.1], scale: [0.18, 0.14, 0.1], surface: 'accent' },
  { position: [-0.5, 0.42, -0.2], rotation: [0.05, 0.24, 0.12], scale: [0.16, 0.2, 0.09], surface: 'recess' },
  { position: [0.53, -0.14, 0.14], rotation: [0.12, -0.28, 0.16], scale: [0.13, 0.11, 0.09], surface: 'accent' },
  { position: [-0.39, -0.3, 0.06], rotation: [-0.14, 0.18, -0.2], scale: [0.15, 0.12, 0.1], surface: 'recess' },
  { position: [1.07, 0.14, 0.18], rotation: [0.08, 0.32, -0.12], scale: [0.12, 0.16, 0.08], surface: 'recess' },
] as const;

/**
 * The interior bus: thin ribs standing across the back of the aperture.
 *
 * The aperture had structure in it and no *machine* in it. Eight plates at eight
 * angles read as eight plates, however carefully they are arranged, because
 * nothing about them says what they are attached to; a bus is the cheapest way to
 * say it, and it is the same argument the routing manifolds are built on. These
 * are the ribs the wafers and dies are mounted between, they are all vertical
 * because a bus has one direction, and their heights step down from the centre
 * toward the mouth so the group has a shape rather than a count.
 *
 * They are all `recess` finish and a tier below the wafers they carry, which is
 * what a mounting rib is: a shadow the parts stand in front of.
 */
const INTERIOR_BUS = [
  { position: [-0.3, 0.18, -0.2], rotation: [0.04, -0.14, 0.06], scale: [0.06, 0.66, 0.04] },
  { position: [0.19, 0.08, -0.16], rotation: [-0.03, 0.12, -0.05], scale: [0.05, 0.54, 0.035] },
  { position: [0.62, 0.24, -0.24], rotation: [0.06, 0.2, 0.1], scale: [0.045, 0.4, 0.03] },
  { position: [-0.44, 0.04, -0.1], rotation: [-0.05, -0.24, -0.08], scale: [0.04, 0.34, 0.03] },
] as const;

/**
 * Layered membranes inside the aperture. The only class that blends.
 *
 * Five of them rather than two, at depths from the back of the recess to well
 * in front of the ring, so the aperture is something the eye looks *into*
 * through several sheets rather than a card with a panel standing on it.
 *
 * Their heights are bounded by the deck they float in front of. The front three
 * used to sit at 0.2 to 0.34, which was clear of the old front plane at 0.30 —
 * and once the deck steps down to 0.20 along the left flank, a sheet at 0.30 is
 * no longer inside the aperture at all, it is a pane standing off the wall on
 * the outside of the machine. They are set below the deck's own low point now and
 * pay for it in nothing: the membrane is translucent, so the depth it gains is
 * depth the eye can read through it.
 */
const APERTURE_MEMBRANES = [
  { position: [-0.13, 0.26, 0.1], rotation: [0.08, -0.26, 0.14], scale: [1.2, 0.66, 0.01], fade: 0.42 },
  { position: [0.67, 0.18, -0.18], rotation: [-0.06, 0.2, -0.1], scale: [0.92, 0.52, 0.01], fade: 0.3 },
  { position: [-0.49, -0.08, 0.16], rotation: [0.1, 0.34, -0.18], scale: [0.66, 0.44, 0.008], fade: 0.36 },
  { position: [0.86, 0.32, 0.26], rotation: [-0.12, -0.3, 0.2], scale: [0.54, 0.38, 0.008], fade: 0.28 },
  { position: [0.03, 0.42, -0.3], rotation: [0.16, 0.12, 0.06], scale: [1.06, 0.4, 0.006], fade: 0.24 },
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
 *
 * The fourth is the one that turns a bundle into a system: two of the other
 * three converge into it inside the wall, so the routing has a junction in the
 * Core rather than three independent exits.
 */
const MANIFOLDS = [
  {
    points: [
      [-0.51, 0.56, 0.14],
      [0.37, 0.72, 0.18],
      [1.09, 0.88, 0.2],
      [1.55, 1.0, 0.24],
    ],
    halfWidth: 0.055,
    halfHeight: 0.055,
  },
  {
    points: [
      [-1.07, -0.34, 0.2],
      [-0.19, -0.48, 0.26],
      [0.85, -0.36, 0.28],
      [1.53, -0.06, 0.26],
    ],
    halfWidth: 0.06,
    halfHeight: 0.06,
  },
  {
    points: [
      [1.21, -0.16, -0.28],
      [1.25, 0.28, -0.26],
      [1.11, 0.72, -0.22],
    ],
    halfWidth: 0.045,
    halfHeight: 0.045,
  },
  {
    points: [
      [-0.13, -0.5, 0.16],
      [0.17, -0.62, 0.12],
      [0.47, -0.6, 0.08],
    ],
    halfWidth: 0.05,
    halfHeight: 0.05,
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
  start: [1.6, 0.26, 0.3],
  end: [1.72, 0.84, 0.34],
  facets: 6,
  chamfer: 0,
  sections: [
    { t: 0, halfWidth: 0.15, halfHeight: 0.15, offset: [0, 0] },
    { t: 0.55, halfWidth: 0.17, halfHeight: 0.17, offset: [0, 0] },
    { t: 1, halfWidth: 0.09, halfHeight: 0.09, offset: [0, 0] },
  ],
};

const ASSEMBLY_FOOT: HullDefinition = {
  start: [-1.24, -0.98, 0.26],
  end: [-0.56, -1.24, 0.18],
  facets: 0,
  chamfer: 0.24,
  sections: [
    { t: 0, halfWidth: 0.24, halfHeight: 0.2, offset: [0, 0] },
    { t: 0.5, halfWidth: 0.28, halfHeight: 0.24, offset: [0, 0.02] },
    { t: 1, halfWidth: 0.18, halfHeight: 0.15, offset: [0, 0] },
  ],
};

const SHOULDER_PLATES = [
  { position: [1.7, 0.54, 0.32], rotation: [0.2, 0.3, 1.35], scale: [0.34, 0.24, 0.02], surface: 'accent' },
  { position: [1.68, 0.66, 0.36], rotation: [-0.15, 0.4, 1.3], scale: [0.3, 0.2, 0.018], surface: 'recess' },
] as const;

const ASSEMBLY_STACK = [
  { position: [-0.3, 1.34, 0.12], rotation: [0.05, 0.1, 0.04], scale: [0.5, 0.05, 0.22], surface: 'recess' },
  { position: [-0.3, 1.4, 0.12], rotation: [0.05, 0.1, 0.04], scale: [0.42, 0.04, 0.18], surface: 'accent' },
  { position: [-0.3, 1.46, 0.12], rotation: [0.05, 0.1, 0.04], scale: [0.34, 0.035, 0.15], surface: 'recess' },
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
  { start: [-1.5, 0.92, 0.36], end: [1.34, 0.52, 0.3], width: 0.03, depth: 0.03 },
  { start: [-1.5, -0.86, 0.34], end: [0.86, -0.72, 0.3], width: 0.028, depth: 0.028 },
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
    [1.26, -1.22, 1.32],
    [1.7, -1.02, 1.38],
    [1.84, -0.6, 1.3],
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
  { position: [-1.8, 0.16, 0.1], direction: [-0.96, -0.1, 0.24] },
  { position: [-1.3, -1.06, 0.02], direction: [-0.5, -0.86, 0.2] },
  { position: [-0.1, -1.46, 0.04], direction: [0.04, -0.96, 0.26] },
  { position: [1.8, 0.06, 0.1], direction: [0.94, -0.06, 0.32] },
  { position: [0.32, 1.46, 0.16], direction: [0.08, 0.95, 0.28] },
  { position: [0.19, 0.24, 0.5], direction: [0.12, -0.02, 0.99] },
  { position: [1.7, 0.54, 0.32], direction: [0.7, 0.68, 0.2] },
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
 * swept path forms the main mass and cuts a deep central aperture through it,
 * and its front face is a stepped deck rather than a plane; four folded shells —
 * over the crown, down the flank, and the two that break the opening's own edge —
 * leave the outline at their ends so the body reads as layered plate; an aperture
 * floor, a bus, eight wafers, five membranes and six compute dies give that
 * opening its own density and its own darkening, all of it below the deck's own
 * value; four manifolds are cut into the mass as channels; and two processing
 * assemblies are attached to the shoulder and the foot.
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
  // as itself, and nothing below it changes the outline — the shelf and the lip
  // are in this band because they are what the opening's edge is made of, and an
  // aperture whose boundary changed with the quality profile would be a
  // different aperture.
  members.push(
    path({ ...MONOLITH, closed: true }, 'anchor', 'shell', 'midground', 0),
    path({ ...CROWN_FOLD, closed: false }, 'primary', 'shell', 'midground', 1),
    path({ ...FLANK_FOLD, closed: false }, 'primary', 'shell', 'midground', 2),
    // The back of the aperture is a `primary` tier under a `recess` surface, and
    // that pairing is the whole of this line. At the interior tier it resolved to
    // the same value as the void beyond the frame, so the opening was not a
    // recess the eye looks into, it was a hole through the body to the
    // background — and a ring with a hole in it is a picture frame. A recess has
    // to have a floor that reads as a floor for the wall to have a depth.
    form(APERTURE_FLOOR, 'primary', 'recess', 'background', 3),
    hull(ASSEMBLY_SHOULDER, 'primary', 'shell', 'midground', 4),
    hull(ASSEMBLY_FOOT, 'secondary', 'shell', 'foreground', 5),
    path({ ...INNER_SHELF, closed: false }, 'primary', 'shell', 'foreground', 6),
    path({ ...LOWER_LIP, closed: false }, 'secondary', 'shell', 'foreground', 7),
    path({ ...FRONT_BEZEL, closed: true }, 'recess', 'shell', 'foreground', 8),
  );

  if (detail >= DECK_PLATE_DETAIL) {
    members.push(
      // `secondary` under a `shell` finish, which is the whole difference
      // between a laid-in panel and a chip out of the deck. A recessed finish
      // on a plate this size puts a near-black speck on the brightest surface in
      // the frame, and a speck at this scale does not read as a machined land —
      // it reads as damage. A panel is a value or two down from the plate it is
      // let into and flat across its own face, which is what a tier does and
      // what a whole surface class is too much of.
      ...DECK_PLATES.map((plate, order) =>
        form(plate, 'secondary', 'shell', 'foreground', 60 + order),
      ),
    );
  }

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
      form(APERTURE_MEMBRANES[4], 'detail', 'membrane', 'background', 15, APERTURE_MEMBRANES[4].fade),
    );
  }

  if (detail >= MEMBRANE_DETAIL) {
    members.push(
      form(APERTURE_MEMBRANES[0], 'detail', 'membrane', 'midground', 20, APERTURE_MEMBRANES[0].fade),
      form(APERTURE_MEMBRANES[1], 'detail', 'membrane', 'midground', 21, APERTURE_MEMBRANES[1].fade),
      form(SHOULDER_PLATES[0], 'anchor', 'accent', 'midground', 22),
      form(WAFERS[4], 'detail', 'recess', 'foreground', 23),
    );
  }

  if (detail >= ASSEMBLY_DETAIL) {
    members.push(
      path({ points: MANIFOLDS[2].points, closed: false, halfWidth: MANIFOLDS[2].halfWidth, halfHeight: MANIFOLDS[2].halfHeight, chamfer: 0.4, reference: [0, 0, 1] }, 'secondary', 'edge', 'background', 24),
      form(ASSEMBLY_STACK[0], 'detail', 'recess', 'midground', 25),
      form(ASSEMBLY_STACK[1], 'anchor', 'accent', 'midground', 26),
      form(SHOULDER_PLATES[1], 'detail', 'recess', 'midground', 27),
      liner(EDGE_LINERS[1], 'detail', 'midground', 28),
      form(APERTURE_MEMBRANES[2], 'detail', 'membrane', 'foreground', 29, APERTURE_MEMBRANES[2].fade),
    );
  }

  if (detail >= DIE_DETAIL) {
    members.push(
      form(WAFERS[2], 'primary', 'accent', 'midground', 30),
      form(WAFERS[3], 'secondary', 'recess', 'background', 31),
      form(WAFERS[5], 'detail', 'accent', 'foreground', 32),
      form(WAFERS[6], 'detail', 'recess', 'foreground', 33),
      form(WAFERS[7], 'secondary', 'recess', 'background', 34),
      form(DIES[0], 'anchor', 'accent', 'foreground', 35),
      form(DIES[1], 'secondary', 'accent', 'foreground', 36),
      form(DIES[2], 'secondary', 'recess', 'background', 37),
      form(DIES[3], 'detail', 'accent', 'foreground', 38),
      form(DIES[4], 'secondary', 'recess', 'foreground', 39),
      form(DIES[5], 'detail', 'recess', 'foreground', 40),
      form(INTERIOR_BUS[0], 'detail', 'recess', 'background', 45),
      form(INTERIOR_BUS[1], 'detail', 'recess', 'background', 46),
      form(INTERIOR_BUS[2], 'detail', 'recess', 'background', 47),
      form(INTERIOR_BUS[3], 'detail', 'recess', 'background', 48),
      form(ASSEMBLY_STACK[2], 'detail', 'recess', 'midground', 41),
      path({ points: MANIFOLDS[3].points, closed: false, halfWidth: MANIFOLDS[3].halfWidth, halfHeight: MANIFOLDS[3].halfHeight, chamfer: 0.4, reference: [0, 0, 1] }, 'secondary', 'edge', 'midground', 42),
      form(APERTURE_MEMBRANES[3], 'detail', 'membrane', 'foreground', 43, APERTURE_MEMBRANES[3].fade),
      path({ ...FOREGROUND_BLADE, closed: false }, 'recess', 'edge', 'foreground', 44),
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
