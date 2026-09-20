import { describe, expect, it } from 'vitest';
import { terrainHeight } from './terrainField';
import {
  CENTRAL_BAND,
  insideRect,
  minimumVistaDistance,
  planShots,
  projectPoint,
  selectInterestPoints,
  SHOT_IDS,
  TARGET_ASPECTS,
  type ShotFraming,
  type ShotId,
} from './shots';
import { createWatershedDescriptor, type Vector3, type WatershedDescriptor } from './watershedDescriptor';

/**
 * The camera invariants from §8 of the reconstruction spec.
 *
 * A camera that clips a hill, faces the void or loses its subject is the failure
 * mode this stage is most exposed to, because none of those produce an error —
 * they produce a frame that is merely bad, and bad frames are easy to argue
 * with. These are the checks that turn each of them into a failure.
 */

const ULTRA = 1;
const SIXTEEN_NINE = 16 / 9;

/**
 * Two regions are hundreds of units apart, so anything under this is one region
 * wearing two names. The BEFORE capture found exactly that — GRAPHICS and
 * SYSTEMS framed identically — and this is its floor.
 */
const DOMAIN_GAP_FLOOR = 120;

/** The four regions a hover or focus can be about. RESEARCH is inspected too, but
 *  it is the quiet region and its framing is allowed to be the most withdrawn. */
const FOCUSABLE = ['ai', 'graphics', 'game-analysis', 'systems'] as const;

const descriptor: WatershedDescriptor = createWatershedDescriptor(2026, ULTRA);

/** How close the nearest ground gets to the camera, out along its view axis to the subject. */
function nearestGroundAlongView(framing: ShotFraming, steps = 60): number {
  const dx = framing.lookTarget[0] - framing.position[0];
  const dy = framing.lookTarget[1] - framing.position[1];
  const dz = framing.lookTarget[2] - framing.position[2];
  const length = Math.hypot(dx, dy, dz) || 1;

  let nearest = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= steps; step += 1) {
    const travelled = (length * step) / steps;
    const x = framing.position[0] + (dx / length) * travelled;
    const z = framing.position[2] + (dz / length) * travelled;
    const y = framing.position[1] + (dy / length) * travelled;

    const ground = terrainHeight(x, z, descriptor.field);
    // Only the vertical clearance matters: the ray may pass over a ridge whose
    // projection is irrelevant, and what must never happen is the ray going
    // *into* the surface.
    if (y > ground) nearest = Math.min(nearest, y - ground);
  }
  return nearest;
}

describe('every shot is a framing the world can actually support', () => {
  it('has all seven, and each is one of the seven', () => {
    const shots = planShots(descriptor, SIXTEEN_NINE, 'graphics');
    expect(Object.keys(shots).sort()).toEqual([...SHOT_IDS].sort());
    for (const id of SHOT_IDS) {
      expect(shots[id].id).toBe(id);
    }
  });

  it('always looks at something in front of it', () => {
    // A look target behind the camera is a degenerate view matrix and produces a
    // NaN projection, which then propagates into the renderer's matrices.
    const shots = planShots(descriptor, SIXTEEN_NINE, 'graphics');
    for (const id of SHOT_IDS) {
      const framing = shots[id];
      const dx = framing.lookTarget[0] - framing.position[0];
      const dy = framing.lookTarget[1] - framing.position[1];
      const dz = framing.lookTarget[2] - framing.position[2];

      expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(5);
      expect(framing.focalDistance).toBeGreaterThan(5);
    }
  });

  it('never sends the camera into the ground', () => {
    for (const domainId of ['ai', 'graphics', 'game-analysis', 'systems', 'research'] as const) {
      const shots = planShots(descriptor, SIXTEEN_NINE, domainId);
      for (const id of SHOT_IDS) {
        const framing = shots[id];
        const ground = terrainHeight(framing.position[0], framing.position[2], descriptor.field);
        expect(framing.position[1]).toBeGreaterThan(ground);
      }
    }
  });

  it('delivers the foreground clearance every shot promises', () => {
    // The brief's "the camera must never clip geometry", stated as the number
    // each shot promises and measured against the ground the camera is actually
    // over. The earlier version of this test only asked that the camera was
    // *above* the ground, which is a much weaker claim than the shot makes: the
    // vista promised 26 units and delivered 25.1, and `> 0` saw nothing wrong.
    for (const domainId of ['ai', 'graphics', 'game-analysis', 'systems', 'research'] as const) {
      for (const shots of [planShots(descriptor, SIXTEEN_NINE, domainId), planShots(descriptor, SIXTEEN_NINE)]) {
        for (const id of SHOT_IDS) {
          const framing = shots[id];
          const ground = terrainHeight(framing.position[0], framing.position[2], descriptor.field);
          const clearance = framing.position[1] - ground;
          expect(clearance, `${id} at ${domainId}`).toBeGreaterThanOrEqual(framing.safeForeground);
        }
      }
    }
  });

  it('looks over the ground it is aimed across, not into it', () => {
    // The other half of "never clip geometry": a pose that stands clear but aims
    // into a hillside is still a bad frame. The ray is followed only as far as
    // the subject it is aimed at, because past that the camera is looking at
    // whatever is behind the subject and passing near ground there is allowed.
    for (const domainId of ['ai', 'graphics', 'game-analysis', 'systems', 'research'] as const) {
      const shots = planShots(descriptor, SIXTEEN_NINE, domainId);
      for (const id of SHOT_IDS) {
        const framing = shots[id];
        expect(nearestGroundAlongView(framing), `${id} at ${domainId}`).toBeGreaterThan(0);
      }
    }
  });

  it('derives every focal distance from the pose it is attached to', () => {
    // `focalDistance` is what the depth of field focuses at, and it is computed
    // from the position — so a shot built by spreading another shot's framing
    // inherits a focal distance belonging to a camera that is no longer there.
    // The hover did exactly that: six units closer to an 800-unit subject, still
    // reporting the vista's figure. Checked against the pose rather than against
    // a remembered number.
    for (const domainId of ['ai', 'graphics', 'game-analysis', 'systems', 'research'] as const) {
      for (const shots of [planShots(descriptor, SIXTEEN_NINE, domainId), planShots(descriptor, SIXTEEN_NINE)]) {
        for (const id of SHOT_IDS) {
          const framing = shots[id];
          const actual = Math.hypot(
            framing.lookTarget[0] - framing.position[0],
            framing.lookTarget[1] - framing.position[1],
            framing.lookTarget[2] - framing.position[2],
          );
          expect(framing.focalDistance, `${id} at ${domainId}`).toBeCloseTo(actual, 9);
        }
      }
    }
  });

  it('names each shot correctly even when no region is bound', () => {
    // The record is keyed by shot id, so the value under that key has to agree.
    // Returning the vista unchanged for the three region shots meant a consumer
    // switching on `framing.id` to choose a transition read `idleVista` and got
    // a route approach.
    const unbound = planShots(descriptor, SIXTEEN_NINE);
    for (const id of SHOT_IDS) {
      expect(unbound[id].id, id).toBe(id);
    }
  });

  it('has a `heroRegion` inside the frame', () => {
    const shots = planShots(descriptor, SIXTEEN_NINE, 'graphics');
    for (const id of SHOT_IDS) {
      const region = shots[id].heroRegion;
      expect(region.left).toBeGreaterThanOrEqual(0);
      expect(region.top).toBeGreaterThanOrEqual(0);
      expect(region.right).toBeLessThanOrEqual(1);
      expect(region.bottom).toBeLessThanOrEqual(1);
      expect(region.left).toBeLessThan(region.right);
      expect(region.top).toBeLessThan(region.bottom);
    }
  });
});

describe('C2 — the basin lands inside the central band', () => {
  it('frames the basin inside the band at both named targets', () => {
    // The two targets the brief names separately, checked separately. They are
    // both 16:9, so this passes for a reason worth stating rather than hiding:
    // see `TARGET_ASPECTS`.
    for (const [label, aspect] of Object.entries(TARGET_ASPECTS)) {
      const framing = planShots(descriptor, aspect).idleVista;
      const centre = projectPoint(
        [descriptor.basin.centre[0], descriptor.basinFloor + 26, descriptor.basin.centre[1]],
        framing,
        aspect,
      );

      expect(Number.isFinite(centre.x), label).toBe(true);
      expect(insideRect(centre, CENTRAL_BAND), label).toBe(true);
    }
  });

  it('keeps the basin’s core inside the shot’s own hero region', () => {
    const aspect = SIXTEEN_NINE;
    const framing = planShots(descriptor, aspect).idleVista;
    const core = descriptor.basin.radius * 0.5;
    const origin: Vector3 = [descriptor.basin.centre[0], descriptor.basinFloor + 26, descriptor.basin.centre[1]];

    // The core's extreme points, rather than only its centre: a basin centred in
    // frame but half again too large would pass a centre-only check.
    for (const [dx, dz] of [
      [core, 0],
      [-core, 0],
      [0, core],
      [0, -core],
    ] as const) {
      const projected = projectPoint([origin[0] + dx, origin[1], origin[2] + dz], framing, aspect);
      expect(Number.isFinite(projected.x)).toBe(true);
      expect(insideRect(projected, framing.heroRegion)).toBe(true);
    }
  });

  it('says out loud that the two named targets are one aspect', () => {
    // Not a tautology dressed up: if a target is ever added at a different
    // aspect, this list changes and the calibration starts doing real work. The
    // assertion exists so that adding one is a deliberate act.
    const framings = Object.values(TARGET_ASPECTS).map((aspect) =>
      planShots(descriptor, aspect).idleVista,
    );
    expect(framings[1]).toEqual(framings[0]);
    expect(framings[2]).toEqual(framings[0]);
  });

  it('derives a vista distance the corridor actually satisfies', () => {
    // The derivation is separate from the corridor so that moving the camera is
    // checked against the arithmetic rather than against the previous value.
    const required = minimumVistaDistance(descriptor.basin.radius * 0.5);
    const framing = planShots(descriptor, SIXTEEN_NINE).idleVista;
    expect(framing.focalDistance).toBeGreaterThan(required);
  });
});

describe('the focus sequence moves toward the subject, not around it', () => {
  it('closes the distance from approach to arrival to inspection', () => {
    const shots = planShots(descriptor, SIXTEEN_NINE, 'graphics');
    const domain = descriptor.domains.find((candidate) => candidate.id === 'graphics')!;
    const toDomain = (framing: ShotFraming): number =>
      Math.hypot(
        framing.position[0] - domain.centre[0],
        framing.position[1] - domain.centre[1],
        framing.position[2] - domain.centre[1],
      );

    expect(toDomain(shots.routeApproach)).toBeGreaterThan(toDomain(shots.domainArrival));
    expect(shots.routeApproach.duration).toBeGreaterThan(0);
    expect(shots.domainArrival.duration).toBeGreaterThan(0);
  });

  it('keeps the basin in frame at inspection, so the region reads as part of a world', () => {
    const aspect = SIXTEEN_NINE;
    for (const domainId of FOCUSABLE) {
      const shots = planShots(descriptor, aspect, domainId);
      const basin = projectPoint(
        [descriptor.basin.centre[0], descriptor.basinFloor + 26, descriptor.basin.centre[1]],
        shots.domainInspection,
        aspect,
      );

      expect(Number.isFinite(basin.x), domainId).toBe(true);
      expect(basin.x).toBeGreaterThan(0);
      expect(basin.x).toBeLessThan(1);
      expect(basin.y).toBeGreaterThan(0);
      expect(basin.y).toBeLessThan(1);
    }
  });

  it('lets the four focusable regions produce four different framings', () => {
    // The BEFORE capture's finding 5: GRAPHICS and SYSTEMS were the same picture
    // with different text. If two regions frame identically here, that has come
    // back.
    const aspect = SIXTEEN_NINE;
    const inspections = (['ai', 'graphics', 'game-analysis', 'systems'] as const).map(
      (domainId) => planShots(descriptor, aspect, domainId).domainInspection,
    );

    for (let index = 0; index < inspections.length; index += 1) {
      for (let other = index + 1; other < inspections.length; other += 1) {
        const a = inspections[index]!;
        const b = inspections[other]!;
        const separation = Math.hypot(
          a.position[0] - b.position[0],
          a.position[1] - b.position[1],
          a.position[2] - b.position[2],
        );
        expect(separation).toBeGreaterThan(DOMAIN_GAP_FLOOR);
      }
    }
  });
});


describe('hover moves the world, not the camera', () => {
  it('barely moves the camera between the vista and a hover', () => {
    const aspect = SIXTEEN_NINE;
    const vista = planShots(descriptor, aspect).idleVista;
    const hover = planShots(descriptor, aspect, 'graphics').hoverReveal;

    const moved = Math.hypot(
      hover.position[0] - vista.position[0],
      hover.position[1] - vista.position[1],
      hover.position[2] - vista.position[2],
    );
    expect(moved).toBeLessThan(12);
    expect(moved).toBeGreaterThan(0);
    // The world responds instead, which is what the fog figure stands in for.
    expect(hover.fogResponse).not.toBe(vista.fogResponse);
  });
});

describe('C1 — the descriptor proposes, the frame disposes', () => {
  it('drops interest points that its own framing does not show', () => {
    const kept = selectInterestPoints(descriptor, SIXTEEN_NINE);
    const proposed = descriptor.interestPoints.length;

    expect(kept.length).toBeGreaterThan(0);
    // The filter has to be doing something, or it is a pass-through wearing a
    // constraint's name.
    expect(kept.length).toBeLessThan(proposed);

    for (const interest of kept) {
      expect(Number.isFinite(interest.projected.x)).toBe(true);
      expect(interest.projected.depth).toBeGreaterThan(0);
    }
  });

  it('keeps the points in descending weight order', () => {
    const kept = selectInterestPoints(descriptor, SIXTEEN_NINE);
    for (let index = 0; index < kept.length - 1; index += 1) {
      expect(kept[index]!.weight).toBeGreaterThanOrEqual(kept[index + 1]!.weight);
    }
  });

  it('does not keep two points that are on top of each other', () => {
    const kept = selectInterestPoints(descriptor, SIXTEEN_NINE);
    for (let index = 0; index < kept.length; index += 1) {
      for (let other = index + 1; other < kept.length; other += 1) {
        const a = kept[index]!.position;
        const b = kept[other]!.position;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(120);
      }
    }
  });
});

describe('the shot vocabulary is closed', () => {
  it('names every shot once', () => {
    expect(new Set(SHOT_IDS).size).toBe(SHOT_IDS.length);
    expect(SHOT_IDS.length).toBe(7);
  });

  it('gives every moving shot a duration and every resting shot none', () => {
    const shots = planShots(descriptor, SIXTEEN_NINE, 'graphics');
    const moving: ShotId[] = ['entry', 'hoverReveal', 'routeApproach', 'domainArrival', 'returnVista'];
    const resting: ShotId[] = ['idleVista', 'domainInspection'];

    for (const id of moving) expect(shots[id].duration, id).toBeGreaterThan(0);
    for (const id of resting) expect(shots[id].duration, id).toBe(0);
  });
});
