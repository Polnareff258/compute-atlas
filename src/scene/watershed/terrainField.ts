/**
 * The watershed's height field.
 *
 * This is the one implementation of the terrain's shape, and it is a CPU
 * function on purpose.
 *
 * The alternative — displacing the surface in the vertex shader from a noise
 * expression — is the technique the brief lists, and it is cheaper per frame.
 * It was rejected here because the silhouette *is* the composition: the brief's
 * constraints (the near field must not occlude the basin, no large plane faces
 * the lens, the basin's projection lands in the central 55%) are statements
 * about the shape of the world, and a shape that only exists inside a shader
 * cannot be asserted in a test, cannot be reasoned about when framing a shot,
 * and has to be re-derived a second time on the CPU for every placement
 * decision. Two implementations of one noise field diverge, and the divergence
 * shows up as labels floating off the ground.
 *
 * So the base terrain is built once, exactly, and deterministically, here. The
 * GPU still deforms it: `terrainMaterial` adds a small flow-driven displacement
 * on top, which is what makes the surface breathe and erode. That term is
 * deliberately bounded below the scale at which it could change the silhouette.
 */
import { hashUnit } from '../seedRandom';

export type Vector2 = readonly [number, number];

/** The basin the whole watershed drains into. */
export type BasinShape = {
  readonly centre: Vector2;
  readonly radius: number;
  readonly depth: number;
  /** Concentric steps inside the bowl. These are what read as *strata*. */
  readonly terraces: number;
  /** How far the raised rim extends past `radius`. */
  readonly rimWidth: number;
  readonly rimHeight: number;
};

/**
 * A carved channel: the ground a river has cut for itself.
 *
 * The spine is a polyline in world XZ. `width` and `depth` are the trough's
 * half-width and its depth below the surrounding ground, and both taper toward
 * the ends so a channel enters the terrain instead of being cut off by it.
 */
export type ChannelShape = {
  readonly spine: readonly Vector2[];
  readonly width: number;
  readonly depth: number;
  /** Where the carve is at full strength, as a fraction along the spine. */
  readonly fullFrom: number;
  readonly fullTo: number;
};

/** A raised mound where material settles. Crystals grow on these. */
export type DepositShape = {
  readonly centre: Vector2;
  readonly radius: number;
  readonly height: number;
};

/**
 * One region's effect on the ground it sits in.
 *
 * Domains are differences in the *physics* of a place, so this is where that
 * becomes geometry: a delta of many shallow competing runnels, a set of hard
 * terraces, a deep ravine, regular strata, or almost nothing at all.
 */
export type DomainTerrain = {
  readonly centre: Vector2;
  readonly radius: number;
  readonly amplitude: number;
  readonly frequency: number;
  /** `0`..`1` — how much of the pattern is stepped rather than smooth. */
  readonly terrace: number;
  /** Vertical scale of the steps, in world units. */
  readonly step: number;
  /** `0` for a mound, `1` for a hollow, negative to lift without inverting. */
  readonly invert: number;
};

export type TerrainFieldOptions = {
  readonly seed: number;
  readonly basin: BasinShape;
  readonly channels: readonly ChannelShape[];
  readonly deposits: readonly DepositShape[];
  readonly domains: readonly DomainTerrain[];
  /** World-space XZ rectangle the field is defined over. */
  readonly extent: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
};

const BASE_AMPLITUDE = 6.4;
const BASE_FREQUENCY = 0.0052;
const BASE_OCTAVES = 4;
const BASE_LACUNARITY = 2.07;
const BASE_GAIN = 0.47;

/**
 * The cross-profile: the shape the ground would have if it had no features.
 *
 * This is the single term that decides whether the world works, and it is worth
 * being precise about why it is a valley in Z rather than a tilt.
 *
 * The basin sits at `BASIN_LATITUDE`, part way between the camera and the far
 * edge. Everything that has to be true follows from the basin being the *low
 * point of that line*:
 *
 *  - a river's source is farther away than the basin, so the ground must fall
 *    from the far edge down to the basin, or the rivers run uphill;
 *  - the foreground is nearer than the basin, so the ground must fall from the
 *    camera toward the basin as well, or the near bank stands in the way of the
 *    view that the whole stage exists to produce;
 *  - and beyond the basin the ground rises again, which is what gives the frame
 *    a far edge to disappear into instead of a line where the world stops.
 *
 * A single linear tilt cannot do this. The first version was one, signed so the
 * far ground sat lower — which is the right instinct for depth and the wrong one
 * for drainage, and it put every river's source *below* its mouth. The tests in
 * `watershedDescriptor.test.ts` are what caught it.
 */
const BASIN_LATITUDE = -300;
/** How high the near bank stands above the basin's own latitude. */
const NEAR_BANK_RISE = 11;
/** How high the far sources stand above it. The far bank is taller: it is what
 *  the rivers come down off, and it is what the fog has to swallow. */
const FAR_BANK_RISE = 18;

/**
 * The ground height of the featureless world at a given `z`.
 *
 * Exported because more than one thing needs it: the descriptor measures the
 * horizon against it, and the camera's clearance checks are stated relative to
 * it rather than to the noisy total.
 */
export function terrainProfile(z: number): number {
  const nearBank = NEAR_BANK_RISE * smoothstep(BASIN_LATITUDE, BASIN_LATITUDE + 560, z);
  const farBank = FAR_BANK_RISE * smoothstep(BASIN_LATITUDE - 40, BASIN_LATITUDE - 860, z);
  return nearBank + farBank;
}

/**
 * Deterministic 2D value noise, smooth-interpolated.
 *
 * Value noise rather than gradient noise: what the terrain needs is broad
 * rolling ground with no directional bias, and gradient noise's characteristic
 * axis-aligned ridges are exactly the kind of repeating structure that reads as
 * "generated" rather than "placed".
 */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  // Smoothstep the interpolant. A linear one leaves visible creases along the
  // lattice, which on a lit surface read as faults in the ground.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const corner = (cx: number, cy: number): number =>
    hashUnit(seed, Math.imul(cx, 73_856_093) ^ Math.imul(cy, 19_349_663));

  const n00 = corner(x0, y0);
  const n10 = corner(x0 + 1, y0);
  const n01 = corner(x0, y0 + 1);
  const n11 = corner(x0 + 1, y0 + 1);

  const top = n00 + (n10 - n00) * sx;
  const bottom = n01 + (n11 - n01) * sx;
  return top + (bottom - top) * sy;
}

/** Fractal sum of `valueNoise2D`, returned in roughly `[-1, 1]`. */
export function fractalNoise2D(
  x: number,
  y: number,
  seed: number,
  octaves = BASE_OCTAVES,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * (valueNoise2D(x * frequency, y * frequency, seed + octave * 977) * 2 - 1);
    norm += amplitude;
    amplitude *= BASE_GAIN;
    frequency *= BASE_LACUNARITY;
  }

  return norm === 0 ? 0 : sum / norm;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Distance from `point` to the polyline, plus how far along it the closest approach is. */
function distanceToSpine(
  x: number,
  z: number,
  spine: readonly Vector2[],
): { distance: number; along: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let travelled = 0;
  let total = 0;

  for (let index = 0; index < spine.length - 1; index += 1) {
    const [ax, az] = spine[index]!;
    const [bx, bz] = spine[index + 1]!;
    total += Math.hypot(bx - ax, bz - az);
  }
  if (total === 0) return { distance: Math.hypot(x - spine[0]![0], z - spine[0]![1]), along: 0 };

  for (let index = 0; index < spine.length - 1; index += 1) {
    const [ax, az] = spine[index]!;
    const [bx, bz] = spine[index + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / lengthSquared, 0), 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const distance = Math.hypot(x - px, z - pz);

    if (distance < best) {
      best = distance;
      bestAlong = (travelled + Math.hypot(px - ax, pz - az)) / total;
    }
    travelled += Math.hypot(dx, dz);
  }

  return { distance: best, along: bestAlong };
}

/**
 * The basin bowl, with its terraces and its raised rim.
 *
 * Terraces are the reason the basin reads as built rather than scooped: a plain
 * radial falloff is a funnel, and a funnel seen from above is a target. Stepping
 * the profile gives concentric shelves whose edges catch light differently, so
 * the shape reads as layered material that has settled in stages.
 */
function basinTerm(x: number, z: number, basin: BasinShape): number {
  // An absent basin is expressed as zero depth and zero rim, and its zero radius
  // would put a NaN through every division below and out into the whole height
  // field. Rejecting it here rather than at each call site is what lets the
  // descriptor hand in a basin entry for every region unconditionally.
  if (basin.depth === 0 && basin.rimHeight === 0) return 0;

  const radius = Math.max(basin.radius, 0);
  const band = Math.max(basin.rimWidth, 0);
  const distance = Math.hypot(x - basin.centre[0], z - basin.centre[1]);

  if (distance > radius + band) return 0;

  // The rim is a lip just outside the bowl edge, not a raised ring on the
  // floor. A half-sine over the rim band leaves the bowl untouched at
  // `radius`, peaks once in the middle of the band and returns to the
  // surrounding height at the outer edge, so the basin sits in the ground
  // rather than on it.
  const rimT = band > 0 ? (distance - radius) / band : 1;
  const rim = rimT <= 0 || rimT >= 1 ? 0 : basin.rimHeight * Math.sin(Math.PI * rimT);

  // The bowl itself: a smooth cosine falloff from the rim to the floor. A
  // zero-radius basin has no bowl to fall off, so it contributes only its rim.
  const t = radius > 0 ? Math.min(distance / radius, 1) : 1;
  const bowl = (Math.cos(t * Math.PI) + 1) * 0.5;

  // Quantise the bowl into shelves, keeping the remainder as a soft lip, so the
  // steps read as ledges with an edge rather than as a staircase.
  const terraces = Math.max(basin.terraces, 1);
  const levels = bowl * terraces;
  const shelf = (Math.floor(levels) + Math.pow(levels - Math.floor(levels), 0.55)) / terraces;

  return -basin.depth * shelf + rim;
}

function channelTerm(x: number, z: number, channel: ChannelShape): number {
  const { distance, along } = distanceToSpine(x, z, channel.spine);
  const taper =
    smoothstep(0, channel.fullFrom, along) * smoothstep(1, channel.fullTo, along);
  if (taper <= 0) return 0;

  // A rounded trough, not a slot: `1 - t^2` has a flat floor and soft walls,
  // and its width is proportionate at every depth, which is what a water-cut
  // channel looks like from a distance.
  const t = Math.min(distance / channel.width, 1);
  return -channel.depth * taper * (1 - t * t);
}

function depositTerm(x: number, z: number, deposit: DepositShape): number {
  const distance = Math.hypot(x - deposit.centre[0], z - deposit.centre[1]);
  if (distance > deposit.radius) return 0;
  const t = distance / deposit.radius;
  // Squared falloff: a deposit has a defined shoulder, unlike the ground it
  // sits on, and that shoulder is where the crystal facets will catch light.
  return deposit.height * (1 - t * t) * (1 - t * t);
}

function domainTerm(x: number, z: number, domain: DomainTerrain, seed: number): number {
  const distance = Math.hypot(x - domain.centre[0], z - domain.centre[1]);
  if (distance > domain.radius) return 0;

  const falloff = smoothstep(domain.radius, domain.radius * 0.55, distance);
  const pattern = fractalNoise2D(
    x * domain.frequency,
    z * domain.frequency,
    seed + Math.round(domain.centre[0] * 7 + domain.centre[1] * 13),
    3,
  );

  // Stepping is what separates the terraced regions from the delta of shallow
  // runnels: on a delta the ground is mostly smooth and only the channel walls
  // are steep, so the stepped fraction stays near zero. Same shelf idiom as the
  // basin — quantise, then keep the remainder as a soft lip.
  const levels = domain.step > 0 ? pattern / domain.step : pattern;
  const stepped =
    domain.step > 0
      ? (Math.floor(levels) + Math.pow(levels - Math.floor(levels), 0.45)) * domain.step
      : pattern;
  const shaped = pattern * (1 - domain.terrace) + stepped * domain.terrace;

  return domain.amplitude * falloff * shaped * (domain.invert === 0 ? 1 : domain.invert);
}

/**
 * The ground height at `(x, z)`.
 *
 * Terms are summed in a deliberate order. The base relief sets the horizon, the
 * channels cut into it, the basin carves *last* so nothing refills it, and the
 * domain patterns are added on top because they describe what the local
 * material is doing rather than what the world's shape is.
 *
 * Deterministic and pure: same `(x, z, options)` in, same height out, with no
 * cache and no shared mutable state. The mesh builder, the placement of every
 * river and label, and the camera corridor checks all call it independently and
 * must agree, which is the whole reason it is not a shader.
 */
export function terrainHeight(x: number, z: number, options: TerrainFieldOptions): number {
  const { seed } = options;

  const base =
    BASE_AMPLITUDE *
    fractalNoise2D(x * BASE_FREQUENCY, z * BASE_FREQUENCY, seed);

  // The cross-profile, which is the composition: near bank, basin, far bank.
  // See `terrainProfile` for why this is a valley and not a tilt.
  let height = base + terrainProfile(z);

  // Channels sum, so a confluence cuts deeper than either branch. That is what
  // a confluence does, and it makes the junction a place the eye goes rather
  // than a seam; the same `smoothMin` objection recorded below applies here.
  for (const channel of options.channels) {
    height += channelTerm(x, z, channel);
  }

  // Deposits are raised, and they are *summed* rather than blended into the
  // ground.
  //
  // A smooth max was tried first and rejected on measurement: the polynomial
  // smooth-min every terrain generator reaches for returns `a - k/4` where its
  // two arguments are equal, so `smoothMax(g, g, k)` is `g + k/4`. On a
  // heightfield that is a flat lift applied to the whole world wherever a
  // deposit lists at zero, and — worse — a step of that lift at the exact radius
  // where `depositTerm` reaches zero and the blend stops being applied. The
  // silhouette cannot afford a step, and a global constant is not worth a
  // parameter. Summing is continuous everywhere, is what the physics does when
  // two deposits overlap, and needs no blend radius to tune.
  for (const deposit of options.deposits) {
    height += depositTerm(x, z, deposit);
  }

  // Carve the basin after everything else, so no deposit or channel inside it
  // can raise the floor it just cut.
  height += basinTerm(x, z, options.basin);

  for (const domain of options.domains) {
    height += domainTerm(x, z, domain, seed);
  }

  return height;
}

/** True when `(x, z)` is inside the declarative extent. */
export function insideExtent(
  x: number,
  z: number,
  extent: TerrainFieldOptions['extent'],
): boolean {
  return x >= extent.minX && x <= extent.maxX && z >= extent.minZ && z <= extent.maxZ;
}

export { smoothstep, distanceToSpine };
