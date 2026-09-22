import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  exp,
  float,
  Fn,
  mix,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

import type { InkTargetFormat } from '../../renderer/capability';
import { BRUSH_SHAPE } from './brushProfile';
import type { InkDensity } from './inkDensity';

/**
 * The Advected Ink-Density River Field: the GPU field every surface in the
 * composition reads.
 *
 * ## What it is
 *
 * A density field that lives in a render target, is carried downstream by the
 * world's own velocity field once per frame, is continuously re-seeded from the
 * river the descriptor authored, and can be struck by the pointer. Every material
 * in the frame samples it: the displacement of the surface, its opacity, its
 * normal perturbation and its emitted intensity are four readings of one number,
 * which is what makes the composition read as one phenomenon rather than as four
 * effects stacked in the same frame.
 *
 * ## Why a render-target simulation rather than a compute kernel
 *
 * The brief asks for advection, local pressure and deposition to happen on the
 * GPU, and allows WebGL2 to answer with the same picture at a lower simulation
 * resolution. This is that design, chosen knowingly over a WebGPU compute kernel:
 *
 * - **One shader graph on both backends.** This codebase has already paid for the
 *   opposite and recorded the receipt. The node-material mid-tone divergence
 *   between WebGPU and WebGL2 was closed not by tuning numbers but by making both
 *   paths construct the same `WebGPURenderer`, so there is one graph rather than
 *   two. Compute does not lower to WebGL2 at all, so a compute route would make
 *   the fallback a *different algorithm* — and two algorithms produce two pictures
 *   that cannot be compared, which is the whole point of having a fallback.
 * - **The simulation is genuinely on the GPU either way.** Semi-Lagrangian
 *   advection, lateral diffusion, deposition, decay and the pointer's pressure
 *   response are all evaluated per texel in a fragment stage.
 * - **What it costs is stated rather than hidden.** ULTRA simulates at 512 texels
 *   across the world's long axis, the lower tiers at 384 / 256 / 192. That is a
 *   resolution ladder; the advection step, the seeding, the pointer response and
 *   the decay rates are the same code and the same numbers at every tier.
 *
 * ## The graph is built once, and that decides the ping-pong
 *
 * A TSL node graph is constructed when its `Fn` is first evaluated, and a
 * `texture(renderTarget.texture, uv)` node captures the target it was built
 * against. Swapping two JavaScript variables after the fact therefore does not
 * rewire anything: the shader keeps sampling the texture it was compiled with, and
 * the failure is a simulation that appears to run and never advances. So there is
 * no swap here. One target is *read* by every pass for the lifetime of the field;
 * the advection renders into a second; and a copy pass moves the result back.
 *
 * That is one more fullscreen pass per frame — 262,144 fragments at ULTRA — and it
 * buys a graph that is static, a program that is compiled once, and a field whose
 * behaviour does not depend on the order two assignments happened in.
 *
 * ## The four channels
 *
 * - **R `body`** — the advected density. The hero silhouette.
 * - **G `scour`** — cut. Carried and only slowly re-seeded, so a channel that was
 *   cut stays cut for a while after the flow moves off it.
 * - **B `settle`** — deposition. Same, from the other side: silt arrives late and
 *   leaves late, which is what makes it read as material rather than as a highlight.
 * - **A `pressure`** — the pointer's own channel, and the reason a drag reads as a
 *   *compression* rather than as a smudge. Pressure is injected by the brush,
 *   spreads laterally hard, decays fast, and sharpens the surface where it is high
 *   — so the front of a drag is the one crisp thing in the frame, which is the 10%
 *   the brief reserves for narrative sharpness.
 *
 * ## Time
 *
 * The field advances on its own clock while the page is moving, and holds entirely under
 * reduced motion.
 * That is a deliberate reading of the requirement rather than an exception to it.
 * Reduced motion is a promise that the *page* stops moving, and a still river is a
 * photograph of a river rather than a river at rest. The compromise is that the
 * field keeps drifting at a rate slow enough that no frame-to-frame difference is
 * legible, while everything the visitor causes — the camera, the transitions, the
 * drag response — stops. The capture harness measures both states rather than
 * asserting them.
 */

/** The minimum a renderer has to do for the field to advance. */
export type InkFieldRenderer = {
  setRenderTarget(target: unknown): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
};

export type InkQuality = {
  /** Texels across the world's long axis in the simulation. */
  readonly simulationResolution: number;
  /**
   * The lateral-spreading multiplier.
   *
   * A ratio rather than a raw tap count, so the shader's own spreads stay readable
   * numbers. Deliberately gentle: SAFE gets `0.5` of the spreading and ULTRA gets
   * `1`, because a fallback whose pigment spreads visibly less would read as a
   * *sharper* picture, which is the opposite of what a lower tier should look like.
   */
  readonly diffusionScale: number;
  /** Whether the field carries eroded and deposited material between frames. */
  readonly carryErosion: boolean;
};

export const INK_QUALITY: Readonly<
  Record<'ultra' | 'high' | 'medium' | 'safe', InkQuality>
> = {
  ultra: { simulationResolution: 1024, diffusionScale: 1, carryErosion: true },
  high: { simulationResolution: 640, diffusionScale: 1, carryErosion: true },
  medium: { simulationResolution: 256, diffusionScale: 0.8, carryErosion: true },
  safe: { simulationResolution: 192, diffusionScale: 0.5, carryErosion: false },
};

/**
 * How much simulated time the field is advanced through before its first
 * displayed frame, and how big each of those steps is.
 *
 * ## The defect this closes
 *
 * The seed pass writes the authored bake into the simulation target — *writes*
 * it, as the texture it is. Everything that makes the field a field rather than
 * a texture happens on the steps after that: the semi-Lagrangian backtrace
 * displaces the pigment along the world's own flow, the five-tap cross diffuses
 * it, and the decay pulls it toward the river the descriptor authored. One seed
 * pass produces the raw bake, and the raw bake has edges — the region membranes
 * the density terms are built from and the polygon boundaries where one region's
 * influence stops — that the simulation is what softens.
 *
 * That was survivable while the field was always running: a frame taken at any
 * moment after the first few seconds showed the settled field, and the raw seed
 * existed for one frame. It stopped being survivable when reduced motion arrived,
 * because a frozen field *is* the first frame for ever. `SceneHost` passes a zero
 * ambient delta, the advection step's `dt` becomes zero, and every term in the
 * shader degenerates to an identity read: the diffusion mix weight is
 * `diffusion · dt = 0`, so nothing spreads; the decay factor is `exp(0) = 1`, so
 * nothing is pulled anywhere; and the backtrace offset is zero, so nothing moves.
 * The preference therefore did not freeze the composition at a stable point, it
 * froze the *seed* — the one state in the field's whole life that is a texture
 * rather than a photograph of water, with the bake's own hard edges still in it.
 *
 * ## Why this is a pre-computation and not a longer fade
 *
 * The honest repair is to land on the state the field actually settles into,
 * which is the fixed point of the integrator under a frozen clock — the same
 * numbers the frozen frame will keep evaluating, run forward until they stop
 * changing. So the steps below use the field's *own* pass, its own decay rates
 * and its own velocity field, with the autonomous clock held at zero, which is
 * exactly what the reduced-motion frame inherits afterwards. Nothing is
 * recoloured and no rate is retuned; what changes is when the first frame is
 * taken.
 *
 * ## The two figures
 *
 * `INK_SETTLE_SECONDS` is chosen against the decay, which is the slowest thing
 * in the system: the body channel's rate is `BODY_DECAY` per second, so the
 * field forgets where it started with a time constant of about 3.3 seconds and
 * eight seconds is roughly two and a half of them. That leaves the seed's own
 * contribution down in the low single-digit percent, which is below what a
 * capture can see, while keeping the transport to something the flow field can
 * carry coherently.
 *
 * `INK_SETTLE_STEP_SECONDS` is the largest step the shader's own clamp admits.
 * Larger steps mean fewer of them, and the per-step cost is a fullscreen pass at
 * the tier's simulation resolution, so this is the figure that decides what the
 * pre-computation costs: at ULTRA that is 160 steps and 320 passes over a
 * 1024-wide target, paid once per load, before the first frame. Going beyond the
 * clamp would be a change to the simulation's stability envelope rather than to
 * its schedule, and the sweep's explicit diffusion is only conditionally stable —
 * a step the shader clamps anyway buys nothing but a lie about what was run.
 *
 * The same figures serve every tier, which is what keeps a tier a resolution
 * ladder rather than a different physics: SAFE settles through the same 160
 * steps of the same simulated time and simply pays a twentieth of the pixels for
 * them.
 */
export const INK_SETTLE_SECONDS = 8;
export const INK_SETTLE_STEP_SECONDS = 1 / 20;

export type InkSettlementPlan = {
  /** Fullscreen simulation steps run before the first displayed frame. */
  readonly steps: number;
  /** Seconds of simulated time each of them advances. */
  readonly stepSeconds: number;
  /** Total simulated seconds, so a caller can state the cost without arithmetic. */
  readonly seconds: number;
};

/**
 * The settlement schedule, as a value rather than as a loop bound.
 *
 * Pure and exported so that "how much simulated time does a load pay for" is
 * assertable without a GPU, and so the frame-loop call site cannot quietly
 * invent its own step size.
 */
export function planInkSettlement(): InkSettlementPlan {
  const stepSeconds = INK_SETTLE_STEP_SECONDS;
  const steps = Math.max(1, Math.round(INK_SETTLE_SECONDS / stepSeconds));
  return { steps, stepSeconds, seconds: steps * stepSeconds };
}

/**
 * How fast the field is carried, in world units per second, at full river rate.
 *
 * The number the idle frame's whole *pace* hangs on, so it is worth being exact
 * about what it is not. It is not a physical velocity: the world is two thousand
 * units across and a real river would cross it in minutes. It is the speed at
 * which the pigment drifts, chosen so a feature takes eight to twelve seconds to
 * travel the visible course — slow enough to read as a deposit settling rather
 * than as a scrolling texture, fast enough that two captures four seconds apart
 * are visibly not the same frame.
 */
const ADVECTION_SPEED = 46;

/**
 * Per-second decay of the advected channels, toward the authored river.
 *
 * A *pull toward the base* rather than a fade to zero, and the distinction is the
 * difference between a system and a leak. A field that decayed toward nothing would
 * eventually lose the river — the composition's whole subject — and an idle page
 * left open overnight would come back to a black screen. Decaying toward the
 * descriptor's own river gives the field a home to return to, and makes everything
 * the visitor does a temporary departure from it. It is also what turns the brief's
 * "returns to idle after a few seconds" into a property of the system rather than a
 * timer somebody has to remember to run.
 */
const BODY_DECAY = 0.30;
const EROSION_DECAY = 0.16;

/**
 * The pressure channel's decay, and it is much the fastest of the four.
 *
 * Pressure is the *event* rather than the material: it is what the pointer drove,
 * and it should be gone in about a second and a half while the ink it pushed is
 * still visibly spreading. Tying it to the same rate would make a drag's sharp
 * front and its soft wake disappear together, which reads as a sticker being
 * removed rather than as water closing.
 */
const PRESSURE_DECAY = 1.45;

/** How hard pressure spreads laterally per second. This is the drag's soft boundary. */
const PRESSURE_DIFFUSION = 5.2;
/** How hard the density spreads. Much lower: ink keeps its shape. */
const BODY_DIFFUSION = 3.2;

/**
 * The brush's imprint shape: how long the ridge is along the drag relative to its
 * radius, and how wide across it.
 *
 * These two numbers are the difference between a brush that reads as a *shove* and
 * one that reads as a decal. The ridge is deliberately much wider than it is deep:
 * a disturbance as deep as it is wide is a circle, and a circle is the one shape
 * the brief names as forbidden. Because the ridge is then advected, the river's own
 * curvature bows it — which is where the arc in "arc compression front" actually
 * comes from, rather than from anything bending it at injection time.
 */
/*
 * The brush injection rates, per second.
 *
 * Chosen from the steady state each channel reaches under a sustained drag, which is
 * `rate / decayRate`: pressure settles near 0.9, body near 0.8, and the erosion channels near
 * 0.3, all inside the range the shader and the material were written against. Stating them as
 * rates is what makes those steady states true at any frame rate; the per-frame form they
 * replace had a steady state sixty times larger at sixty hertz.
 */
const BODY_INJECT_RATE = 0.24;
const EROSION_INJECT_RATE = 0.05;
const SETTLE_INJECT_RATE = 0.04;
const PRESSURE_INJECT_RATE = 4.8;

/**
 * The ceilings the simulated channels may reach.
 *
 * Above the authored maximum, so they bound the visitor contribution rather than the world. The
 * body channel is capped at one because it is a density the material reads as a `0..1` ramp;
 * the erosion channels are capped above the bake deposits stack them (1.6); and pressure is
 * capped at one because it is spent as a multiplier on vertex displacement.
 */
const CHANNEL_MAX_BODY = 1.2;
const CHANNEL_MAX_EROSION = 1.8;
const CHANNEL_MAX_PRESSURE = 1;

export type InkBrush = {
  /** World XZ of the pointer. */
  readonly x: number;
  readonly z: number;
  /** Direction of the drag in world XZ. Normalised here, not by the caller. */
  readonly dirX: number;
  readonly dirZ: number;
  /** `0`..`1`. How hard the pointer is pressing, from its speed. */
  readonly speed: number;
};

export type InkFieldOptions = {
  readonly density: InkDensity;
  readonly quality: InkQuality;
  /** World units the brush's imprint reaches. */
  readonly brushRadius: number;
  /**
   * What the two simulation targets are allocated in.
   *
   * Decided by the capability probe, not here, because whether an `RGBA16F`
   * framebuffer is renderable is a property of the context — see
   * `probeHalfFloatRenderTarget`. Defaults to half float, which is what WebGPU
   * always gives and what every WebGL2 context in the capture matrix gave.
   */
  readonly targetFormat?: InkTargetFormat;
};

export type InkField = {
  /**
   * The advected field's texture, for any material to sample.
   *
   * A texture rather than a ready-made node, and that is a correction worth
   * recording: the first version of this handed back `texture(read.texture, uv())`
   * and every consumer then wrapped it in `texture()` again, which is a texture
   * node passed as a texture's *value*. It happened to not throw and it sampled
   * nothing. Handing back the texture puts the one `texture(textureObject, uvNode)`
   * call where the uv is known — in the consumer, which is the only place it is.
   */
  readonly sampleTexture: THREE.Texture;
  /** The static authored field: body, scour, settle, along. */
  readonly baseTexture: THREE.Texture;
  /** The velocity field: tangent x, tangent z, speed, seed. */
  readonly fluvialTexture: THREE.Texture;
  /** The world rectangle the field covers, for world-XZ to UV conversion. */
  readonly extent: InkDensity['extent'];
  /** What the simulation targets are allocated in. A readout, not a knob. */
  readonly targetFormat: InkTargetFormat;
  /** Advances one frame. Called from the frame loop, never from React. */
  step(
    renderer: InkFieldRenderer,
    ambientDeltaSeconds: number,
    elapsedSeconds: number,
    interactionDeltaSeconds?: number,
  ): void;
  /** Arms the brush. `null` releases it, which starts its own decay. */
  setBrush(brush: InkBrush | null): void;
  dispose(): void;
};

export function createInkField(options: InkFieldOptions): InkField {
  const { density } = options;
  const spanX = density.extent.maxX - density.extent.minX;
  const spanZ = density.extent.maxZ - density.extent.minZ;

  // --- The input textures ------------------------------------------------------
  //
  // `FloatType`, not `UnsignedByteType`, and the reason is banding rather than
  // precision in the abstract. The density's own gradient can span a thousand
  // screen pixels in the hero frame; stored in eight bits that is one visible step
  // every four pixels, and a four-pixel contour through a soft pigment field is the
  // single most obvious way a render stops looking photographic. The cost is four
  // bytes per texel on textures that are uploaded once.
  const makeInputTexture = (data: Float32Array) => {
    const target = new THREE.DataTexture(
      data,
      density.width,
      density.height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    target.minFilter = THREE.LinearFilter;
    target.magFilter = THREE.LinearFilter;
    target.wrapS = THREE.ClampToEdgeWrapping;
    target.wrapT = THREE.ClampToEdgeWrapping;
    target.colorSpace = THREE.NoColorSpace;
    target.needsUpdate = true;
    return target;
  };
  const baseTextureSource = makeInputTexture(density.data);
  const fluvialTextureSource = makeInputTexture(density.fluvial);

  // --- The two simulation targets ---------------------------------------------
  //
  // `read` is the field's published state and the *only* target any shader
  // samples. `write` is where the advection lands before the copy pass moves it
  // back. See the module note for why there is no swap.
  // `const`, because the field is immutable per tier: a quality change reconstructs
  // the whole field rather than resizing this one. See the module note.
  const quality = options.quality;
  const targetFormat: InkTargetFormat = options.targetFormat ?? 'rgba16f';
  const makeTarget = (width: number, height: number) => {
    const target = new THREE.RenderTarget(width, height, {
      // Half float rather than full by default: `RGBA32F` is renderable only with
      // `EXT_color_buffer_float`, whereas half float is renderable far more widely,
      // and three decimal digits against a `0`..`1` field is a thousand times the
      // resolution the decay rates above can express.
      //
      // `rgba8` is the fallback the capability probe sends here when the context
      // could not give a complete `RGBA16F` framebuffer, and it is chosen over
      // the alternative of not simulating at all because the pressure channel is
      // the *drag*, and a fallback that loses the page's only input is a worse
      // picture than one with a coarser one. What it costs is stated rather than
      // hidden: eight bits per channel, linear filtering, and a hard clamp at 1
      // where the half-float target's channel ceilings run to 1.2 and 1.8 — so
      // the eroded and deposited channels lose their overshoot and the field
      // bands where the half-float one would not. It is still a rendered,
      // diffusing, advecting field, which is the point: a target the context
      // cannot produce would draw nothing at all, and nothing at all is
      // indistinguishable from a broken page.
      type:
        targetFormat === 'rgba8' ? THREE.UnsignedByteType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    return target;
  };

  let simWidth = 0;
  let simHeight = 0;
  let read!: THREE.RenderTarget;
  let write!: THREE.RenderTarget;

  const uniforms = {
    uTime: uniform(0),
    uDelta: uniform(1 / 60),
    uInteractionDelta: uniform(1 / 60),
    uSpanX: uniform(spanX),
    uSpanZ: uniform(spanZ),
    uMinX: uniform(density.extent.minX),
    uMinZ: uniform(density.extent.minZ),
    /** One simulation texel in UV. A uniform, because the resolution can change. */
    uTexel: uniform(new THREE.Vector2(1 / 512, 1 / 512)),
    uDiffusion: uniform(quality.diffusionScale),
    uErosion: uniform(quality.carryErosion ? 1 : 0),
    uBrushPos: uniform(new THREE.Vector2(0, 0)),
    uBrushDir: uniform(new THREE.Vector2(1, 0)),
    /** (strength, speed, radius, unused) */
    uBrushParams: uniform(new THREE.Vector4(0, 0, options.brushRadius, 0)),
  };

  /**
   * Allocates the two targets at a tier's resolution.
   *
   * Called once, before the shader graph is built — and never again, because the
   * graph names the targets it was built against and cannot be re-pointed. A
   * quality change reconstructs the whole field instead; see the module note.
   */
  function allocate(settings: InkQuality): void {
    simWidth = Math.max(8, Math.round(settings.simulationResolution));
    simHeight = Math.max(
      8,
      Math.round((settings.simulationResolution * spanZ) / Math.max(1e-3, spanX)),
    );
    read = makeTarget(simWidth, simHeight);
    write = makeTarget(simWidth, simHeight);
    uniforms.uTexel.value.set(1 / simWidth, 1 / simHeight);
    uniforms.uDiffusion.value = settings.diffusionScale;
    uniforms.uErosion.value = settings.carryErosion ? 1 : 0;
  }

  allocate(quality);

  // --- The passes ---------------------------------------------------------------
  //
  // Three node materials. A uniform-conditional branch inside a single material
  // would evaluate every half of the program on every texel to save a draw call,
  // and the seeding pass and the advection pass are genuinely different programs.
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geometry, undefined);
  quad.frustumCulled = false;
  scene.add(quad);

  const configure = (material: MeshBasicNodeMaterial) => {
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;
    // Stated rather than defaulted. These passes must *replace* their target; a blending mode
    // would mix the new state with the old, and the simulation would accumulate a blend of its
    // own history rather than holding its state.
    material.blending = THREE.NoBlending;
    return material;
  };

  let seedMaterial!: MeshBasicNodeMaterial;
  let advectMaterial!: MeshBasicNodeMaterial;
  let copyMaterial!: MeshBasicNodeMaterial;

  /**
   * Builds the three passes against the targets that currently exist.
   *
   * **Why this cannot be a rebind, and therefore why the field is immutable per
   * tier.** A `texture(renderTarget.texture, uv)` node captures the target it was
   * constructed against, and the compiled program is cached. Mutating a JavaScript
   * binding afterwards does not rewire anything: the shader keeps sampling the
   * texture it was compiled with, so the visible failure is a simulation that
   * appears to run and never advances. The first version of this field tried to
   * handle a quality change by resizing its targets in place and rebuilding here,
   * which worked but left every consumer's material holding a graph that named a
   * disposed target — the scene host had to know to rebuild them, and that is a
   * requirement one refactor away from being forgotten. Reconstructing the field is
   * the same work with none of the coupling.
   *
   * The cost is a shader compile, so this runs at construction and never inside the
   * frame loop.
   */
  function buildMaterials(): void {
    seedMaterial?.dispose();
    advectMaterial?.dispose();
    copyMaterial?.dispose();

    // Seeded state is the authored field with a dead pressure channel. Pressure is
    // the visitor's; a world that started with pressure already in it would show the
    // aftermath of an event nobody caused.
    seedMaterial = configure(new MeshBasicNodeMaterial());
    // `outputNode`, not `colorNode`: an opaque material forces the fragment alpha to one, so a
    // vec4 written through `colorNode` loses its fourth component entirely. See the module
    // note - this is the defect that saturated the pressure channel on every frame.
    seedMaterial.outputNode = Fn(() => {
      const authored = texture(baseTextureSource, uv());
      return vec4(authored.x, authored.y, authored.z, float(0));
    })();

    advectMaterial = configure(new MeshBasicNodeMaterial());
    advectMaterial.outputNode = Fn(() => {
      const coord = uv();

      // --- Velocity -----------------------------------------------------------
      //
      // Read from the fluvial texture rather than reconstructed from the density's
      // own gradient. That tangent is the descriptor's spine direction at the
      // texel's nearest river point, written down at bake time, so it is continuous
      // everywhere the body is — and the body is what gates the speed, so the field
      // is smooth exactly where it is fast.
      const fluvial = texture(fluvialTextureSource, coord);
      const tangent = fluvial.xy;

      /*
       * The slow oscillation.
       *
       * Phased on the field's own longitudinal coordinate so the river does not
       * breathe in lockstep along its length: a river that pulsed everywhere at once
       * would read as an animated texture, and the point of the drifting term is that
       * the meander's motion *travels*.
       */
      const alongPhase = coord.y.mul(6.283).add(uniforms.uTime.mul(0.21));
      const swell = alongPhase.sin().mul(0.24).add(1);
      const lateral = alongPhase.mul(1.7).add(float(1.9)).sin().mul(0.24);

      /*
       * A cross-channel component, which is what stops the advection being a pure
       * translation. Flow in a bend is helical — the surface water crosses toward the
       * outside and the bed water toward the inside — so pigment carried on the
       * surface shears across the channel as it travels. Without this term the field
       * only ever smears lengthwise and every feature keeps its lateral position
       * forever, which reads as a conveyor belt rather than as a river.
       */
      const normal = vec2(tangent.y.negate(), tangent.x);
      const carried_speed = fluvial.z.mul(ADVECTION_SPEED);
      const velocity = tangent
        .mul(carried_speed)
        .mul(swell)
        .add(normal.mul(lateral.mul(carried_speed)));

      /*
       * Semi-Lagrangian backtrace: the value that will *arrive* here is the value
       * that is currently one step upstream. Divided by the span so a world-space
       * velocity becomes UV per second, which keeps `ADVECTION_SPEED` a number in
       * world units at every extent and every simulation resolution.
       */
      const dt = uniforms.uDelta;
      const interactionDt = uniforms.uInteractionDelta;
      const back = vec2(
        velocity.x.mul(dt).div(uniforms.uSpanX),
        velocity.y.mul(dt).div(uniforms.uSpanZ),
      );
      const upstream = coord.sub(back);

      const carried = texture(read.texture, upstream);

      // --- Seeding ------------------------------------------------------------
      //
      // The authored river, re-injected every frame. This is what gives the
      // simulation a home: advection can smear the field downstream indefinitely and
      // the seed pulls it back toward the course the descriptor authored. Without it
      // the river migrates off the terrain it cut, which is the one thing a meander
      // does not do on a human timescale and the one thing a pure advection pass does
      // immediately.
      const authored = texture(baseTextureSource, coord);

      // --- The brush ----------------------------------------------------------
      //
      // One imprint, evaluated every frame the brush is armed; the trail comes from
      // the simulation rather than from a list of stamps. Ink injected at the
      // pointer's position last frame has since been carried downstream, so a fast
      // drag leaves a continuous wake *because* it moved, not because anything
      // recorded where it had been. That is the difference between this and a decal
      // trail, and it is visible in the result: the wake follows the river's bend,
      // not the pointer's path.
      const worldX = coord.x.mul(uniforms.uSpanX).add(uniforms.uMinX);
      const worldZ = coord.y.mul(uniforms.uSpanZ).add(uniforms.uMinZ);
      const offset = vec2(worldX, worldZ).sub(uniforms.uBrushPos);
      // Decomposed in the *drag's* frame: `depth` runs along the push and `breadth`
      // across it, so the imprint is a ridge perpendicular to the drag and wide along
      // it — a crescent being shoved into the water rather than a dot.
      const depth = offset.x.mul(uniforms.uBrushDir.x).add(offset.y.mul(uniforms.uBrushDir.y));
      const breadth = offset.x
        .mul(uniforms.uBrushDir.y)
        .negate()
        .add(offset.y.mul(uniforms.uBrushDir.x));
      const radius = uniforms.uBrushParams.z.max(float(1));
      const normalisedBreadth = breadth.div(radius);
      // Bow the stamp in the drag frame. A pure separable Gaussian is an ellipse,
      // and an ellipse viewed at grazing angle becomes the black capsule that made
      // the interaction read as a cursor decal. This quadratic offset turns the
      // same continuous pressure into an open, direction-bearing crescent.
      const bowedDepth = depth
        .add(normalisedBreadth.pow(2).mul(radius).mul(BRUSH_SHAPE.bow))
        .sub(normalisedBreadth.mul(radius).mul(BRUSH_SHAPE.skew));
      const depthTerm = bowedDepth.div(radius.mul(BRUSH_SHAPE.depth)).pow(2).negate();
      const breadthTerm = normalisedBreadth.div(BRUSH_SHAPE.breadth).pow(2).negate();
      const ridge = exp(depthTerm.add(breadthTerm)).mul(
        normalisedBreadth.mul(0.18).add(0.92).clamp(0.68, 1),
      );
      const brush = ridge.mul(uniforms.uBrushParams.x);

      // --- Diffusion -----------------------------------------------------------
      //
      // A five-tap cross at one simulation texel. The field is isotropic and the tap
      // spacing is a texel, so a cross is a genuine Laplacian and its repeated
      // application is a real second-order diffusion. Pressure spreads much harder
      // than the body — see `PRESSURE_DIFFUSION` — which is what gives a drag its soft
      // boundary while the ink under it keeps a shape.
      const texelStep = uniforms.uTexel;
      const up = texture(read.texture, upstream.add(vec2(0, texelStep.y)));
      const down = texture(read.texture, upstream.sub(vec2(0, texelStep.y)));
      const left = texture(read.texture, upstream.sub(vec2(texelStep.x, 0)));
      const right = texture(read.texture, upstream.add(vec2(texelStep.x, 0)));
      const neighbourAverage = up.add(down).add(left).add(right).mul(0.25);

      const spread = uniforms.uDiffusion.mul(dt).min(1);
      const bodySpread = mix(carried.x, neighbourAverage.x, spread.mul(BODY_DIFFUSION).min(1));
      const scourSpread = mix(carried.y, neighbourAverage.y, spread.mul(BODY_DIFFUSION).min(1));
      const settleSpread = mix(carried.z, neighbourAverage.z, spread.mul(BODY_DIFFUSION).min(1));
      const pressureSpread = mix(
        carried.w,
        neighbourAverage.w,
        uniforms.uDiffusion
          .mul(interactionDt)
          .mul(PRESSURE_DIFFUSION)
          .min(1),
      );

      const decayBody = exp(dt.mul(BODY_DECAY).negate());
      const decayErosion = exp(dt.mul(EROSION_DECAY).negate());
      const decayPressure = exp(interactionDt.mul(PRESSURE_DECAY).negate());

      /*
       * The brush cuts on its leading edge and deposits behind it, which is what makes
       * a drag read as compression rather than as a smear of more ink. `leading` is one
       * behind the direction of travel and falls to zero ahead of it.
       */
      const leading = depth
        .div(radius.mul(BRUSH_SHAPE.depth))
        .clamp(-1, 1)
        .oneMinus()
        .mul(0.5)
        .clamp(0, 1);

      // `carryErosion` off means the eroded and deposited channels are re-derived
      // from the authored river every frame instead of accumulating: the SAFE
      // tier's honest simplification, where the cut is still there but stops
      // remembering what the visitor did to it.
      const carry = uniforms.uErosion;
      const erosionBase = mix(authored.y, scourSpread, carry);
      const settleBase = mix(authored.z, settleSpread, carry);

      const body = bodySpread
        .mul(decayBody)
        .add(authored.x.mul(float(1).sub(decayBody)).mul(0.60))
      // Injection is a *rate*, scaled by the timestep. See the channel ceilings below for
      // what the per-frame form used to settle at.
      .add(brush.mul(interactionDt).mul(BODY_INJECT_RATE));
      const scour = erosionBase
        .mul(decayErosion)
        .add(authored.y.mul(float(1).sub(decayErosion)).mul(0.52))
      .add(brush.mul(leading).mul(interactionDt).mul(EROSION_INJECT_RATE));
      const settle = settleBase
        .mul(decayErosion)
        .add(authored.z.mul(float(1).sub(decayErosion)).mul(0.52))
      .add(brush.mul(interactionDt).mul(SETTLE_INJECT_RATE));
      const pressure = pressureSpread
        .mul(decayPressure)
        .add(brush.mul(interactionDt).mul(PRESSURE_INJECT_RATE));

      /*
       * The ceilings.
       *
       * Above the authored field maximum in every case: the bake stacks deposits as high as
       * 1.6, so a clamp at one would flatten the world itself rather than the visitor addition
       * to it. These bound the *sum*, which is what the material reads.
       */
      return vec4(
        body.min(CHANNEL_MAX_BODY),
        scour.min(CHANNEL_MAX_EROSION),
        settle.min(CHANNEL_MAX_EROSION),
        pressure.min(CHANNEL_MAX_PRESSURE),
      );
    })();

    // The copy pass. Its only job is to move `write` back into `read`, so the graph
    // above can keep sampling one fixed target for the life of the field.
    copyMaterial = configure(new MeshBasicNodeMaterial());
    copyMaterial.outputNode = texture(write.texture, uv());
  }

  buildMaterials();

  /** True once the field has been seeded *and* settled. See `INK_SETTLE_SECONDS`. */
  let settled = false;

  let brushState: InkBrush | null = null;
  let liveStrength = 0;
  /** Release over about 2.6 seconds, attack over about 90ms. */
  const ATTACK_RATE = 1 / 0.09;
  const RELEASE_RATE = 1 / 2.6;

  /**
   * One simulation step, against a given pair of deltas.
   *
   * Split out of `step` because the settlement pass and the frame loop have to
   * run *the same integrator*: a pre-computation that used its own pass would be
   * a claim about where the field settles rather than a measurement of it, and
   * the two would separate the first time either was retuned.
   *
   * The brush is written here rather than by the caller so that a settlement step
   * — which passes an interaction delta of zero — cannot inject anything: the
   * ridge term is multiplied by `uInteractionDelta`, and a zero there means the
   * visitor's own channel starts where the world does, empty.
   */
  function advance(
    renderer: InkFieldRenderer,
    deltaSeconds: number,
    interactionDeltaSeconds: number,
    elapsedSeconds: number,
  ): void {
    uniforms.uDelta.value = deltaSeconds;
    uniforms.uInteractionDelta.value = interactionDeltaSeconds;
    uniforms.uTime.value = elapsedSeconds;

    // Attack far faster than it releases, which is what makes a drag feel
    // immediate and its aftermath feel slow: the brief's whole character in one
    // pair of rates. Exponential rather than timer-based, because a drag that
    // ended on a switch would leave a visible edge in the water at the instant
    // the button came up.
    const target = brushState === null ? 0 : brushState.speed;
    const rate = target > liveStrength ? ATTACK_RATE : RELEASE_RATE;
    liveStrength += (target - liveStrength) * (1 - Math.exp(-rate * interactionDeltaSeconds));
    if (brushState !== null) {
      uniforms.uBrushPos.value.set(brushState.x, brushState.z);
    }
    uniforms.uBrushParams.value.set(liveStrength, brushState?.speed ?? 0, options.brushRadius, 0);

    quad.material = advectMaterial;
    renderer.setRenderTarget(write);
    renderer.render(scene, camera);

    quad.material = copyMaterial;
    renderer.setRenderTarget(read);
    renderer.render(scene, camera);
  }

  function seed(renderer: InkFieldRenderer): void {
    quad.material = seedMaterial;
    renderer.setRenderTarget(read);
    renderer.render(scene, camera);
  }

  const field: InkField = {
    get sampleTexture() {
      return read.texture;
    },
    get baseTexture() {
      return baseTextureSource;
    },
    get fluvialTexture() {
      return fluvialTextureSource;
    },
    extent: density.extent,
    targetFormat,
    step(renderer, ambientDeltaSeconds, elapsedSeconds, interactionDeltaSeconds) {
      /*
       * Seed, then settle, exactly once — before the first frame that is shown.
       *
       * The seeding pass and the settlement pass both need a renderer, and the
       * frame loop is the only place one is available, so both happen lazily at
       * the top of the first call rather than in the constructor. What is *not*
       * lazy is the order: the seed writes one texture, and the frame that
       * follows the settlement is the first frame anyone sees. See
       * `INK_SETTLE_SECONDS` for what a seed alone looks like under reduced
       * motion, which is where this was found.
       */
      if (!settled) {
        settled = true;
        seed(renderer);
        const plan = planInkSettlement();
        // Autonomous time only, and the clock is held at zero: the velocity field
        // the settlement integrates against has to be the field the frozen frame
        // will keep integrating against, or the fixed point is of some other
        // system. See `INK_SETTLE_SECONDS`.
        for (let index = 0; index < plan.steps; index += 1) {
          advance(renderer, plan.stepSeconds, 0, 0);
        }
      }

      const interactionDelta = interactionDeltaSeconds ?? ambientDeltaSeconds;

      /*
       * A zero delta means "hold".
       *
       * This is how reduced motion is honoured, and it is the whole of it after
       * the settlement above: nothing advances, and the frame is the state the
       * field settled into. No two consecutive frames differ.
       *
       * It began as an exception. The field kept drifting under the preference, on the
       * reasoning that a still river is a photograph rather than a river at rest. That is a
       * defensible sentence about art direction and an indefensible one about a requirement:
       * reduced motion means the page stops moving, and a single exemption for the one thing
       * that constitutes the entire picture is not a reading of that, it is an override. The
       * capture harness made the cost concrete — the reduced-motion frame never passed the
       * readiness probe, so the preference could not be evidenced at all.
       */
      if (!(ambientDeltaSeconds > 0) && !(interactionDelta > 0)) {
        renderer.setRenderTarget(null);
        return;
      }

      const dt = ambientDeltaSeconds > 0
        ? Math.min(Math.max(ambientDeltaSeconds, 1 / 240), 1 / 20)
        : 0;
      const interactionDt = interactionDelta > 0
        ? Math.min(Math.max(interactionDelta, 1 / 240), 1 / 20)
        : 0;

      advance(renderer, dt, interactionDt, elapsedSeconds);
      renderer.setRenderTarget(null);
    },
    setBrush(brush) {
      if (brush === null) {
        brushState = null;
        return;
      }
      // Normalised here rather than at the call site, because the direction is the
      // one input whose magnitude would change the *shape* of the imprint rather
      // than its strength: a caller passing a raw pointer delta would get a crescent
      // whose width silently tracked the pointer's speed.
      const length = Math.hypot(brush.dirX, brush.dirZ);
      brushState = {
        x: brush.x,
        z: brush.z,
        dirX: length < 1e-5 ? 1 : brush.dirX / length,
        dirZ: length < 1e-5 ? 0 : brush.dirZ / length,
        speed: Math.min(1, Math.max(0, brush.speed)),
      };
    },
    dispose() {
      geometry.dispose();
      seedMaterial.dispose();
      advectMaterial.dispose();
      copyMaterial.dispose();
      read.dispose();
      write.dispose();
      baseTextureSource.dispose();
      fluvialTextureSource.dispose();
      scene.remove(quad);
    },
  };

  return field;
}
