import { describe, expect, it } from 'vitest';

import {
  CONVERGENCE_LAYERS,
  CONVERGENCE_TIERS,
  resolveConvergenceLayers,
} from './convergenceProfile';

describe('CONVERGENCE_LAYERS', () => {
  it('builds a membrane volume around a smaller internal signal tissue', () => {
    const membranes = CONVERGENCE_LAYERS.filter((layer) => layer.kind === 'membrane');
    const filaments = CONVERGENCE_LAYERS.filter((layer) => layer.kind === 'filament');

    expect(membranes).toHaveLength(3);
    expect(filaments).toHaveLength(3);
    expect(Math.max(...filaments.map((layer) => layer.scale[1]))).toBeLessThan(
      Math.min(...membranes.map((layer) => layer.scale[1])) * 0.7,
    );
    expect(filaments.every((layer) => layer.gain > 0 && layer.gain < 1)).toBe(true);
    expect(Math.max(...membranes.map((layer) => layer.displacement))).toBeLessThanOrEqual(18);
    expect(new Set(filaments.map((layer) => layer.scale[1])).size).toBe(3);
    expect(Math.max(...CONVERGENCE_LAYERS.map((layer) => layer.height))).toBeLessThanOrEqual(60);
    expect(Math.max(...filaments.map((layer) => layer.displacement))).toBeLessThanOrEqual(12);
    expect(new Set(filaments.map((layer) => layer.offset.join(','))).size).toBe(3);
    expect(filaments.some((layer) => layer.offset[0] < 0)).toBe(true);
    expect(filaments.some((layer) => layer.offset[0] > 0)).toBe(true);
  });

  it('keeps layer identities and render order deterministic', () => {
    expect(new Set(CONVERGENCE_LAYERS.map((layer) => layer.id)).size).toBe(
      CONVERGENCE_LAYERS.length,
    );
    expect(CONVERGENCE_LAYERS.map((layer) => layer.renderOrder)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('classifies every layer, and keeps the envelope in the primary set', () => {
    // The primaries are what a lower tier is not allowed to lose, so the set has
    // to be sufficient on its own: the widest sheet draws the silhouette, the
    // tallest closes the top of the stack, and one tissue is the main path.
    expect(
      CONVERGENCE_LAYERS.every(
        (layer) => layer.role === 'primary' || layer.role === 'secondary',
      ),
    ).toBe(true);

    const primary = CONVERGENCE_LAYERS.filter((layer) => layer.role === 'primary');
    expect(primary.map((layer) => layer.id)).toEqual([
      'rear-membrane',
      'signal-tissue-a',
      'front-membrane',
    ]);
    expect(Math.max(...primary.map((layer) => layer.scale[0]))).toBe(
      Math.max(...CONVERGENCE_LAYERS.map((layer) => layer.scale[0])),
    );
    expect(Math.max(...primary.map((layer) => layer.height))).toBe(
      Math.max(...CONVERGENCE_LAYERS.map((layer) => layer.height)),
    );
    expect(Math.min(...primary.map((layer) => layer.height))).toBe(
      Math.min(...CONVERGENCE_LAYERS.map((layer) => layer.height)),
    );
    expect(primary.some((layer) => layer.kind === 'filament')).toBe(true);
  });
});

describe('CONVERGENCE_TIERS', () => {
  const TIERS = ['ultra', 'high', 'medium', 'safe'] as const;

  it('leaves ULTRA on the figures the approved frame was drawn at', () => {
    // The reference captures are ULTRA. If this table ever restates them, the
    // approved frame stops being reproducible, and every comparison against it
    // becomes a comparison against a different picture.
    expect(CONVERGENCE_TIERS.ultra.layerIds).toEqual(CONVERGENCE_LAYERS.map((layer) => layer.id));
    expect(CONVERGENCE_TIERS.ultra.segments).toEqual({
      membrane: [288, 150],
      filament: [220, 72],
    });
  });

  it('never increases sampling or layer count as the tier drops', () => {
    const order = TIERS;
    for (let index = 1; index < order.length; index += 1) {
      const previous = CONVERGENCE_TIERS[order[index - 1]!];
      const current = CONVERGENCE_TIERS[order[index]!];

      expect(current.layerIds.length).toBeLessThanOrEqual(previous.layerIds.length);
      for (const kind of ['membrane', 'filament'] as const) {
        const [previousAcross, previousAlong] = previous.segments[kind];
        const [across, along] = current.segments[kind];
        expect(across, `${order[index]} ${kind} across`).toBeLessThanOrEqual(previousAcross);
        expect(along, `${order[index]} ${kind} along`).toBeLessThanOrEqual(previousAlong);
      }
    }
  });

  it('keeps the silhouette, the main path and the core membrane at every tier', () => {
    // SAFE is the tier a weak machine runs, and it is the one that has to still
    // be this composition. What survives is stated as ids rather than as a count,
    // so a later edit that dropped the wrong three fails here.
    for (const tier of TIERS) {
      const ids = CONVERGENCE_TIERS[tier].layerIds;
      expect(ids, tier).toContain('rear-membrane');
      expect(ids, tier).toContain('signal-tissue-a');
      expect(ids, tier).toContain('front-membrane');
    }
  });

  it('takes layers out of the secondary set only', () => {
    const secondary = new Set(
      CONVERGENCE_LAYERS.filter((layer) => layer.role === 'secondary').map((layer) => layer.id),
    );
    const everyId = new Set(CONVERGENCE_LAYERS.map((layer) => layer.id));

    for (const tier of TIERS) {
      const dropped = [...everyId].filter((id) => !CONVERGENCE_TIERS[tier].layerIds.includes(id));
      expect(dropped.every((id) => secondary.has(id)), tier).toBe(true);
    }
  });

  it('names only layers that exist, and each at most once', () => {
    const known = new Set(CONVERGENCE_LAYERS.map((layer) => layer.id));
    for (const tier of TIERS) {
      const ids = CONVERGENCE_TIERS[tier].layerIds;
      expect(new Set(ids).size, tier).toBe(ids.length);
      expect(ids.every((id) => known.has(id)), tier).toBe(true);
      expect(ids.length, tier).toBeGreaterThanOrEqual(3);
    }
  });

  it('spends materially fewer vertices at every step down', () => {
    // A ladder that reduces a count without reducing the cost is a label. The
    // figure is the sum over the tier's own layers of the sheets it draws, which
    // is what the GPU is actually asked for.
    const vertices = (tier: (typeof TIERS)[number]): number =>
      resolveConvergenceLayers(tier).reduce((total, layer) => {
        const [across, along] = CONVERGENCE_TIERS[tier].segments[layer.kind];
        return total + (across + 1) * (along + 1);
      }, 0);

    expect(vertices('high')).toBeLessThan(vertices('ultra') * 0.6);
    expect(vertices('medium')).toBeLessThan(vertices('high') * 0.6);
    expect(vertices('safe')).toBeLessThan(vertices('medium') * 0.6);
  });

  it('keeps the profile order rather than the table order', () => {
    // The layer list is a depth sequence. A subset sorted by anything other than
    // the profile is a subset that can change what occludes what.
    for (const tier of TIERS) {
      const renderOrder = resolveConvergenceLayers(tier).map((layer) => layer.renderOrder);
      expect(renderOrder, tier).toEqual([...renderOrder].sort((a, b) => a - b));
    }
  });
});
