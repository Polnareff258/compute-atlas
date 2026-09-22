import {
  float,
  floor,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  sin,
  smoothstep,
  texture,
  vec2,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { FlowField } from '../watershed/flowField';

/**
 * What the flow field is doing at a point, and what that does to the ground.
 *
 * **Why this is its own module and not a block inside `terrainMaterial`.** Two
 * materials now have to agree about where the water is. The ground erodes by the
 * flow field, and the water *stands in the trough the erosion cut*; if the two
 * worked out that trough separately they would disagree by however much their
 * constants had drifted, and the failure is a river that floats over its own bed
 * or sinks into it. The way to make two things agree is to have one of them, so
 * the displacement is computed here, once, and both materials read it.
 *
 * The agreement has a second half that is easy to miss: the ground's rendered
 * surface is *not* the height field the CPU built the mesh from. It is that
 * surface displaced — down where the water cuts, up where silt settles, plus the
 * relief noise, the basin's strata and its breathing. A water sheet placed on the
 * CPU surface is therefore placed on a surface that is not there: it would sit
 * inside the hills and float over the channels, by up to several world units. The
 * water has to be a constant offset above the *displaced* surface, which means
 * the water's material has to apply the same displacement. That is the reason
 * this function exists, and it is the reason it returns the terms rather than
 * only their sum — the ground's fragment stage needs several of them on their own.
 *
 * **What is deliberately not here.** Anything that depends on which material is
 * asking: the baked vertex colour, the region mask, the wet sheen, the phase
 * colour. Those are a material's own business, and they are what makes the water
 * look like water rather than like a wet version of the ground.
 *
 * The `position` argument is the vertex's own local position, which is world XZ
 * because every mesh in this scene is mounted at the origin with no rotation and
 * unit scale. A transform on either mesh would leave its field sampling the wrong
 * ground while looking entirely plausible, which is the one thing to check if the
 * erosion ever appears in the wrong place.
 */

/** How far erosion may cut, in world units, on top of the field's own carve. */
export const EROSION_DEPTH = 3.4;
/** How far deposition may raise. Smaller than the cut, because silt is thinner. */
export const DEPOSIT_HEIGHT = 2.2;
/** Amplitude of the basin's compression, in world units. */
export const COMPRESSION_DEPTH = 1.1;

/**
 * The relief's frequency and amplitude.
 *
 * A period of about twelve world units against a mesh whose rows are 2 to 40
 * units apart: the point is that this detail is *below* what the CPU grid can
 * carry, so it has to be finer than the near-field spacing and coarser than a
 * pixel. It is scaled by `uQuality` so a fallback profile spends less of its
 * vertex budget on decoration.
 */
export const RELIEF_SCALE = 0.082;
export const RELIEF_AMPLITUDE = 0.85;

/**
 * How much of the relief survives on ground the flow field says nothing is
 * happening to.
 *
 * Not zero, and that is the point: perfectly smooth ground reads as untextured
 * geometry, and the tessellation underneath it becomes the only thing there is to
 * see. It was tried at a quarter and the result was worse than the problem — the
 * near field turned to polished glass, which is a surface finish with *no* grain
 * rather than one with the wrong grain, and the eye reads the glass as clearly as
 * it reads the crinkle. Most of the relief therefore stays everywhere, and the
 * modulation is the small difference between quiet ground and worked ground
 * rather than a near-total suppression of the former: worked ground carries about
 * a third more detail than the ground beside it, which is a difference in
 * *character* a viewer can see without either state being an absence.
 */
export const RELIEF_QUIET = 0.72;

/**
 * The basin's strata: how many shells, and how tall one riser is.
 *
 * This is the one thing in the displacement that is not about the water. A
 * Convergence Basin is not a bowl — a bowl is what a crater is, and a crater is
 * an *absence*. What the brief asks for is a place that has been accumulating for
 * longer than anything around it, and accumulation leaves layers: five shells of
 * ground, each one stepping down toward the centre, each one a surface with its
 * own lit edge. Quantising the basin's radius is what turns a smooth depression
 * into a structure with a *count*, and a countable structure is the first thing
 * the eye can read in the middle distance, where nothing else in the frame has
 * any shape at all.
 *
 * Five, and not more: at `BASIN_REACH` the shells are 38 world units across, so
 * the risers are wide enough to hold a lit face at the vista's distance rather
 * than collapsing into shading noise. A step is 1.5 world units — the risers
 * together add about seven and a half units across the whole basin, which is
 * under a fifth of its depth and so cannot fill it in.
 */
export const STRATA_COUNT = 5;
export const STRATA_STEP = 1.5;

/**
 * How much of its relief the ground keeps under water.
 *
 * Nearly none, and this is a fix for a specific and ugly failure. The water is a
 * separate mesh laid into the channel, and the ground's relief is a 3D noise with
 * a period of about twelve world units. The terrain mesh evaluates it at its own
 * vertices — two to forty units apart — and the water evaluates it at its own,
 * which are neither the same points nor at the same spacing. The two surfaces
 * therefore disagree by up to the full amplitude of the relief, and since the
 * relief is 0.85 units against a water surface that stands 0.45 above the bed, the
 * ground's noise tore through the water in patches the size of its own lumps: the
 * first capture of the river came back as a green ribbon in fragments, with the
 * bed's grain punching through it.
 *
 * Suppressing the relief inside the channel is the fix, and it is also the right
 * picture: a bed under moving water is scoured smooth, and the channel is the one
 * place in the landscape where a *lack* of grain is what the eye expects. It is
 * not taken to zero — a bed with no grain at all is the polished glass the
 * `RELIEF_QUIET` note records as worse than the problem it solved — and the water
 * covers most of it anyway.
 *
 * **Rationed to the channel's core, not to its reach.** The suppression is gated
 * on `smoothstep(0.25, 0.8, core)`, so it applies where `proximity² × fade` says
 * the water is deep and fades out well before the reach ends. That distinction is
 * not decoration: a river's *reach* is two and a half times its own width, so
 * gating on `core > 0` would smooth a band five times wider than the water, and
 * the first capture with this term in it lost nineteen percent of the near field's
 * measured detail — a real loss, in a landscape whose whole character is its grain.
 * A `core` above 0.8 is inside a channel; a `core` of 0.2 is out on the bank, where
 * the ground should be as rough as it ever was. Both are stronger than the reach,
 * so the smoothing is a lens along the water rather than weather over the valley.
 */
export const BED_RELIEF = 0.15;

/**
 * The basin's reach in world units.
 *
 * 190, and it is the same figure the old CPU terrain mesh used to tint its bowl
 * with. That mesh is gone — the ground is a value of the density field now, not a
 * displaced grid — but the number was measured against this world rather than
 * chosen for that mesh, so it is carried here as the basin's own reach.
 */
export const BASIN_REACH = 190;
const TAU = Math.PI * 2;

/**
 * How fast the basin's compression cycles, in cycles per second, and how the
 * breath that follows the water drifts.
 *
 * Shared because both materials animate from them, and a water sheet whose
 * travelling bands moved at a different rate from the ground's own breathing
 * would read as two systems rather than as one river.
 */
const COMPRESSION_RATE = TAU * 1.5;
const BREATH_BANDS = TAU * 2;
const BREATH_RATE = TAU * 3;

export function sampleGround(
  uniforms: FieldUniforms,
  flow: FlowField,
  position: typeof positionLocal,
) {
  const u = uniforms.uniforms;

  const { minX, maxX, minZ, maxZ } = flow.extent;
  const flowUV = vec2(
    position.x.sub(minX).div(maxX - minX),
    position.z.sub(minZ).div(maxZ - minZ),
  );
  const flowSample = texture(flow.texture, flowUV);
  const erosion = flowSample.x;
  const along = flowSample.y;
  const rate = flowSample.z;
  const deposit = flowSample.w;

  /*
   * The channel's own cross-section, with each river's own strength divided out.
   *
   * `erosion` is `strength × proximity² × fade` and `rate` is the winning river's
   * `flowRate`, so this is `proximity² × fade` and nothing else: 1 at the centre of
   * a channel, 0 at its reach, and the same shape whether the river is a creek or
   * the main artery. Both materials need it — the water for its lens and its
   * opacity, the ground for the bed — and it is derived here rather than in either
   * of them because deriving it twice is how two materials come to disagree about
   * where the water is, which is the whole reason this module exists.
   *
   * The `0.12` floor is against a divide by zero. Outside every river both channels
   * are zero, so the quotient is 0/0.12 = 0, which is the right answer.
   *
   * There is no `.min(1)` and none is needed: `erosion` is a maximum over the
   * rivers of `proximity² × fade × flowRate` and `rate` is the winning river's
   * `flowRate`, so the numerator is the denominator times two factors that are each
   * at most one. The quotient cannot exceed one, and clamping it would be a second
   * statement of something the flow field already guarantees.
   */
  const core = erosion.div(rate.max(0.12));

  const cut = erosion.mul(EROSION_DEPTH);
  const built = deposit.mul(DEPOSIT_HEIGHT);

  // The basin's own reach, from the one uniform every material shares. Taken from
  // the basin's XZ only: a compression that varied with height would tilt the
  // bowl, and a bowl that tilts is a different landscape.
  const toBasin = vec2(u.uBasinCentre.x, u.uBasinCentre.z)
    .sub(position.xz)
    .length()
    .div(BASIN_REACH);
  const inBasin = smoothstep(0.15, 1.0, toBasin).oneMinus();

  // The strata. `toBasin` is the radius, so quantising it gives concentric shells
  // and `riser` rises over the outer part of each one — the flat tread is the
  // surface the eye reads, and a ramp with no tread has no ledges to catch
  // anything. The stair descends *inward*, because that is the direction a basin
  // fills from: everything the world sheds arrives at the middle last.
  const ringPhase = toBasin.mul(STRATA_COUNT);
  const ring = floor(ringPhase);
  const withinRing = ringPhase.sub(ring);
  const riser = smoothstep(float(0.58), float(1), withinRing);
  const strata = ring.add(riser).mul(inBasin).mul(STRATA_STEP);

  // The pulse. `uFlowPhase` rather than `uTime` so the basin keeps breathing under
  // reduced motion while the operation phase stays frozen — see `fieldUniforms`.
  // Squared so the release is a longer, quieter part of the cycle than the
  // compression: a symmetric pulse reads as a heartbeat, and a watershed is not
  // beating.
  const pulse = sin(u.uFlowPhase.mul(COMPRESSION_RATE)).mul(0.5).add(0.5);
  const compression = pulse
    .pow(2)
    .mul(inBasin)
    .mul(u.uActivity.max(0.35))
    .mul(COMPRESSION_DEPTH);

  // A slower, wider breath that follows the water rather than the basin: this is
  // the "data flowing slowly along the surface" the brief asks the idle state to
  // have, and it is why the flow field carries `rate` at all. Two bands per river
  // length, moving at the river's own speed.
  const drift = sin(along.mul(BREATH_BANDS).sub(u.uFlowPhase.mul(BREATH_RATE)).add(rate.mul(4)));
  const breathe = drift.mul(erosion).mul(0.55);

  // How much relief this ground carries, which is a statement about the water
  // rather than about the ground: unworked terrain is smooth, and the detail is
  // where something is cutting or settling. The flow field already knows where the
  // work is; this asks it. Applied to the relief alone and never to the mesh's own
  // shape, so the silhouette the shots are framed against is unchanged.
  const worked = smoothstep(float(0.04), float(0.55), erosion.max(deposit));
  const reliefGain = mix(float(RELIEF_QUIET), float(1), worked).mul(
    // `mix(1, BED_RELIEF, gate)`, in that order — the *first* argument is what the
    // weight of zero selects. It was written the other way round first, which put
    // the suppression on dry ground and left the bed rough: the whole landscape
    // lost a fifth of its measured detail and the channel — the one place the term
    // exists for — kept all of it. A `mix` whose endpoints are both plausible is a
    // mix that reads as correct either way, so the only thing that caught it was
    // rendering `core` and seeing that the smoothing was happening where `core` was
    // zero.
    mix(float(1), float(BED_RELIEF), smoothstep(float(0.25), float(0.8), core)),
  );

  const relief = mx_fractal_noise_float(position.mul(RELIEF_SCALE), 3, 2.0, 0.5)
    .mul(RELIEF_AMPLITUDE)
    .mul(u.uQuality)
    .mul(reliefGain);

  return {
    erosion,
    along,
    rate,
    deposit,
    core,
    relief,
    reliefGain,
    riser,
    ring,
    inBasin,
    toBasin,
    pulse,
    cut,
    built,
    breathe,
    compression,
    strata,
    /** The ground's own vertical offset from the height field, in world units. */
    displacement: relief
      .sub(cut)
      .add(built)
      .sub(compression)
      .add(breathe)
      .add(strata),
  };
}

/*
 * The return type is inferred rather than written down, and that is deliberate.
 * TSL's arithmetic methods return a different type from the one they are called
 * on, so an explicit annotation would have to name `ShaderNodeObject<OperatorNode>`
 * and friends — types the callers' `.mul()` chains then have to be cast into.
 * Letting TypeScript derive it from the body gives each caller the exact node type
 * this function produced, which is what keeps the chains typed without a cast.
 */
