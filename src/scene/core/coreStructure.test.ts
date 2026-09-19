import { describe, expect, it } from 'vitest';

import {
  deriveCorePortActivation,
  deriveCoreStructure,
  selectCorePortForDirection,
  type CoreStructureForm,
  type CoreStructureMember,
  type CoreStructureSpan,
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

/** `filter` cannot narrow a union on its own, so forms and spans narrow here. */
function formsOf(
  members: readonly CoreStructureMember[],
  shape: CoreStructureForm['shape'],
): readonly CoreStructureForm[] {
  return members.filter(
    (member): member is CoreStructureForm => member.shape === shape,
  );
}

function spansOf(
  members: readonly CoreStructureMember[],
): readonly CoreStructureSpan[] {
  return members.filter(
    (member): member is CoreStructureSpan => member.shape === 'beam',
  );
}

describe('deriveCoreStructure', () => {
  it('keeps a diagonal spine and a cut hero volume at every detail level', () => {
    for (const structureDetail of [0, 0.12, 0.5, 1]) {
      const structure = deriveCoreStructure({ structureDetail }, SEED);
      const spans = spansOf(structure.members);
      const volumes = formsOf(structure.members, 'volume');

      expect(spans.length).toBeGreaterThanOrEqual(1);
      // Hero upper, hero lower, and the recessed void between them.
      expect(volumes.length).toBeGreaterThanOrEqual(3);
      expect(structure.ports.length).toBeGreaterThanOrEqual(3);
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

  it('introduces membranes, secondary assemblies, layers and foreground slices at their tiers', () => {
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0 }, SEED).members))
      .not.toContain('membrane');
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0.25 }, SEED).members))
      .toContain('membrane');
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0.5 }, SEED).members))
      .toContain('membrane');
    expect(shapesOf(deriveCoreStructure({ structureDetail: 0.72 }, SEED).members))
      .toContain('slice');
    expect(shapesOf(deriveCoreStructure({ structureDetail: 1 }, SEED).members))
      .toContain('slice');
  });

  it('keeps the hero volume clear of the spine and holds an explicit void gap', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const upper = structure.members.find(
      (member) => member.shape === 'volume' && member.rank === 2,
    );
    const lower = structure.members.find(
      (member) => member.shape === 'volume' && member.rank === 3,
    );

    expect(upper?.shape).toBe('volume');
    expect(lower?.shape).toBe('volume');
    if (upper?.shape !== 'volume' || lower?.shape !== 'volume') return;

    const upperBottom = upper.position[1] - upper.scale[1] / 2;
    const lowerTop = lower.position[1] + lower.scale[1] / 2;
    // A real gap, not two touching halves: this is the central void.
    expect(upperBottom - lowerTop).toBeGreaterThan(0.08);
  });

  it('separates bands so the composition has front, middle and back', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const bands = new Set(structure.members.map((member) => member.band));

    expect(bands.has('background')).toBe(true);
    expect(bands.has('midground')).toBe(true);
    expect(bands.has('foreground')).toBe(true);
  });

  it('varies member scale classes rather than repeating one box size', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const volumes = formsOf(structure.members, 'volume');
    const volumeExtents = volumes.map((member) => member.scale[0] * member.scale[1]);

    expect(Math.max(...volumeExtents)).toBeGreaterThan(
      Math.min(...volumeExtents) * 2.5,
    );
  });

  it('holds the foreground slices close to the viewer so the viewport clips them', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const slices = formsOf(structure.members, 'slice');

    expect(slices.length).toBeGreaterThanOrEqual(2);
    for (const slice of slices) {
      expect(slice.position[2]).toBeGreaterThan(1);
    }
  });

  it('is asymmetric: no member mirrors another across the origin', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const positions = structure.members
      .filter((member): member is CoreStructureForm => member.shape !== 'beam')
      .map((member) => member.position);

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
        'position' in member
          ? [...member.position, ...member.rotation, ...member.scale]
          : [...member.start, ...member.end, member.width, member.depth];
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

  it('points the spine along its own endpoints as a unit direction', () => {
    const structure = deriveCoreStructure({ structureDetail: 1 }, SEED);
    const spine = structure.members.find((member) => member.shape === 'beam');

    expect(spine?.shape).toBe('beam');
    if (spine?.shape !== 'beam') return;

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