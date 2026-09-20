import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  mix,
  positionLocal,
  step,
  varying,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { FlowField } from '../watershed/flowField';
import { sampleGround } from './groundField';

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

/*
 * The displacement's own constants — the cut, the deposit, the strata, the relief
 * and the basin's reach — live in `groundField`, because the water reads them too
 * and the two materials have to agree about where the channel is. What is left
 * here is only what is this material's own business.
 */

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
  // Every term below comes from `sampleGround`, which the water reads too: the two
  // have to agree about where the channel is, and the only way to make two things
  // agree is to have one of them. See that module for what each term means and for
  // why the water cannot simply be placed on the height field.
  const field = sampleGround(uniforms, flow, positionLocal);
  const { erosion, deposit, relief, riser, ring, inBasin, pulse } = field;

  material.positionNode = positionLocal.add(vec3(0, field.displacement, 0));

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

/*
 * `max`, `length` and `normalize` are *not* imported: each appears here as a node
 * *method* (`.max()`, `.length()`, `.normalize()`), which is the TSL idiom. The
 * free functions of the same names are separate exports that take the receiver as
 * their first argument, and importing both forms for the same operation is how a
 * chain silently becomes a call with the wrong argument order.
 */
