import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import type { StructurePart, StructureTier } from '../materials/structureGeometry';
import type { SurfaceClass } from '../materials/structureGeometry';

type Vector = readonly [number, number, number];

/**
 * The hero is not a body. It is a fault.
 *
 * The previous hero was a monolith: one closed mass, centred, with an aperture
 * through it, sized so the whole thing fit the frame. That is a *product* — a
 * thing photographed so it can be looked at — and the composition it produces is
 * inescapably a diagram of a machine.
 *
 * This descriptor builds the opposite object. It is a computing substrate that
 * has been split, and what the frame shows is the split: two enormous bodies
 * that entered from opposite corners, the throat between them, and the material
 * of the rift itself. Nothing here has a centre, nothing here closes, and every
 * large form is authored to leave the frame rather than to fit inside it.
 *
 * Three properties are load-bearing and each one exists to kill a specific
 * failure mode of the old composition:
 *
 * - **Nothing is closed.** Every large member is an open sweep — a folded blade,
 *   a cut plate, a stepped shelf — so its silhouette changes with the view and
 *   it has an inside edge that can be seen. A closed box has one silhouette and
 *   it is the same one from every angle, which is what makes a pile of boxes
 *   read as a pile of boxes.
 * - **Nothing is mirrored.** The two massifs differ in scale, in depth, in
 *   profile and in what they are made of. A symmetric composition is a
 *   diagram's composition.
 * - **Nothing is fully in frame.** The near massif is authored past the left and
 *   bottom edges and the far shelf past the top and right. A subject that
 *   continues beyond the frame is a subject that is larger than the frame, and
 *   that is the single cheapest way to make a composition feel like a place.
 *
 * The descriptor is pure and seeded. Equal `(detail, seed)` gives byte-identical
 * parts, which is what lets the composition be tested rather than admired.
 */

/**
 * Where the rift's spine runs, as a direction, and where it is centred.
 *
 * The spine was shallow for the first ten captures of this composition — about
 * half a unit of rise per unit of run — and a shallow spine is indistinguishable
 * from a horizontal one at the idle framing. Both massifs are authored along it,
 * so the whole hero resolved to *one long bar crossing the middle of the page*,
 * and the header's claim that two enormous bodies enter from opposite corners was
 * a claim the coordinates did not make. Ten captures read it as a canoe.
 *
 * The spine is now steep enough that the two bodies are visibly two lines rather
 * than two halves of one: the near massif comes up out of the bottom-left corner
 * and the far shelf leaves through the top-right, and they cross at the throat
 * instead of joining end to end. Everything downstream follows from this one
 * vector — the cavity, the fibres, the matter field's circulation axis — which is
 * why it is written down as a direction with a comment rather than as three
 * unrelated coordinate lists.
 */
const RIFT_AXIS_RAW: Vector = [1, 0.92, -0.86];

/**
 * Detail gates.
 *
 * Structure detail runs 0.12 (SAFE) to 1 (ULTRA). Each gate adds a whole family
 * rather than a few instances, so the ladder is legible: at SAFE the frame holds
 * the two massifs and the throat between them and nothing else, and every step
 * up adds a layer of the rift's *interior* rather than more of its outside.
 */
const SHELF_DETAIL = 0.2;
const FOLD_DETAIL = 0.4;
const WAFER_DETAIL = 0.3;
const MEMBRANE_DETAIL = 0.55;
const FIBRE_DETAIL = 0.7;
const FINE_DETAIL = 0.88;

/**
 * The cavity is the throat the matter field lives in.
 *
 * It sits where the two massifs cross — the near one overshoots to `[1.2, 1.6,
 * 1.6]` and the far one starts at `[2.6, 1.4, -3.4]` — so the throat is the
 * volume between them rather than a break in one body. It has to be re-derived
 * whenever either sweep moves, and it is written as a literal rather than
 * computed from them because a throat placed by averaging two authored lists is
 * a throat that moves every time either list is nudged.
 */
const CAVITY_CENTRE: Vector = [1.9, 1.5, -0.9];
const CAVITY_HALF_EXTENTS: Vector = [6.4, 2.9, 2.6];

export type RiftPort = {
  readonly id: number;
  readonly rank: number;
  /** World position the routing field leaves from. */
  readonly position: Vector;
  /** Unit direction the field leaves along. */
  readonly direction: Vector;
};

export type RiftStructure = {
  readonly parts: readonly StructurePart[];
  readonly ports: readonly RiftPort[];
  /** Unit direction of the rift's spine. */
  readonly riftAxis: Vector;
  readonly riftCentre: Vector;
  readonly cavity: {
    readonly centre: Vector;
    readonly halfExtents: Vector;
  };
  readonly bounds: {
    readonly min: Vector;
    readonly max: Vector;
  };
  readonly detail: number;
};

export type RiftStructureInput = {
  /** 0..1, from the quality profile. */
  readonly detail: number;
  readonly seed?: number;
};

/**
 * The ports the routing field leaves from, in the rift's own frame.
 *
 * They sit on the throat's lip rather than on a body, because the field does not
 * leave the mass — it leaves the rift. Each carries a direction so a route can
 * be aimed at a domain without the hero knowing what a domain is: this module
 * imports no graph type and must not start.
 */
const PORT_TABLE: readonly {
  readonly offset: Vector;
  readonly direction: Vector;
}[] = [
  { offset: [-4.6, -1.1, 0.7], direction: [-0.86, -0.42, 0.28] },
  { offset: [-2.6, -2.0, 0.2], direction: [-0.62, -0.7, 0.35] },
  { offset: [2.4, -1.7, -0.5], direction: [0.66, -0.66, 0.36] },
  { offset: [4.1, -0.4, -0.9], direction: [0.93, -0.14, 0.34] },
  { offset: [-3.4, 1.6, -1.4], direction: [-0.78, 0.48, 0.4] },
  { offset: [0.2, 2.1, -1.9], direction: [0.05, 0.66, 0.75] },
  { offset: [3.3, 1.9, -1.7], direction: [0.72, 0.5, 0.48] },
];

function normalize(vector: Vector): Vector {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * A perpendicular to `a`, with `hint` choosing which of the infinitely many.
 *
 * `a × hint` is degenerate when the two are parallel, so the fallback swaps the
 * hint rather than returning a zero vector — a zeroed frame would silently
 * collapse every member placed in it onto the origin.
 */
function cross(a: Vector, hint: Vector): Vector {
  const result: Vector = [
    a[1] * hint[2] - a[2] * hint[1],
    a[2] * hint[0] - a[0] * hint[2],
    a[0] * hint[1] - a[1] * hint[0],
  ];
  if (Math.hypot(result[0], result[1], result[2]) < 1e-4) {
    return cross(a, [hint[2], hint[0], hint[1]]);
  }
  return normalize(result);
}

function add(a: Vector, b: Vector): Vector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * An open swept shell.
 *
 * A path part with an open polyline and a wide, flat profile is a folded blade:
 * the sweep gives it a length that curves through space, the profile gives it a
 * face, and because the path does not close it has two cut ends rather than a
 * rim. That is the primitive the whole hero is built from, and it is why the
 * massif reads as a slice of something larger rather than as an object.
 */
function shell(options: {
  readonly points: readonly Vector[];
  readonly halfWidth: number | readonly number[];
  readonly halfHeight: number | readonly number[];
  readonly tier: StructureTier;
  readonly surface: SurfaceClass;
  readonly chamfer?: number;
  readonly folds?: number;
  readonly reference?: Vector;
}): StructurePart {
  return {
    shape: 'path',
    tier: options.tier,
    surface: options.surface,
    points: options.points,
    closed: false,
    halfWidth: options.halfWidth,
    halfHeight: options.halfHeight,
    chamfer: options.chamfer ?? 0.22,
    folds: options.folds ?? 0,
    reference: options.reference ?? [0, 1, 0],
  };
}

function slab(
  position: Vector,
  rotation: Vector,
  extents: Vector,
  tier: StructureTier,
  surface: SurfaceClass,
): StructurePart {
  return {
    shape: 'form',
    tier,
    surface,
    position,
    rotation,
    // `form` parts are unit boxes, so the scale vector is the full size.
    scale: [extents[0] * 2, extents[1] * 2, extents[2] * 2],
  };
}

function beam(
  start: Vector,
  end: Vector,
  width: number,
  depth: number,
  tier: StructureTier,
  surface: SurfaceClass,
): StructurePart {
  return { shape: 'span', tier, surface, start, end, width, depth };
}

/**
 * Across the foreground tier's sweep, in world space.
 *
 * The tier's own path runs from `[-31, -27.5, 24]` to `[-11, -9.4, 14.8]`, so
 * this is the direction perpendicular to that path and to the world up — the
 * direction the plates are spread along. It is written out rather than derived
 * because it is a composition decision: the plates fan across the frame's
 * bottom-left corner, and which way that is has to be readable here.
 */
const PLATE_SIDE: Vector = [-0.6731, 0.7395, 0];

/** How far the outermost plate rolls about the sweep axis, in radians. */
const PLATE_ROLL_RADIANS = 0.5;

/**
 * One long sweep, cut into separate members with gaps between them.
 *
 * This is the answer to the one thing in the hero that outlived every shading
 * fix, and it took a capture with the matter field switched off to see it
 * clearly. The pale unbroken wedge across the bottom-left of the frame is not a
 * lighting problem at all: it is the near massif's own sweep, and its silhouette
 * is two nearly straight parallel lines running the length of the corner. A
 * surface seen at a grazing angle has a constant view angle across it, so no rim
 * can vary along it; a body whose outline is two straight lines has a constant
 * outline, so no silhouette can either. Ribbing the section changed the edge
 * texture and nothing else, and the measurements agree — the ribs are in the
 * geometry and the face still renders flat.
 *
 * So the sweep is no longer one member. It is cut at its own control points and
 * each piece is pulled back from its neighbour, which puts three real gaps into
 * the outline, and each piece is nudged off its neighbour's axis so the pieces
 * read as a body assembled from segments rather than a body that was sliced. The
 * brief asks for 非封闭结构切片 — non-closed structure slices — and this is that
 * literal reading: the massif is slices.
 *
 * The pull-back is proportional to the local span rather than a constant, so a
 * long piece loses the same *fraction* as a short one and the gaps stay in
 * proportion to the composition at every scale the quality ladder runs at.
 */
const SEGMENT_GAP = 0.05;
const SEGMENT_DRIFT = 0.2;

/**
 * How much of the massif's own section the backbone keeps.
 *
 * The first cut of the segmented massif had no backbone, and the SAFE capture
 * is what showed it was needed: at a detail of 0.4 the fins are the only thing
 * left and the body reads as a chain of shards floating in the dark, which is
 * the one thing the brief names and forbids — 随机漂浮的岩石. A body made of
 * segments is still one body; it has a spine, and the segments are what is
 * mounted on it.
 *
 * The spine is thin enough to sit inside the gap and read as the dark between
 * two lit faces rather than as a third face, and it is set back far enough that
 * the corridor's own light does not reach it.
 */
const SEGMENT_SPINE = 0.42;

function segmentedShell(options: {
  readonly points: readonly Vector[];
  readonly halfWidth: readonly number[];
  readonly halfHeight: readonly number[];
  readonly tier: StructureTier;
  readonly surface: SurfaceClass;
  readonly folds?: number;
  readonly reference?: Vector;
}): StructurePart[] {
  const parts: StructurePart[] = [];
  const last = options.points.length - 1;

  // The continuous spine, on the same path and inside the segments. It takes the
  // body's own finish rather than a darker one: an interior finish is dark
  // enough to read as the void it is cut out of, so a spine in `recess` closes
  // the body in the geometry and leaves it open on screen — the SAFE capture
  // showed exactly that, the joints still reading as gaps with a black spine
  // sitting invisibly in them.
  parts.push(
    shell({
      points: options.points,
      halfWidth: options.halfWidth.map((value) => value * SEGMENT_SPINE),
      halfHeight: options.halfHeight.map((value) => value * SEGMENT_SPINE),
      tier: options.tier,
      surface: options.surface,
      ...(options.folds === undefined ? {} : { folds: options.folds }),
      ...(options.reference === undefined ? {} : { reference: options.reference }),
    }),
  );

  for (let index = 0; index < last; index += 1) {
    const from = options.points[index]!;
    const to = options.points[index + 1]!;
    const side = hashSigned(index + 71, index + 3) * SEGMENT_DRIFT;
    const lift = hashSigned(index + 91, index + 5) * SEGMENT_DRIFT;

    const cut = (point: Vector, other: Vector, towards: number): Vector => {
      const dx = other[0] - point[0];
      const dy = other[1] - point[1];
      const dz = other[2] - point[2];
      return [
        point[0] + dx * SEGMENT_GAP * towards + side,
        point[1] + dy * SEGMENT_GAP * towards + lift,
        point[2] + dz * SEGMENT_GAP * towards,
      ];
    };

    parts.push(
      shell({
        points: [cut(from, to, 1), cut(to, from, 1)],
        halfWidth: [options.halfWidth[index]!, options.halfWidth[index + 1]!],
        halfHeight: [options.halfHeight[index]!, options.halfHeight[index + 1]!],
        tier: options.tier,
        surface: options.surface,
        ...(options.folds === undefined ? {} : { folds: options.folds }),
        ...(options.reference === undefined ? {} : { reference: options.reference }),
      }),
    );
  }

  return parts;
}

/** Both massifs, as open sweeps. Authored by hand: a composition is not noise. */
function buildMassifs(detail: number, seed: number): StructurePart[] {
  const parts: StructurePart[] = [];

  // --- The near massif: up out of the bottom-left corner, close to the lens. --
  //
  // It was authored nearly flat and ended *inside* the frame at the throat, with
  // the far shelf picking the line up from there — which is precisely why the
  // hero read as one bar with a break in it rather than as two bodies. The sweep
  // is now steep, and it is authored past the corner in both senses: the first
  // point is behind the lens plane and outside the frame to the left and below,
  // so the body is already large when it comes into shot, and its last point
  // overshoots the throat rather than stopping at it.
  parts.push(
    ...segmentedShell({
      points: [
        [-36.0, -30.0, 19.5],
        [-25.5, -20.5, 15.0],
        [-15.5, -12.0, 10.6],
        [-6.5, -4.4, 6.0],
        [1.2, 1.6, 1.6],
      ],
      halfWidth: [6.4, 5.0, 3.5, 2.0, 0.8],
      halfHeight: [3.8, 3.0, 2.1, 1.2, 0.46],
      tier: 'primary',
      surface: 'shell',
      folds: 4,
    }),
  );

  if (detail >= FOLD_DETAIL) {
    // A second blade inside the first, cut shorter and rotated across it. Two
    // sweeps that do not share a plane read as a folded body; two that do read
    // as one thick plate.
    parts.push(
      ...segmentedShell({
        points: [
          [-32.5, -25.0, 14.2],
          [-22.5, -16.6, 10.2],
          [-13.0, -9.2, 6.4],
          [-4.6, -2.6, 2.6],
          [0.6, 1.2, -0.6],
        ],
        halfWidth: [4.1, 3.2, 2.2, 1.2, 0.44],
        halfHeight: [2.4, 1.9, 1.3, 0.7, 0.28],
        tier: 'secondary',
        surface: 'shell',
        folds: 3,
        reference: [0.3, 1, -0.2],
      }),
      // The cut face where the massif was split: a steep plate across the sweep.
      // Its normal is close to the new spine, so the plate is close to
      // perpendicular to the body it cuts.
      slab([-19.5, -14.0, 9.0], [0.3, 1.05, -0.72], [5.6, 0.3, 3.4], 'secondary', 'edge'),
    );
  }

  if (detail >= FINE_DETAIL) {
    // The foreground tier: a fan of narrow plates near the lens at the
    // bottom-left corner. It occludes, it is nearly silhouette, and it is what
    // gives the frame a near edge rather than a floor. The nearest plate is
    // authored *behind* the idle camera plane — its first point is at z = 24
    // against a camera at z = 20 — which is the only place in the hero that
    // happens.
    //
    // This tier has now been rebuilt twice, and the two failures are the same
    // failure. It began as a single wide blade: three points and a near-constant
    // profile is a plane, it covered forty percent of the frame's diagonal, and
    // it took one value from end to end, which is the pale unbroken wedge in the
    // bottom-left of every capture. Then it was a *stack* of three blades stepped
    // apart in depth on the argument that a near body wants a lit edge, a
    // shadowed edge and a sliver of another behind it. That was right about
    // silhouette and wrong about area: three parallel sweeps of the same width,
    // piled along the view axis, still present the viewer with one continuous
    // face, because the near one hides the others and the others only reappear at
    // the rim. The captures show it — the ribbing added to those blades is
    // plainly there in the massif's silhouette and plainly absent from the blade's
    // face.
    //
    // So the plates are no longer parallel, and no longer overlapping. They are
    // laid side by side *across* the sweep with gaps between them, and each is
    // rolled about the sweep axis by its own angle. A viewer looking at the tier
    // now sees five faces at five orientations, each one occluding the one behind
    // it at a different depth, and the void through the gaps — which is a
    // structure rather than a surface, and is the only thing that has ever
    // stopped this corner from reading as a polygon.
    //
    // The roll is applied through the profile's own reference vector, which is
    // projected perpendicular to the path at every vertex — so a plate rolls
    // about its own length rather than about a world axis, and a tier that curves
    // through space keeps its slats parallel to itself.
    const plateCount = 5;
    const spread = 1.55;
    for (let index = 0; index < plateCount; index += 1) {
      const along = index / (plateCount - 1) - 0.5;
      const lateral: Vector = [
        PLATE_SIDE[0] * along * spread * 2,
        PLATE_SIDE[1] * along * spread * 2,
        PLATE_SIDE[2] * along * spread * 2,
      ];
      const roll = along * PLATE_ROLL_RADIANS * 2;
      const reference: Vector = [
        Math.sin(roll) * PLATE_SIDE[0],
        Math.sin(roll) * PLATE_SIDE[1],
        Math.cos(roll),
      ];
      // The plates thin as they fan outward, so the tier has a heavy centre and
      // light outer slats rather than five identical bars.
      const taper = 1 - Math.abs(along) * 0.34;
      const lift = hashSigned(seed, index + 500) * 0.35;
      parts.push(
        shell({
          points: [
            [
              -31.0 + lateral[0],
              -27.5 + lateral[1] + lift,
              24.0 + lateral[2],
            ],
            [-21.0 + lateral[0], -18.0 + lateral[1] + lift, 19.5 + lateral[2]],
            [-11.0 + lateral[0], -9.4 + lateral[1] + lift, 14.8 + lateral[2]],
          ],
          halfWidth: [1.95 * taper, 1.55 * taper, 1.15 * taper],
          halfHeight: [0.34 * taper, 0.27 * taper, 0.2 * taper],
          tier: 'secondary',
          surface: 'shell',
          folds: 3,
          reference,
        }),
      );
    }
    parts.push(
      slab([-24.0, -21.0, 21.5], [0.16, 0.42, 0.62], [8.0, 4.2, 0.32], 'secondary', 'shell'),
    );
  }

  // Feet and sockets: the massif has to sit on something, or it floats. They are
  // stepped along the sweep's own line rather than along a world axis, so they
  // stay under the body they belong to now that it is steep.
  const footCount = detail >= FINE_DETAIL ? 5 : detail >= FOLD_DETAIL ? 4 : 3;
  for (let index = 0; index < footCount; index += 1) {
    const t = (index + 1) / (footCount + 1);
    const position: Vector = [
      -30.0 + t * 26.0 + hashSigned(seed, index * 7 + 1) * 0.9,
      -25.0 + t * 21.5 + hashSigned(seed, index * 7 + 2) * 0.7,
      16.4 - t * 12.4 + hashSigned(seed, index * 7 + 3) * 0.6,
    ];
    const size = 2.3 - t * 1.35;
    parts.push({
      shape: 'hull',
      tier: 'primary',
      surface: 'shell',
      start: position,
      end: [position[0] + size * 1.1, position[1] + size * 1.3, position[2] - size * 0.9],
      facets: index % 2 === 0 ? 0 : 6,
      chamfer: 0.3,
      sections: [
        { t: 0, halfWidth: size * 1.25, halfHeight: size * 0.9, offset: [0, 0] },
        { t: 0.45, halfWidth: size * 1.0, halfHeight: size * 0.72, offset: [size * 0.12, 0] },
        { t: 1, halfWidth: size * 0.42, halfHeight: size * 0.3, offset: [size * 0.3, -size * 0.08] },
      ],
    });
  }

  if (detail < SHELF_DETAIL) return parts;

  // --- The far shelf: up through the top-right corner, behind the throat. ----
  //
  // Steeper than the near massif rather than parallel to it, so the two bodies
  // converge on the throat from opposite corners instead of running alongside
  // each other. It also starts *past* the throat's centre, so the two sweeps
  // overlap in depth rather than meeting end to end — the throat is a place where
  // they cross, not a seam where they join.
  parts.push(
    shell({
      points: [
        [2.6, 1.4, -3.4],
        [10.5, 9.0, -8.6],
        [18.5, 17.5, -14.2],
        [27.0, 27.5, -20.4],
      ],
      halfWidth: [2.3, 1.8, 1.25, 0.7],
      halfHeight: [1.4, 1.1, 0.76, 0.4],
      tier: 'secondary',
      surface: 'shell',
      folds: 3,
    }),
  );

  if (detail >= FOLD_DETAIL) {
    parts.push(
      shell({
        points: [
          [4.2, 4.0, -6.4],
          [12.4, 12.0, -12.4],
          [20.6, 21.0, -18.6],
          [29.0, 30.0, -25.0],
        ],
        halfWidth: [1.5, 1.15, 0.82, 0.46],
        halfHeight: [0.86, 0.66, 0.48, 0.28],
        tier: 'recess',
        surface: 'shell',
        reference: [-0.2, 1, 0.3],
      }),
    );
  }

  if (detail >= FINE_DETAIL) {
    // Three stacked shelves in the far body, not five, and their sizes diverge
    // rather than stepping evenly. Five near-identical plates at even spacing is
    // a comb — a rhythm so regular it reads as a repeated object rather than as
    // depth, which is the one thing the brief rules out twice over ("重复的盒子",
    // "均匀分布的碎片"). Three at deliberately uneven sizes read as banding.
    const shelves: readonly (readonly [number, number, number])[] = [
      [10.0, 8.4, -8.2],
      [17.6, 16.4, -13.5],
      [25.4, 25.6, -19.6],
    ];
    const spans: readonly number[] = [5.6, 3.4, 4.6];
    for (let index = 0; index < shelves.length; index += 1) {
      const centre = shelves[index]!;
      const span = spans[index]!;
      const t = index / (shelves.length - 1);
      parts.push(
        slab(
          centre,
          [0.2 + t * 0.07, 0.98, -0.78],
          [span, 0.15 + t * 0.05, 2.6 - t * 0.7],
          index === 1 ? 'primary' : 'secondary',
          'shell',
        ),
      );
    }
  }

  return parts;
}

/** The rift's spine, as a unit vector. Module scope because the cavity builds around it. */
const RIFT_AXIS: Vector = normalize(RIFT_AXIS_RAW);

/** An arbitrary but stable pair of directions across the spine. */
const ACROSS_A: Vector = normalize(cross(RIFT_AXIS, [0.13, 1, 0.27]));
const ACROSS_B: Vector = normalize(cross(RIFT_AXIS, ACROSS_A));

/**
 * A point in the cavity's own frame: `along` runs down the spine, `acrossA` and
 * `acrossB` are the two perpendicular directions.
 *
 * The cavity's contents used to be placed in world axes and rotated by angles
 * drawn from the hash, and the result was the single worst thing in the second
 * capture of this scene: five to sixteen separate cards at unrelated angles,
 * which read as *rocks floating in space*. No amount of tuning fixes that,
 * because the fault is not in the numbers, it is that the parts had no frame.
 * Nothing in a machine sits at a random angle to nothing.
 *
 * Everything in the throat is now placed and oriented in the spine's frame, so
 * the cavity has an axis and its contents have a relationship to it. The
 * variation that remains — a twist, a taper, a spiral — is variation *around an
 * axis*, which is what the brief means by 悬置但有序 (suspended but organised).
 */
function cavityPoint(
  along: number,
  a: number,
  b: number,
): Vector {
  const [cx, cy, cz] = CAVITY_CENTRE;
  return [
    cx + RIFT_AXIS[0] * along + ACROSS_A[0] * a + ACROSS_B[0] * b,
    cy + RIFT_AXIS[1] * along + ACROSS_A[1] * a + ACROSS_B[1] * b,
    cz + RIFT_AXIS[2] * along + ACROSS_A[2] * a + ACROSS_B[2] * b,
  ];
}

/**
 * The throat: a lined barrel, a baffle stack and the membranes across it.
 *
 * The three families are still three families, but they now have three different
 * jobs rather than three different random distributions. The barrel is the
 * cavity's *wall* — a continuous inward-facing surface. The stack is its
 * *contents* — baffles hung across the spine, spiralling and tapering. The
 * membranes are its *air* — the only blending class, and the only thing that
 * gives the throat volume rather than a boundary.
 */
function buildCavity(detail: number, seed: number): StructurePart[] {
  const parts: StructurePart[] = [];

  // --- The barrel -----------------------------------------------------------
  // Ring ribs swept around the spine, each an open polyline that stops short of
  // closing, so the throat is a tube with a longitudinal opening rather than an
  // enclosed pipe. That opening is the rift: matter and light leave the cavity
  // along it, and it is the only place the barrel is not a wall.
  //
  // This replaced a ring of thirty-six tangential *plates*. The plates tiled the
  // same volume correctly — every orientation was right — and the frame still
  // read as a cluster of crates, because a box is a box at any angle and
  // thirty-six of them at thirty-six angles is thirty-six boxes. A swept ring is
  // the same idea in a primitive that cannot read as a box: it has curvature, it
  // tapers, and at any view angle its silhouette is a curve.
  const ribs = detail >= FINE_DETAIL ? 5 : detail >= FOLD_DETAIL ? 4 : 3;
  const segments = detail >= FOLD_DETAIL ? 12 : 9;
  const gap = 2;
  for (let rib = 0; rib < ribs; rib += 1) {
    const along = (rib - (ribs - 1) / 2) * (detail >= FOLD_DETAIL ? 1.45 : 2.1);
    const radius = 1 - hashUnit(seed, rib + 140) * 0.14;
    const thickness = 0.34 + hashUnit(seed, rib + 160) * 0.22;
    const breadth = 0.62 + hashUnit(seed, rib + 180) * 0.3;
    const twist = hashSigned(seed, rib + 200) * 0.4;
    const points: Vector[] = [];
    for (let step = gap; step <= segments - gap; step += 1) {
      const angle = (step / segments) * Math.PI * 2 + twist;
      points.push(
        cavityPoint(
          along,
          Math.cos(angle) * 4.35 * radius,
          Math.sin(angle) * 2.95 * radius,
        ),
      );
    }
    parts.push(
      shell({
        points,
        halfWidth: thickness,
        halfHeight: breadth,
        tier: 'recess',
        surface: 'recess',
        reference: RIFT_AXIS,
      }),
    );
  }

  if (detail < WAFER_DETAIL) return parts;

  // --- The baffle stack -----------------------------------------------------
  // Baffles hung across the spine, each turned a little further than the last, so
  // the stack spirals and the rifling reads from any angle. They taper toward
  // both ends: a machine's interior narrows where it is being worked hardest, and
  // a stack of constant plates is a stack of plates.
  //
  // The count fell from twenty-four to thirteen. Twenty-four plates two to seven
  // units across, inside a box thirteen by six, is not a dense interior — it is
  // more plate area than there is cavity, which is why the previous capture's
  // throat was opaque shard and no depth at all.
  const waferCount = Math.round(5 + detail * 8);
  for (let index = 0; index < waferCount; index += 1) {
    const t = (index + 0.5) / waferCount;
    const along = (t - 0.5) * 4.6;
    // Largest in the middle of the stack, feathered at both ends.
    const taper = 0.42 + Math.sin(t * Math.PI) * 0.58;
    const angle = t * Math.PI * 2.1 + hashSigned(seed, index + 300) * 0.12;
    const reach = taper * 4.3;
    parts.push(
      slab(
        cavityPoint(along, Math.cos(angle) * reach * 0.34, Math.sin(angle) * reach * 0.24),
        [0.22, angle, 0.15],
        [
          taper * (1.5 + hashUnit(seed, index + 240) * 0.5),
          0.045 + hashUnit(seed, index + 340) * 0.05,
          taper * (0.8 + hashUnit(seed, index + 360) * 0.34),
        ],
        index === Math.floor(waferCount / 2) ? 'primary' : 'detail',
        'accent',
      ),
    );
  }

  if (detail < MEMBRANE_DETAIL) return parts;

  // --- The air --------------------------------------------------------------
  // Open sweeps across the throat. They are the only class that blends, so they
  // are what gives the cavity volume rather than walls. Each is authored around
  // the spine and fans along it, so the set reads as veils hanging in a barrel
  // rather than as bowls arranged around nothing.
  const membraneCount = Math.round(2 + detail * 4);
  for (let index = 0; index < membraneCount; index += 1) {
    const t = (index + 1) / (membraneCount + 1);
    const along = (t - 0.5) * 5.4;
    const bow = hashSigned(seed, index + 400) * 2.4;
    parts.push(
      shell({
        points: [
          cavityPoint(along, -4.6, -1.9),
          cavityPoint(along + bow * 0.3, 0.4, 2.3),
          cavityPoint(along - bow * 0.2, 4.4, -1.4),
        ],
        halfWidth: [1.5, 2.0, 1.3],
        halfHeight: [0.06, 0.05, 0.06],
        tier: 'recess',
        surface: 'membrane',
        reference: [0, 0, 1],
      }),
    );
  }

  return parts;
}

/**
 * Bundled compute fibres: the one family that reads as *throughput*.
 *
 * A bundle is several members that agree. The previous version was twenty-six
 * independent wires at widths of a tenth of a unit, which at this framing is a
 * two-pixel line crossing twenty world units — the brief names 大量无功能短线 as a
 * thing not to build, and a hair thin enough to be a pixel is that line whatever
 * it is made of. These are three bundles of four to six members each, running
 * along the spine, at a width that resolves: a member is now a sixth of a unit
 * across, which is ten pixels, and four of them side by side is a cable.
 */
function buildFibres(detail: number, seed: number): StructurePart[] {
  if (detail < FIBRE_DETAIL) return [];

  const parts: StructurePart[] = [];
  const bundles = 3;
  const members = Math.round(4 + detail * 2);

  for (let bundle = 0; bundle < bundles; bundle += 1) {
    const bundleAngle = (bundle / bundles) * Math.PI * 2 + 0.6;
    const bundleReach = 0.55 + hashUnit(seed, bundle + 700) * 0.3;
    const halfLength = 6.2 + hashUnit(seed, bundle + 720) * 2.6;

    for (let member = 0; member < members; member += 1) {
      // Members within a bundle sit close together — a bundle is a group of
      // things that are nearly touching, and spreading them out is exactly what
      // turns a bundle back into a set of unrelated wires.
      const offset = (member - (members - 1) / 2) * 0.19;
      const a = Math.cos(bundleAngle) * bundleReach * 4.3 + offset * Math.cos(bundleAngle + 1.6);
      const b = Math.sin(bundleAngle) * bundleReach * 2.9 + offset * Math.sin(bundleAngle + 1.6);
      const start = cavityPoint(-halfLength, a, b);
      const end = cavityPoint(halfLength, a, b);
      parts.push(
        beam(
          start,
          end,
          0.17 + hashUnit(seed, bundle * 31 + member + 620) * 0.14,
          0.17 + hashUnit(seed, bundle * 31 + member + 640) * 0.14,
          'detail',
          'edge',
        ),
      );
    }
  }

  return parts;
}

/*
 * There was a `buildDeepField` here: four plates, the outermost two hundred and
 * forty units across, meant to give the rift somewhere to go. It is gone, and
 * the reason is worth keeping.
 *
 * The four plates were authored as *structure* — the same part type, the same
 * bake, and the same energy material as the hero — and the only thing separating
 * them from the hero was that they sat further back. But the energy material has
 * no idea what a plate is for. It drew them with a finish (`recess`) whose
 * corridor gain is the highest of any finish in the scene, and it drew them at
 * the size they were authored: the outermost was a single surface two hundred
 * and forty units across, against a hero roughly twenty-six. Whatever that
 * surface did, it did in the largest area in the frame, in front of everything.
 *
 * The first capture of this scene was mostly those four surfaces, as soft cyan
 * blotches with the hero behind them. A backdrop that is larger, brighter and
 * closer in value than the subject is not a backdrop.
 *
 * The far field lives in `backdrop/backdropStructure.ts` now, at its own gain,
 * with its own bounds — and `measureBounds` below measures the rift again
 * instead of measuring the rift plus four walls.
 */

export function deriveRiftStructure(input: RiftStructureInput): RiftStructure {
  const detail = Number.isFinite(input.detail)
    ? Math.min(1, Math.max(0, input.detail))
    : 0;
  const seed = normalizeSeed(input.seed ?? 17);

  const parts: StructurePart[] = [
    ...buildMassifs(detail, seed),
    ...buildCavity(detail, seed),
    ...buildFibres(detail, seed),
  ];

  const riftAxis = normalize(RIFT_AXIS_RAW);
  const ports: RiftPort[] = PORT_TABLE.map((entry, index) => ({
    id: index,
    rank: index,
    position: add(CAVITY_CENTRE, entry.offset),
    direction: normalize(entry.direction),
  }));

  const bounds = measureBounds(parts);

  return {
    parts,
    ports,
    riftAxis,
    riftCentre: CAVITY_CENTRE,
    cavity: { centre: CAVITY_CENTRE, halfExtents: CAVITY_HALF_EXTENTS },
    bounds,
    detail,
  };
}

function measureBounds(parts: readonly StructurePart[]): {
  readonly min: Vector;
  readonly max: Vector;
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const consider = (point: Vector) => {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[2] < minZ) minZ = point[2];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
    if (point[2] > maxZ) maxZ = point[2];
  };

  for (const part of parts) {
    if (part.shape === 'form') {
      consider(part.position);
      continue;
    }
    if (part.shape === 'span' || part.shape === 'hull') {
      consider(part.start);
      consider(part.end);
      continue;
    }
    for (const point of part.points) consider(point);
  }

  if (!Number.isFinite(minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Picks the port whose direction best matches `direction`.
 *
 * The hero answers a route without being told where the route is going: the
 * caller supplies a unit direction and gets the port facing it. That is the
 * whole of the coupling, and it is why `riftStructure` imports no graph type.
 */
export function selectRiftPortForDirection(
  structure: RiftStructure,
  direction: Vector,
): RiftPort {
  const target = normalize(direction);
  let best: RiftPort | undefined;
  let bestDot = -Infinity;

  for (const port of structure.ports) {
    const dot =
      port.direction[0] * target[0] +
      port.direction[1] * target[1] +
      port.direction[2] * target[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = port;
    }
  }

  if (!best) {
    throw new Error('Rift structure has no ports to select from');
  }

  return best;
}

export type RiftPortActivation = {
  readonly sourcePortId: number;
  /** 0..1. How committed the routing field is, and therefore how lit the throat is. */
  readonly routingAuthority: number;
};

/**
 * How much of the throat is awake, and which port the field is leaving from.
 *
 * Idle never reaches zero. A foundry at rest is still a foundry, and a hero that
 * goes completely cold between interactions reads as a screenshot rather than as
 * a running machine — so the floor is real and the range above it is what the
 * interaction buys.
 */
export function deriveRiftPortActivation(
  structure: RiftStructure,
  input: {
    readonly intensity: number;
    readonly visualState: 'idle' | 'hover_response' | 'focusing';
    readonly signalDirection: Vector;
  },
): RiftPortActivation {
  const port = selectRiftPortForDirection(structure, input.signalDirection);
  const intensity = Number.isFinite(input.intensity)
    ? Math.min(1, Math.max(0, input.intensity))
    : 0;

  const base =
    input.visualState === 'focusing'
      ? 0.92
      : input.visualState === 'hover_response'
        ? 0.54
        : 0.22;

  return {
    sourcePortId: port.id,
    routingAuthority: Math.min(1, base + intensity * 0.25),
  };
}

export { hashUnit, hashSigned };
