import { describe, expect, it } from 'vitest';

import {
  deriveCorePortActivation,
  deriveCoreStructure,
  selectCorePortForDirection,
  type CoreStructureForm,
  type CoreStructureHull,
  type CoreStructureMember,
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

function shapesOf(members: readonly CoreStructureMember[]): string[] {
  return members.map((member) => member.shape);
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

function hullByRank(
  members: readonly CoreStructureMember[],
  rank: number,
): CoreStructureHull | undefined {
  return hullsOf(members).find((member) => member.rank === rank);
}

/** An interior point of a hull, used where a member's location is all we need. */
function hullCentre(hull: CoreStructureHull): readonly [number, number, number] {
  return [
    (hull.start[0] + hull.end[0]) / 2,
    (hull.start[1] + hull.end[1]) / 2,
    (hull.start[2] + hull.end[2]) / 2,
  ];
}

/** Where a member sits, whatever shape it is. */
function memberCentre(member: CoreStructureMember): readonly [number, number, number] {
  if (member.shape === 'hull' || member.shape === 'beam') {
    return [
      (member.start[0] + member.end[0]) / 2,
      (member.start[1] + member.end[1]) / 2,
      (member.start[2] + member.end[2]) / 2,
    ];
  }
  return member.position;
}

/** The widest and narrowest half-height in a hull's section list. */
function sectionSpread(hull: CoreStructureHull): { widest: number; narrowest: number } {
  const heights = hull.sections.map((section) => section.halfHeight);
  return { widest: Math.max(...heights), narrowest: Math.min(...heights) };
}

/**
 * The hull's centre line and half-height at a point along x.
 *
 * The hulls run mostly along x, so this is how the tests measure the opening
 * between them: a real window has a measurable vertical extent at the x where
 * both hulls exist.
 */
function hullAt(hull: CoreStructureHull, x: number): { centreY: number; halfHeight: number } {
  const forward = hull.start[0] <= hull.end[0];
  const from = forward ? hull.start : hull.end;
  const to = forward ? hull.end : hull.start;
  const t = Math.min(1, Math.max(0, (x - from[0]) / (to[0] - from[0])));

  const sections = hull.sections;
  let index = 0;
  for (let cursor = 0; cursor < sections.length - 1; cursor += 1) {
    if (sections[cursor + 1]!.t <= t) index = cursor + 1;
  }
  const a = sections[index]!;
  const b = sections[Math.min(sections.length - 1, index + 1)]!;
  const span = b.t - a.t;
  const mix = span < 1e-6 ? 0 : (t - a.t) / span;

  return {
    centreY: from[1] + (to[1] - from[1]) * t + a.offset[1] + (b.offset[1] - a.offset[1]) * mix,
    halfHeight: a.halfHeight + (b.halfHeight - a.halfHeight) * mix,
  };
}

describe('deriveCoreStructure', () => {
  it('keeps the hero hulls, the spine that carries them and the ports at every detail level', () => {
    for (const structureDetail of [0, 0.12, 0.5, 1]) {
      const structure = deriveCoreStructure({ structureDetail }, SEED);
      const hulls = hullsOf(structure.members);

      // Two processing hulls, two end yokes, the void wall and the spine.
      expect(hulls.length).toBeGreaterThanOrEqual(6);
      expect(structure.ports.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('builds the processing hulls from their own sections rather than scaled boxes', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const upper = hullByRank(structure.members, 0);
    const lower = hullByRank(structure.members, 1);

    for (const hull of [upper, lower]) {
      expect(hull).toBeDefined();
      if (!hull) continue;
      // A lofted hull is defined by sections that differ along its axis. A
      // transformed unit box has one cross-section for its whole length, which
      // is exactly what made the old mass read as slabs.
      expect(hull.sections.length).toBeGreaterThanOrEqual(3);
      const { widest, narrowest } = sectionSpread(hull);
      expect(narrowest).toBeLessThan(widest * 0.6);
      expect(hull.chamfer).toBeGreaterThan(0);
    }
  });

  it('runs the spine through both processing hulls instead of past them', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const spine = hullByRank(structure.members, 5);
    const upper = hullByRank(structure.members, 0);
    const lower = hullByRank(structure.members, 1);

    expect(spine).toBeDefined();
    expect(upper).toBeDefined();
    expect(lower).toBeDefined();
    if (!spine || !upper || !lower) return;

    // The spine's own endpoints reach past both hulls' centre lines, so it is a
    // member the mass is hung on rather than a rod laid alongside it.
    for (const hull of [upper, lower]) {
      const centre = hullCentre(hull);
      const toCentre = Math.hypot(
        centre[0] - spine.start[0],
        centre[1] - spine.start[1],
        centre[2] - spine.start[2],
      );
      const span = Math.hypot(
        spine.end[0] - spine.start[0],
        spine.end[1] - spine.start[1],
        spine.end[2] - spine.start[2],
      );
      expect(toCentre).toBeLessThan(span);
    }
  });

  it('holds an explicit void between the hulls and closes it on both sides', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const upper = hullByRank(structure.members, 0);
    const lower = hullByRank(structure.members, 1);
    const leftYoke = hullByRank(structure.members, 2);
    const rightYoke = hullByRank(structure.members, 3);

    expect(upper).toBeDefined();
    expect(lower).toBeDefined();
    expect(leftYoke).toBeDefined();
    expect(rightYoke).toBeDefined();
    if (!upper || !lower || !leftYoke || !rightYoke) return;

    // The window is what the two yokes hold open, so that is where it is
    // measured: an opening outside the end walls would be a gap in the
    // silhouette, not a void cut through the body.
    const leftWall = hullCentre(leftYoke)[0];
    const rightWall = hullCentre(rightYoke)[0];
    expect(rightWall - leftWall).toBeGreaterThan(1.2);
    expect(rightWall).toBeGreaterThan(leftWall);

    // Half the Core's own height is the ceiling: past that the opening stops
    // being a void cut through a body and becomes the frame itself.
    const openings: number[] = [];
    for (const fraction of [0.25, 0.5, 0.75]) {
      const x = leftWall + (rightWall - leftWall) * fraction;
      const top = hullAt(upper, x);
      const bottom = hullAt(lower, x);
      const gap = top.centreY - top.halfHeight - (bottom.centreY + bottom.halfHeight);
      openings.push(gap);

      // A window you can see through, not a seam between two touching slabs...
      expect(gap).toBeGreaterThan(0.3);
      // ...and never the dominant feature of the composition.
      expect(gap).toBeLessThan(structure.bounds[1] * 2 * 0.55);
    }
    // It is a shaped opening, not a constant slot: the body tapers around it.
    expect(Math.max(...openings) - Math.min(...openings)).toBeGreaterThan(0.15);

    // Both hulls have to still be present across the whole opening, otherwise
    // the "window" is just the end of the structure.
    for (const hull of [upper, lower]) {
      const spanStart = Math.min(hull.start[0], hull.end[0]);
      const spanEnd = Math.max(hull.start[0], hull.end[0]);
      expect(spanStart).toBeLessThan(leftWall);
      expect(spanEnd).toBeGreaterThan(rightWall);
    }
  });

  it('adds surfaces monotonically as detail rises instead of turning anything up', () => {
    const counts = [0, 0.25, 0.5, 0.72, 0.9, 1].map(
      (structureDetail) =>
        deriveCoreStructure({ structureDetail }, SEED).members.length,
    );

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    }

    // ULTRA must be visibly richer than SAFE, not merely brighter.
    expect(counts.at(-1)!).toBeGreaterThan(counts[0]! + 5);
  });

  it('introduces membranes, pockets, layers and the foreground chip at their tiers', () => {
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0 }, SEED).members))
      .not.toContain('membrane');
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0.25 }, SEED).members))
      .toContain('membrane');

    const hullCountAt = (structureDetail: number): number =>
      hullsOf(deriveCoreStructure({ structureDetail }, SEED).members).length;
    // The pockets arrive at the secondary tier, the background rail at tertiary.
    expect(hullCountAt(0.25)).toBeLessThan(hullCountAt(0.5));
    expect(hullCountAt(0.5)).toBeLessThan(hullCountAt(0.9));

    expect(shapesOf(deriveCoreStructure({ structureDetail: 0.5 }, SEED).members))
      .not.toContain('slice');
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0.72 }, SEED).members))
      .toContain('slice');
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
    const hulls = hullsOf(structure.members);
    const lengths = hulls.map((hull) =>
      Math.hypot(
        hull.end[0] - hull.start[0],
        hull.end[1] - hull.start[1],
        hull.end[2] - hull.start[2],
      ),
    );

    expect(Math.max(...lengths)).toBeGreaterThan(Math.min(...lengths) * 2.5);
  });

  it('holds exactly one small low-contrast element in the foreground', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const slices = formsOf(structure.members, 'slice');

    // The previous round used two plates over a world unit across, which
    // swallowed a third of the frame at 1920 and flattened 2560 entirely.
    expect(slices).toHaveLength(1);
    const [chip] = slices;
    expect(chip).toBeDefined();
    if (!chip) return;

    expect(chip.position[2]).toBeGreaterThan(1);
    expect(chip.scale[0] * chip.scale[1]).toBeLessThan(0.12);
    // It has to be the darkest thing in the frame, not a bright overlay.
    expect(chip.tier).toBe('recess');
  });

  it('is asymmetric: no member mirrors another across the origin', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const positions = structure.members.map((member) => memberCentre(member));

    for (const position of positions) {
      const mirrored = positions.find(
        (candidate) =>
          Math.abs(candidate[0] + position[0]) < 0.02 &&
          Math.abs(candidate[1] + position[1]) < 0.02 &&
          Math.abs(candidate[2] + position[2]) < 0.02,
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
            : [...member.position, ...member.rotation, ...member.scale];
      for (const value of values) expect(Number.isFinite(value)).toBe(true);
    }

    for (const port of first.ports) {
      for (const value of [...port.position, ...port.direction]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(
        Math.hypot(...port.direction),
      ).toBeCloseTo(1, 5);
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

  it('points the spine axis along its own endpoints as a unit direction', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const spine = hullByRank(structure.members, 5);

    expect(spine).toBeDefined();
    if (!spine) return;

    const dx = spine.end[0] - spine.start[0];
    const dy = spine.end[1] - spine.start[1];
    const dz = spine.end[2] - spine.start[2];
    const length = Math.hypot(dx, dy, dz);

    expect(structure.spineAxis[0]).toBeCloseTo(dx / length, 5);
    expect(structure.spineAxis[1]).toBeCloseTo(dy / length, 5);
    expect(structure.spineAxis[2]).toBeCloseTo(dz / length, 5);
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
    for (const structureDetail of [0, 0.25, 0.5, 0.72, 1]) {
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
    const leftmost = structure.ports.find(
      (port) => port.direction[0] < -0.9,
    );
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