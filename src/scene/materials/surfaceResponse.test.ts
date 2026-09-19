import { describe, expect, it } from 'vitest';

import { SURFACE_RESPONSE_CURVES, type SurfaceRole } from './machinePalette';
import {
  deriveSurfaceResponse,
  responseCurveFor,
  type SurfaceInput,
} from './surfaceResponse';

const ROLES: readonly SurfaceRole[] = [
  'shell',
  'edge',
  'recess',
  'accent',
  'membrane',
  'port',
];

/**
 * The solid tiers, ordered by how much they answer, and that ordering is a
 * contract rather than a coincidence: `recess` and `accent` are the two classes
 * a working structure lights from the inside out, and `shell` is the one that
 * has to hold still while it happens.
 */
const SOLID_TIERS_ASCENDING: readonly SurfaceRole[] = [
  'shell',
  'edge',
  'port',
  'recess',
  'accent',
];

/**
 * The highest gain any curve may reach with every increment saturated.
 *
 * Loose on purpose. The number this pins is not a brightness target — it is the
 * statement that the response is *bounded*, so a caller cannot hand a ramp
 * position to a colour multiplier and get an unbounded value out of it. The real
 * ceiling is `accent` at 1.78, and it is only reachable from full activity, full
 * focus and a fully arrived field at the same time.
 */
const MAX_GAIN = 1.8;

function at(role: SurfaceRole, input: Partial<SurfaceInput>): number {
  return deriveSurfaceResponse(role, {
    activity: 0,
    focus: 0,
    ...input,
  }).gain;
}

describe('deriveSurfaceResponse', () => {
  it('rests below full gain on every role, so activity has somewhere to travel', () => {
    for (const role of ROLES) {
      const rest = at(role, {});

      expect(rest).toBeGreaterThan(0);
      // A surface that rests at 1 can only ever be clipped by its own activity.
      expect(rest).toBeLessThan(1);
      expect(rest).toBeCloseTo(responseCurveFor(role).gainAtRest, 10);
    }
  });

  it('never lets any role exceed the gain ceiling', () => {
    for (const role of ROLES) {
      expect(at(role, { activity: 1, focus: 1, proximity: 1 })).toBeLessThanOrEqual(
        MAX_GAIN,
      );
    }
  });

  it('rises with activity, with focus and with proximity, monotonically', () => {
    for (const role of ROLES) {
      const rest = at(role, {});
      const active = at(role, { activity: 0.5 });
      const moreActive = at(role, { activity: 1 });
      const focused = at(role, { focus: 1 });
      const near = at(role, { proximity: 1 });

      expect(active).toBeGreaterThan(rest);
      expect(moreActive).toBeGreaterThan(active);
      expect(focused).toBeGreaterThan(rest);
      // Proximity is the increment the routing field writes, and it has to be
      // able to light a surface that is doing nothing else at all — otherwise a
      // manifold could not show *where* the flow is, only that something is.
      expect(near).toBeGreaterThan(rest);
    }
  });

  it('orders the solid tiers by how much they answer, the recessed ones first', () => {
    const rising = SOLID_TIERS_ASCENDING.map(
      (role) => at(role, { activity: 1, focus: 1 }) - at(role, {}),
    );

    for (let index = 1; index < rising.length; index += 1) {
      expect(rising[index]!).toBeGreaterThan(rising[index - 1]!);
    }
  });

  it('answers proximity hardest on the surfaces the field runs through', () => {
    // The shell is the frame and the frame does not report traffic. The recessed
    // and accent classes are the machine's working surfaces, so the field
    // arriving at one of them has to be legible on it.
    expect(responseCurveFor('recess').gainFromProximity).toBeGreaterThan(
      responseCurveFor('shell').gainFromProximity,
    );
    expect(responseCurveFor('accent').gainFromProximity).toBeGreaterThan(
      responseCurveFor('shell').gainFromProximity,
    );
  });

  it('carries a membrane in its openness rather than in its gain', () => {
    const rise = at('membrane', { activity: 1, focus: 1 }) - at('membrane', {});
    const opened =
      deriveSurfaceResponse('membrane', { activity: 1, focus: 1 }, 0.34).alpha -
      deriveSurfaceResponse('membrane', { activity: 0, focus: 0 }, 0.34).alpha;

    // A membrane is a thin layer: its job is to thin and thicken, not to become
    // a bright surface. Its gain stays below every other tier's, including the
    // shell's neighbours, while its alpha travels a visible distance.
    expect(rise).toBeLessThan(at('edge', { activity: 1, focus: 1 }) - at('edge', {}));
    expect(opened).toBeGreaterThan(0.1);
  });

  it('keeps the multiplier bounded when the inputs are not', () => {
    for (const role of ROLES) {
      const response = deriveSurfaceResponse(role, {
        activity: Number.POSITIVE_INFINITY,
        focus: Number.NaN,
        proximity: Number.NEGATIVE_INFINITY,
      });

      expect(Number.isFinite(response.gain)).toBe(true);
      expect(response.gain).toBeGreaterThan(0);
      expect(response.gain).toBeLessThanOrEqual(MAX_GAIN);
      expect(Number.isFinite(response.alpha)).toBe(true);
    }

    const negative = deriveSurfaceResponse('recess', {
      activity: -12,
      focus: -3,
    });
    expect(negative.gain).toBeCloseTo(responseCurveFor('recess').gainAtRest, 10);
  });

  it('gives every opaque role an alpha of exactly one', () => {
    for (const role of ROLES) {
      if (role === 'membrane') continue;

      // Not "near one": an opaque material ignores alpha, so any other value
      // would be a response the renderer silently drops.
      expect(deriveSurfaceResponse(role, { activity: 1, focus: 1 }).alpha).toBe(1);
      expect(SURFACE_RESPONSE_CURVES[role].fadeFromActivity).toBe(0);
      expect(SURFACE_RESPONSE_CURVES[role].fadeFromFocus).toBe(0);
      expect(SURFACE_RESPONSE_CURVES[role].fadeFromProximity).toBe(0);
    }
  });

  it('opens a membrane inside its tuned band and never past it', () => {
    const rest = deriveSurfaceResponse('membrane', { activity: 0, focus: 0 }, 0.34);
    const open = deriveSurfaceResponse('membrane', { activity: 1, focus: 1 }, 0.34);

    expect(rest.alpha).toBeGreaterThan(0.16);
    expect(open.alpha).toBeGreaterThan(rest.alpha);
    expect(open.alpha).toBeLessThanOrEqual(0.46);

    // A closed membrane stays a visible layer rather than vanishing, which is
    // what keeps a dormant domain's layering legible in the idle composition.
    const closed = deriveSurfaceResponse('membrane', { activity: 0, focus: 0 }, 0);
    expect(closed.alpha).toBeGreaterThan(0);
  });

  it('takes the resting openness from the caller, not from the curve', () => {
    const quiet = deriveSurfaceResponse('membrane', { activity: 0, focus: 0 }, 0.2);
    const open = deriveSurfaceResponse('membrane', { activity: 0, focus: 0 }, 0.6);

    expect(open.alpha).toBeGreaterThan(quiet.alpha);
    // The hero's membranes and a domain's membranes layer over different
    // amounts of structure, so the floor has to be theirs to set.
    expect(quiet.gain).toBe(open.gain);
  });

  it('scales the whole response by presence, and only presence takes it below rest', () => {
    for (const role of ROLES) {
      const rest = at(role, {});
      const receded = at(role, { presence: 0.25 });

      // The receded domains in an idle frame are drawn by this and by nothing
      // else: activity cannot express them, because `gainAtRest` is a floor.
      expect(receded).toBeLessThan(rest);
      expect(receded).toBeGreaterThan(0);
      expect(receded).toBeCloseTo(rest * 0.25, 10);
    }

    const gone = deriveSurfaceResponse('recess', {
      activity: 1,
      focus: 1,
      presence: 0,
    });
    expect(gone.gain).toBe(0);
    expect(gone.alpha).toBe(1);
  });
});
