import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  sin,
  smoothstep,
  varying,
  vec2,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';

/**
 * The Convergence Basin's sheets: the frame's layered surfaces.
 *
 * **What this is for.** The brief's core object is not a thing but a *place* — the
 * Convergence Basin — and it is defined by "layered surfaces, flow bundles,
 * volumetric density and internal glow". The flow bundles are the rivers and the
 * density is the fog; this material is the layers. Before it existed the basin was
 * a bare height-field depression, and the measured idle frame showed exactly that:
 * four sheets' worth of structure in the descriptor that nothing drew, so the
 * frame's subject was a dim hole between two bright rivers.
 *
 * **A membrane, not a plate.** The brief forbids "large transparent plates", and
 * the difference between the two is entirely in where the alpha is. A plate is
 * uniform: the same value everywhere, so the eye reads a rectangle of tint laid
 * over the world. This surface is *edge-weighted* — nearly all of its opacity is in
 * a narrow band at its rim, and its interior is a tenth of that, varying with a
 * slow noise. So what a viewer sees is a bright *line* around each level with a
 * faint body inside it, which is a film under tension rather than a pane of glass.
 *
 * **Why the colour ramps with height.** The sheets are ordered lowest to highest
 * and their hue runs from the palette's violet to its cyan across that order, so
 * the stack has a direction the eye can read without a legend: the deepest, oldest
 * layer is the coldest and most withdrawn, and the layer nearest the surface carries
 * the flow's own colour. That is the same statement the terrain's strata make in
 * height, made here in colour, and the two together are what makes the basin read
 * as *accumulating* rather than merely as depressed.
 *
 * **The one thing it must not do.** Outshout the flare on the basin's floor. The
 * brief's rejected frame was a blown-out white core, and a stack of four additive
 * films inside the same bowl is precisely how that happens a second time. So the
 * peak here is spent only on a rim, only on the beat, and only ever as a *tint*
 * toward white rather than a saturation of it.
 */

/**
 * How much of a sheet's opacity is its rim, and how much is its body.
 *
 * The ratio is what makes this a membrane. `RIM_ALPHA` is high because a layer's
 * edge is the whole of what a viewer at six hundred units can resolve — the band is
 * about a tenth of the radius, so at the vista it is a handful of pixels wide and
 * it has to be legible in those pixels. `FACE_ALPHA` is low because the interior of
 * a film is where a viewer looks *through* it, and a body as opaque as its edge is
 * a disc, which is the plate the brief rejects.
 */
const RIM_START = 0.85;
const RIM_ALPHA = 0.78;
const FACE_ALPHA = 0.1;

/** The body's own slow variation, so a film is not a flat tint. */
const FILM_SCALE = 0.012;
const FILM_RATE = 0.045;

/**
 * The beat the sheets run on, and how far apart in phase the stack is spread.
 *
 * `PHASE_SPREAD` of a full turn across the stack means the lowest sheet and the
 * highest are in antiphase, so the basin does not blink as one object: the levels
 * lift in sequence and settle in sequence, which reads as a system working through
 * its layers rather than as a lamp on a timer. It is the same event the terrain's
 * compression is drawing — both read `uFlowPhase` — so the sheets and the bowl they
 * sit in can never disagree about when the basin is compressing.
 */
const PULSE_RATE = Math.PI * 2 * 1.5;
const PHASE_SPREAD = Math.PI;

/** How much of the frame's white a rim may take at the top of the beat. */
const RIM_PEAK = 0.45;

/**
 * Where the sheets give up, and how much survives.
 *
 * Beyond the river's own fade, because the basin is the subject and the sheets are
 * the reason it is one: the far sheets are still structure at a distance where the
 * rivers have already become lines. The floor is high for the same reason — this
 * is the last thing in the frame that should ever dim to nothing.
 */
const FADE_NEAR = 1400;
const FADE_FAR = 2600;
const FADE_FLOOR = 0.45;

export type MembraneMaterial = {
  readonly material: MeshBasicNodeMaterial;
  dispose(): void;
};

export function createMembraneMaterial(uniforms: FieldUniforms): MembraneMaterial {
  const u = uniforms.uniforms;

  const material = new MeshBasicNodeMaterial();
  // The sheets carry only position and their two own attributes — see
  // `strataGeometry`. Stated rather than left to default because a node material
  // left alone will go looking for a `color` attribute that is not there.
  material.vertexColors = false;
  material.transparent = true;
  // Four nested films overlap in screen space wherever the camera is above them,
  // and they are drawn lowest-first, which is the correct order from any camera
  // above the basin. Depth *writing* would have the first sheet drawn punch a hole
  // in the second — a hard notch exactly where the stack is deepest, which is the
  // one place the composition can least afford one. Depth *testing* stays on, so
  // the bowl's own wall still occludes a sheet behind it.
  material.depthWrite = false;

  // --- Where this fragment is on its own sheet ---------------------------------
  //
  // The radius is carried per vertex because one mesh holds every sheet and the
  // fragment stage has no other way to know which one it is in. `positionLocal` is
  // world XZ — every mesh in this scene is mounted at the origin, unrotated and
  // unscaled — so the distance from the basin's centre divided by the sheet's own
  // radius is 0 at its middle and 1 at its edge.
  const sheetRadius = attribute('aSheetRadius', 'float');
  const sheetT = attribute('aSheetT', 'float');
  // `uBasinCentre` is a `Vector3` whose x and z are the centre's world XZ and whose
  // y is the floor's height; `groundField` reads the same two components for the
  // same purpose, and the two must agree about where the basin is.
  const radial = vec2(u.uBasinCentre.x, u.uBasinCentre.z)
    .sub(positionLocal.xz)
    .length()
    .div(sheetRadius.max(0.001));

  /*
   * The rim, and the body.
   *
   * `smoothstep(RIM_START, 1, radial)` is deliberately *not* clamped at the outer
   * side: the wavy rim in `strataGeometry` pushes a fraction of the vertices past
   * 1.0, and a rim that stopped rising at 1.0 would draw a hard outline *inside*
   * the wave, which is a circle again — the exact thing the wave exists to avoid.
   */
  const rim = smoothstep(float(RIM_START), float(1), radial);

  // The body falls away from the centre rather than rising to the rim, so the
  // middle of a level is where the film is thickest. It is the inverse of the rim
  // and never overlaps it, which is what keeps the two terms from summing into the
  // uniform opacity of a plate.
  const face = smoothstep(float(0.92), float(0.1), radial);

  const film = mx_fractal_noise_float(
    vec3(positionLocal.x, positionLocal.z, u.uFlowPhase.mul(FILM_RATE).add(sheetT)).mul(FILM_SCALE),
    2,
    2.0,
    0.5,
  )
    .mul(0.5)
    .add(0.5);

  /*
   * The beat. `sin(phase + sheetT * π)` is the stack's antiphase stagger, and it is
   * squared-then-floored the same way the terrain's compression is: a rim that
   * spent as long going out as coming in would read as a pulsing lamp, and a level
   * that holds its brightness and then lifts reads as a body of data settling.
   */
  const pulse = sin(u.uFlowPhase.mul(PULSE_RATE).add(sheetT.mul(PHASE_SPREAD)))
    .mul(0.5)
    .add(0.5)
    .pow(2)
    .mul(0.7)
    .add(0.3);

  // Violet at the bottom of the stack, the flow's own cyan at the top — see the
  // module note. The `0.9` keeps the lowest sheet from reaching the palette's
  // deepest violet exactly, so the stack's bottom is a dark blue rather than a
  // hole in the frame.
  const hue = mix(u.uDeep, u.uFlow, sheetT.mul(0.9).add(0.08));

  // The rim's one white, as a tint on the beat and never as a saturation.
  const peak = rim.mul(pulse).mul(u.uActivity.max(0.4)).mul(RIM_PEAK);
  const colour = mix(hue, u.uPeak, peak).mul(float(1).add(peak.mul(0.6)));

  material.colorNode = colour;

  // --- Opacity -----------------------------------------------------------------
  //
  // `uQuality` scales the whole film, so a degraded profile spends less of its
  // fill budget inside the basin. It is applied to the body only: the rim is the
  // sheet's identity, and a stack of levels whose edges had gone soft at MEDIUM
  // would be a different object rather than a cheaper one.
  const body = rim.mul(RIM_ALPHA).add(face.mul(film).mul(FACE_ALPHA).mul(u.uQuality));

  const distance = varying(positionLocal).sub(cameraPosition).length();
  const reach = mix(
    float(FADE_FLOOR),
    float(1),
    float(1).sub(smoothstep(FADE_NEAR, FADE_FAR, distance)),
  );

  // Gated on the activity like every other moving thing, so reduced motion leaves
  // the sheets present and still rather than deleting the basin's structure.
  material.opacityNode = body.mul(reach).mul(u.uActivity.max(0.35));

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}
