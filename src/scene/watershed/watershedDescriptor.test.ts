import { describe, expect, it } from 'vitest';
import { terrainHeight, terrainProfile, type Vector2 } from './terrainField';
import {
  createWatershedDescriptor,
  DOMAIN_IDS,
  type WatershedDescriptor,
} from './watershedDescriptor';

/**
 * These are the composition constraints from §4 of the reconstruction spec,
 * written as assertions.
 *
 * The point is not that the current seed happens to satisfy them; it is that a
 * change which *breaks* one of them fails here rather than being discovered as a
 * bad screenshot. A constraint nobody can check is a preference.
 */

const ULTRA = 1;
const SAFE = 0.28;

/** Distance from a point to a segment, in XZ. */
function distanceToSegment(point: Vector2, a: Vector2, b: Vector2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(Math.max(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared, 0), 1);
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
}

/** The closest any river gets to a point, in XZ. */
function nearestFlow(descriptor: WatershedDescriptor, point: Vector2): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const river of descriptor.rivers) {
    for (let index = 0; index < river.spine.length - 1; index += 1) {
      nearest = Math.min(nearest, distanceToSegment(point, river.spine[index]!, river.spine[index + 1]!));
    }
  }
  return nearest;
}

describe('the descriptor is a pure function of its inputs', () => {
  it('returns an identical world for identical inputs', () => {
    expect(createWatershedDescriptor(4242, ULTRA)).toEqual(createWatershedDescriptor(4242, ULTRA));
  });

  it('carves each river along its own course and along no other', () => {
    // A river and the channel it cuts are the *same course*, so they share one
    // spine object; that is the relationship rather than a defect, and sharing
    // is what makes it impossible for the carve to drift off the water. What
    // must not happen is a river sharing a spine with another river, or two free
    // gullies — the delta's runnels, the ravine's branches — sharing one.
    const descriptor = createWatershedDescriptor(7, ULTRA);

    const riverSpines = descriptor.rivers.map((river) => river.spine);
    expect(new Set(riverSpines).size).toBe(riverSpines.length);

    // Every river's carve is present and is the identical array, not a copy.
    for (const river of descriptor.rivers) {
      expect(descriptor.channels.some((channel) => channel.spine === river.spine)).toBe(true);
    }

    // Every other channel is a gully, and no two gullies share a course.
    const gullies = descriptor.channels
      .map((channel) => channel.spine)
      .filter((spine) => !riverSpines.includes(spine));
    expect(gullies.length).toBeGreaterThan(0);
    expect(new Set(gullies).size).toBe(gullies.length);
  });
});

describe('C3 — the near field cannot occlude the basin', () => {
  it('keeps every river well clear of the idle camera corridor', () => {
    // Checked across many seeds, because the rivers wander per seed and the
    // clearance is the one thing the wander must never spend.
    for (let seed = 0; seed < 40; seed += 1) {
      const descriptor = createWatershedDescriptor(seed, ULTRA);
      const corridor = descriptor.cameraCorridors[0]!;
      const centre: Vector2 = [corridor.from[0], corridor.from[2]];

      const nearest = nearestFlow(descriptor, centre);
      expect(nearest).toBeGreaterThan(corridor.minClearance);

      // And not merely by a hair: the corridor is a finite volume, so its ends
      // are checked too rather than only its middle.
      const far: Vector2 = [corridor.to[0], corridor.to[2]];
      expect(nearestFlow(descriptor, far)).toBeGreaterThan(corridor.minClearance);
    }
  });

  it('puts the corridor above the whole volume it sweeps', () => {
    // The corridor's height is measured from the terrain at build time. This
    // holds the measurement honest: replacing it with a hand-written constant
    // would fail here rather than as a camera buried in a hill.
    //
    // Sampled over the corridor's real footprint, which is the capsule between
    // its two ends and not a square around its middle. The first version of this
    // test made exactly the mistake the code did, so it agreed with the bug.
    for (let seed = 0; seed < 12; seed += 1) {
      const descriptor = createWatershedDescriptor(seed, ULTRA);
      const corridor = descriptor.cameraCorridors[0]!;
      const from: Vector2 = [corridor.from[0], corridor.from[2]];
      const to: Vector2 = [corridor.to[0], corridor.to[2]];
      const floor = corridor.from[1] - corridor.minClearance;

      let sampled = 0;
      for (let row = 0; row <= 24; row += 1) {
        for (let column = 0; column <= 24; column += 1) {
          const x = Math.min(from[0], to[0]) - corridor.radius + (column / 24) * (Math.abs(to[0] - from[0]) + corridor.radius * 2);
          const z = Math.min(from[1], to[1]) - corridor.radius + (row / 24) * (Math.abs(to[1] - from[1]) + corridor.radius * 2);
          if (distanceToSegment([x, z], from, to) > corridor.radius) continue;
          sampled += 1;
          expect(terrainHeight(x, z, descriptor.field)).toBeLessThanOrEqual(floor + 1e-9);
        }
      }

      // A guard against the loop above silently skipping everything and passing.
      expect(sampled).toBeGreaterThan(50);
    }
  });
});

describe('the world is one watershed, not five islands', () => {
  const descriptor = createWatershedDescriptor(2026, ULTRA);

  it('has exactly the five domains, each with a distinct behaviour', () => {
    expect(descriptor.domains.map((domain) => domain.id)).toEqual([...DOMAIN_IDS]);

    const behaviours = descriptor.domains.map((domain) => domain.behaviour);
    expect(new Set(behaviours).size).toBe(behaviours.length);
  });

  it('keeps every domain clear of the basin rim', () => {
    // The basin's rim is the composition's centre of gravity. A region whose
    // radius reached into it would put a second subject in the same frame.
    const outerRim = descriptor.basin.radius + descriptor.basin.rimWidth;

    for (const domain of descriptor.domains) {
      const toBasin = Math.hypot(
        domain.centre[0] - descriptor.basin.centre[0],
        domain.centre[1] - descriptor.basin.centre[1],
      );
      expect(toBasin - domain.radius).toBeGreaterThan(outerRim);
    }
  });

  it('lands every domain-feeding river exactly on its domain', () => {
    for (const river of descriptor.rivers.filter((candidate) => candidate.feeds === 'domain')) {
      const domain = descriptor.domains.find((candidate) => candidate.id === river.domainId);
      expect(domain).toBeDefined();
      const mouth = river.spine[river.spine.length - 1]!;
      expect(mouth[0]).toBeCloseTo(domain!.centre[0], 6);
      expect(mouth[1]).toBeCloseTo(domain!.centre[1], 6);
    }
  });

  it('lands every basin-feeding river inside the basin', () => {
    for (const river of descriptor.rivers.filter((candidate) => candidate.feeds === 'basin')) {
      const mouth = river.spine[river.spine.length - 1]!;
      expect(Math.hypot(mouth[0] - descriptor.basin.centre[0], mouth[1] - descriptor.basin.centre[1]))
        .toBeLessThan(descriptor.basin.radius);
    }
  });

  it('does not double back on itself', () => {
    // Stated as a turn angle rather than as monotonicity in Z, which is the
    // stricter-looking version and the wrong one: a perpendicular wander moves a
    // laterally-running river in Z by definition, so a river that crosses the
    // frame can never satisfy it. What must be true is that the course keeps
    // going the same way.
    for (const river of descriptor.rivers) {
      for (let index = 1; index < river.spine.length - 1; index += 1) {
        const incoming = river.spine[index - 1]!;
        const at = river.spine[index]!;
        const outgoing = river.spine[index + 1]!;
        const ax = at[0] - incoming[0];
        const az = at[1] - incoming[1];
        const bx = outgoing[0] - at[0];
        const bz = outgoing[1] - at[1];
        const cosine = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));

        // cos(120°) = -0.5. A course that turns more sharply than this has a
        // kink in it, which on a carved channel reads as a fault.
        expect(cosine).toBeGreaterThan(-0.5);
      }
    }
  });

  it('makes every river run downhill', () => {
    // The property the first version of this world got wrong. The basin is the
    // low point, so the featureless ground falls from every source to the basin.
    // Checked on `terrainProfile` rather than on the total height: the noise
    // would swamp a two-point comparison, and this is a statement about the
    // composition rather than about the noise.
    //
    // "Overall" rather than "at every step", because the meander is allowed to
    // rise a little locally — a river that had to be monotone step by step would
    // have to be straight.
    for (const river of descriptor.rivers) {
      const heights = river.spine.map((point) => terrainProfile(point[1]));
      const drop = heights[0]! - heights[heights.length - 1]!;
      expect(drop).toBeGreaterThan(1.5);

      for (let index = 0; index < heights.length - 1; index += 1) {
        const rise = heights[index]! - heights[index + 1]!;
        expect(rise).toBeGreaterThan(-drop * 0.2);
      }
    }
  });

  it('hands the mesh and the deposit list the same deposits', () => {
    // Two lists that can disagree is one list too many: the mesh is built from
    // one and the crystals placed from the other.
    expect(descriptor.field.deposits.length).toBe(descriptor.deposits.length);
    for (const deposit of descriptor.deposits) {
      expect(descriptor.field.deposits).toContain(deposit);
    }
    expect(descriptor.field.domains.length).toBe(5);
    expect(descriptor.field.channels.length).toBe(descriptor.channels.length);
  });
});

describe('C6 — detail is not uniformly distributed', () => {
  const descriptor = createWatershedDescriptor(2026, ULTRA);

  it('leaves the research expanse deliberately empty', () => {
    const research = descriptor.domains.find((domain) => domain.id === 'research')!;
    const others = descriptor.domains.filter((domain) => domain.id !== 'research');

    for (const other of others) {
      expect(research.terrain.amplitude).toBeLessThan(other.terrain.amplitude);
    }
    // And nothing is deposited there, which is what keeps the far field quiet.
    expect(descriptor.deposits.some((deposit) => deposit.id === `deposit-${research.id}`)).toBe(
      false,
    );
  });

  it('puts the highest carve density in the delta', () => {
    // The AI delta is the dense end of the density field: many fine competing
    // runnels. Counted as channels whose spine ends in the region, which is how
    // the delta's branches are built.
    const ai = descriptor.domains.find((domain) => domain.id === 'ai')!;
    const inRegion = (point: Vector2): boolean =>
      Math.hypot(point[0] - ai.centre[0], point[1] - ai.centre[1]) <= ai.radius;

    const deltaChannels = descriptor.channels.filter((channel) =>
      inRegion(channel.spine[channel.spine.length - 1]!),
    ).length;

    expect(deltaChannels).toBeGreaterThanOrEqual(4);
    for (const domain of descriptor.domains.filter((candidate) => candidate.id !== 'ai')) {
      const count = descriptor.channels.filter((channel) => {
        const end = channel.spine[channel.spine.length - 1]!;
        return Math.hypot(end[0] - domain.centre[0], end[1] - domain.centre[1]) <= domain.radius;
      }).length;
      expect(deltaChannels).toBeGreaterThan(count);
    }
  });
});

describe('C7 — per-seed variation is real', () => {
  it('produces genuinely different worlds, not one world nudged', () => {
    const worlds = Array.from({ length: 12 }, (_, seed) =>
      createWatershedDescriptor(seed * 977 + 3, ULTRA),
    );

    // Density has to vary: a stage where every seed yields the same river count
    // and the same terrace count is a stage with one world and twelve names.
    expect(new Set(worlds.map((world) => world.rivers.length)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map((world) => world.basin.terraces)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map((world) => world.deposits.length)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map((world) => world.channels.length)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map((world) => world.basin.depth)).size).toBeGreaterThan(1);
  });

  it('keeps the composition fixed no matter the seed', () => {
    // Variation may not touch the art direction. This is the other half of C7
    // and the more important half: the basin, the domain anchors and the camera
    // corridor are the same in every world.
    for (let seed = 0; seed < 30; seed += 1) {
      const descriptor = createWatershedDescriptor(seed, ULTRA);
      expect(descriptor.basin.centre).toEqual([0, -300]);
      expect(descriptor.basin.radius).toBe(190);
      expect(descriptor.domains.map((domain) => domain.centre)).toEqual([
        [-440, -520],
        [520, -310],
        [-440, -100],
        [480, -640],
        [-40, -860],
      ]);
      expect(descriptor.cameraCorridors[0]!.from[0]).toBe(0);
    }
  });
});

describe('detail changes counts, never positions', () => {
  const full = createWatershedDescriptor(2026, ULTRA);
  const reduced = createWatershedDescriptor(2026, SAFE);

  it('reduces what exists without moving what remains', () => {
    // If detail moved a feature, the SAFE capture would be a different picture
    // from the ULTRA one and the two could not be compared at all.
    expect(reduced.basin).toEqual(full.basin);
    expect(reduced.domains.map((domain) => domain.centre)).toEqual(
      full.domains.map((domain) => domain.centre),
    );
    expect(reduced.extent).toEqual(full.extent);

    expect(reduced.strata.length).toBeLessThan(full.strata.length);
    expect(reduced.deposits.length).toBeLessThanOrEqual(full.deposits.length);
    expect(reduced.terrainResolution).toBeLessThan(full.terrainResolution);
  });

  it('keeps the composition constraints at the lowest detail', () => {
    // SAFE must still show the silhouette, the basin and at least one river.
    expect(reduced.rivers.length).toBeGreaterThanOrEqual(2);
    expect(reduced.strata.length).toBeGreaterThanOrEqual(1);
    expect(reduced.domains.length).toBe(5);

    const corridor = reduced.cameraCorridors[0]!;
    expect(nearestFlow(reduced, [corridor.from[0], corridor.from[2]])).toBeGreaterThan(
      corridor.minClearance,
    );
  });

  it('gives a river present at both details the same course', () => {
    for (const river of reduced.rivers) {
      const counterpart = full.rivers.find((candidate) => candidate.id === river.id);
      expect(counterpart).toBeDefined();
      expect(counterpart!.spine).toEqual(river.spine);
    }
  });
});
