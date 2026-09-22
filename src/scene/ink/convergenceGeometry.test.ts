import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';

import { createConvergenceGeometry } from './convergenceGeometry';
import { CONVERGENCE_TIERS } from './convergenceProfile';

const TIERS = ['ultra', 'high', 'medium', 'safe'] as const;

describe('createConvergenceGeometry', () => {
  it('creates a genuinely curved membrane instead of a displaced flat plane', () => {
    const geometry = createConvergenceGeometry(100, 'membrane', CONVERGENCE_TIERS.ultra.segments.membrane);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());

    expect(size.x).toBeGreaterThan(390);
    expect(size.y).toBeGreaterThan(180);
    expect(size.z).toBeGreaterThan(42);
    expect(size.z / size.x).toBeLessThan(0.15);
    const position = geometry.attributes.position!;
    let centreHeight = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getX(index)) < 1 && Math.abs(position.getY(index)) < 1) {
        centreHeight = Math.max(centreHeight, position.getZ(index));
      }
    }
    expect(centreHeight).toBeLessThan(20);

    geometry.dispose();
  });

  it('keeps the signal tissue narrower than the structural membrane', () => {
    const membrane = createConvergenceGeometry(100, 'membrane', CONVERGENCE_TIERS.ultra.segments.membrane);
    const filament = createConvergenceGeometry(100, 'filament', CONVERGENCE_TIERS.ultra.segments.filament);
    membrane.computeBoundingBox();
    filament.computeBoundingBox();

    const membraneSize = membrane.boundingBox!.getSize(new Vector3());
    const filamentSize = filament.boundingBox!.getSize(new Vector3());
    expect(filamentSize.x).toBeLessThan(membraneSize.x);
    expect(filamentSize.y).toBeLessThan(membraneSize.y);

    membrane.dispose();
    filament.dispose();
  });

  it('shapes the filament like a tapered calligraphic stroke', () => {
    const geometry = createConvergenceGeometry(
      100,
      'filament',
      CONVERGENCE_TIERS.ultra.segments.filament,
    );
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    const position = geometry.attributes.position!;
    const halfSpan = size.x * 0.5;
    let centreHalfWidth = 0;
    let tipHalfWidth = 0;

    for (let index = 0; index < position.count; index += 1) {
      const x = Math.abs(position.getX(index));
      const y = Math.abs(position.getY(index));
      if (x < halfSpan * 0.16) centreHalfWidth = Math.max(centreHalfWidth, y);
      if (x > halfSpan * 0.88) tipHalfWidth = Math.max(tipHalfWidth, y);
    }

    // The bounding envelope includes the authored S-curve. It must remain
    // unmistakably directional without forcing the centreline back into a rail.
    expect(size.x / size.y).toBeGreaterThan(5.2);
    expect(centreHalfWidth).toBeGreaterThan(tipHalfWidth * 1.8);
    geometry.dispose();
  });

  it('gives the filament a visible authored meander instead of a straight rail', () => {
    const geometry = createConvergenceGeometry(
      100,
      'filament',
      CONVERGENCE_TIERS.ultra.segments.filament,
    );
    const position = geometry.attributes.position!;
    const centreSamples: number[] = [];
    const [across, along] = CONVERGENCE_TIERS.ultra.segments.filament;
    const centreRowStart = (along / 2) * (across + 1);

    // PlaneGeometry emits one centre-width vertex per longitudinal column when
    // the lateral segment count is even. Looking only at those vertices removes
    // taper width from the measurement and leaves the authored centreline.
    for (let column = 0; column <= across; column += 1) {
      centreSamples.push(position.getY(centreRowStart + column));
    }

    expect(Math.max(...centreSamples) - Math.min(...centreSamples)).toBeGreaterThan(12);
    geometry.dispose();
  });

  it('samples the same silhouette at every tier', () => {
    // "Reduce the sampling, never the silhouette" is the whole constraint on the
    // quality ladder, and this is where it is measured rather than asserted. The
    // shape is a smooth function of normalised position, so a coarser grid can
    // only differ from the finest one by how closely its polyline follows the
    // same curve — never by moving the curve. Two percent of the envelope is a
    // bound well below what a segment-per-eight-pixels outline can drift, and
    // well above what a tier that had lost its arch or its torsion would pass.
    for (const kind of ['membrane', 'filament'] as const) {
      const reference = createConvergenceGeometry(100, kind, CONVERGENCE_TIERS.ultra.segments[kind]);
      reference.computeBoundingBox();
      const referenceSize = reference.boundingBox!.getSize(new Vector3());

      for (const tier of TIERS) {
        const geometry = createConvergenceGeometry(100, kind, CONVERGENCE_TIERS[tier].segments[kind]);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox!.getSize(new Vector3());

        for (const [axis, expected] of [
          ['x', referenceSize.x],
          ['y', referenceSize.y],
          ['z', referenceSize.z],
        ] as const) {
          const measured = axis === 'x' ? size.x : axis === 'y' ? size.y : size.z;
          expect(
            Math.abs(measured - expected) / expected,
            `${tier} ${kind} ${axis} (${measured.toFixed(3)} vs ${expected.toFixed(3)})`,
          ).toBeLessThan(0.02);
        }

        geometry.dispose();
      }

      reference.dispose();
    }
  });

  it('actually reduces the grid it asks the GPU for', () => {
    const vertexCount = (tier: (typeof TIERS)[number], kind: 'membrane' | 'filament'): number => {
      const [across, along] = CONVERGENCE_TIERS[tier].segments[kind];
      const geometry = createConvergenceGeometry(100, kind, [across, along]);
      const count = geometry.attributes.position!.count;
      geometry.dispose();
      return count;
    };

    expect(vertexCount('safe', 'membrane')).toBeLessThan(vertexCount('ultra', 'membrane') / 4);
    expect(vertexCount('safe', 'filament')).toBeLessThan(vertexCount('ultra', 'filament') / 4);
  });
});
