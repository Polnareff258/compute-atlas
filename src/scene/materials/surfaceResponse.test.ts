import { describe, expect, it } from 'vitest';

import { SURFACE_RESPONSE_CURVES, type SurfaceRole } from './machinePalette';
import {
  deriveSurfaceResponse,
  responseCurveFor,
  type SurfaceInput,
} from './surfaceResponse';

const ROLES: readonly SurfaceRole[] = [
  'volume',
  'beam',
  'port',
  'interior',
  'membrane',
];

/** The highest gain any curve may reach with activity and focus both saturated. */
const MAX_GAIN = 1.2;

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
      expect(at(role, { activity: 1, focus: 1 })).toBeLessThanOrEqual(MAX_GAIN);
    }
  });

  it('rises with activity and with focus, monotonically', () => {
    for (const role of ROLES) {
      const rest = at(role, {});
      const active = at(role, { activity: 0.5 });
      const moreActive = at(role, { activity: 1 });
      const focused = at(role, { focus: 1 });

      expect(active).toBeGreaterThan(rest);
      expect(moreActive).toBeGreaterThan(active);
      expect(focused).toBeGreaterThan(rest);
    }
  });

  it('orders the tiers by how much they answer, interior first', () => {
    const rising = (['volume', 'beam', 'port', 'interior'] as const).map((role) =>
      at(role, { activity: 1, focus: 1 }) - at(role, {}),
    );

    // The recessed interior has to rise furthest: that is what makes a working
    // domain read as lit from inside while its shell stays where it is. If the
    // ordering ever flattens, the response has stopped carrying meaning.
    for (let index = 1; index < rising.length; index += 1) {
      expect(rising[index]!).toBeGreaterThan(rising[index - 1]!);
    }
  });

  it('keeps the multiplier bounded when the inputs are not', () => {
    for (const role of ROLES) {
      const response = deriveSurfaceResponse(role, {
        activity: Number.POSITIVE_INFINITY,
        focus: Number.NaN,
      });

      expect(Number.isFinite(response.gain)).toBe(true);
      expect(response.gain).toBeGreaterThan(0);
      expect(response.gain).toBeLessThanOrEqual(MAX_GAIN);
      expect(Number.isFinite(response.alpha)).toBe(true);
    }

    const negative = deriveSurfaceResponse('interior', {
      activity: -12,
      focus: -3,
    });
    expect(negative.gain).toBeCloseTo(responseCurveFor('interior').gainAtRest, 10);
  });

  it('gives every opaque role an alpha of exactly one', () => {
    for (const role of ROLES) {
      if (role === 'membrane') continue;

      // Not "near one": an opaque material ignores alpha, so any other value
      // would be a response the renderer silently drops.
      expect(deriveSurfaceResponse(role, { activity: 1, focus: 1 }).alpha).toBe(1);
      expect(SURFACE_RESPONSE_CURVES[role].fadeFromActivity).toBe(0);
      expect(SURFACE_RESPONSE_CURVES[role].fadeFromFocus).toBe(0);
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
});
