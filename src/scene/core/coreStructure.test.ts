import { describe, expect, it } from 'vitest';

import {
  deriveCorePortActivation,
  deriveCoreStructure,
  selectCorePortForDirection,
  type CoreStructure,
  type CoreStructureForm,
  type CoreStructureHull,
  type CoreStructureMember,
  type CoreStructurePath,
} from './coreStructure';
import type { CoreVisualInput } from './coreTypes';

const SEED = 17;

function baseInput(overrides: Partial<CoreVisualInput> = {}): CoreVisualInput {
  return {
    pointerX: 0,
    pointerY: 0,
    focusX: 0,
    focusY: 0,
    focusZ: 0,
    intensity: 0.6,
    visualState: 'idle',
    reducedMotion: false,
    ...overrides,
  };
}

type Vector = readonly [number, number, number];

function pathsOf(members: readonly CoreStructureMember[]): readonly CoreStructurePath[] {
  return members.filter(
    (member): member is CoreStructurePath => member.shape === 'path',
  );
}

/** `filter` cannot narrow a union on its own, so the narrowing happens here. */
function formsOf(
  members: readonly CoreStructureMember[],
  shape: CoreStructureForm['shape'],
): readonly CoreStructureForm[] {
  return members.filter(
    (member): member is CoreStructureForm => member.shape === shape,
  );
}

function hullsOf(members: readonly CoreStructureMember[]): readonly CoreStructureHull[] {
  return members.filter(
    (member): member is CoreStructureHull => member.shape === 'hull',
  );
}

/** The one closed path: the ring of material the aperture is cut through. */
function monolithOf(structure: CoreStructure): CoreStructurePath {
  const closed = pathsOf(structure.members).filter((member) => member.closed);
  expect(closed).toHaveLength(1);
  return closed[0]!;
}

/** A profile extent, which a path may carry per point rather than as one value. */
function extentsOf(value: number | readonly number[]): readonly number[] {
  return typeof value === 'number' ? [value] : value;
}

/** The half-thickness the ring's wall carries at each of its points. */
function wallProfile(ring: CoreStructurePath): readonly number[] {
  const widths = extentsOf(ring.halfWidth);
  return widths.length === 1 ? ring.points.map(() => widths[0]!) : widths;
}

/** Where a member sits, whatever shape it is. */
function memberCentre(member: CoreStructureMember): Vector {
  if (member.shape === 'hull' || member.shape === 'beam') {
    return [
      (member.start[0] + member.end[0]) / 2,
      (member.start[1] + member.end[1]) / 2,
      (member.start[2] + member.end[2]) / 2,
    ];
  }
  if (member.shape === 'path') {
    const total = member.points.reduce<[number, number, number]>(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
      [0, 0, 0],
    );
    const count = Math.max(1, member.points.length);
    return [total[0] / count, total[1] / count, total[2] / count];
  }
  return member.position;
}

/**
 * The three dimensions a member's own bounding box has, whatever shape it is.
 *
 * Sections come from the member's own numbers rather than from its bake, which
 * is what makes these readable as authored sizes: a form is its scale, a span or
 * a hull is its cross-section plus its run, and a swept path is its profile plus
 * its run.
 */
function extentsOfMember(member: CoreStructureMember): readonly number[] {
  if (member.shape === 'path') {
    return [
      largest(extentsOf(member.halfWidth)) * 2,
      largest(extentsOf(member.halfHeight)) * 2,
      runLength(member.points),
    ];
  }
  if (member.shape === 'hull' || member.shape === 'beam') {
    const run = Math.hypot(
      member.end[0] - member.start[0],
      member.end[1] - member.start[1],
      member.end[2] - member.start[2],
    );
    if (member.shape === 'hull') {
      const widest = Math.max(...member.sections.map((section) => section.halfWidth));
      return [widest * 2, widest * 2, run];
    }
    return [
      Math.max(member.width, member.depth),
      Math.min(member.width, member.depth),
      run,
    ];
  }
  return [...member.scale].sort((left, right) => right - left);
}

/**
 * The second-largest dimension, which is how big a member reads as a *part*.
 *
 * A wafer is two units across and a liner is six units long, but both are thin:
 * the longest dimension of a thin member measures the space it crosses rather
 * than its presence in it. The second dimension is what tells a fitted part
 * apart from the mass it is fitted into, so it is the number the composition's
 * scale contrast is checked against.
 */
function sectionOf(member: CoreStructureMember): number {
  const sorted = [...extentsOfMember(member)].sort((left, right) => right - left);
  return sorted[1] ?? 0;
}

function largest(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function runLength(points: readonly Vector[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] ?? [0, 0, 0];
    const to = points[index] ?? [0, 0, 0];
    total += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  }
  return total;
}

/**
 * Whether a point lies inside a closed polygon, by ray casting in the view plane.
 *
 * The hero is authored flat against the view axis and the question here is
 * whether a member sits inside the aperture's *outline*, so the x/y plane is the
 * plane the question is asked in.
 */
function insideOutline(polygon: readonly Vector[], point: Vector): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (a[1] > point[1] !== b[1] > point[1]) {
      const x = a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (point[0] < x) inside = !inside;
    }
  }
  return inside;
}

const DETAILS = [0, 0.25, 0.5, 0.72, 0.9, 1] as const;

describe('deriveCoreStructure', () => {
  it('keeps the monolith, its aperture, both folds and the exits at every detail level', () => {
    for (const structureDetail of DETAILS) {
      const structure = deriveCoreStructure({ structureDetail }, SEED);

      // One closed ring and two open folds. The ring is the whole main mass, so
      // a tier that dropped it would drop the subject of the frame.
      expect(pathsOf(structure.members).filter((member) => member.closed)).toHaveLength(1);
      expect(pathsOf(structure.members).filter((member) => !member.closed).length)
        .toBeGreaterThanOrEqual(2);
      // The floor behind the aperture is what makes the opening a recess rather
      // than a hole through to the background.
      expect(formsOf(structure.members, 'volume').length).toBeGreaterThanOrEqual(1);
      expect(structure.ports.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('cuts the aperture through a ring of walking wall thickness, not a frame of constant section', () => {
    const ring = monolithOf(deriveCoreStructure({ structureDetail: 1 }, SEED));

    expect(ring.points.length).toBeGreaterThanOrEqual(6);
    expect(ring.chamfer).toBeGreaterThan(0);
    // Depth along the view axis is what makes the aperture a recess with a wall
    // you can see into rather than a hole cut in a card.
    expect(Math.min(...extentsOf(ring.halfHeight))).toBeGreaterThan(0.15);

    // A wall that carries one thickness all the way round a closed path is an
    // extruded picture frame. A machined body that happens to have an opening
    // through it is heavy at the foot and thin at the shoulder.
    const walls = wallProfile(ring);
    expect(walls.length).toBe(ring.points.length);
    expect(Math.max(...walls)).toBeGreaterThan(Math.min(...walls) * 1.6);
  });

  it('encloses the aperture instead of leaving a gap in the silhouette', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const ring = monolithOf(structure);
    const centre: Vector = [0, 0, 0];

    // The opening only exists if the ring goes *around* its own centre. Two
    // stacked hulls with a slot between them leaves the centre outside every
    // member, which is a gap rather than an aperture.
    expect(insideOutline(ring.points, centre)).toBe(true);

    // And the opening has exactly one back, at the body's own scale: the floor
    // that makes it a recess rather than a hole through to the background.
    const ringWidth =
      Math.max(...ring.points.map((point) => point[0])) -
      Math.min(...ring.points.map((point) => point[0]));
    const enclosed = structure.members.filter(
      (member) => member !== ring && insideOutline(ring.points, memberCentre(member)),
    );
    const atBodyScale = enclosed.filter(
      (member) => sectionOf(member) > ringWidth * 0.4,
    );

    expect(atBodyScale).toHaveLength(1);
    expect(atBodyScale[0]?.surface).toBe('recess');
  });

  it('stands both folds off the ring, on opposite sides, so the silhouette is layered', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const ring = monolithOf(structure);
    const folds = pathsOf(structure.members).filter((member) => !member.closed);
    const ringTop = Math.max(...ring.points.map((point) => point[1]));
    const ringBottom = Math.min(...ring.points.map((point) => point[1]));

    let above = 0;
    let below = 0;
    for (const fold of folds) {
      const top = Math.max(...fold.points.map((point) => point[1]));
      const bottom = Math.min(...fold.points.map((point) => point[1]));
      if (top > ringTop) above += 1;
      if (bottom < ringBottom) below += 1;
    }

    // Each fold has to leave the outline at its own end, or the mass is one
    // extruded block with a ribbon lying on its face.
    expect(above + below).toBeGreaterThanOrEqual(2);
    // One corner is heavy and the other is open: a symmetric pair of folds is
    // the reactor the brief rules out.
    expect(above).toBeGreaterThanOrEqual(1);
    expect(below).toBeGreaterThanOrEqual(1);
  });

  it('embeds the routing manifolds in the body they leave', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const ring = monolithOf(structure);
    // The foreground blade is also a swept edge-class path, and it is a
    // compositional slice in front of the body rather than a channel in it.
    const manifolds = pathsOf(structure.members).filter(
      (member) => member.surface === 'edge' && member.band !== 'foreground',
    );

    expect(manifolds).toHaveLength(3);

    // The field is not a line drawn to the Core: it is carried in a channel that
    // starts inside the aperture and crosses the ring's own wall on its way out.
    for (const manifold of manifolds) {
      const start = manifold.points[0];
      expect(start).toBeDefined();
      expect(insideOutline(ring.points, start!)).toBe(true);
    }

    const leaving = manifolds.filter((manifold) => {
      const end = manifold.points[manifold.points.length - 1];
      return end !== undefined && !insideOutline(ring.points, end);
    });
    expect(leaving).toHaveLength(2);
  });

  it('keeps the local density small, so scale is read as contrast rather than repetition', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const ring = monolithOf(structure);
    const ringWidth =
      Math.max(...ring.points.map((point) => point[0])) -
      Math.min(...ring.points.map((point) => point[0]));

    const fitted = structure.members.filter(
      (member) =>
        member !== ring &&
        insideOutline(ring.points, memberCentre(member)) &&
        sectionOf(member) <= ringWidth * 0.4,
    );

    // A dense local region at the aperture is what gives the eye something to
    // read against a body several units across. Wafers, dies, membranes, a
    // manifold passing through and the edge liner over the mouth.
    expect(fitted.length).toBeGreaterThanOrEqual(6);

    // And every one of them is small: the aperture is a place where the machine
    // does fine work, not a hole with a second body inside it.
    for (const member of fitted) {
      expect(sectionOf(member)).toBeLessThan(ringWidth * 0.4);
    }
  });

  it('builds the assemblies from their own sections rather than scaled boxes', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);

    for (const hull of hullsOf(structure.members)) {
      expect(hull.sections.length).toBeGreaterThanOrEqual(3);
      const heights = hull.sections.map((section) => section.halfHeight);
      const widest = Math.max(...heights);
      const narrowest = Math.min(...heights);

      // Tapered, but closing on a *face*: the narrowest section is still most of
      // the widest one. A section that collapses toward a tip is a leaf, and two
      // leaves hung on a stick is what the hero was, not a housing.
      expect(narrowest).toBeGreaterThan(widest * 0.5);
      expect(narrowest).toBeLessThan(widest * 0.8);
      // A machined part either carries a chamfer or is a faceted prism. Both are
      // a cut corner; neither is a fillet.
      if (hull.facets === 0) {
        expect(hull.chamfer).toBeGreaterThan(0);
        expect(hull.chamfer).toBeLessThanOrEqual(0.3);
      } else {
        expect(hull.facets).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('splits the mass across finishes, so one state can reach inside it', () => {
    // A single merged mass has exactly one lever: everything about it moves
    // together or nothing does. The classes are what let a hover reach the
    // aperture while the shell holds.
    const safe = deriveCoreStructure({ structureDetail: 0 }, SEED);
    const safeClasses = new Set(safe.members.map((member) => member.surface));
    expect(safeClasses.has('shell')).toBe(true);
    expect(safeClasses.has('recess')).toBe(true);
    expect(safeClasses.size).toBeGreaterThanOrEqual(2);

    const ultra = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const ultraClasses = new Set(ultra.members.map((member) => member.surface));
    expect(ultraClasses.size).toBeGreaterThanOrEqual(4);
    // The accent is rare by construction: a class that most of the structure
    // belonged to would not be an accent.
    const accent = ultra.members.filter((member) => member.surface === 'accent');
    expect(accent.length).toBeGreaterThan(0);
    expect(accent.length).toBeLessThan(ultra.members.length / 2);
  });

  it('adds surfaces monotonically as detail rises instead of turning anything up', () => {
    const counts = DETAILS.map(
      (structureDetail) =>
        deriveCoreStructure({ structureDetail }, SEED).members.length,
    );

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    }

    // ULTRA must be visibly richer than SAFE, not merely brighter.
    expect(counts.at(-1)!).toBeGreaterThan(counts[0]! + 5);
  });

  it('introduces the manifolds, the layered membranes and the dies at their own tiers', () => {
    const at = (structureDetail: number) => deriveCoreStructure({ structureDetail }, SEED);
    const countOf = (structureDetail: number, surface: string): number =>
      at(structureDetail).members.filter((member) => member.surface === surface).length;

    // Each gate adds its own kind of surface and nothing below it does. Reading
    // these as a table rather than as four loose inequalities is the point: the
    // classes are what the response is written against, so a class that arrived
    // at the wrong tier would be a hover answering in the wrong place.
    expect(countOf(0.25, 'membrane')).toBe(0);
    expect(countOf(0.6, 'membrane')).toBe(2);
    expect(countOf(0.25, 'edge')).toBe(1);
    expect(countOf(0.45, 'edge')).toBe(3);
    expect(countOf(0.6, 'accent')).toBe(2);
    expect(countOf(0.72, 'accent')).toBe(3);
    expect(countOf(0.9, 'accent')).toBe(6);
  });

  it('adds detail inside the aperture rather than more body around it', () => {
    const ringWidth = (structureDetail: number): number => {
      const ring = monolithOf(deriveCoreStructure({ structureDetail }, SEED));
      return (
        Math.max(...ring.points.map((point) => point[0])) -
        Math.min(...ring.points.map((point) => point[0]))
      );
    };

    // The mass's own width is the same at every tier: a richer profile is more
    // work inside the machine, not a bigger machine in the frame.
    expect(ringWidth(1)).toBeCloseTo(ringWidth(0), 6);
  });

  it('separates bands so the composition has front, middle and back', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const bands = new Set(structure.members.map((member) => member.band));

    expect(bands.has('background')).toBe(true);
    expect(bands.has('midground')).toBe(true);
    expect(bands.has('foreground')).toBe(true);
  });

  it('varies member scale classes rather than repeating one body size', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const sections = structure.members.map(sectionOf);

    // The body, its folds, its assemblies and the fitted parts inside the
    // aperture span more than a factor of ten, which is what makes the aperture
    // read as dense local detail against a large mass rather than as more of the
    // same machine at a smaller size.
    expect(Math.max(...sections)).toBeGreaterThan(Math.min(...sections) * 10);
  });

  it('holds only small, low-contrast elements in the foreground', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const bodyDepth = structure.bounds[2];
    const inFront = structure.members.filter(
      (member) => memberCentre(member)[2] > bodyDepth,
    );

    // The previous round used two plates over a world unit across, which
    // swallowed a third of the frame at 1920 and flattened 2560 entirely. One
    // compositional slice is allowed, in the deepest tier, and it is small.
    expect(inFront).toHaveLength(1);
    const [blade] = inFront;
    expect(blade).toBeDefined();
    if (!blade) return;

    expect(blade.band).toBe('foreground');
    // It has to be the darkest thing in the frame, not a bright overlay.
    expect(blade.tier).toBe('recess');
    expect(sectionOf(blade)).toBeLessThan(structure.bounds[0] * 0.12);
  });

  it('is asymmetric: no member mirrors another across the origin', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const centres = structure.members.map(memberCentre);

    for (const centre of centres) {
      const mirrored = centres.find(
        (candidate) =>
          Math.abs(candidate[0] + centre[0]) < 0.02 &&
          Math.abs(candidate[1] + centre[1]) < 0.02 &&
          Math.abs(candidate[2] + centre[2]) < 0.02,
      );
      expect(mirrored).toBeUndefined();
    }
  });

  it('produces the same structure for equal inputs and finite values throughout', () => {
    const first = deriveCoreStructure({ structureDetail: 0.72 }, SEED);
    const second = deriveCoreStructure({ structureDetail: 0.72 }, SEED);

    expect(second).toEqual(first);

    for (const member of first.members) {
      const values =
        member.shape === 'hull'
          ? [
              ...member.start,
              ...member.end,
              member.chamfer,
              ...member.sections.flatMap((section) => [
                section.t,
                section.halfWidth,
                section.halfHeight,
                ...section.offset,
              ]),
            ]
          : member.shape === 'beam'
            ? [...member.start, ...member.end, member.width, member.depth]
            : member.shape === 'path'
              ? [
                  ...member.points.flatMap((point) => [...point]),
                  ...extentsOf(member.halfWidth),
                  ...extentsOf(member.halfHeight),
                  member.chamfer,
                  ...member.reference,
                ]
              : [...member.position, ...member.rotation, ...member.scale];
      for (const value of values) expect(Number.isFinite(value)).toBe(true);
    }

    for (const port of first.ports) {
      for (const value of [...port.position, ...port.direction]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(Math.hypot(...port.direction)).toBeCloseTo(1, 5);
    }
  });

  it('sanitizes out-of-range detail and non-finite seeds without producing NaN', () => {
    for (const structureDetail of [-3, Number.NaN, Number.POSITIVE_INFINITY, 4]) {
      const structure = deriveCoreStructure({ structureDetail }, Number.NaN);
      expect(structure.members.length).toBeGreaterThan(0);
      expect(structure.heroScale).toBeGreaterThan(0);
      expect(Number.isFinite(structure.spineAxis[0])).toBe(true);
    }
  });

  it('points the aperture axis along the mass it opens through, as a unit direction', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const ring = monolithOf(structure);
    const axis = structure.spineAxis;

    expect(Math.hypot(...axis)).toBeCloseTo(1, 5);

    // The aperture is wider than it is tall, so its long axis is the body's long
    // axis: the flow inside the opening runs the way the opening runs. This is a
    // reading of the opening rather than a member — nothing crosses the body.
    const project = (point: Vector): number =>
      point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2];
    const along = ring.points.map(project);
    const alongSpread = Math.max(...along) - Math.min(...along);
    const acrossSpread = Math.max(...ring.points.map((point) => point[1])) -
      Math.min(...ring.points.map((point) => point[1]));
    expect(alongSpread).toBeGreaterThan(acrossSpread);

    // And nothing crosses the body. The old hero was hung on a thick diagonal
    // beam that ran the whole width of the mass and destroyed its formal unity,
    // so the invariant is that every end-defined member is trim: thinner than
    // the thinnest part of the ring's own wall, and shorter than the body is
    // wide. The one thing this cannot show is that they are *outside* the
    // opening — that is checked against the baked geometry, where the shell
    // class is proved to hold nothing inside the aperture's mouth.
    const thinnestWall = Math.min(...wallProfile(ring)) * 2;
    for (const member of structure.members) {
      if (member.shape !== 'beam') continue;
      expect(member.width).toBeLessThan(thinnestWall);
      expect(member.depth).toBeLessThan(thinnestWall);
      expect(Math.hypot(
        member.end[0] - member.start[0],
        member.end[1] - member.start[1],
        member.end[2] - member.start[2],
      )).toBeLessThan(structure.bounds[0] * 2);
    }
  });

  it('exposes every port, identically, at full detail regardless of seed', () => {
    const ids = [1, 17, 4096, Number.NaN].map((seed) =>
      deriveCoreStructure({ structureDetail: 1 }, seed)
        .ports.map((port) => port.id)
        .join(','),
    );

    // The hero silhouette and its exits are art-directed, so the seed must not
    // be able to change them at full detail.
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('0,1,2,3,4,5,6');
  });

  it('lets the seed choose which exits a partial profile routes through', () => {
    const budgets = [0, 0.25, 0.5, 0.72].map(
      (structureDetail) => deriveCoreStructure({ structureDetail }, 1).ports.length,
    );
    expect(budgets).toEqual([3, 4, 5, 6]);

    // Seed 1 and seed 2 must not agree on the subset at low detail, otherwise
    // the seed is not actually doing anything.
    const subsets = [1, 2, 3, 4].map((seed) =>
      deriveCoreStructure({ structureDetail: 0 }, seed)
        .ports.map((port) => port.id)
        .join(','),
    );
    expect(new Set(subsets).size).toBeGreaterThan(1);
  });

  it('keeps partial-detail exits ordered and in range so draw ranges stay valid', () => {
    for (const structureDetail of DETAILS) {
      for (const seed of [1, 17, 999]) {
        const ports = deriveCoreStructure({ structureDetail }, seed).ports;
        const ids = ports.map((port) => port.id);

        expect([...ids].sort((left, right) => left - right)).toEqual(ids);
        for (const id of ids) {
          expect(id).toBeGreaterThanOrEqual(0);
          expect(id).toBeLessThan(7);
        }
      }
    }
  });
});

describe('selectCorePortForDirection', () => {
  it('resolves an inbound direction to the best-aligned local port', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const leftmost = structure.ports.find((port) => port.direction[0] < -0.9);
    expect(leftmost).toBeDefined();

    const selected = selectCorePortForDirection(structure, [-1, 0, 0]);
    expect(selected?.id).toBe(leftmost?.id);
  });

  it('selects different ports for materially different directions', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const left = selectCorePortForDirection(structure, [-1, 0, 0]);
    const right = selectCorePortForDirection(structure, [1, 0, 0]);

    expect(left?.id).not.toBe(right?.id);
  });

  it('keeps the Core graph-blind by resolving zone identity locally', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const selected = selectCorePortForDirection(structure, [0.3, -1, 0.1]);

    expect(selected).toBeDefined();
    expect(structure.ports.some((port) => port.zone === selected?.zone)).toBe(true);
  });
});

describe('deriveCorePortActivation', () => {
  it('holds low authority while idle and full authority once focused', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);

    const idle = deriveCorePortActivation(structure, baseInput({ visualState: 'idle' }));
    const focused = deriveCorePortActivation(
      structure,
      baseInput({ visualState: 'focusing', focusX: -0.97, focusY: -0.18, focusZ: -0.11 }),
    );

    expect(idle.routingAuthority).toBeGreaterThan(0);
    expect(idle.routingAuthority).toBeLessThan(0.4);
    expect(focused.routingAuthority).toBe(1);
    expect(focused.compression).toBeGreaterThan(idle.compression);
  });

  it('bends toward the hovered direction and away from the idle port', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);

    const idle = deriveCorePortActivation(structure, baseInput({ visualState: 'idle' }));
    const hoveredRight = deriveCorePortActivation(
      structure,
      baseInput({ visualState: 'hover_response', pointerX: 1, pointerY: 0 }),
    );

    expect(hoveredRight.sourcePortId).not.toBe(idle.sourcePortId);
    expect(hoveredRight.sourceZone).toBeGreaterThanOrEqual(0);
  });

  it('keeps every scalar finite and bounded for extreme inputs', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);

    for (const visualState of [
      'dormant',
      'awakening',
      'idle',
      'hover_response',
      'focusing',
      'agent_activity',
    ] as const) {
      const activation = deriveCorePortActivation(
        structure,
        baseInput({
          visualState,
          intensity: Number.POSITIVE_INFINITY,
          pointerX: Number.NaN,
          focusX: Number.NEGATIVE_INFINITY,
          focusY: 40,
          focusZ: -40,
        }),
      );

      expect(Number.isFinite(activation.routingAuthority)).toBe(true);
      expect(activation.routingAuthority).toBeGreaterThanOrEqual(0);
      expect(activation.routingAuthority).toBeLessThanOrEqual(1);
      expect(Number.isFinite(activation.compression)).toBe(true);
      expect(activation.sourceZone).toBeGreaterThanOrEqual(0);
    }
  });

  it('never advances routing authority when reduced motion is requested', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const activation = deriveCorePortActivation(
      structure,
      baseInput({
        visualState: 'agent_activity',
        reducedMotion: true,
        intensity: 1,
      }),
    );

    // Reduced motion keeps the static selection readable but does not add the
    // continuous circulation that agent activity would otherwise drive.
    expect(activation.routingAuthority).toBe(1);
    expect(activation.sourcePortId).toBeGreaterThanOrEqual(0);
  });
});
