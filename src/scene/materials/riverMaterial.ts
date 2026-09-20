import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  float,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  sin,
  smoothstep,
  step,
  varying,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { FlowField } from '../watershed/flowField';
import { sampleGround } from './groundField';

/**
 * The Data River: the water, and the second half of Data Erosion and Reformation.
 *
 * The ground material cuts a trough; this is what stands in it. The two are the
 * same phenomenon seen from either side — the brief's "data deposition, erosion,
 * convergence, bifurcation" is one process, and splitting it across two materials
 * is a statement about which of the two the camera is looking at, not about the
 * process.
 *
 * **The one thing this must get right, and it is not the shading.** The water has
 * to be exactly on the ground the terrain mesh drew. That is harder than it sounds
 * and it is the reason `groundField` exists: both materials displace from
 * `positionLocal`, including a 3D noise for the relief, so the water can only sit
 * correctly if it applies the same displacement to a vertex that started at the
 * same place. `riverGeometry` puts each ribbon vertex on `terrainHeight`, and this
 * material adds `sampleGround`'s displacement to it. Between them the two cancel
 * exactly and the water sits at a constant offset above the surface rather than
 * sinking into the channel it is supposed to be filling.
 *
 * **Why the water is a lens and not a sheet.** `WATER_LIFT` is scaled by the
 * channel's own cross-section, so the water is deepest at the centre of the
 * channel and thins to nothing at the reach — a body of water in a bed, rather
 * than a film of the same thickness laid over the whole valley. The `core` term is
 * what does it: `erosion` in the flow field is a river's strength *times* its
 * lateral profile, so dividing by the winning river's own `flowRate` leaves the
 * profile alone, and every river gets the same cross-section regardless of how
 * much water it carries. That is why the flow texture carries four channels and
 * not three.
 *
 * **The three phases, and why they are reconstructed rather than passed in.** The
 * descriptor's `phasesFor` is a pure function of a river's `flowRate`: fast rivers
 * carry particles, filaments and bands, middling ones drop the bands, slow ones
 * drop the particles. `rate` in the flow texture *is* the winning river's
 * `flowRate`, so the material can recover the same answer from the texture — and
 * cannot disagree with the descriptor about it, because it is evaluating the same
 * function of the same value. An attribute would be a second copy of a fact that
 * is already in the texture, and second copies drift.
 *
 * **What is deliberately absent.** No fresnel rim. Water at a grazing angle is
 * brighter, and that would normally be the first term here — but `riverGeometry`
 * builds no normals (the ribbon's surface is the terrain's surface and the terrain
 * has them), so a rim term would need either a second attribute or a finite
 * difference over the flow texture, and neither is worth a term whose whole job is
 * a highlight the water's own core profile already provides.
 */

/**
 * How far above the displaced ground the water stands, at the channel's centre.
 *
 * Under a third of `EROSION_DEPTH` in `groundField`: the cut is 3.4 units and this
 * is 1.15, so the surface of a full river sits about two and a quarter units below
 * the ground that was there before the water cut it. That is a channel with water
 * in it. A lift anywhere near the cut would put the water at the level of the
 * banks, which reads as a flood rather than as a river, and one above it reads as
 * a ribbon laid on the landscape — the exact failure this whole composition exists
 * to replace.
 */
const WATER_LIFT = 1.15;

/**
 * A constant film of clearance under every part of the ribbon, including the dry
 * edge.
 *
 * `WATER_LIFT` is scaled by `core`, so at the reach the water is exactly on the
 * ground — two coincident surfaces, which z-fight. It does not matter that the
 * alpha is zero there: a fragment at zero alpha still writes depth unless
 * `depthWrite` is off, and the sparkle is a per-pixel decision that no amount of
 * transparency prevents. A film across a landscape that is hundreds of units tall
 * is nothing, and it takes the whole coincidence problem away.
 *
 * **Raised from a quarter of a unit, because a quarter was not enough.** The bed
 * carries a sixth of the ground's relief (`BED_RELIEF` in `groundField`) and this
 * surface is deliberately built *without* the relief at all, so the two disagree
 * by however much relief survives on the bed. At a quarter of a unit that was
 * inside the noise: the captured rivers had the terrain's own surface cutting
 * dark sawtooth notches along their length, which is the depth test deciding
 * per-pixel and per-frame which of two surfaces a hair apart is in front. Nine
 * tenths is still far under `EROSION_DEPTH`, so the water stays inside its own
 * channel and does not become the flood `WATER_LIFT` is written to avoid.
 *
 * It is deliberately *not* the defence against the terrain mesh bridging over the
 * channel — see `polygonOffset` below for that, and for why a slope-scaled depth
 * bias is the right tool where a world-space lift is not.
 */
const WATER_FILM = 0.9;

/**
 * The river's opacity at the centre of its core, before the phases modulate it.
 *
 * **Lowered from 0.9, which made the water opaque paint.** Two things followed
 * from that and both were visible in the captures. The water read as a chalky
 * solid lying on the ground rather than as a translucent film the bed shows
 * through — the brief's "translucent data layers" and "glowing information
 * rivers" want the film, not the solid. And because an opaque surface wins every
 * depth test outright, the place where the water's surface meets the channel's
 * wall was a hard binary edge: the wall is a triangle mesh and the water is a
 * ribbon, neither is the other's grid, so their intersection is a staircase with
 * a step per triangle. At 0.58 the wall's own darkness carries through the water
 * at that boundary, which converts the step into a gradient.
 */
const WATER_ALPHA = 0.58;

/**
 * How bright the water is between the phases' crossings, and how much the
 * crossings add on top.
 *
 * A river is a lit thing along its whole length and a *brighter* thing where its
 * threads and bands cross; these two numbers are that sentence.
 *
 * **Lowered from 0.72 and 0.85, which together put the water above white.** Those
 * values made the emission range 0.5 to 1.8, so most of every river's length was
 * at or past the top of the range and the captured water read as an extruded
 * white tube lying on the ground — which is the ribbon-on-the-landscape failure
 * this composition exists to replace, arrived at from the brightness side rather
 * than the geometry side. The pair below peaks at about 1.05, so only the phase
 * crossings spend the frame's white and the rest of the river is a lit line rather
 * than a saturated one.
 *
 * The floor is not lowered far enough to make a river visible *only* at its
 * crossings; a dashed line is the other failure. It has to beat the ground it lies
 * in at its dimmest, and the ground at the channel's own bed is the darkest thing
 * in the frame.
 */
const BRIGHTNESS_FLOOR = 0.36;
const BRIGHTNESS_STRUCTURE = 0.52;

/** Which way the internal structure runs, and how fast it travels downstream. */
const FILAMENT_THREADS = Math.PI * 2 * 2.5;
const FILAMENT_RATE = 2.2;
const BAND_COUNT = Math.PI * 2 * 5;
const BAND_RATE = Math.PI * 2 * 1.6;

/** The grain's frequency, and how fast it boils on its own third axis. */
const PARTICLE_SCALE = 0.32;
const PARTICLE_DRIFT = 0.07;

/**
 * Distances over which the water gives up its detail, and how much of it survives.
 *
 * A bright sub-pixel-wide ribbon at the horizon is the worst aliasing case in the
 * frame — worse than a bright edge on the ground, because the ribbon is thin in
 * *both* screen directions. Dimming it with distance is the same trade the terrain
 * makes by baking haze into its vertex colours, and it is a real depth cue rather
 * than a fix: it is why the far rivers read as being far.
 *
 * The floor is what matters. The brief asks for one or two rivers *entering from
 * the distance*, so the far water has to still be water: it dims to a quarter and
 * stops there. A fade that reached zero would delete the far half of the
 * composition's one line of motion.
 */
const FADE_NEAR = 900;
const FADE_FAR = 1750;
const FADE_FLOOR = 0.25;

/** How much of the compression's white the river's mouth is allowed to spend. */
const MOUTH_FLARE = 0.7;

export type RiverMaterial = {
  readonly material: MeshBasicNodeMaterial;
  dispose(): void;
};

export function createRiverMaterial(
  uniforms: FieldUniforms,
  flow: FlowField,
): RiverMaterial {
  const u = uniforms.uniforms;

  const material = new MeshBasicNodeMaterial();
  // No `color` attribute on this geometry, and the node material would otherwise
  // look for one. Stated rather than left to default so the omission reads as a
  // decision — see the note in `riverGeometry` about what the ribbon carries.
  material.vertexColors = false;
  material.transparent = true;
  // Water does not occlude water. Two rivers meeting at the basin overlap for a
  // short stretch, and with depth writes on the one drawn first would punch a hole
  // in the one drawn second — a hard-edged notch exactly where the composition is
  // converging, which is the one place it must not be. Depth *testing* stays on, so
  // the foreground still occludes the river behind it.
  material.depthWrite = false;

  /*
   * The river has to win the depth test against the ground it is lying in, and it
   * cannot do that by being higher than it.
   *
   * The ground is a mesh whose rows are two to forty units apart and the channel is
   * a concave feature narrower than that over most of the world, so the mesh's
   * linear interpolation across the trough lies *above* the surface the water is
   * evaluated on. Raising the water to clear it would put the water at the level of
   * its own banks in the near field, where the mesh is fine and the problem does not
   * exist — the wrong fix applied where it is not needed.
   *
   * A slope-scaled depth bias is the right tool instead, and the reason is in the
   * arithmetic: at a kilometre out, forty world units of separation is about 3e-8
   * in normalised depth, while the bias below is fixed at roughly 2e-7 and scaled
   * again by the depth slope. So at range — exactly where the mesh bridges the
   * channel — the bias is many times the error it has to cover, and close to the
   * camera, where the error is small, it is comparable to it. A foreground ridge a
   * hundred units nearer still occludes the river, because the bias never grows
   * into the range where that would flip.
   *
   * `polygonOffsetUnits` lands in WebGPU's `depthStencil.depthBias` and the factor
   * in `depthBiasSlopeScale`, both negative because WebGPU adds the bias to depth
   * and a fragment has to move *toward* the viewer to win.
   */
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;

  // --- The same displacement the ground uses ----------------------------------
  const field = sampleGround(uniforms, flow, positionLocal);

  /*
   * The water's own surface, which is the ground's displacement *without* the
   * relief.
   *
   * Water is flat. The relief is a 3D noise whose period is about twelve world
   * units, and the ribbon evaluates it at points that are neither the terrain
   * mesh's vertices nor at its spacing, so carrying it here would give the water a
   * grain of its own — decorrelated from the bed's, at a different frequency,
   * visible as noise crawling on the surface. `BED_RELIEF` in `groundField` takes
   * the bed's relief down to a sixth for the same reason from the other side, and
   * between them the two surfaces agree to well inside the water's own depth.
   */
  const lift = field.core.mul(WATER_LIFT).add(WATER_FILM);
  material.positionNode = positionLocal.add(
    vec3(0, field.displacement.sub(field.relief).add(lift), 0),
  );

  // --- What the fragment stage is told ----------------------------------------
  const vCore = varying(field.core);
  const vAlong = varying(field.along);
  const vRate = varying(field.rate);
  const vInBasin = varying(field.inBasin);
  const vPulse = varying(field.pulse);

  // --- The cross-section ------------------------------------------------------
  // A dense core with a soft shoulder. The dashes are the reach of the erosion's
  // own falloff rather than anything the water chooses: the profile is flat near
  // the centre and collapses toward the edge, and these thresholds land inside
  // that collapse so the water's visible edge is where its bed is.
  const body = smoothstep(float(0.03), float(0.34), vCore);

  // --- The three phases -------------------------------------------------------
  //
  // `phasesFor`, in the shader. See the module note: this is the descriptor's own
  // function of `flowRate` and `rate` is that value, so the two cannot disagree.
  const fast = step(float(0.45), vRate);
  const fastest = step(float(0.9), vRate);
  const particleGate = fast;
  const bandGate = fastest.add(fast.oneMinus());

  /*
   * Filaments: threads running *along* the river.
   *
   * `core` is monotone in the distance from the channel's centre, so lines of
   * constant `core` are lines parallel to the bank — which is what a filament is.
   * The lateral coordinate is therefore the channel's own profile rather than a UV,
   * and a filament follows the river round a bend for free, because the bend is in
   * the flow field rather than in the ribbon's parameterisation.
   *
   * The count rises with the river's speed: a fast river carries finer threads,
   * which is a statement about the water and also what keeps eight rivers at eight
   * widths from looking like one pattern at eight scales.
   */
  const lateral = float(1).sub(vCore);
  const threadCount = float(FILAMENT_THREADS).mul(vRate.mul(0.7).add(0.65));
  const filament = sin(
    lateral.mul(threadCount).add(vAlong.mul(2.1)).sub(u.uFlowPhase.mul(FILAMENT_RATE)),
  );

  /*
   * Bands: broad light travelling downstream, at the river's own speed.
   *
   * This is the brief's "data flowing slowly along the surface" made a property of
   * the water rather than a film over the whole frame — the distinction that the
   * stage this replaces got wrong. The speed is scaled by `rate`, so the artery and
   * the creeks do not pulse in lockstep, and the `along` coordinate is the one the
   * flow field produces by hand rather than a distance, so a band keeps its shape
   * through a river's bends.
   */
  const band = sin(
    vAlong
      .mul(BAND_COUNT)
      .sub(u.uFlowPhase.mul(BAND_RATE).mul(vRate.mul(0.8).add(0.45))),
  );

  /*
   * Particles: granular structure on the fast rivers only.
   *
   * A 3D noise rather than a 2D one, because the ground beside the river is already
   * using 3D noise for its relief and the water shares the same XZ. A 2D noise here
   * would sample the same field the ground is sampling, and the grain would line up
   * with the relief across the water's edge — the river would look printed onto the
   * ground rather than lying in it. The third axis is the flow clock, so the grain
   * boils slowly instead of sliding downstream, which is what suspended matter
   * does.
   */
  const grain = mx_fractal_noise_float(
    vec3(
      positionLocal.x,
      positionLocal.z,
      u.uFlowPhase.mul(PARTICLE_DRIFT),
    ).mul(PARTICLE_SCALE),
    2,
    2.0,
    0.5,
  )
    .mul(0.5)
    .add(0.5);

  const threads = filament.mul(0.5).add(0.5);
  // Gated, and the gate is the descriptor's own: a middling river carries no
  // bands, so its `bands` term is exactly 1 and the phase contributes nothing
  // rather than contributing a faint copy of a pattern it is not supposed to have.
  // The `particleGate` below is the same idea for the other phase; filaments are
  // in every river's list and so are the one term with no gate at all.
  const bands = mix(float(1), band.mul(0.5).add(0.5), bandGate);
  const spark = mix(float(1), grain, particleGate);

  /*
   * Emission: what makes the river read as information rather than as water.
   *
   * **The phases lift a base rather than multiplying each other down.** The
   * obvious form is `threads × bands × spark`, so that a thread crossing a band on
   * a particle is genuinely brighter than any one of them — and the crossings do
   * read well, which is why the product is still in here. But on its own it is the
   * wrong shape: each phase is a wave centred on a half, so the product of three of
   * them has a mean of an *eighth* and the river comes out at about the same value
   * as the ground it is lying on. That is exactly what the first capture measured —
   * the water at `23,61,87` against ground at `23,56,82`, indistinguishable — and
   * the emission was the reason.
   *
   * So the product carries only the *excess* over the base (`BRIGHTNESS_FLOOR`),
   * and the river is luminous everywhere and brighter where the phases cross. The
   * `rate` scale is the last term because it is the one that is about the river
   * rather than about the pattern: a river carrying more water is brighter, all
   * else equal, and that is the only reading of `flowRate` a viewer gets without a
   * legend.
   */
  const structure = threads.mul(bands).mul(spark);
  const emission = float(BRIGHTNESS_FLOOR)
    .add(structure.mul(BRIGHTNESS_STRUCTURE))
    .mul(vRate.mul(0.45).add(0.7));

  // --- Colour -----------------------------------------------------------------
  //
  // Each river's own speed picks its hue, from the flow's cyan toward the spectral
  // blue the palette reserves for compression and ridge — so the frame's coldest,
  // most saturated line is the one carrying the most information, and the eye is
  // led along the composition by colour rather than by arrows.
  const hue = mix(u.uFlow, u.uSpectral, vRate.mul(0.6));

  /*
   * The mouth.
   *
   * Where a river has arrived — inside the basin, on its own channel — the water
   * goes white, on the compression's beat, and this is the one place the river
   * spends the frame's white. It is the same event the terrain's `flare` is drawing
   * on the basin's floor, seen from the other side: the ground lighting up where
   * everything the world sheds arrives, and the water that arrived.
   *
   * Tinted toward white rather than taken to it (`MOUTH_FLARE`), and gated on
   * `uActivity` like every other moving thing in the scene, because the brief's
   * blown-out core was a frame with nothing *but* white in it and a second
   * full-strength emitter at the same point is how that happens twice.
   */
  const flare = vInBasin
    .mul(vCore)
    .mul(vPulse.pow(2).mul(0.7).add(0.3))
    .mul(u.uActivity.max(0.3))
    .mul(MOUTH_FLARE);

  // `float(1).add(...)` rather than `1 + flare * 0.8`: a TSL node is not a number
  // and JavaScript's operators do not overload, so the arithmetic has to be the
  // node's own methods all the way out.
  const colour = mix(hue, u.uPeak, flare)
    .mul(emission)
    .mul(float(1).add(flare.mul(0.8)));

  material.colorNode = colour;

  // --- Opacity ------------------------------------------------------------------
  //
  // The phases cut into the body as well as lighting it, but only a little. A river
  // whose alpha were the filaments would be a stencil of a river — the channels
  // would have holes in them and the ground would show through the water — and the
  // brief asks for a body with structure in it, not for a pattern.
  const cut = mix(float(1), threads, 0.3).mul(mix(float(1), bands, 0.18));

  const distance = varying(positionLocal).sub(cameraPosition).length();
  const nearFade = float(1).sub(smoothstep(FADE_NEAR, FADE_FAR, distance));
  const reach = mix(float(FADE_FLOOR), float(1), nearFade);

  material.opacityNode = body.mul(cut).mul(reach).mul(WATER_ALPHA);

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}

/*
 * `min` and `oneMinus` appear here as node *methods* rather than as imports, which
 * is the TSL idiom: the free functions of the same names are separate exports that
 * take the receiver as their first argument. `max` in `field.rate.max(0.12)` is the
 * same, and it is worth noticing that the two are not interchangeable — importing
 * both forms for one operation is how a chain silently becomes a call with the
 * wrong argument order, which is a class of bug this file has already produced
 * once.
 */
