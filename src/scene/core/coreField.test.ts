import { describe, expect, it } from 'vitest';

import { getCoreParameters } from './coreParameters';
import { deriveCoreField } from './coreField';

function occupiedRegions(field: ReturnType<typeof deriveCoreField>): Set<number> {
  const regions = new Set<number>();

  for (let index = 0; index < field.attributes.region.length; index += 1) {
    regions.add(Math.round(field.attributes.region[index] ?? 0));
  }

  return regions;
}

describe('deriveCoreField', () => {
  const parameters = getCoreParameters('ultra');

  it('produces deterministic typed-array contents for equal inputs', () => {
    const first = deriveCoreField(parameters, 17);
    const second = deriveCoreField(parameters, 17);

    expect(first).toEqual(second);
    expect(first.attributes.positions).not.toBe(second.attributes.positions);
    expect(first.attributes.drift).not.toBe(second.attributes.drift);
  });

  it('uses exact packed attribute lengths for every sample', () => {
    const field = deriveCoreField(parameters, 17);
    const sampleCount = field.attributes.phase.length;

    expect(sampleCount).toBeGreaterThan(0);
    expect(field.attributes.positions).toHaveLength(sampleCount * 3);
    expect(field.attributes.drift).toHaveLength(sampleCount * 3);
    expect(field.attributes.region).toHaveLength(sampleCount);
    expect(field.attributes.weight).toHaveLength(sampleCount);
  });

  it('keeps attributes and bounds finite with positions inside declared bounds', () => {
    const field = deriveCoreField(parameters, 17);
    const { positions, drift, phase, region, weight } = field.attributes;

    for (const value of positions) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of drift) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of phase) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of region) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of weight) {
      expect(Number.isFinite(value)).toBe(true);
    }

    expect(field.bounds.every(Number.isFinite)).toBe(true);
    for (let index = 0; index < positions.length; index += 3) {
      expect(Math.abs(positions[index] ?? 0)).toBeLessThanOrEqual(field.bounds[0]);
      expect(Math.abs(positions[index + 1] ?? 0)).toBeLessThanOrEqual(field.bounds[1]);
      expect(Math.abs(positions[index + 2] ?? 0)).toBeLessThanOrEqual(field.bounds[2]);
    }
  });

  it('contains multiple occupied regions, directional drift, and explicit void bands', () => {
    const field = deriveCoreField(parameters, 17);
    const { positions, drift, weight } = field.attributes;
    const regions = occupiedRegions(field);
    const occupiedX = new Set<number>();
    let directionalDrift = 0;
    let zeroWeightSamples = 0;

    for (let index = 0; index < weight.length; index += 1) {
      const x = positions[index * 3] ?? 0;
      occupiedX.add(Math.floor(x * 2));
      if ((drift[index * 3 + 2] ?? 0) > 0.04) {
        directionalDrift += 1;
      }
      if ((weight[index] ?? 0) === 0) {
        zeroWeightSamples += 1;
      }
    }

    expect(regions.size).toBeGreaterThan(1);
    expect(occupiedX.size).toBeGreaterThan(3);
    expect(directionalDrift).toBeGreaterThan(0);
    expect(zeroWeightSamples).toBeGreaterThan(0);
  });

  it('changes the deterministic field with a different seed', () => {
    const first = deriveCoreField(parameters, 17);
    const second = deriveCoreField(parameters, 91);

    expect(Array.from(first.attributes.positions)).not.toEqual(
      Array.from(second.attributes.positions),
    );
  });

  it('scales field samples with quality while keeping SAFE non-empty', () => {
    const ultra = deriveCoreField(getCoreParameters('ultra'), 17);
    const safe = deriveCoreField(getCoreParameters('safe'), 17);

    expect(safe.attributes.phase.length).toBeGreaterThan(0);
    expect(safe.attributes.phase.length).toBeLessThan(ultra.attributes.phase.length);
    expect(safe.streamCount).toBeGreaterThan(0);
  });

  it('reports at least one deterministic directional stream', () => {
    const field = deriveCoreField(parameters, 17);

    expect(Number.isInteger(field.streamCount)).toBe(true);
    expect(field.streamCount).toBeGreaterThan(0);
  });
});
