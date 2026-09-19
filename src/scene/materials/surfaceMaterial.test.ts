import { describe, expect, it } from 'vitest';

import { MACHINE_PALETTE } from './machinePalette';
import { createSurfaceMaterial, type SurfaceRole } from './surfaceMaterial';

const ROLES: readonly SurfaceRole[] = ['volume', 'beam', 'port', 'membrane'];

describe('createSurfaceMaterial', () => {
  it('selects the material backend from the explicit renderer seam', () => {
    const standard = createSurfaceMaterial({
      role: 'volume',
      color: MACHINE_PALETTE.shellMid,
      webgpuPreferred: false,
    });
    expect(standard.backend).toBe('standard');

    standard.dispose();

    const node = createSurfaceMaterial({
      role: 'volume',
      color: MACHINE_PALETTE.shellMid,
      webgpuPreferred: true,
    });
    expect(node.backend).toBe('node');

    node.dispose();
  });

  it('keeps structural solids depth-writing and membranes blended', () => {
    for (const role of ROLES) {
      const handle = createSurfaceMaterial({
        role,
        color: MACHINE_PALETTE.membrane,
        webgpuPreferred: false,
      });

      if (role === 'membrane') {
        // No depth write: membranes layer over the structure instead of
        // occluding it, and they blend rather than dithering to a hard edge.
        expect(handle.material.depthWrite).toBe(false);
        expect(handle.material.transparent).toBe(true);
        expect(handle.material.opacity).toBeGreaterThan(0);
        expect(handle.material.opacity).toBeLessThan(1);
      } else {
        expect(handle.material.depthWrite).toBe(true);
        expect(handle.material.transparent).toBe(false);
      }

      handle.dispose();
    }
  });

  it('advances membrane openness with activity and focus without passing the bounds', () => {
    const handle = createSurfaceMaterial({
      role: 'membrane',
      color: MACHINE_PALETTE.membrane,
      baseFade: 0.2,
      webgpuPreferred: false,
    });

    const closedAtRest = handle.material.opacity;
    handle.updateInput({ activity: 1, focus: 1, reducedMotion: false });
    const openUnderFocus = handle.material.opacity;

    expect(openUnderFocus).toBeGreaterThan(closedAtRest);

    handle.updateInput({
      activity: Number.POSITIVE_INFINITY,
      focus: Number.NaN,
      reducedMotion: true,
    });
    expect(Number.isFinite(handle.material.opacity)).toBe(true);
    expect(handle.material.opacity).toBeLessThanOrEqual(1);

    handle.dispose();
  });

  it('sanitizes non-finite scalar inputs on solid roles', () => {
    const handle = createSurfaceMaterial({
      role: 'beam',
      color: MACHINE_PALETTE.shellLow,
      webgpuPreferred: false,
    });

    handle.updateInput({
      activity: Number.NaN,
      focus: Number.POSITIVE_INFINITY,
      reducedMotion: false,
    });

    expect(Number.isFinite(handle.material.opacity)).toBe(true);
    expect(handle.material.opacity).toBeGreaterThan(0);
    expect(handle.material.opacity).toBeLessThanOrEqual(1);

    handle.dispose();
  });

  it('makes dispose idempotent and stops further input updates', () => {
    const handle = createSurfaceMaterial({
      role: 'membrane',
      color: MACHINE_PALETTE.membrane,
      webgpuPreferred: false,
    });

    handle.dispose();
    const opacityAfterDispose = handle.material.opacity;

    expect(() => handle.dispose()).not.toThrow();
    handle.updateInput({ activity: 1, focus: 1, reducedMotion: false });
    expect(handle.material.opacity).toBe(opacityAfterDispose);
  });
});