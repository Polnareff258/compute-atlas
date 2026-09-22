import type { DepositShape, Vector2 } from '../watershed/terrainField';
import { sampleDomainField, type InkDomain } from './inkDomains';

/**
 * The river's density field, baked once on the CPU from the descriptor.
 *
 * **What this is, and what it deliberately is not.** This is the *static* half of
 * the Advected Ink-Density River Field: the part of the picture that is a property
 * of the world rather than of the current frame. A meander's pigment, its scour
 * and its point bars were laid down by a process that has been running for longer
 * than anything the visitor does, so they are computed once, deterministically,
 * from the same descriptor every other system reads, and uploaded as one texture.
 *
 * The *dynamic* half — advection, the drifting oscillation, the pointer's impulse
 * — is the GPU field's business. The split is not an optimisation dressed up as
 * architecture; it is the distinction the whole codebase is built on. If the base
 * were simulated, the world would differ on every load and two captures could not
 * be compared. If the drift were baked, the frame would be a photograph.
 *
 * **Why the field is a field and not a ribbon.** The one thing the previous
 * composition could not stop being was a ribbon: a mesh exactly as wide as the
 * water, with an edge, laid in a channel it had cut. The brief forbids that
 * picture twice over — "no clearly closed river banks", "no sharp transparent
 * ribbons" — and no amount of shading fixes a mesh whose outline is a river
 * shape. So nothing here has a boundary. `body` is a value that is high along a
 * meander and *decays to zero* over several times the channel's width; where the
 * river "ends" is wherever the eye stops being able to tell, which is the
 * definition the reference works are drawn with.
 *
 * Four channels, each read by the same material that reads the others:
 *
 * - **R `body`** — the 70% layer. Wide, low-frequency pigment: the density the
 *   GPU advects, and the silhouette the frame is composed around.
 * - **G `scour`** — where flow has cut. Peaks on the *outside* of a bend, which
 *   is where curvature puts the fast water, and it is what the surface is
 *   displaced down by.
 * - **B `settle`** — where material has come to rest. Peaks on the *inside* of a
 *   bend and where the river decelerates, which is what a point bar is, and it is
 *   what the surface is displaced up by.
 * - **A `along`** — the arc-length position of the nearest river, normalised. The
 *   bedding phase reads it, so the directional layering runs *downstream* rather
 *   than across the screen, and a band keeps its shape through a bend for free.
 *
 * `scour` and `settle` being separate channels driven by the sign of the bend is
 * the whole reason the picture reads as a river rather than as a paint stroke:
 * erosion and deposition are on opposite banks, and a river where they had been
 * averaged into one "flow" value would be symmetric — which is to say, a canal.
 */

/** One river, as this bake needs it. A structural subset of the descriptor's own. */
export type InkRiver = {
  readonly spine: readonly Vector2[];
  /** Half-width of the flowing body, in world units. */
  readonly width: number;
  /** `0`..`1`. Scales the body's density and its cut. */
  readonly flowRate: number;
};

export type InkDensityOptions = {
  readonly rivers: readonly InkRiver[];
  readonly deposits: readonly DepositShape[];
  readonly basin: { readonly centre: Vector2; readonly radius: number };
  readonly extent: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
  /** Texels along the longer axis. The shorter axis is scaled to keep square texels. */
  readonly resolution: number;
  /**
   * The five regions, as terms in the field.
   *
   * Passed in rather than looked up, for the reason everything else in this file is:
   * the descriptor is the single source of the world and a bake that reached for it
   * itself would be a second reader that could disagree with the first.
   */
  readonly domains: readonly InkDomain[];
  readonly seed: number;
};

export type InkDensity = {
  /** What is here: body, scour, settle, along. */
  readonly data: Float32Array;
  /**
   * Where it goes: tangent X, tangent Z, speed, seed.
   *
   * A second texture rather than a wider first one, because a texel's colour and
   * a texel's velocity are answers to different questions and only one of them is
   * advected. The velocity field is a property of the *course* and must not drift
   * with the ink; folding it into the simulated texture would have the simulation
   * advect the thing that defines the advection, which is how a flow field
   * slowly dissolves into its own blur.
   *
   * It could have been derived in the shader from the gradient of `along`, and
   * that was the first design. It is wrong for a reason worth recording: `along`
   * is taken from whichever river won the texel, so at the boundary between two
   * rivers' influence it *jumps*, and the gradient there is a large vector
   * pointing from one river to the other — a seam of cross-flow down the exact
   * midline where the composition is quietest. The bake knows the winning tangent
   * at every texel already, so it writes it down instead.
   */
  readonly fluvial: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly extent: InkDensityOptions['extent'];
  /** Channel indices, named so the shader side and the bake cannot drift apart. */
  readonly channels: { readonly body: 0; readonly scour: 1; readonly settle: 2; readonly along: 3 };
  readonly fluvialChannels: { readonly tangentX: 0; readonly tangentZ: 1; readonly speed: 2; readonly seed: 3 };
};

/**
 * How far the body's density reaches past the channel, as a multiple of the width.
 *
 * The simulation keeps a compact transport corridor; the material is responsible
 * for the much wider optical diffusion. Baking the blur into the transport field
 * made every course a uniformly thick band, and no shader could recover the lost
 * separation between moving water and suspended pigment.
 */
export const INK_REACH = 2.7;

/**
 * The body's falloff exponent, applied after the reach is normalised.
 *
 * Above one, so the core stays dense across a wide centre and the tail thins
 * rather than ramping linearly. A linear falloff reads as a Gaussian blur on a
 * stripe; this reads as ink.
 */
const BODY_SHARPNESS = 1.35;

/**
 * The pigment field's frequencies in cycles per world unit, and their weights.
 *
 * Low, deliberately: the brief's 70% layer is "wide pigment, blurred boundaries",
 * a statement about wavelength. The longest period is about two hundred world
 * units — comparable to the meander's own wavelength rather than to its width —
 * so the pigment is a wash at the scale of the *composition*, which is what keeps
 * it reading as a deposit rather than as noise on a surface.
 */
const PIGMENT_OCTAVES: readonly number[] = [0.0052, 0.0113, 0.0241, 0.0517];
const PIGMENT_WEIGHTS: readonly number[] = [0.5, 0.27, 0.15, 0.08];

/**
 * How fast the pigment decays away from the river.
 *
 * This is what buys the frame its negative space. Pigment is not zero out in the
 * unworked ground — a watershed has been shedding material across its whole floor
 * — but it falls off, so the corners of the frame arrive at true black and the
 * river is the only thing with substance. Without this the low-frequency field
 * alone lights the entire frame, which is exactly the uniformly-lit failure the
 * baseline measured at a lit fraction of 1.00.
 *
 * The attenuation is clamped at `PIGMENT_REACH_LIMIT` half-lives, so the far
 * field keeps a floor of faint veil rather than being switched off at a radius —
 * a hard edge in a pigment field is visible as a ring, and a ring is the one
 * artefact this composition cannot hide.
 */
const PIGMENT_FALLOFF = 0.58;
const PIGMENT_REACH_LIMIT = 4;

/** Value-noise lattice size. Small, because every octave above is long. */
const NOISE_LATTICE = 256;

// --- Deterministic noise ------------------------------------------------------

/**
 * A seeded integer hash, and the only source of randomness in this file.
 *
 * An integer mix rather than a `Math.random` behind a seed, because the whole
 * point of the descriptor architecture is that two runs on the same seed draw the
 * same world. A float PRNG's statefulness would make the bake depend on the order
 * texels were visited — a dependency nobody could see and everybody would
 * eventually be bitten by.
 */
function hash2(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear value noise on the lattice, in `0`..`1`. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smootherstep(x - x0);
  const fy = smootherstep(y - y0);
  const xa = ((x0 % NOISE_LATTICE) + NOISE_LATTICE) % NOISE_LATTICE;
  const ya = ((y0 % NOISE_LATTICE) + NOISE_LATTICE) % NOISE_LATTICE;
  const xb = (xa + 1) % NOISE_LATTICE;
  const yb = (ya + 1) % NOISE_LATTICE;

  const v00 = hash2(xa, ya, seed);
  const v10 = hash2(xb, ya, seed);
  const v01 = hash2(xa, yb, seed);
  const v11 = hash2(xb, yb, seed);

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** The pigment field: the weighted octave sum above, in `0`..`1`. */
function pigment(x: number, z: number, seed: number): number {
  let sum = 0;
  let norm = 0;
  for (let index = 0; index < PIGMENT_OCTAVES.length; index += 1) {
    const frequency = PIGMENT_OCTAVES[index]!;
    const weight = PIGMENT_WEIGHTS[index]!;
    // Each octave gets its own offset from the seed, so they do not share a zero
    // crossing at the origin — which is visible as a cross-shaped artefact
    // through the middle of the frame when they do.
    const offset = index * 37.13;
    sum += valueNoise(x * frequency + offset, z * frequency - offset, seed + index * 101) * weight;
    norm += weight;
  }
  return sum / norm;
}

// --- The spine ----------------------------------------------------------------

/**
 * A river's spine resampled to uniform arc length, with its curvature.
 *
 * The descriptor authors a spine as a coarse polyline — its points are where the
 * *generator* found it convenient to emit one, not where the geometry wants
 * samples — so the distance search below needs a uniform parameterisation, or the
 * meander's tightest bends sit exactly where the polygon is coarsest. Curvature
 * is the discrete second difference of the resampled points, signed by the cross
 * product with the forward direction, so its sign says *which side is the outside
 * of the bend*: the whole input the scour/settle split runs on.
 */
type ResampledSpine = {
  readonly points: readonly Vector2[];
  readonly tangents: readonly Vector2[];
  /** Signed curvature per point. Positive means the centre of the bend is to the left. */
  readonly curvature: readonly number[];
  /** Cumulative arc length at each point, normalised to `0`..`1` at the far end. */
  readonly arc: readonly number[];
  readonly length: number;
};

function resampleSpine(spine: readonly Vector2[], spacing: number): ResampledSpine {
  if (spine.length < 2) {
    const only = spine[0] ?? ([0, 0] as const);
    return { points: [only], tangents: [[1, 0]], curvature: [0], arc: [0], length: 0 };
  }

  let total = 0;
  for (let index = 1; index < spine.length; index += 1) {
    total += Math.hypot(
      spine[index]![0] - spine[index - 1]![0],
      spine[index]![1] - spine[index - 1]![1],
    );
  }
  // Never zero, and never more samples than the polyline can support: a spine
  // shorter than one spacing is still a river, and dividing its length by a
  // spacing larger than itself would emit a single point and lose both ends.
  const safeSpacing = Math.max(1e-3, Math.min(spacing, Math.max(1e-3, total)));
  const count = Math.max(2, Math.ceil(total / safeSpacing) + 1);

  const points: Vector2[] = [];
  let segment = 0;
  let segmentStart = 0;
  let segmentLength = Math.hypot(spine[1]![0] - spine[0]![0], spine[1]![1] - spine[0]![1]);

  for (let index = 0; index < count; index += 1) {
    const target = (index / (count - 1)) * total;
    while (segment < spine.length - 2 && segmentStart + segmentLength < target) {
      segmentStart += segmentLength;
      segment += 1;
      segmentLength = Math.hypot(
        spine[segment + 1]![0] - spine[segment]![0],
        spine[segment + 1]![1] - spine[segment]![1],
      );
    }
    const t = segmentLength < 1e-6 ? 0 : (target - segmentStart) / segmentLength;
    const a = spine[segment]!;
    const b = spine[segment + 1]!;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }

  const tangents: Vector2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const before = points[Math.max(0, index - 1)]!;
    const after = points[Math.min(points.length - 1, index + 1)]!;
    const dx = after[0] - before[0];
    const dz = after[1] - before[1];
    const length = Math.hypot(dx, dz) || 1;
    tangents.push([dx / length, dz / length]);
  }

  const step = Math.max(1e-3, total / (count - 1));
  const curvature: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const before = tangents[Math.max(0, index - 1)]!;
    const after = tangents[Math.min(tangents.length - 1, index + 1)]!;
    const span = Math.max(1, Math.min(points.length - 1, index + 1) - Math.max(0, index - 1));
    // Signed turn per world unit. The cross product's sign is what makes this
    // directional; a dot product alone would only say "there is a bend here", and
    // the scour/settle split would have nothing to be on opposite sides of.
    const cross = before[0] * after[1] - before[1] * after[0];
    const dot = Math.max(-1, Math.min(1, before[0] * after[0] + before[1] * after[1]));
    curvature.push(Math.atan2(cross, dot) / (step * span));
  }

  const arc: number[] = [];
  let travelled = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      travelled += Math.hypot(
        points[index]![0] - points[index - 1]![0],
        points[index]![1] - points[index - 1]![1],
      );
    }
    arc.push(total > 0 ? travelled / total : 0);
  }

  return { points, tangents, curvature, arc, length: total };
}

/**
 * A texel's nearest point on a resampled spine.
 *
 * Brute force over every sample, and that is a decision rather than an omission:
 * the bake runs once, at load, and the alternative is an acceleration structure
 * whose build cost on a coarse polyline is comparable to the search it would
 * replace. If the resolution ever rises by an order of magnitude this is the
 * first thing to revisit, and this comment is here so it is found by reading
 * rather than by profiling.
 */
function nearestOnSpine(
  spine: ResampledSpine,
  x: number,
  z: number,
): { distance: number; index: number; along: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let index = 0; index < spine.points.length; index += 1) {
    const point = spine.points[index]!;
    // Squared for the comparison and square-rooted once at the end: this is the
    // innermost loop of the whole bake.
    const dx = point[0] - x;
    const dz = point[1] - z;
    const squared = dx * dx + dz * dz;
    if (squared < best) {
      best = squared;
      bestIndex = index;
    }
  }
  return { distance: Math.sqrt(best), index: bestIndex, along: spine.arc[bestIndex] ?? 0 };
}

// --- The bake -----------------------------------------------------------------

export function createInkDensity(options: InkDensityOptions): InkDensity {
  const { extent, resolution, seed } = options;
  const spanX = extent.maxX - extent.minX;
  const spanZ = extent.maxZ - extent.minZ;
  const width = Math.max(8, Math.round(resolution));
  const height = Math.max(8, Math.round((resolution * spanZ) / Math.max(1e-3, spanX)));
  const data = new Float32Array(width * height * 4);
  const fluvial = new Float32Array(width * height * 4);

  // One resample per river, at a spacing tied to its own width: a wide river's
  // meander is long and a creek's is short, and a single global spacing would
  // either over-sample the creek or lose the artery's bends.
  const prepared = options.rivers.map((river) => ({
    river,
    spine: resampleSpine(river.spine, Math.max(2, river.width * 0.5)),
  }));

  // The widest reach in the world, used for the pigment envelope's fallback. The
  // fallback exists so that a texel no river claims divides by a real number
  // rather than by an undefined winner: a NaN in a density field is a black hole
  // with a soft edge, which is far worse than a slightly wrong envelope.
  let widestReach = 1;
  for (const entry of prepared) {
    widestReach = Math.max(widestReach, entry.river.width * INK_REACH);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const worldX = extent.minX + ((x + 0.5) / width) * spanX;
      const worldZ = extent.minZ + ((y + 0.5) / height) * spanZ;

      let body = 0;
      let scour = 0;
      let settle = 0;
      let along = 0;
      let tangentX = 0;
      let tangentZ = 0;
      let speed = 0;
      let winningDistance = Number.POSITIVE_INFINITY;

      for (const { river, spine } of prepared) {
        const reach = river.width * INK_REACH;
        const near = nearestOnSpine(spine, worldX, worldZ);
        // A coarse reject before the shaping: most texels in the frame are
        // nowhere near most rivers, and everything below is per-sample work.
        if (near.distance > reach * 1.6) continue;

        const normalised = Math.min(1, near.distance / reach);
        const shaped = Math.pow(1 - smootherstep(normalised), BODY_SHARPNESS);
        const local = shaped * river.flowRate;
        if (local <= 0) continue;

        // Which side of the meander the texel is on, from the cross product of
        // the local tangent with the offset to the texel.
        const tangent = spine.tangents[near.index] ?? ([1, 0] as const);
        const offsetX = worldX - spine.points[near.index]![0];
        const offsetZ = worldZ - spine.points[near.index]![1];
        const side = tangent[0] * offsetZ - tangent[1] * offsetX;

        // Curvature is normalised by the channel's own width, because 0.01 per
        // unit is a gentle sweep on a sixty-unit river and a hairpin on a six-unit
        // one. This is the difference between "the banks differ" and "every small
        // river is a chain of oxbows".
        const bend = Math.max(-1, Math.min(1, (spine.curvature[near.index] ?? 0) * river.width * 3));
        // `tanh` rather than a clamp on a product that can reach any magnitude:
        // it saturates smoothly, so there is no radius at which the banks switch
        // sides, which a clamp would produce as a visible seam along a contour.
        const signed = bend * side;
        const outside = Math.max(0, Math.tanh(signed));
        const inside = Math.max(0, Math.tanh(-signed));

        if (local > body) {
          body = local;
          along = near.along;
          winningDistance = near.distance;
          // The winner's own direction, so the velocity field is continuous
          // everywhere `body` is continuous — which is everywhere that matters,
          // because speed is gated on `body` below.
          tangentX = tangent[0];
          tangentZ = tangent[1];
          speed = river.flowRate;
        }
        scour = Math.max(scour, local * (0.42 + 0.58 * outside));
        // Deposition is *slower* water, gated on the river's own rate: a fast
        // artery builds a thin bar and a slow creek builds a broad one.
        settle = Math.max(
          settle,
          local * (0.34 + 0.66 * inside) * (1 - river.flowRate * 0.6),
        );
      }

      // The descriptor's own raised deposits. These are mounds rather than bars
      // and belong to the field for the same reason channels do — they are places,
      // not effects. Added rather than maximised, because overlapping deposits
      // genuinely stack; this codebase has already had to learn that once, in
      // `groundField`'s note about smooth-min returning a flat lift.
      for (const deposit of options.deposits) {
        const distance = Math.hypot(worldX - deposit.centre[0], worldZ - deposit.centre[1]);
        if (distance > deposit.radius) continue;
        const t = 1 - distance / deposit.radius;
        settle = Math.min(1.6, settle + t * t * 0.75);
      }

      /*
       * The five regions.
       *
       * Sampled per texel against every region rather than indexed by one, because the
       * regions overlap: two of them can reach the same ground, and a texel between
       * them should carry both influences fading out rather than one winning.
       */
      const region = sampleDomainField(options.domains, worldX, worldZ, seed);

      // The 70% layer: deterministic, low-frequency, and decaying away from the
      // river rather than spread across the frame.
      const raw = pigment(worldX, worldZ, seed);
      const envelope =
        Math.exp(
          -PIGMENT_FALLOFF *
            Math.min(
              PIGMENT_REACH_LIMIT,
              winningDistance / Math.max(1, widestReach),
            ),
        ) *
        (0.34 + 0.66 * body);
      const veil = raw * envelope * 0.85;

      const index = (y * width + x) * 4;
      data[index] = Math.min(1, body + veil * 0.55 + region.body * 0.55);
      data[index + 1] = Math.min(1, scour + region.scour * 0.7);
      data[index + 2] = Math.min(1, settle + region.settle * 0.7);
      data[index + 3] = along;

      /*
       * The velocity field.
       *
       * Speed is gated on the body rather than on the river's rate alone, and the
       * difference is what makes the flow a *field* instead of a set of lanes. A
       * river that moved at its full rate right up to the reach and stopped dead
       * outside it would advect the ink into a band with two straight edges —
       * which is a ribbon again, arrived at from the simulation side. Falling off
       * with the same profile as the density means the water at the bank is slow
       * water, and the ink that drifts out there drifts slowly, which is exactly
       * how a real meander's suspended load spreads.
       *
       * `0.35` rather than `0` at the shoulder, because ambient motion is what
       * keeps the slow oscillation legible across the whole course. A field that
       * is exactly still anywhere is a field where the pigment is frozen, and a
       * frozen pigment field is a texture.
       */
      fluvial[index] = tangentX;
      fluvial[index + 1] = tangentZ;
      fluvial[index + 2] = speed * (0.35 + 0.65 * body);
      fluvial[index + 3] = raw;
    }
  }

  // The basin. Everything the world sheds arrives here, so `settle` rises into it
  // and the body flattens out: a river does not end, it stops being a river.
  // Applied after the sweep rather than inside it because it is one disc, and
  // testing it per river would be the same test eight times.
  const basinRadius = Math.max(1, options.basin.radius);
  const basinField = basinRadius * 1.8;
  const minX = extent.minX;
  const minZ = extent.minZ;
  for (let y = 0; y < height; y += 1) {
    const worldZ = minZ + ((y + 0.5) / height) * spanZ;
    const dz = worldZ - options.basin.centre[1];
    for (let x = 0; x < width; x += 1) {
      const worldX = minX + ((x + 0.5) / width) * spanX;
      const dx = worldX - options.basin.centre[0];
      const distance = Math.hypot(dx, dz);
      if (distance > basinField) continue;
      const t = 1 - distance / basinField;
      const gather = t * t;
      const index = (y * width + x) * 4;
      // Read into locals first. The project runs with `noUncheckedIndexedAccess`, so
      // a typed-array read is `number | undefined` and an arithmetic read-modify-write
      // is a type error rather than a runtime one — which is the check working as
      // intended, since a NaN reaching a density texture is a soft-edged black hole.
      const settled = data[index + 2] ?? 0;
      const pigmented = data[index] ?? 0;
      data[index + 2] = Math.min(1, settled + gather * 0.8);
      data[index] = Math.min(1, pigmented + gather * 0.22);
    }
  }

  return {
    data,
    fluvial,
    width,
    height,
    extent,
    channels: { body: 0, scour: 1, settle: 2, along: 3 },
    fluvialChannels: { tangentX: 0, tangentZ: 1, speed: 2, seed: 3 },
  };
}
