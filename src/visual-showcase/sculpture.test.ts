import { describe, expect, it } from 'vitest';
import { createRibbon, createParticleField } from './sculpture';

describe('procedural sculpture assets', () => {
  it('creates a finite surface with normals and consistent per-fragment displacement', () => {
    const geometry = createRibbon();
    const positions = geometry.getAttribute('position');
    const centers = geometry.getAttribute('aCenter');
    expect(positions.count).toBeGreaterThan(1000);
    expect(centers.count).toBe(positions.count);
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
    for (let i = 0; i < centers.count; i += 3) {
      expect(centers.getX(i)).toBe(centers.getX(i + 1));
      expect(centers.getY(i)).toBe(centers.getY(i + 2));
    }
    geometry.dispose();
  });
  it('produces the requested particle budget with deterministic coordinates', () => {
    const a = createParticleField(1800);
    const b = createParticleField(1800);
    expect(a.getAttribute('position').count).toBe(1800);
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    expect(Array.from(a.getAttribute('aScatter').array).every(Number.isFinite)).toBe(true);
    a.dispose(); b.dispose();
  });
});
