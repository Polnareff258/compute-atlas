import { describe, expect, it } from 'vitest';
import {
  BASE_AMPLITUDE,
  fractalNoise2D,
  insideExtent,
  terrainHeight,
  terrainProfile,
  valueNoise2D,
  type BasinShape,
  type ChannelShape,
  type DepositShape,
  type DomainTerrain,
  type TerrainFieldOptions,
} from './terrainField';

/**
 * The tests are written against the *shape* the brief asks for rather than
 * against the numbers this implementation happens to produce. A golden-value
 * test would pass just as happily on a terrain that had lost its basin, which is
 * the failure that would actually matter.
 */

const FLAT_BASIN: BasinShape = {
  centre: [0, -300],
  radius: 0,
  depth: 0,
  terraces: 4,
  rimWidth: 0,
  rimHeight: 0,
  tilt: 0,
};

const EXTENT = { minX: -800, maxX: 800, minZ: -800, maxZ: 200 };

function options(overrides: Partial<TerrainFieldOptions> = {}): TerrainFieldOptions {
  return {
    seed: 1234,
    basin: FLAT_BASIN,
    channels: [],
    deposits: [],
    domains: [],
    extent: EXTENT,
    ...overrides,
  };
}

describe('the noise field', () => {
  it('is deterministic in its seed', () => {
    expect(valueNoise2D(3.7, -1.2, 99)).toBe(valueNoise2D(3.7, -1.2, 99));
    expect(fractalNoise2D(0.4, 0.9, 7)).toBe(fractalNoise2D(0.4, 0.9, 7));
    expect(fractalNoise2D(0.4, 0.9, 7)).not.toBe(fractalNoise2D(0.4, 0.9, 8));
  });

  it('stays inside its stated range', () => {
    // `fractalNoise2D` is documented as roughly [-1, 1]; a scale error here would
    // silently change the terrain's amplitude everywhere.
    for (let index = 0; index < 200; index += 1) {
      const value = fractalNoise2D(index * 0.37, index * -0.61, 11);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('terrainHeight', () => {
  it('returns the same height for the same query, every time', () => {
    const field = options();
    const first = terrainHeight(37.5, -412.25, field);
    expect(terrainHeight(37.5, -412.25, field)).toBe(first);
    // A second, structurally identical descriptor must agree too: nothing is
    // cached between calls, so this is the property the mesh builder and the
    // label placer both depend on.
    expect(terrainHeight(37.5, -412.25, options())).toBe(first);
  });

  it('falls from the near bank to the basin and rises again beyond it', () => {
    // The cross-profile is the composition: the basin is the low point, the near
    // bank stands above it so the view over it is clear, and the far bank rises
    // so the rivers have somewhere to come down from.
    //
    // Asserted on `terrainProfile` directly rather than on `terrainHeight`,
    // because this is a statement about the shape of the world and the noise
    // would swamp it — the same mistake that let the first, uphill version pass
    // every measurement.
    expect(terrainProfile(-300)).toBeCloseTo(0, 6);

    for (let z = -300; z < 240; z += 20) {
      expect(terrainProfile(z + 20)).toBeGreaterThan(terrainProfile(z));
    }
    for (let z = -1140; z < -380; z += 20) {
      expect(terrainProfile(z + 20)).toBeLessThan(terrainProfile(z));
    }

    // The floor between the two banks is genuinely flat, which is what lets the
    // basin be the only thing shaping the middle of the frame.
    expect(terrainProfile(-340)).toBeCloseTo(0, 6);
    expect(terrainProfile(-320)).toBeCloseTo(0, 6);

    // And the height it reaches at each end is worth having: a profile that only
    // technically sloped would give the frame no depth at all.
    expect(terrainProfile(170)).toBeGreaterThan(8);
    expect(terrainProfile(-1140)).toBeGreaterThan(14);
    expect(terrainProfile(0) - terrainProfile(-400)).toBeGreaterThan(3);
  });

  it('raises a deposit instead of lowering it', () => {
    const deposit: DepositShape = { centre: [0, -180], radius: 90, height: 22 };
    const without = options();
    const withDeposit = options({ deposits: [deposit] });

    const plain = terrainHeight(0, -180, without);
    const raised = terrainHeight(0, -180, withDeposit);

    expect(raised - plain).toBeGreaterThan(20);
    // Well outside the radius the mound must have let go entirely.
    expect(terrainHeight(0, 400, withDeposit)).toBeCloseTo(terrainHeight(0, 400, without), 6);
  });

  it('carves a channel below the ground it runs through', () => {
    const channel: ChannelShape = {
      spine: [
        [0, 60],
        [0, -120],
        [0, -260],
      ],
      width: 26,
      depth: 14,
      fullFrom: 0.15,
      fullTo: 0.85,
    };
    const without = options();
    const withChannel = options({ channels: [channel] });

    const frontier = terrainHeight(0, -120, without) - terrainHeight(0, -120, withChannel);
    expect(frontier).toBeGreaterThan(11);

    // The trough tapers to nothing at the ends, so the ground there is untouched.
    expect(terrainHeight(0, 60, withChannel)).toBeCloseTo(terrainHeight(0, 60, without), 6);
  });

  it('carves a basin into the ground and leaves a rim just outside it', () => {
    const basin: BasinShape = {
      centre: [0, -300],
      radius: 180,
      depth: 46,
      terraces: 5,
      rimWidth: 40,
      rimHeight: 6,
      tilt: 0,
    };
    const plain = options();
    // Depth zero isolates the rim from the bowl.
    const rimOnly = options({ basin: { ...basin, depth: 0 } });

    const floorDrop = terrainHeight(0, -300, plain) - terrainHeight(0, -300, options({ basin }));
    const rimRise =
      terrainHeight(0, -300 + 180 + 20, rimOnly) - terrainHeight(0, -300 + 180 + 20, plain);

    // The floor must sit most of `depth` below the surrounding ground.
    expect(floorDrop).toBeGreaterThan(30);
    // The rim is a lip at full height, not the quarter-height product a
    // smoothstep-over-smoothstep pair would have produced.
    expect(rimRise).toBeGreaterThan(basin.rimHeight * 0.9);
    expect(rimRise).toBeLessThan(basin.rimHeight * 1.05);
    // And it is gone by the time the band is crossed, so the basin sits *in* the
    // ground rather than on a ring.
    expect(
      terrainHeight(0, -300 + 180 + 40, rimOnly) - terrainHeight(0, -300 + 180 + 40, plain),
    ).toBeCloseTo(0, 6);
  });

  it('leaves the basin floor undisturbed by what is inside it', () => {
    // The basin is carved last precisely so a channel crossing it cannot refill
    // the floor it just cut. A channel through the centre must not raise it.
    const basin: BasinShape = {
      centre: [0, -300],
      radius: 180,
      depth: 46,
      terraces: 5,
      rimWidth: 40,
      rimHeight: 6,
      tilt: 0,
    };
    const crossing: ChannelShape = {
      spine: [
        [0, -120],
        [0, -300],
        [0, -460],
      ],
      width: 24,
      depth: 12,
      fullFrom: 0,
      fullTo: 1,
    };

    const basinAlone = terrainHeight(0, -300, options({ basin }));
    const withChannel = terrainHeight(0, -300, options({ basin, channels: [crossing] }));

    expect(withChannel).toBeLessThanOrEqual(basinAlone);
  });

  it('inverts a domain pattern exactly when `invert` is negative', () => {
    const mound: DomainTerrain = {
      centre: [200, -200],
      radius: 160,
      amplitude: 9,
      frequency: 0.02,
      terrace: 0,
      step: 0,
      invert: 0,
    };

    const plain = options();
    const raised = options({ domains: [mound] });
    const sunk = options({ domains: [{ ...mound, invert: -1 }] });

    // A pattern with `terrace: 0` is the raw noise, whose sign is not fixed, so
    // the assertion is that the two descriptors moved the ground by exactly
    // opposite amounts rather than that either moved a particular way.
    const lift = terrainHeight(200, -200, raised) - terrainHeight(200, -200, plain);
    const drop = terrainHeight(200, -200, sunk) - terrainHeight(200, -200, plain);

    expect(lift).not.toBe(0);
    expect(drop).toBeCloseTo(-lift, 9);

    // Outside the radius the ground is exactly what it was.
    expect(terrainHeight(700, 0, raised)).toBeCloseTo(terrainHeight(700, 0, plain), 9);
    expect(terrainHeight(200, 100, raised)).toBeCloseTo(terrainHeight(200, 100, plain), 9);
  });

  it('creates a flat floor, not a spike, at a stepped domain', () => {
    // The amplitude is `BASE_AMPLITUDE` rather than a written-down 10, and that
    // is the point rather than a convenience: at 10 the stepped and unstepped
    // spreads measured 3.943 against 3.928, because the base relief's own fine
    // octaves contribute about four units of variation over a sixty-unit window
    // and swallowed the domain's whole contribution. The test was then measuring
    // the base noise, and the domain could have done anything at all inside it.
    const terraced: DomainTerrain = {
      centre: [0, -200],
      radius: 150,
      amplitude: BASE_AMPLITUDE,
      frequency: 0.03,
      terrace: 1,
      step: 0.25,
      invert: 0,
    };
    const smooth: DomainTerrain = { ...terraced, step: 0, terrace: 0 };
    const stepped = options({ domains: [terraced] });
    const unstepped = options({ domains: [smooth] });

    // Stepping must reduce the spread of the pattern — that is what makes it
    // read as shelves — while keeping it inside the same envelope.
    const steppedSpread = spreadOfRegion(0, -200, 60, stepped);
    const smoothSpread = spreadOfRegion(0, -200, 60, unstepped);

    expect(steppedSpread).toBeLessThan(smoothSpread);
    expect(steppedSpread).toBeGreaterThan(0);
  });
});

/** Standard deviation of the height over a square region, centred on the domain. */
function spreadOfRegion(cx: number, cz: number, radius: number, field: TerrainFieldOptions): number {
  const values: number[] = [];
  for (let dz = -radius; dz <= radius; dz += radius / 8) {
    for (let dx = -radius; dx <= radius; dx += radius / 8) {
      values.push(terrainHeight(cx + dx, cz + dz, field));
    }
  }
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((total, value) => total + (value - mean) * (value - mean), 0) / values.length,
  );
}

describe('insideExtent', () => {
  it('accepts the boundary and rejects a point beyond it', () => {
    expect(insideExtent(EXTENT.minX, EXTENT.minZ, EXTENT)).toBe(true);
    expect(insideExtent(EXTENT.maxX, EXTENT.maxZ, EXTENT)).toBe(true);
    expect(insideExtent(0, 0, EXTENT)).toBe(true);
    expect(insideExtent(EXTENT.maxX + 0.5, 0, EXTENT)).toBe(false);
    expect(insideExtent(0, EXTENT.minZ - 0.5, EXTENT)).toBe(false);
  });
});
