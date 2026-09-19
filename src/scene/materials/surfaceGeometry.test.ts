import { describe, expect, it } from 'vitest';

import {
  deriveMembraneOpacity,
  deriveSurfaceLuminance,
  resolveStructureTier,
} from './surfaceGeometry';
import { MACHINE_PALETTE } from './machinePalette';

describe('deriveSurfaceLuminance', () => {
  const FACES = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;

  it('gives every one of the six box faces its own tier within range', () => {
    const luminances = FACES.map(([x, y, z]) => deriveSurfaceLuminance(x, y, z));

    for (const luminance of luminances) {
      expect(luminance).toBeGreaterThanOrEqual(0);
      expect(luminance).toBeLessThanOrEqual(1);
    }
    // Six distinct values is what produces a massed read without lighting.
    expect(new Set(luminances.map((value) => value.toFixed(4))).size).toBe(6);
  });

  it('brightens the key-facing side above the away-facing side', () => {
    const facing = deriveSurfaceLuminance(0.42, 0.6, 0.68);
    const away = deriveSurfaceLuminance(-0.42, -0.6, -0.68);

    expect(facing).toBeGreaterThan(away);
    // The shadow side is graded, not collapsed to one flat value.
    expect(away).toBeGreaterThan(0);
  });

  it('is stable for a repeated normal', () => {
    expect(deriveSurfaceLuminance(0.2, -0.5, 0.84)).toBe(
      deriveSurfaceLuminance(0.2, -0.5, 0.84),
    );
  });
});

describe('deriveMembraneOpacity', () => {
  it('opens the membrane with fade and never dissolves the silhouette', () => {
    const closed = deriveMembraneOpacity(0);
    const open = deriveMembraneOpacity(1);

    expect(open).toBeGreaterThan(closed);
    // Never 0: a fully closed membrane stays a visible layer rather than
    // vanishing, which is what keeps a dormant domain's layering legible.
    expect(closed).toBeGreaterThan(0);
    // Never opaque: a membrane that hides what it covers is not a membrane.
    expect(open).toBeLessThan(1);
  });

  it('stays inside a band that reads as a layer rather than as a wall', () => {
    expect(deriveMembraneOpacity(0.3)).toBeGreaterThan(0.2);
    expect(deriveMembraneOpacity(0.3)).toBeLessThan(0.3);
    expect(deriveMembraneOpacity(1)).toBeLessThanOrEqual(0.5);
  });

  it('bounds and sanitizes out-of-range fade inputs', () => {
    expect(deriveMembraneOpacity(-5)).toBe(deriveMembraneOpacity(0));
    expect(deriveMembraneOpacity(9)).toBe(deriveMembraneOpacity(1));
    expect(deriveMembraneOpacity(Number.NaN)).toBe(deriveMembraneOpacity(0));
  });
});

describe('resolveStructureTier', () => {
  it('maps structural roles onto a descending luminance order', () => {
    expect(resolveStructureTier('anchor')).toBe('shellHigh');
    expect(resolveStructureTier('primary')).toBe('shellMid');
    expect(resolveStructureTier('secondary')).toBe('shellLow');
    expect(resolveStructureTier('recess')).toBe('interior');

    const order = [
      MACHINE_PALETTE.shellHigh,
      MACHINE_PALETTE.shellMid,
      MACHINE_PALETTE.shellLow,
      MACHINE_PALETTE.interior,
    ];
    expect(new Set(order).size).toBe(order.length);
  });
});