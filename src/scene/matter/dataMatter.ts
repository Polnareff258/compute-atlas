import { hashUnit, normalizeSeed } from '../seedRandom';

type Vector = readonly [number, number, number];

/**
 * One region the matter field occupies.
 *
 * `kind` is the field behaviour, not the region's identity: it selects which
 * family of motion the shader runs for units that belong here. Keeping it a
 * number rather than a node id is what lets the matter system be told about five
 * places without ever learning what a domain is — the same boundary the hero
 * keeps, and for the same reason.
 */
export type MatterRegion = {
  readonly centre: Vector;
  readonly extent: Vector;
  readonly kind: number;
};

export type MatterFieldSpec = {
  /** Index 0 is the rift; indices 1.. are the regions the units can occupy. */
  readonly regions: readonly MatterRegion[];
  readonly rift: MatterRegion;
  /** Total instances to allocate, before any quality scaling. */
  readonly count: number;
  readonly seed?: number;
  /** 0..1. Scales both the population and the extent of the populated volume. */
  readonly density?: number;
};

/**
 * Per-instance attributes: static, uploaded once, never rewritten.
 *
 * Everything about a unit that does *not* change over its life is baked here at
 * construction. Nothing in this array is touched at frame rate — that is the
 * whole contract. The CPU decides how many units there are, where they live,
 * what form they favour and how big they are; the GPU decides everywhere they go
 * from there.
 *
 * `home` is world space rather than region-relative and `extent` is carried per
 * instance. That is redundant data — every unit in a region shares an extent —
 * and it is deliberate: it means the shader needs no region table and no dynamic
 * uniform indexing, so the same graph compiles unchanged on WebGPU and on the
 * WebGL2 backend, where dynamic indexing of a uniform array by a varying-derived
 * value is the kind of thing that works on one driver and not the next.
 *
 * `form` earns its place. Every unit carries a bias in 0..1 for how readily it
 * condenses: low-form units stay diffuse vapour and drift, high-form units snap
 * into filaments the moment the field gives them something to align to. Without
 * it the whole field changes phase together and reads as one object being scaled
 * — and grain is what makes a field read as matter rather than as a texture.
 */
export type MatterFieldAttributes = {
  /** 3 per instance. World-space home position. */
  readonly home: Float32Array;
  /** 3 per instance, in [0,1). */
  readonly seed: Float32Array;
  /** 1 per instance. 0 is the rift; 1.. are region kinds. */
  readonly kind: Float32Array;
  /** 3 per instance. The half-extents of the unit's own region. */
  readonly extent: Float32Array;
  /** 1 per instance, in [0,1). Bias toward a condensed form. */
  readonly form: Float32Array;
  /** 1 per instance. Relative size multiplier. */
  readonly scale: Float32Array;
  readonly count: number;
};

/**
 * How the population is split between the rift and the regions.
 *
 * The rift owns the majority and it is not close. The composition's subject is
 * the split in the substrate, so the matter that describes it has to be mostly
 * *there*; a field spread evenly across six places is a diagram of six places.
 * The regions are filled from the remainder in unequal shares for the same
 * reason at a smaller scale.
 */
const RIFT_SHARE = 0.86;
/**
 * The regions' shares, and the reason they are this small.
 *
 * They were fourteen, nine, six, six and three percent — thirty-eight percent of
 * the field homed inside five ellipsoids of about three units' radius. At the
 * ULTRA budget that is roughly nine thousand additive streaks in a thirty-unit
 * volume, which is three hundred times the overdraw the region's own area can
 * carry. The third capture of this scene showed exactly that: five saturated
 * glowing balls, one at each domain, identical to each other.
 *
 * A domain is not a reservoir of matter. It is a place where matter *arrives* —
 * the corridor pulls units out of the Core toward it, and the region's own load
 * decides how much of what arrives condenses. What is homed there only has to be
 * enough to seed that, and eight hundred units will seed it. The rest of the
 * brief's thousand-strong local pocket is the corridor's doing, not the
 * allocation's.
 */
const REGION_SHARES: readonly number[] = [0.04, 0.028, 0.02, 0.02, 0.012];

/**
 * The one place the population is scaled from a profile.
 *
 * `density` is a 0..1 quality scalar. The scaling has a floor rather than going
 * to zero, because a quality step is meant to make the field sparser and not to
 * make it stop existing — the brief's lower tiers all still require the field to
 * be legible, and a field of four units is not a field.
 *
 * Both the view and the telemetry read this, so the count that is reported is
 * the count that is drawn. That is the rule the previous stage's telemetry was
 * written to keep, and it is worth more here than it was there: the whole point
 * of this stage is that the GPU is doing visible work, and a readout of the
 * allocation rather than the draw would hide exactly the number that matters.
 */
export function deriveMatterCount(budget: number, density: number): number {
  const bounded = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1;
  const safeBudget = Number.isFinite(budget) ? Math.max(0, budget) : 0;
  return Math.max(0, Math.trunc(safeBudget * (0.35 + bounded * 0.65)));
}

export function buildMatterField(spec: MatterFieldSpec): MatterFieldAttributes {
  const seed = normalizeSeed(spec.seed ?? 17);
  const count = deriveMatterCount(spec.count, spec.density ?? 1);
  const regionCount = spec.regions.length;

  const home = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  const kind = new Float32Array(count);
  const extent = new Float32Array(count * 3);
  const form = new Float32Array(count);
  const scale = new Float32Array(count);

  if (count === 0 || regionCount === 0) {
    return { home, seed: seeds, kind, extent, form, scale, count: 0 };
  }

  // A unit's region is one comparison against a cumulative table. Slot 0 is the
  // rift; slots 1..n are the regions. Units past the last share clamp into the
  // final region rather than dropping, because a dropped unit is a hole.
  const bounds: number[] = [RIFT_SHARE];
  let running = RIFT_SHARE;
  for (const share of REGION_SHARES) {
    running += share;
    bounds.push(running);
  }
  const total = running;

  for (let index = 0; index < count; index += 1) {
    const seedA = hashUnit(seed, index * 3 + 1);
    const seedB = hashUnit(seed, index * 3 + 2);
    const seedC = hashUnit(seed, index * 3 + 3);
    seeds[index * 3] = seedA;
    seeds[index * 3 + 1] = seedB;
    seeds[index * 3 + 2] = seedC;

    const draw = hashUnit(seed, index + 900_001) * total;
    let slot = bounds.length - 1;
    for (let candidate = 0; candidate < bounds.length; candidate += 1) {
      if (draw <= bounds[candidate]!) {
        slot = candidate;
        break;
      }
    }

    const region =
      slot === 0 ? spec.rift : spec.regions[Math.min(regionCount - 1, slot - 1)]!;
    const offset = sampleRegionOffset(seedA, seedB, region.extent, seedC);

    home[index * 3] = region.centre[0] + offset[0];
    home[index * 3 + 1] = region.centre[1] + offset[1];
    home[index * 3 + 2] = region.centre[2] + offset[2];
    kind[index] = region.kind;
    extent[index * 3] = region.extent[0];
    extent[index * 3 + 1] = region.extent[1];
    extent[index * 3 + 2] = region.extent[2];

    // Biased low. Most of the field is vapour and stays vapour; a minority are
    // ready to condense the moment the field gives them a direction. An even
    // draw would make every unit transform at once, which reads as one object
    // scaling rather than as matter reconfiguring.
    form[index] = Math.pow(hashUnit(seed, index + 1_700_003), 1.6);
    scale[index] = 0.4 + hashUnit(seed, index + 2_300_007) * 1.35;
  }

  return { home, seed: seeds, kind, extent, form, scale, count };
}

/**
 * A unit's position inside its own region, as a pure function of its seeds.
 *
 * Sphere-sampled rather than cube-sampled: an even cube fill puts units in the
 * corners of a region, and a field with visible corners is a box of dust. The
 * radial term is scaled per axis afterwards so a region that is wide and flat
 * still gets a wide flat volume of matter.
 */
export function sampleRegionOffset(
  seedA: number,
  seedB: number,
  extent: Vector,
  fill = 1,
): Vector {
  const angle = seedA * Math.PI * 2;
  const height = seedB * 2 - 1;
  // A uniform angle and a uniform height give a point on the ellipsoid's
  // *surface*, not inside it — which is why the third capture of this scene had
  // five bright hollow balls sitting where the five domains are. A shell of
  // thousands of additive streaks seen in projection is a luminous disc, and a
  // luminous disc at a domain's position is a glowing icon, which is the one
  // thing the brief is most explicit about not building.
  //
  // The cube root is the standard correction: uniform in `r³` is uniform in
  // volume. It is a default of one so that every existing caller keeps the
  // surface behaviour it was written against.
  const radius = Math.cbrt(fill);
  const radial = Math.sqrt(Math.max(0, 1 - height * height)) * radius;
  return [
    Math.cos(angle) * radial * extent[0],
    height * radius * extent[1],
    Math.sin(angle) * radial * extent[2],
  ];
}
