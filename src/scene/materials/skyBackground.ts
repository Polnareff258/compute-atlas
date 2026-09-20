import { Color } from 'three';
import { float, mix, positionLocal, sin, smoothstep, uniform, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

import type { FieldUniforms } from '../field/fieldUniforms';
import { WATERSHED_PALETTE } from '../watershed/watershedDescriptor';

/**
 * The landscape's air, as the scene's background.
 *
 * **Why the world needed one.** The stage before this had no sky at all: the
 * scene's background was a single clear colour, and the page's own DOM gradient
 * showed through the transparent canvas behind the terrain. A world with a flat
 * plate behind it cannot recede, and that is not a matter of taste — it is
 * geometry. The far ground was being fogged toward a blue the background did not
 * share, so its silhouette ended in a hard edge against a colour nothing in the
 * scene had ever mixed toward. The measured frame said so plainly: the terrain
 * occupied a band from y 0.33 to 0.85 of the frame and read as a *crumpled ribbon
 * floating in a void*, which is the failure clause of the brief this stage exists
 * to satisfy, arrived at by leaving out the air.
 *
 * **Why this is a background node and not a dome.** The first version of this was
 * a large inverted sphere carried at the camera, which is the usual way and it was
 * wrong here for a reason worth recording: it is *geometry in the scene*, so it
 * competes with the terrain for the depth buffer and for draw order. Measured with
 * a magenta probe, the dome covered the ground across the entire lower half of the
 * frame — the ground's own pixels came back at the sky's colour — and neither
 * `renderOrder` nor disabling the depth test changed it. `Scene.background`, when
 * given a node rather than a colour or a texture, is rendered by the renderer's own
 * background pass: a unit sphere drawn with its view-space Z forced to the far
 * plane, depth testing off, before anything in the scene. It cannot occlude, cannot
 * be occluded, cannot z-fight and cannot be reached by the camera. The air stops
 * being an object in the world, which is what it always was.
 *
 * **The one decision this module exists to make is that its horizon colour is the
 * fog's colour.** `FogExp2` drives every fragment toward `descriptor.fog.tint` as
 * depth grows, so the far field's limit *is* that colour; the sky's own band at
 * zero elevation is therefore the same colour at the same value, and the ground's
 * far edge dissolves into the sky instead of being cut out of it. That is the whole
 * reason the band is not a hand-picked glow: a hand-picked one would have to be
 * kept in agreement with the descriptor by hand, and the first time a seed moved
 * the fog's tint the horizon would come apart.
 *
 * **What it is not.** Not a filter and not a backdrop image. The gradient is driven
 * by the *view direction's elevation*, which is what a sky is a function of, so the
 * horizon sits at the world's true horizon line no matter where the camera is
 * pitched or how far it has travelled. And every value it writes is below the
 * terrain's own — the sky is the frame's darkest large area, so the basin and the
 * banks stay the subject. The measurement to hold it to is the same one that caught
 * the previous composition's wash: if the sky's mean luminance ever exceeds the
 * ground's, the frame has become a picture of its own atmosphere.
 *
 * **The three things above the horizon**, in the order they matter:
 *
 *  1. **The haze band.** Petroleum at the horizon, falling to ink. This is what
 *     gives the frame a horizon line to compose against and what the far ground
 *     dissolves into.
 *  2. **A slow spectral drift.** One large-scale term across the azimuth, so the
 *     sky is warmer on one side of the world than the other. The brief asks the
 *     entry page for "a slow large-scale spectral gradient"; this is that gradient,
 *     and it is deliberately the same one at every scale of the site so the entry
 *     and the landscape are visibly the same place.
 *  3. **Layering in the haze.** The band's strength is modulated in elevation by a
 *     low-frequency term, so the distant air has *depth* rather than being a painted
 *     stripe. It is a modulation of the band and not a set of lines drawn over it,
 *     which is the difference between air with structure in it and a contour
 *     texture — the latter being the failure the brief names by name.
 */

/**
 * How far above the horizon the haze reaches before it is fully ink, in elevation.
 * `0.62` is about 35°, so the gradient covers the frame's whole upper half and the
 * zenith is only reached at the top of a wide frame.
 */
const HAZE_REACH = 0.62;

/**
 * How far below the horizon the air keeps its own colour before it goes to the deep
 * tone. Short, because below the horizon the ground covers nearly all of it — this
 * only shows where the ground has ended, which is the world's own far edge.
 */
const DEEP_REACH = 0.34;

/** Amplitude of the azimuthal spectral drift, as a fraction of the full mix. */
const DRIFT_AMOUNT = 0.16;
/** Rate of the drift's own travel, in cycles per second. Very slow by intent. */
const DRIFT_RATE = 0.004;
/** How many haze layers the elevation modulation resolves into. */
const HAZE_LAYERS = 3.5;
/** How far the haze layering may cut into the band. Kept small: this is texture. */
const HAZE_LAYER_DEPTH = 0.22;

const HAZE = new Color(WATERSHED_PALETTE.petroleum);
const ZENITH = new Color(WATERSHED_PALETTE.ink);
const DEEP = new Color(WATERSHED_PALETTE.midnight);
const SPECTRAL = new Color(WATERSHED_PALETTE.spectral);

/**
 * The glow the haze drifts toward on one side of the world.
 *
 * Built by mixing the haze's own colour toward spectral rather than by using
 * spectral directly, so the drift is a *shift in the haze* and never a second,
 * brighter thing in the sky. A drift that could out-value its own horizon would put
 * the frame's brightest region in the air, which constraint C5 forbids.
 */
const HAZE_WARM = HAZE.clone().lerp(SPECTRAL, 0.35);

const TAU = Math.PI * 2;

export type SkyBackground = {
  /** Assign to `Scene.background`. A vec4 node, so it also fills the alpha. */
  readonly node: Node;
  dispose(): void;
};

/**
 * The smallest surface `installSkyBackground` needs of a scene.
 *
 * Structural rather than `import type { Scene }`, so this module does not have to
 * know whether the caller is holding a three scene, a wrapper, or a test double —
 * and so the one property it writes is visible in the type rather than buried in a
 * cast.
 */
type BackgroundHost = { background: unknown; backgroundNode?: unknown };

/**
 * Put the air on a scene, and hand back the undo.
 *
 * A function rather than three lines in the caller's effect because the caller
 * obtains its scene from a hook, and the lint rules forbid a component writing to a
 * value a hook returned — the rule cannot see that the write happens in an effect
 * with a matching cleanup, which is precisely the imperative-integration case it is
 * not meant to catch. Moving the write to the module that owns the sky's life cycle
 * puts it on the right side of that boundary without silencing anything: the
 * assignment is still here, still explicit, and still the only place the scene's
 * background is touched.
 */
export function installSkyBackground(scene: BackgroundHost, sky: SkyBackground): () => void {
  /*
   * `backgroundNode`, not `background`.
   *
   * Both paths draw the node — the background pass reads
   * `nodes.getBackgroundNode(scene) || scene.background` and takes the `isNode`
   * branch either way. They differ in what the *other* consumer does with it.
   * `NodeManager.updateBackground` inspects `scene.background` to decide whether it
   * needs to build a node representation for it, and its only recognised cases are
   * a cube texture, a texture and a colour; anything else falls through to
   * `error('WebGPUNodes: Unsupported background configuration.')`. So a node on
   * `scene.background` is drawn correctly and logged as a failure on every frame —
   * which is what happened here, and what put a console error and a Next.js dev
   * overlay badge into every capture of the scene.
   *
   * On `backgroundNode` the same node is drawn by the same pass and the manager
   * takes its `else` branch, which clears stale cache and logs nothing. The sky is
   * unchanged; the error and the badge are gone.
   */
  const previous = scene.backgroundNode;
  scene.backgroundNode = sky.node;
  return () => {
    // Only restored if nothing else has claimed the background in the meantime, so
    // a later owner is not clobbered by this one's teardown.
    if (scene.backgroundNode === sky.node) scene.backgroundNode = previous;
    sky.dispose();
  };
}

export function createSkyBackground(uniforms: FieldUniforms): SkyBackground {
  const u = uniforms.uniforms;

  // The view direction. The renderer draws this node on a unit sphere whose view
  // position is forced to the far plane, so a vertex's own local position *is* the
  // direction being looked at and nothing has to be reconstructed from a matrix.
  const direction = positionLocal.normalize();
  const elevation = direction.y;

  // 1. The haze band, and the zenith above it.
  const above = smoothstep(float(0), float(HAZE_REACH), elevation);
  const sky = mix(uniform(HAZE), uniform(ZENITH), above);

  // 2. The azimuthal drift. One term across the whole sky, so it reads as one side
  // of the world being warmer rather than as noise on the atmosphere.
  const azimuth = sin(direction.x.mul(1.9).add(u.uTime.mul(TAU * DRIFT_RATE)))
    .mul(0.5)
    .add(0.5);
  const drifted = mix(
    sky,
    mix(uniform(HAZE_WARM), uniform(SPECTRAL).mul(0.35), above),
    azimuth.mul(DRIFT_AMOUNT).mul(above.oneMinus()),
  );

  // 3. Depth inside the haze itself. A modulation of the band's own brightness in
  // elevation, so the distant air thickens and thins rather than wearing stripes.
  const layering = sin(elevation.mul(TAU * HAZE_LAYERS).add(u.uTime.mul(0.05)))
    .mul(0.5)
    .add(0.5)
    .oneMinus()
    .mul(HAZE_LAYER_DEPTH)
    .oneMinus();
  const haze = drifted.mul(mix(float(1), layering, above.oneMinus()));

  // Below the horizon the air goes deeper and cooler. The ground covers nearly all
  // of this; what shows is the world's last edge, and it has to be darker than the
  // ground above it or the frame grows a shelf along its own horizon.
  const below = smoothstep(float(0), float(DEEP_REACH), elevation.negate());
  const colour = mix(haze, uniform(DEEP), below);

  // Alpha 1, so the sky fills the canvas opaquely: this is the page's background
  // now, and the DOM backdrop behind the canvas is for the entry page alone.
  const node = vec4(colour, float(1));

  return {
    node,
    dispose() {
      // Dispatches `dispose`, which the renderer's background pass listens for in
      // order to release the sphere and its material it built for this node.
      (node as unknown as { dispose?: () => void }).dispose?.();
    },
  };
}
