import { describe, expect, it } from 'vitest';

import type { StructureFormPart } from './materials/structureGeometry';
import { resolveStructureTier } from './materials/surfaceGeometry';
import { deriveAtmosphereDescriptor } from './atmosphereDescriptor';
import { CAMERA_FOV_DEGREES } from './camera/cameraController';

const ASPECT = 16 / 9;
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);
/** The widest the camera rig ever sits: the reframe dolly at full reach. */
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

describe('deriveAtmosphereDescriptor', () => {
  it('is a fixed backdrop rather than a generated field', () => {
    expect(deriveAtmosphereDescriptor()).toEqual(deriveAtmosphereDescriptor());
    expect(deriveAtmosphereDescriptor().parts.length).toBeGreaterThanOrEqual(3);
  });

  it('is graded by depth so the backdrop reads as distance, not as a wall', () => {
    const depths = deriveAtmosphereDescriptor()
      .parts.map(depthOf)
      .sort((left, right) => left - right);

    expect(new Set(depths).size).toBe(depths.length);
    // Separated far enough that the fog grades them into visibly distinct
    // planes rather than one slab with three faces.
    for (let index = 1; index < depths.length; index += 1) {
      expect((depths[index] ?? 0) - (depths[index - 1] ?? 0)).toBeGreaterThan(3);
    }
  });

  it('stays in the recessed tier, so nothing behind the scene competes with it', () => {
    for (const part of deriveAtmosphereDescriptor().parts) {
      // Recessed, not membrane: the backdrop is an opaque depth read with no
      // activity of its own, and a blending tier would let the void show through
      // it and re-open the empty canvas this backdrop replaced.
      expect(part.surface).toBe('recess');
      expect(resolveStructureTier(part.tier)).toBe('interior');
      expect(depthOf(part)).toBeGreaterThan(3.5);
    }
  });

  it('over-covers the widest frame the camera can hold at its own depth', () => {
    for (const part of deriveAtmosphereDescriptor().parts) {
      // The plane has to cover the frame even when the reframe dollies the camera
      // to its farthest and slides it sideways, or the composition would run off
      // the end of its own backdrop.
      const distance = depthOf(part) + FARTHEST_CAMERA;
      const requiredHalfWidth = distance * HALF_FOV_TAN * ASPECT;
      const requiredHalfHeight = distance * HALF_FOV_TAN;

      // Half-extents, with a margin for the slight rotations the planes carry.
      expect(part.scale[0] / 2).toBeGreaterThan(requiredHalfWidth);
      expect(part.scale[1] / 2).toBeGreaterThan(requiredHalfHeight);
      for (const value of [...part.position, ...part.rotation, ...part.scale]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
