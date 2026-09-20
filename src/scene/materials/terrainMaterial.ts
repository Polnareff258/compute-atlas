import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
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
 * Three of the four things this does are the *displacement*, and they are the
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
 *  4. **Relief.** Fine procedural detail, which is the fourth item because it is
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

  const relief = mx_fractal_noise_float(positionLocal.mul(RELIEF_SCALE), 3, 2.0, 0.5)
    .mul(RELIEF_AMPLITUDE)
    .mul(u.uQuality);

  const displacement = relief.sub(cut).add(built).sub(compression).add(breathe);
  material.positionNode = positionLocal.add(vec3(0, displacement, 0));

  // --- What the fragment stage is told ----------------------------------------
  const baseColour = varying(attribute('color', 'vec3'));
  const vRegion = varying(attribute('aRegion', 'vec2'));
  const vErosion = varying(erosion);
  const vDeposit = varying(deposit);
  const vRelief = varying(relief);
  const vInBasin = varying(inBasin);
  const vPulse = varying(pulse);

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

  // The basin's compression, as light. Rationed: it is the frame's one white, and
  // it appears at the compression's own phase rather than around the rim.
  const flare = u.uPeak
    .mul(vInBasin)
    .mul(vPulse.pow(6))
    .mul(u.uActivity.max(0.4))
    .mul(clamp(u.uFocus.add(u.uHover).add(0.35), 0, 1))
    .mul(0.55);

  // Deposits read as freshly laid material: brighter than the ground around them,
  // and cool, because what settles here is mineral rather than lit.
  const silt = mix(baseColour, u.uMass, vDeposit.mul(0.5)).mul(vDeposit.mul(1.5).add(1));

  const colour = silt
    .add(vec3(reliefLight, reliefLight, reliefLight))
    .add(wetColour.mul(wet))
    .add(lift)
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
