import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  sin,
  smoothstep,
  step,
  texture,
  varying,
  vec2,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { FlowField } from '../watershed/flowField';

/**
 * The ground's material: the hero effect the brief calls Data Erosion and
 * Reformation.
 *
 * Four of the five things this does are the *displacement*, and they are the
 * whole reason it is a material rather than a picture painted on the mesh:
 *
 *  1. **Erosion.** Where the flow field says water is working the ground, the
 *     surface is cut down. The field already carves a trough into the mesh — the
 *     silhouette has to know about a channel — and this is the second, finer cut
 *     on top of it, at a scale the mesh's 4.5-unit spacing cannot represent.
 *  2. **Deposition.** Where the descriptor put a deposit, structure is built up.
 *     Erosion and deposition are the same phenomenon read in two directions, and
 *     the brief asks for both, so they share one texture and one code path.
 *  3. **Compression.** The Convergence Basin periodically compresses and releases.
 *     This is the idle frame's one moving structural event and it is *at the
 *     basin*, not everywhere: a world that breathed as a whole would read as a
 *     wobbling model rather than as a place with something happening in it.
 *  4. **Strata.** The basin's shells, quantised out of its own radius so the
 *     depression reads as a structure with a count rather than as a bowl. This is
 *     the one thing here that is not about the water — see `STRATA_COUNT` — and
 *     it is what gives the middle distance, where nothing else in the frame has
 *     any shape, something for the eye to land on.
 *  5. **Relief.** Fine procedural detail, which is the last item because it is
 *     the one that is decoration rather than statement. It exists so the mesh's
 *     own tessellation is not legible as a grid of triangles on the near ground.
 *
 * **Why the normals are not recomputed.** The displaced surface's true normal is
 * the base normal perturbed by the displacement's derivative, and computing that
 * derivative costs two more full displacement evaluations per vertex — a texture
 * sample and a noise evaluation each — on 194,000 vertices, for relief whose
 * amplitude is under a unit against a terrain whose own slopes are tens of units.
 * The base normal is therefore used, and the relief is kept small enough that this
 * is honest rather than a shortcut: what the relief has to do is break up the
 * tessellation, and a perturbation below the shading's own resolution does that
 * without needing to be shaded itself.
 *
 * **What the fragment stage is allowed to be.** Not a lighting model. The baked
 * vertex colour already carries the light's direction and the depth — see
 * `terrainGeometry` — and there is no light rig in this scene. What is left for
 * the fragment stage is the part that is a function of time or of the view: the
 * wet sheen on working ground, the region's accent, and the basin's compression.
 * Every one of those is a *response*, and none of them is allowed to be a filter
 * over the whole frame — which is the difference between this and the cyan-grey
 * wash the stage is replacing.
 */

/** How far erosion may cut, in world units, on top of the field's own carve. */
const EROSION_DEPTH = 3.4;
/** How far deposition may raise. Smaller than the cut, because silt is thinner. */
const DEPOSIT_HEIGHT = 2.2;
/** Amplitude of the basin's compression, in world units. */
const COMPRESSION_DEPTH = 1.1;

/**
 * The relief's frequency and amplitude.
 *
 * A period of about twelve world units against a mesh whose rows are 2 to 40
 * units apart: the point is that this detail is *below* what the CPU grid can
 * carry, so it has to be finer than the near-field spacing and coarser than a
 * pixel. It is scaled by `uQuality` so a fallback profile spends less of its
 * vertex budget on decoration.
 */
const RELIEF_SCALE = 0.082;
const RELIEF_AMPLITUDE = 0.85;

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
const RELIEF_QUIET = 0.72;

/**
 * What the sheen is made of.
 *
 * A Fresnel term rather than a specular one, because there is no light to
 * specular off. `WET_SHEEN` is how bright wet ground may get and `SHEEN_POWER` is
 * how tight the rim is; together they read as a film of water sitting on the
 * channels, which is what the brief asks the roughness term to do, without a
 * roughness term.
 */
const WET_SHEEN = 0.42;
const SHEEN_POWER = 3.0;

/** How much of the active region's accent may land on its own ground. */
const REGION_LIFT = 0.5;

/**
 * The basin's strata: how many shells, and how tall one riser is.
 *
 * This is the one thing in the material that is not about the water. A
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
const STRATA_COUNT = 5;
const STRATA_STEP = 1.5;

export type TerrainMaterial = {
  readonly material: MeshBasicNodeMaterial;
  dispose(): void;
};

export function createTerrainMaterial(
  uniforms: FieldUniforms,
  flow: FlowField,
): TerrainMaterial {
  const u = uniforms.uniforms;

  const material = new MeshBasicNodeMaterial();
  // The baked colours are read by hand from the `color` attribute below, so
  // three must not also be asked to apply them: with `vertexColors` on, the node
  // material folds the attribute into the colour *and* this node does, and the
  // ground comes out at the square of its intended value.
  material.vertexColors = false;

  // --- The flow field, in the vertex stage ------------------------------------
  //
  // `positionLocal` is the mesh's own vertex position, which is world XZ because
  // the mesh is mounted at the origin with no rotation and unit scale. That is an
  // assumption, and it is the one thing to check if the erosion ever appears in
  // the wrong place: a transform on the mesh would leave the flow field sampling
  // the wrong ground while looking entirely plausible.
  const { minX, maxX, minZ, maxZ } = flow.extent;
  const flowUV = vec2(
    positionLocal.x.sub(minX).div(maxX - minX),
    positionLocal.z.sub(minZ).div(maxZ - minZ),
  );
  const flowSample = texture(flow.texture, flowUV);
  const erosion = flowSample.x;
  const along = flowSample.y;
  const rate = flowSample.z;
  const deposit = flowSample.w;

  // --- Displacement -----------------------------------------------------------
  const cut = erosion.mul(EROSION_DEPTH);
  const built = deposit.mul(DEPOSIT_HEIGHT);

  // The basin's own reach, from the one uniform every material shares. Taken from
  // the basin's XZ only: a compression that varied with height would tilt the
  // bowl, and a bowl that tilts is a different landscape.
  const toBasin = vec2(u.uBasinCentre.x, u.uBasinCentre.z)
    .sub(positionLocal.xz)
    .length()
    .div(BASIN_REACH);
  const inBasin = smoothstep(0.15, 1.0, toBasin).oneMinus();

  // The pulse. `uFlowPhase` rather than `uTime` so the basin keeps breathing under
  // reduced motion while the operation phase stays frozen — see `fieldUniforms`.
  // Squared so the release is a longer, quieter part of the cycle than the
  // compression: a symmetric pulse reads as a heartbeat, and a watershed is not
  // beating.
  // --- The basin's strata -----------------------------------------------------
  //
  // `toBasin` is the radius, so quantising it gives concentric shells. `riser`
  // rises over the outer part of each shell and the inner part is flat, which is
  // what makes it a staircase rather than a cone: the flat tread is the surface
  // the eye reads, and a ramp with no tread has no ledges to catch anything.
  //
  // The stair descends *inward* — the tread height is the shell's own index — so
  // the deepest point is the centre. That is the direction a basin fills from:
  // everything the world sheds arrives at the middle last, so the oldest and
  // thickest ground is the outermost shell and the newest is the floor.
  const ringPhase = toBasin.mul(STRATA_COUNT);
  const ring = floor(ringPhase);
  const withinRing = ringPhase.sub(ring);
  const riser = smoothstep(float(0.58), float(1), withinRing);
  const strata = ring.add(riser).mul(inBasin).mul(STRATA_STEP);

  const pulse = sin(u.uFlowPhase.mul(TAU * 1.5)).mul(0.5).add(0.5);
  const compression = pulse
    .pow(2)
    .mul(inBasin)
    .mul(u.uActivity.max(0.35))
    .mul(COMPRESSION_DEPTH);

  // A slower, wider breath that follows the water rather than the basin: this is
  // the "data flowing slowly along the surface" the brief asks the idle state to
  // have, and it is why the flow field carries `rate` at all. Two bands per river
  // length, moving at the river's own speed.
  const drift = sin(along.mul(TAU * 2).sub(u.uFlowPhase.mul(TAU * 3)).add(rate.mul(4)));
  const breathe = drift.mul(erosion).mul(0.55);

  // How much relief this ground carries, which is a statement about the water
  // rather than about the ground: unworked terrain is smooth, and the detail is
  // where something is cutting or settling. Without this the same noise is laid
  // over the whole world at the same amplitude, and the near field — which is the
  // largest area in the frame and the one the eye has most time to read — becomes
  // an even crinkle with no structure in it, which is the "noise" the brief names
  // as the failure mode of the previous composition. The flow field already knows
  // where the work is; this asks it. Applied to the relief alone and never to the
  // mesh's own shape, so the silhouette the shots are framed against is unchanged.
  const worked = smoothstep(float(0.04), float(0.55), erosion.max(deposit));
  const reliefGain = mix(float(RELIEF_QUIET), float(1), worked);

  const relief = mx_fractal_noise_float(positionLocal.mul(RELIEF_SCALE), 3, 2.0, 0.5)
    .mul(RELIEF_AMPLITUDE)
    .mul(u.uQuality)
    .mul(reliefGain);

  const displacement = relief
    .sub(cut)
    .add(built)
    .sub(compression)
    .add(breathe)
    .add(strata);
  material.positionNode = positionLocal.add(vec3(0, displacement, 0));

  // --- What the fragment stage is told ----------------------------------------
  const baseColour = varying(attribute('color', 'vec3'));
  const vRegion = varying(attribute('aRegion', 'vec2'));
  const vErosion = varying(erosion);
  const vDeposit = varying(deposit);
  const vRelief = varying(relief);
  const vInBasin = varying(inBasin);
  const vPulse = varying(pulse);
  const vRiser = varying(riser);
  // The innermost shell, as its own signal: `1 - ring` is 1 on the floor and 0
  // on every shell outside it, so the heart of the basin survives the trip to the
  // fragment stage as a shape rather than as a radius.
  const vHeart = varying(float(1).sub(ring).max(0).mul(inBasin));

  // Which region this ground is, against which region is answering. A `step`
  // window rather than a lookup, because a dynamic index into a uniform array is
  // the one thing the house idiom forbids — the five loads are five summed
  // windows for the same reason.
  const active = float(1).sub(
    step(float(0.001), abs(vRegion.x.mul(4).sub(u.uActiveDomain))),
  );
  const activeWeight = active.mul(vRegion.y).mul(vRegion.y);

  // --- The fragment stage -----------------------------------------------------
  const normal = varying(attribute('normal', 'vec3'));
  const view = varying(positionLocal).sub(cameraPosition).normalize();
  // `abs`, because the surface can face either way relative to the origin and a
  // one-sided rim would put a hard edge across the middle of the world.
  const rim = float(1).sub(abs(dot(normal.normalize(), view))).pow(SHEEN_POWER);

  // Relieved ground is a little lighter where the noise lifts it, which is what
  // makes the relief read as ground rather than as noise in the colour stream.
  const reliefLight = vRelief.mul(0.06);

  // Wet ground: the rim term only where water is working, so the sheen is a
  // statement about the flow rather than a global edge glow. This is the one
  // place the material lets a *hue* onto the terrain, and it takes the region's
  // accent first and the flow colour only where no region is answering.
  const wetColour = mix(u.uFlow, u.uRegionAccent, active);
  const wet = rim.mul(vErosion).mul(WET_SHEEN).add(rim.mul(vDeposit).mul(WET_SHEEN * 0.6));

  // The region's own lift, on its own ground only, and gated by the highlight
  // budget: constraint C5 says one region may be bright, and this is the terrain's
  // share of that one region's brightness.
  const lift = wetColour.mul(activeWeight).mul(u.uHighlight).mul(REGION_LIFT);

  // The basin's own light, and the frame's one white. It sits on the innermost
  // shell — the floor everything the world sheds finally arrives at — and beats
  // with the compression rather than sitting on, so the basin reads as *working*
  // rather than as lit. Rationed to this one place: the `0.25` floor is what it
  // is at rest, and the pulse is what it is at the top of its cycle.
  const flare = u.uPeak
    .mul(vHeart)
    .mul(vPulse.pow(2).mul(0.75).add(0.25))
    .mul(u.uActivity.max(0.4))
    .mul(clamp(u.uFocus.add(u.uHover).add(0.5), 0, 1))
    .mul(0.9);

  // The ledges. Every riser faces a different way from the tread it stands on, so
  // a small fixed lift is enough to make the staircase legible as steps instead
  // of as a smooth slope with banding painted on it. Deliberately small: it is
  // structure, not a second highlight.
  const ledge = vRiser.mul(vInBasin).mul(0.16);

  // Deposits read as freshly laid material: brighter than the ground around them,
  // and cool, because what settles here is mineral rather than lit.
  const silt = mix(baseColour, u.uMass, vDeposit.mul(0.5)).mul(vDeposit.mul(1.5).add(1));

  // The ledges are mineral, like the deposits, but cooler and tipped toward the
  // flow's own colour: what faces the sky in the basin is the same material as
  // what gathers on the floor, seen at a different angle.
  const ledgeColour = mix(u.uMass, u.uFlow, 0.55);

  const colour = silt
    .add(vec3(reliefLight, reliefLight, reliefLight))
    .add(wetColour.mul(wet))
    .add(lift)
    .add(ledgeColour.mul(ledge))
    .add(flare);

  material.colorNode = colour;

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}

/** The basin's reach in world units, matching `terrainGeometry`'s tint reach. */
const BASIN_REACH = 190;
const TAU = Math.PI * 2;

/*
 * `max`, `length` and `normalize` are *not* imported: each appears here as a node
 * *method* (`.max()`, `.length()`, `.normalize()`), which is the TSL idiom. The
 * free functions of the same names are separate exports that take the receiver as
 * their first argument, and importing both forms for the same operation is how a
 * chain silently becomes a call with the wrong argument order.
 */
