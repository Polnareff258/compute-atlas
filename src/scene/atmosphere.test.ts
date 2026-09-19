import { describe, expect, it } from 'vitest';

import type { StructureFormPart } from './materials/structureGeometry';
import { resolveStructureTier } from './materials/surfaceGeometry';
import { deriveAtmosphereDescriptor } from './atmosphereDescriptor';
import {
  BASE_CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
} from './camera/cameraController';

const ASPECT = 16 / 9;
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);
/**
 * The widest the camera rig ever sits: the reframe dolly at full reach.
 *
 * A bound rather than a measurement. The reframe resolves to about 8.9 world
 * units for the furthest domain, which is very slightly *nearer* than the idle
 * distance, so this is a deliberate over-estimate — the backdrop has to cover
 * the frame under any legal rig state, and being a little too large is free
 * while being a little too small leaves a hole at the edge of the frame.
 */
const FARTHEST_CAMERA = 12;

function depthOf(part: StructureFormPart): number {
  return Math.abs(part.position[2]);
}

/**
 * How much of the frame's half-height a part fills, seen from `cameraDistance`.
 *
 * The composition is authored at the idle distance, so that is the default. The
 * number is what actually decides whether a plate's edge lands inside the frame
 * or outside it; a world size says nothing on its own.
 */
function screenFraction(part: StructureFormPart, cameraDistance = BASE_CAMERA_DISTANCE) {
  const distance = depthOf(part) + cameraDistance;
  return part.scale[1] / 2 / (HALF_FOV_TAN * distance);
}

describe('deriveAtmosphereDescriptor', () => {
  it('is a fixed backdrop rather than a generated field', () => {
    expect(deriveAtmosphereDescriptor()).toEqual(deriveAtmosphereDescriptor());
    expect(deriveAtmosphereDescriptor().parts.length).toBeGreaterThanOrEqual(5);
  });

  it('is graded by depth so the backdrop reads as distance, not as a wall', () => {
    const depths = deriveAtmosphereDescriptor()
      .parts.map(depthOf)
      .sort((left, right) => left - right);

    expect(new Set(depths).size).toBe(depths.length);
    // Separated far enough that the fog grades them into visibly distinct
    // planes rather than one slab with several faces.
    for (let index = 1; index < depths.length; index += 1) {
      expect((depths[index] ?? 0) - (depths[index - 1] ?? 0)).toBeGreaterThan(3);
    }
  });

  it('stays in the recessed tier and behind the whole composition', () => {
    for (const part of deriveAtmosphereDescriptor().parts) {
      // Recessed, not membrane: the backdrop is an opaque depth read with no
      // activity of its own, and a blending tier would let the void show through
      // it and re-open the empty canvas this backdrop replaced.
      expect(part.surface).toBe('recess');
      // Its own colour, though, and not the recessed interior's. There is a
      // measurement behind that: at the interior tier every plate resolved below
      // the scene background, so the backdrop was a hole rather than a field.
      expect(resolveStructureTier(part.tier)).toBe('backdrop');
      expect(depthOf(part)).toBeGreaterThan(3.5);
    }
  });

  it('nests the plates in the frame, and fills to the edge with the last one', () => {
    const parts = deriveAtmosphereDescriptor().parts;
    const rear = parts.reduce((deepest, part) =>
      depthOf(part) > depthOf(deepest) ? part : deepest,
    );

    // Exactly the rearmost plate runs past the frame edge. It is the one that
    // guarantees no seam, and it is also the only one large enough to be a wall
    // if it were not behind everything.
    expect(screenFraction(rear, FARTHEST_CAMERA)).toBeGreaterThan(1);

    const nested = parts
      .filter((part) => part !== rear)
      .map((part) => screenFraction(part));

    for (const fraction of nested) {
      // Inside the frame: a plate that ran off the edge would occlude every
      // plate behind it, and the stack would collapse to whichever one happened
      // to be nearest. That is precisely how this was broken.
      expect(fraction).toBeLessThan(1);
      expect(fraction).toBeGreaterThan(0.3);
    }
    // And ordered, so the steps go outward monotonically instead of crossing
    // over each other and leaving one plate hidden entirely.
    for (let index = 1; index < nested.length; index += 1) {
      expect(nested[index]!).toBeGreaterThan(nested[index - 1]! + 0.05);
    }
  });

  it('covers the frame at every depth it claims, with real numbers', () => {
    for (const part of deriveAtmosphereDescriptor().parts) {
      const distance = depthOf(part) + FARTHEST_CAMERA;
      const requiredHalfWidth = distance * HALF_FOV_TAN * ASPECT;
      const requiredHalfHeight = distance * HALF_FOV_TAN;

      // The rear plate is sized beyond the framing angle and so over-covers on
      // its own; the nested ones are inside the idle frame by design and are
      // covered by it. Either way the union has no hole in it.
      if (screenFraction(part, FARTHEST_CAMERA) > 1) {
        expect(part.scale[0] / 2).toBeGreaterThan(requiredHalfWidth);
        expect(part.scale[1] / 2).toBeGreaterThan(requiredHalfHeight);
      }
      for (const value of [...part.position, ...part.rotation, ...part.scale]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
