'use client';

import { extend, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { createCommandBus, type CommandBus } from '../commands/bus';
import { createCommandRegistry } from '../commands/registry';
import { readFrameCounters, sampleRendererTelemetry } from '../telemetry/rendererTelemetry';
import type { RendererTelemetrySnapshot } from '../telemetry/rendererTelemetry';

import { getQualityProfile } from '../config/quality';
import {
  createInitialGraphInteractionState,
  reduceGraphInteraction,
  type GraphInteractionAction,
  type GraphInteractionState,
} from '../graph/interaction';
import { createGraphController } from '../graph/graphController';
import { GRAPH_MANIFEST } from '../graph/graphManifest';
import { deriveGraphProminence } from '../graph/layout';
import type { QualityProfile, RendererBackend } from '../renderer/types';
import { createCameraController, sequenceKey } from './camera/cameraController';
import { heroVista, resolveScrollPose } from './camera/heroShot';
import { createFieldUniforms } from './field/fieldUniforms';
import { createSkyBackground, installSkyBackground } from './materials/skyBackground';
import { deriveFieldState } from './field/deriveFieldState';
import { createInkDensity } from './ink/inkDensity';
import { resolveBrushRadius } from './ink/brushProfile';
import { createInkField, INK_QUALITY, type InkField } from './ink/inkField';
import { resolveInkStepTiming } from './ink/inkStepTiming';
import { meanderCourse } from './ink/riverCourse';
import { projectDomainLabels, type DomainLabelEntry } from './domains/domainLabels';
import { deriveScrollChoreography } from './scroll/scrollChoreography';
import type { InkTargetFormat } from '../renderer/capability';
import { RiverView } from './views/RiverView';
import { TerrainView } from './views/TerrainView';
import { ConvergenceView } from './views/ConvergenceView';
import {
  createWatershedDescriptor,
  DOMAIN_IDS,
  type DomainId,
} from './watershed/watershedDescriptor';
import {
  deriveShotIntent,
  entryApproachPose,
  KEY_LIGHT,
  planShots,
  sequenceFor,
  type ShotIntent,
} from './watershed/shots';

/**
 * R3F 9 resolves intrinsic elements from this catalogue rather than from the
 * THREE namespace at large, so anything the scene mounts as a JSX element has to
 * be registered before the first render. The catalogue starts empty in this
 * version — nothing is registered implicitly — so a scene with no `extend` is a
 * scene whose first `<mesh>` throws `R3F: Mesh is not part of the THREE
 * namespace!` rather than rendering nothing.
 */
extend({
  Color: THREE.Color,
  FogExp2: THREE.FogExp2,
  Mesh: THREE.Mesh,
});

export type SceneHostProps = {
  readonly quality: QualityProfile;
  readonly backend: RendererBackend;
  /**
   * The render-target format the ink field may allocate, from the capability
   * probe. Defaulted to half float so a scene mounted without a runtime — tests,
   * a tool — still gets the profile every capture in this project was taken at.
   */
  readonly inkTargetFormat?: InkTargetFormat;
  readonly reducedMotion?: boolean;
  readonly onTelemetry?: (snapshot: RendererTelemetrySnapshot) => void;
  readonly onQualityChange?: (profile: QualityProfile) => void;
  /**
   * Publishes the five regions' screen positions once a frame.
   *
   * A callback rather than a DOM write, because this module has no legitimate route to
   * the document — see the note on the label layer for why the two are split.
   */
  readonly onCommandBusReady?: (bus: CommandBus | null) => void;
  readonly onDomainLabels?: (entries: readonly DomainLabelEntry[]) => void;
};

/** Telemetry is a readout, not a per-frame stream. */
const TELEMETRY_INTERVAL = 0.25;

/**
 * The seed the world is built from.
 *
 * Fixed, not random. The descriptor is a pure function of seed and detail — that
 * is the whole point of it — so a fixed seed makes the page the same landscape on
 * every load, which is what lets a capture be compared against yesterday's. Per-seed
 * variation is real and tested; it is simply not something the visitor gets to
 * roll.
 */
const WORLD_SEED = 2026;

/**
 * How fast the interaction strengths ease toward their targets.
 *
 * Escape has to be a decompression rather than a cut, so this rate is a real
 * design parameter and not a smoothing constant: too fast and escape snaps, too
 * slow and the site feels unresponsive to a pointer. The landscape's *shape*
 * follows this, so it is the shape that decompresses.
 */
const FIELD_APPROACH_RATE = 3.1;
const REDUCED_MOTION_RATE = 24;

/**
 * How fast the flow's own clock runs, in cycles per second.
 *
 * Very slow, and separate from the operation phase: a river that stopped when the
 * interaction did would read as a frozen photograph of a river, and the brief's
 * idle requirement is that the landscape *breathes* even when nothing is being
 * asked of it. Under reduced motion it holds with everything else, because the
 * preference means the page stops moving and an exception for the composition's own
 * subject would not be a reading of that requirement.
 */
const FLOW_RATE = 0.018;


/**
 * How high the veil floats above the ground, in world units.
 *
 * High enough to parallax against the ground over the distances the scroll travels, low
 * enough that it is never read as a ceiling: about three channel-widths above the water,
 * which at the resting eye height is a couple of degrees of frame.
 */
const VEIL_HEIGHT = 96;

/**
 * How much of the veil each tier carries.
 *
 * A *presence*, not a brightness, and the difference is the point: MEDIUM and SAFE
 * have no veil at all rather than a dimmer one, because a translucent sheet's cost
 * is fill rate and sorting rather than its opacity, and because a tier that keeps a
 * faint veil would spend that cost to show a wash nobody can see. What the tiers
 * keep without exception is the ground, the drag and the value hierarchy — which is
 * where the brief draws the line between an art-directed simplification and a
 * dimmer copy of the same frame.
 */
const VEIL_PRESENCE: Readonly<Record<QualityProfile, number>> = {
  ultra: 0.9,
  high: 0.8,
  medium: 0,
  safe: 0,
};

/**
 * Turns the pointer into a disturbance in the field.
 *
 * The pointer is a screen position and the field is a world one, so the two are bridged
 * by a ray against the ground plane. The plane is `y = 0` rather than the displaced
 * surface, and that is deliberate: the surface moves every frame — the drag itself moves
 * it — so raycasting against it would make the brush's own position depend on the brush's
 * last result, which is a feedback loop that reads as the disturbance sliding away from
 * the cursor.
 *
 * The direction is the pointer's *travel* since the previous frame, not its offset from
 * the centre of the screen. That is the whole difference between a drag that pushes water
 * and a hover that lights it, and the field's imprint is shaped along this vector: a
 * pointer that moves fast leaves a deep narrow crescent, one that moves slowly leaves a
 * broad shallow one.
 */
function updateBrush(
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  ink: InkField,
  drag: DragState,
  brushRadius: number,
): void {
  if (!drag.down) {
    // Released, or never pressed. `null` starts the field's own release, which decays
    // over about two and a half seconds and returns the river to the state the
    // descriptor authored — the brief's "returns to idle after a few seconds" implemented
    // as a property of the system rather than as a timer somebody has to remember to run.
    ink.setBrush(null);
    drag.hasPrevious = false;
    return;
  }

  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.ray.intersectPlane(GROUND_PLANE, scratchGround);
  if (hit === null) {
    // The pointer is above the horizon and the ray never meets the ground. Releasing is
    // the honest response: the alternative is to hold the last position, which makes the
    // brush sit still and burn a hole while the cursor is somewhere else entirely.
    ink.setBrush(null);
    drag.hasPrevious = false;
    return;
  }

  // Once the ray has met the plane it has set `scratchGround`, and `hit` is the same
  // object — so the read is from one place rather than two that could disagree.
  const worldX = scratchGround.x;
  const worldZ = scratchGround.z;

  if (!drag.hasPrevious) {
    drag.previousX = worldX;
    drag.previousZ = worldZ;
    drag.hasPrevious = true;
    // A press with no travel yet is still an event, and the field should answer it. A
    // zero-length direction would be normalised to nothing by the field, which falls back
    // to `+X` — so the very first frame of a drag pushes along the world's X axis, which
    // is wrong but invisible, because that frame's imprint is a single dot at the cursor.
    ink.setBrush({ x: worldX, z: worldZ, dirX: 1, dirZ: 0, speed: 0.35 });
    return;
  }

  const deltaX = worldX - drag.previousX;
  const deltaZ = worldZ - drag.previousZ;
  const travel = Math.hypot(deltaX, deltaZ);

  drag.previousX = worldX;
  drag.previousZ = worldZ;

  if (travel < 1e-4) {
    // The pointer is down and still. The field keeps the last imprint decaying rather
    // than being re-struck, so a stationary press is a mark that fades rather than a
    // hole that deepens.
    ink.setBrush(null);
    return;
  }

  // Speed is travel *per frame* normalised against a fraction of the brush's own radius,
  // so the response is a property of the gesture relative to the size of the mark it
  // makes rather than of the frame rate.
  const speed = Math.min(1, travel / Math.max(1, brushRadius * 0.22));
  ink.setBrush({ x: worldX, z: worldZ, dirX: deltaX, dirZ: deltaZ, speed });
}

/** What the drag has to remember between frames. A ref's contents, never React state. */
type DragState = {
  down: boolean;
  hasPrevious: boolean;
  previousX: number;
  previousZ: number;
};

/**
 * The ground plane the pointer is projected onto, and the scratch vector that receives
 * the hit. Both are module-level so the frame loop allocates nothing — a `Vector3` per
 * frame is a small thing that becomes a large thing once a collector notices it.
 */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/** Reused by the label projection, for the reason every other scratch vector is. */
const labelScratch = new THREE.Vector3();
const scratchGround = new THREE.Vector3();

/**
 * How far down the scroll story the visitor is, `0`..`1`.
 *
 * Read from the document rather than tracked with a listener, and read once per frame from
 * inside the frame loop. A listener would need a handler, a ref to write into, and a decision
 * about passive registration; reading two numbers that the browser already maintains costs
 * nothing and cannot drift out of sync with the actual scroll position. The one thing a
 * listener would buy is not asking 60 times a second, and two property reads are not worth
 * an event system.
 *
 * A document with no scroll range returns zero rather than dividing by it — which is a real
 * case, not a defensive one: a viewport taller than the story would otherwise produce a NaN
 * that reaches the camera and blanks the frame.
 */
function readScrollProgress(): number {
  if (typeof window === 'undefined') return 0;
  const root = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(root.scrollHeight, body ? body.scrollHeight : 0);
  const maxScroll = scrollHeight - window.innerHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / maxScroll));
}

/**
 * The last values written to the document, so a frame that changed nothing writes nothing.
 *
 * A custom property write invalidates style for the whole subtree that reads it, so writing
 * one every frame is a per-frame style recalculation for a value that usually has not moved.
 * The threshold is below one part in five hundred, which is finer than the eye resolves on a
 * fade and coarse enough that a resting page writes nothing at all.
 */
const lastScrollStyle = { opacity: Number.NaN, progress: Number.NaN };

/**
 * Publishes the story to the DOM.
 *
 * The type's exit is done in CSS from one custom property rather than by animating elements
 * from JavaScript, because the brief asks for the text to leave through opacity, a slight
 * displacement and a mask — all of which are style, and none of which should be a per-frame
 * write to several elements' inline styles.
 */
function writeScrollStyle(choreography: ReturnType<typeof deriveScrollChoreography>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!(Math.abs(choreography.textOpacity - lastScrollStyle.opacity) <= 0.002)) {
    lastScrollStyle.opacity = choreography.textOpacity;
    root.style.setProperty('--scroll-text-opacity', choreography.textOpacity.toFixed(3));
  }
  if (!(Math.abs(choreography.progress - lastScrollStyle.progress) <= 0.002)) {
    lastScrollStyle.progress = choreography.progress;
    root.style.setProperty('--scroll-progress', choreography.progress.toFixed(3));
    root.dataset.scrollStage = choreography.stage;
  }
}

export function SceneHost({
  quality,
  backend,
  inkTargetFormat = 'rgba16f',
  reducedMotion = false,
  onTelemetry,
  onQualityChange,
  onCommandBusReady,
  onDomainLabels,
}: SceneHostProps) {
  const settings = useMemo(() => getQualityProfile(quality), [quality]);
  const graphProminence = useMemo(() => deriveGraphProminence(GRAPH_MANIFEST), []);
  // Read here rather than beside `gl` below, because the shot plan needs the
  // aspect and the shot plan is built before the frame loop.
  const { gl, scene, size } = useThree();

  /**
   * The whole world, as data.
   *
   * Every consumer below reads from this one object — the uniforms, the field
   * state, and in time the terrain mesh, the flow, the labels and the camera's
   * own clearance. Rebuilding it is the only thing that can change the landscape,
   * which is why detail is threaded through here rather than into each system.
   */
  const descriptor = useMemo(
    () => createWatershedDescriptor(WORLD_SEED, settings.terrainDetail),
    [settings.terrainDetail],
  );

  const uniforms = useMemo(() => createFieldUniforms(), []);

  /**
   * Where the camera stands, in Z, so the terrain's grid can be graded around it.
   *
   * Read from the descriptor's own corridor rather than written down a second
   * time. The corridor is a short segment centred on the camera's XZ and carrying
   * its true world height — the descriptor built it by measuring the ground — so
   * its midpoint Z is the camera's Z by construction. A copy of the number here
   * would be a second answer to a question the descriptor already answers, and the
   * cost of the two disagreeing is a grid that spends its density on ground
   * nobody looks at.
   *
   * **No longer read by anything, and kept named rather than deleted.** The ink
   * composition grades its corridor on the river's own arc length and its camera on
   * the river's own spine, so neither needs a Z handed to it. What is left is the
   * descriptor's clearance promise, which is still true and still asserted by
   * `shots.test.ts`; deleting the read would not delete the promise, and a future
   * consumer that re-derives it from the corridor would be re-deriving it wrongly.
   */
  const attentionZ = useMemo(() => {
    const corridor = descriptor.cameraCorridors[0];
    if (corridor === undefined) return 0;
    return (corridor.from[2] + corridor.to[2]) / 2;
  }, [descriptor]);
  void attentionZ;

  /**
   * The key light, as one constant for the whole scene.
   *
   * `shots.ts`'s own `KEY_LIGHT` and the terrain's baked orientation term are the
   * same light, and they have to be: the baked colour is the only lighting this
   * scene has, so a shot whose `lightDirection` disagreed with the bake would be a
   * shot lit from two directions at once. A `Vector3` readonly tuple, which is
   * what `TerrainGeometryOptions` asks for.
   *
   * The ink material takes the same direction as two literals inside its own shading
   * term rather than through here, so this is currently only the shot system's copy.
   */
  const keyLight = useMemo<readonly [number, number, number]>(
    () => [KEY_LIGHT[0], KEY_LIGHT[1], KEY_LIGHT[2]],
    [],
  );
  void keyLight;

  useEffect(() => {
    uniforms.setQuality(settings.terrainDetail);

    /*
     * The diagnostic mode, from the URL. See the material for what each one draws; the point
     * here is only that a view can be selected reproducibly without touching the source.
     */
    const requested = new URLSearchParams(window.location.search).get("debug");
    uniforms.setDebugMode(requested === null ? 0 : Number.parseInt(requested, 10));
  }, [uniforms, settings.terrainDetail]);

  /**
   * The air, installed as the scene's own background.
   *
   * Written straight onto the scene rather than mounted as a `<color>` or a mesh,
   * because it is neither: the renderer's background pass draws it on a unit sphere
   * at the far plane, before anything else and with the depth test off, so it can
   * neither occlude the landscape nor be occluded by it. See `skyBackground` for
   * why the mesh form of this did not work.
   */
  const sky = useMemo(() => createSkyBackground(uniforms), [uniforms]);

  useEffect(() => installSkyBackground(scene, sky), [scene, sky]);

  useEffect(() => {
    uniforms.setBasin(descriptor.basin.centre, descriptor.basinFloor);
  }, [uniforms, descriptor]);

  /*
   * The ink field: the composition's whole subject.
   *
   * Built from the descriptor, so the river the visitor sees is the river the
   * descriptor authored — the same spine the terrain's channels and the camera's own
   * travel are derived from. The bake is a CPU sweep over eight rivers into two
   * float textures, and it runs once per descriptor, which is once per load.
   *
   * The bake and the field are separate memos because they answer to different
   * dependencies: the bake is a property of the *world*, and the simulation's
   * resolution is a property of the *tier*. Folding them together would re-bake the
   * world on every quality change — close to a second of frozen frame for no visible
   * gain.
   */
  /**
   * The courses the ink system draws.
   *
   * Computed once here and handed to the bake, the corridor mesh and the hero framing,
   * because all three have to run the same curve. `meanderCourse` adds the river's
   * curvature to the descriptor's authoring line — the descriptor's own spines are
   * near-straight, seven points each, which is right for a height field and useless for
   * a composition whose first named reference quality is river curvature. See
   * `riverCourse` for what that means and what it deliberately does not change.
   *
   * The dependency list is the whole descriptor rather than `descriptor.rivers`, because
   * a descriptor is rebuilt as a unit by `createWatershedDescriptor` and its `rivers`
   * array has no identity of its own to key on.
   */
  const courses = useMemo(
    () =>
      descriptor.rivers.map((river) => ({
        id: river.id,
        spine: meanderCourse({ spine: river.spine, width: river.width }, WORLD_SEED),
        width: river.width,
        flowRate: river.flowRate,
        feeds: river.feeds,
      })),
    [descriptor],
  );

  /*
   * How far the pointer's disturbance reaches, in world units.
   *
   * Hoisted out of the field's construction because the frame loop needs it too: the
   * brush's own strength is normalised against this radius, so the gesture's response is a
   * property of the mark's size relative to the river rather than a constant that happens
   * to work at one world scale. Tied to the authored river's width instead of written down
   * as a literal, because a literal stops being true the first time the descriptor's scale
   * changes — which this world has already done once.
   */
  const brushRadius = useMemo(
    () => resolveBrushRadius(descriptor.rivers[0]?.width ?? 32),
    [descriptor],
  );

  const inkDensity = useMemo(
    () =>
      createInkDensity({
        rivers: courses,
        domains: descriptor.domains.map((domain) => ({
          centre: domain.centre,
          radius: domain.radius,
          behaviour: domain.behaviour,
          terrain: domain.terrain,
        })),
        deposits: descriptor.deposits,
        basin: { centre: descriptor.basin.centre, radius: descriptor.basin.radius },
        extent: descriptor.field.extent,
        // The bake's resolution, scaled by detail, and bounded well below the
        // simulation's: it carries the world's low-frequency structure, whose finest
        // feature is tens of world units, so texels finer than the simulation's would
        // be storing detail the advection is about to blur away.
        resolution: Math.round(512 + 512 * settings.terrainDetail),
        seed: WORLD_SEED,
      }),
    [descriptor, courses, settings.terrainDetail],
  );

  const ink: InkField = useMemo(
    () =>
      createInkField({
        density: inkDensity,
        quality: INK_QUALITY[quality],
        // The capability probe's answer, not a constant: a WebGL2 context that
        // could not give a complete half-float framebuffer allocates bytes
        // instead of drawing into a target the driver never made. See
        // `probeHalfFloatRenderTarget`.
        targetFormat: inkTargetFormat,
        // See `brushRadius` above: the reach is a property of the authored river rather
        // than a literal here, so it rescales with the world instead of going stale.
        // changed — which this world has already done once.
        brushRadius,
      }),
    [inkDensity, quality, brushRadius, inkTargetFormat],
  );

  useEffect(() => () => ink.dispose(), [ink]);

  /**
   * The rig, built once for the visit.
   *
   * **Why the preference is not a dependency.** It used to be, which meant
   * toggling `prefers-reduced-motion` built a second controller — and a second
   * controller has no pose, so the boot snap ran again and the visitor was sent
   * back through the entry they had already made. A mode change is not a new
   * rig; `setReducedMotion` below is the whole of what changes, and the entry
   * state (`enteredRef`, `intentRef`) survives it because nothing resets them.
   *
   * The initial value comes from the preference the page was loaded with, read
   * once through a lazy `useState` initialiser — the primitive that is allowed
   * to take a prop at construction time. An effect would be too late (it runs
   * after the first frame) and a ref read during render is not a place this
   * codebase reads props from.
   */
  const [cameraController] = useState(() =>
    createCameraController({ reducedMotion }),
  );

  useEffect(() => {
    cameraController.setReducedMotion(reducedMotion);
  }, [cameraController, reducedMotion]);

  const [graphInteraction, setGraphInteraction] = useState<GraphInteractionState>(
    createInitialGraphInteractionState,
  );
  const handleGraphAction = useCallback((action: GraphInteractionAction) => {
    setGraphInteraction((state) => reduceGraphInteraction(state, action));
  }, []);
  const graphController = useMemo(
    () => createGraphController(handleGraphAction),
    [handleGraphAction],
  );

  const handleQualityChange = useCallback(
    (profile: QualityProfile) => {
      onQualityChange?.(profile);
    },
    [onQualityChange],
  );

  const commandBus = useMemo(
    () =>
      createCommandBus({
        registry: createCommandRegistry({
          graph: graphController,
          renderer: { setQuality: handleQualityChange },
        }),
      }),
    [graphController, handleQualityChange],
  );

  useEffect(() => {
    onCommandBusReady?.(commandBus);
    return () => onCommandBusReady?.(null);
  }, [commandBus, onCommandBusReady]);

  /**
   * Which region the interaction is about, as the descriptor's own id.
   *
   * `hoveredNodeId` and `focusedNodeId` are `GraphNodeId`s and may name the core,
   * which is not a region: the watershed has five regions and no centre. Filtering
   * here rather than in every consumer keeps "a graph node" and "a region" from
   * being used as though they were the same set.
   */
  const activeDomainId: DomainId | null = useMemo(() => {
    const candidate = graphInteraction.focusedNodeId ?? graphInteraction.hoveredNodeId;
    if (candidate === null) return null;
    return DOMAIN_IDS.find((id) => id === candidate) ?? null;
  }, [graphInteraction.focusedNodeId, graphInteraction.hoveredNodeId]);

  /**
   * The seven framings for this descriptor and this viewport.
   *
   * `aspect` comes from the renderer rather than being assumed, because the shot
   * system's calibration is a property of the frame — `planShots` genuinely
   * branches on it — and a calibration read off a constant is a calibration that
   * stops being one the day the frame changes. Replanning on a resize is a
   * handful of pure functions over a descriptor that has not changed.
   */
  const aspect = size.width / Math.max(1, size.height);
  const shots = useMemo(() => {
    const planned = planShots(descriptor, aspect, activeDomainId ?? undefined);
    /*
     * The resting shot is re-framed for the ink composition.
     *
     * `shots.ts`'s `idleVista` stands the camera on the ground and looks at a
     * horizon, which is the framing of a *landscape* — and this composition has no
     * horizon. It is replaced here rather than rewritten there because the shot
     * table's own tests assert a two-sided contract about a world that is still
     * present, and re-pointing the shared function at a different framing would have
     * meant rewriting assertions whose subject had not changed, which is how a test
     * suite stops being evidence.
     *
     * Everything else in the table is untouched, so hover, focus, arrival and escape
     * keep the choreography they were authored with while the resting frame is the
     * one this stage is composed around.
     */
    return {
      ...planned,
      idleVista: heroVista(descriptor, aspect, courses),
      hoverReveal: heroVista(descriptor, aspect, courses, { lift: 1 }),
    };
  }, [descriptor, aspect, activeDomainId, courses]);

  /**
   * Which shot the camera is in, and the last sequence asked for.
   *
   * Refs rather than state, both: they are written and read by the frame loop,
   * and routing them through React would be a re-render per transition — the
   * per-frame state storm the performance preconditions rule out. Nothing
   * outside the frame loop reads them.
   */
  const intentRef = useRef<ShotIntent>('entry');
  const sequenceKeyRef = useRef<string | null>(null);
  const enteredRef = useRef(false);

  /**
   * The entry, and the one thing that re-arms it.
   *
   * `bootedRef` starts false so the first frame places the rig — snapped, never
   * travelled — and then stays true for the rest of the page's life. It is
   * deliberately *not* re-armed when the reduced-motion preference changes, and
   * that is a repair rather than an omission: the rig used to be replaced by a
   * preference change, and the replacement was treated as a rig with no pose,
   * which reset `entered` and sent somebody who had already arrived back through
   * the entry. `entered` is a fact about the visit, not about the controller, so
   * nothing about the controller is allowed to clear it.
   *
   * The original note stands for the case that does have to start again:
   * re-running the entry because the window was resized would be the same
   * failure, and a new *world* is a different thing to have arrived in.
   */
  const bootedRef = useRef(false);

  useEffect(() => {
    if (activeDomainId === null) {
      uniforms.setRegion(-1, null);
      return;
    }
    const index = DOMAIN_IDS.indexOf(activeDomainId);
    const domain = descriptor.domains.find((candidate) => candidate.id === activeDomainId);
    uniforms.setRegion(index, domain?.palette ?? null);
  }, [uniforms, descriptor, activeDomainId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      setGraphInteraction((state) =>
        reduceGraphInteraction(state, { type: 'CLEAR_FOCUS' }),
      );
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * Whether a button is down, and where the pointer was last frame.
   *
   * A ref rather than state, and the listener set is deliberately on the canvas's own
   * element for the press and on `window` for the release: a pointer that leaves the
   * canvas while held still has to end its drag, and a `pointerup` that happened outside
   * the element never arrives at the element.
   */
  const dragRef = useRef<DragState>({
    down: false,
    hasPrevious: false,
    previousX: 0,
    previousZ: 0,
  });

  useEffect(() => {
    const element = gl.domElement;
    const handleDown = () => {
      dragRef.current.down = true;
      dragRef.current.hasPrevious = false;
    };
    const handleUp = () => {
      dragRef.current.down = false;
    };
    element.addEventListener('pointerdown', handleDown);
    // Chrome DevTools automation and a few embedded browser shells can emit the
    // compatibility mouse event without a PointerEvent. Listening to both is
    // idempotent here (the handler only sets two values) and keeps the direct
    // manipulation path available in those hosts as well as on normal pointer input.
    element.addEventListener('mousedown', handleDown);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('mouseup', handleUp);
    return () => {
      element.removeEventListener('pointerdown', handleDown);
      element.removeEventListener('mousedown', handleDown);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [gl]);

  const fieldState = useMemo(
    () =>
      deriveFieldState({
        manifest: GRAPH_MANIFEST,
        interaction: graphInteraction,
        prominence: graphProminence,
        descriptor,
      }),
    [graphInteraction, graphProminence, descriptor],
  );

  // Eased interaction strengths. They are the only thing in the scene that
  // changes on a frame without a semantic change, so they live in a ref and are
  // never React state.
  const easedRef = useRef({ hover: 0, focus: 0, activity: 0.24, phase: 0, flow: 0 });
  const telemetryClockRef = useRef({ elapsed: 0, last: 0 });

  useFrame((state, delta) => {
    const safeDelta = Math.min(Math.max(delta, 0), 0.1);
    const target = fieldState;

    /*
     * Telemetry, and the frame boundary it is read at.
     *
     * At the *top* of the frame, before anything this frame draws, and that
     * position is the measurement rather than a convenience. `gl.info` is not
     * reset by the renderer — see `configureRenderer`, which turns Three.js's own
     * automatic reset off so that several passes can be counted as one frame —
     * so what it holds here is exactly the frame that finished: the ink field's
     * passes and R3F's own render, both from frame N-1, and nothing older,
     * because the counters were cleared at the top of frame N-1.
     *
     * The counters are cleared on *every* frame, not only on the ones that
     * report, and that is the half that is easy to get wrong. The readout is
     * throttled to a quarter-second, so clearing only when a report is due makes
     * the value a report reads the sum of every frame since the last report: the
     * first version of this measured 126 draw calls where the frame costs 21,
     * which is six frames wearing one frame's field name. A readout may be stale;
     * it may not describe a different interval from the one it names.
     */
    if (onTelemetry === undefined) {
      // Cleared even with nobody listening. The counters belong to the frame, not
      // to the readout, and a reset that only happens when a subscriber is
      // mounted is a counter whose meaning depends on who is watching.
      gl.info.reset();
    } else {
      telemetryClockRef.current.elapsed += safeDelta;

      if (
        telemetryClockRef.current.elapsed - telemetryClockRef.current.last >=
        TELEMETRY_INTERVAL
      ) {
        telemetryClockRef.current.last = telemetryClockRef.current.elapsed;
        const report = onTelemetry;
        readFrameCounters(gl, () => {
          report(
            sampleRendererTelemetry({
              renderer: gl,
              backend,
              quality,
              configuredFieldBudget: settings.particleBudget,
              // Zero, and truthfully so: the landscape's geometry and its units do not
              // exist yet. The two figures are separate arguments precisely so that a
              // plan and a fact cannot be reported as the same number, and reporting
              // the budget here would be the plan wearing the fact's name.
              renderedFieldSamples: 0,
              activeSignalSamples: 0,
              deltaSeconds: safeDelta,
              sampledAt: performance.now(),
            }),
          );
        });
      } else {
        gl.info.reset();
      }
    }

    const wantHover = target.phase === 'awaiting' ? 1 : 0;
    const wantFocus = target.phase === 'running' ? 1 : 0;
    const rate = reducedMotion ? REDUCED_MOTION_RATE : FIELD_APPROACH_RATE;
    const eased = easedRef.current;
    const step = Math.min(1, safeDelta * rate);

    eased.hover += (wantHover - eased.hover) * step;
    eased.focus += (wantFocus - eased.focus) * step;
    eased.activity += (target.activityStrength - eased.activity) * step;

    // The operation's phase advances with the operation rather than with wall
    // time, so a still frame still says where the work is. Frozen under reduced
    // motion, which is the point of the reduced-motion path.
    if (!reducedMotion) {
      eased.phase = (eased.phase + safeDelta * 0.06) % 1;
    }
    // The flow's clock is the one thing that never stops. Everything else can
    // hold still and the landscape is still a landscape; water that holds still
    // is a photograph.
    if (!reducedMotion) {
      eased.flow = (eased.flow + safeDelta * FLOW_RATE) % 1;
    }

    uniforms.update(
      {
        ...target,
        activityStrength: eased.activity,
        activityPhase: eased.phase,
      },
      eased,
      reducedMotion ? 0 : state.clock.elapsedTime,
      // The flow's own elapsed, and this is the argument that matters for motion: it is
      // what the bedding's travel and the granule noise read. Frozen with everything else,
      // because a frame that advances its flow phase is a frame that changes.
      reducedMotion ? 0 : state.clock.elapsedTime,
    );

    // The shot. Which one it is follows from the interaction and from where the
    // camera already is, and the run of shots it plays is the choreography.
    // Derived here rather than in an effect so that "the entry has landed" is a
    // fact this frame establishes rather than one a re-render has to be told
    // about — and because it is the same clock that advances the transition.
    if (!bootedRef.current) {
      bootedRef.current = true;
      if (reducedMotion) {
        /*
         * Reduced motion arrives at the resting framing instead of travelling to
         * it. The entry is a *passage* — the camera starts behind the gate and
         * flies in, and the landscape resolves as it arrives — and a preference
         * that asks the page to stop moving is not a request for a smaller
         * version of that passage. What it keeps is the composition: the resting
         * vista is where the entry was going, so landing on it directly shows
         * the frame the site is composed around rather than a frame on its way
         * there.
         *
         * `entered` is set here rather than earned by a settle, because there is
         * no settle to earn it from — and it has to be set, or the intent would
         * stay `entry` and the rig would keep asking for a sequence it has
         * already been told not to play.
         */
        enteredRef.current = true;
        intentRef.current = 'rest';
        cameraController.snapTo(shots.idleVista);
      } else {
        // Snapped, not travelled: the approach pose is where the entry move
        // begins, so arriving at it is not a move anybody should see.
        cameraController.snapTo(entryApproachPose(shots.entry));
      }
    } else if (intentRef.current === 'entry' && cameraController.isSettled()) {
      enteredRef.current = true;
    }
    const intent = deriveShotIntent({
      focused: graphInteraction.focusedNodeId === null ? null : activeDomainId,
      hovered: graphInteraction.hoveredNodeId === null ? null : activeDomainId,
      entered: enteredRef.current,
      previous: intentRef.current,
    });
    const key = sequenceKey(intent, activeDomainId ?? undefined);
    if (key !== sequenceKeyRef.current) {
      intentRef.current = intent;
      sequenceKeyRef.current = key;
      cameraController.setSequence({
        key,
        shots: sequenceFor(intent).map((id) => shots[id]),
      });
    }

    /*
     * The scroll story, once per frame.
     *
     * Everything here is a function of one number. The choreography decides the act and the
     * layer weights; the weights go to the shared uniform block, where the material reads
     * them; the pose goes to the camera controller, which blends it and remains the only
     * thing that writes a camera. Nothing in this block touches the camera directly, and that
     * is the boundary the brief draws between an input source and the camera's owner.
     */
    const scrollProgress = readScrollProgress();
    const choreography = deriveScrollChoreography(scrollProgress);
    uniforms.setScrollLayers(
      choreography.layers.pigment,
      choreography.layers.bedding,
      choreography.layers.sharpness,
      choreography.layers.granules,
    );
    cameraController.setScrollTrack(
      resolveScrollPose(descriptor, aspect, courses, choreography.progress),
      choreography.cameraAuthority,
    );
    writeScrollStyle(choreography);

    cameraController.setVisualState(
      eased.focus > 0.5 ? 'focusing' : eased.hover > 0.35 ? 'hover_response' : 'idle',
    );
    cameraController.update(safeDelta);

    const pose = cameraController.getResolvedPose();
    state.camera.position.set(pose.positionX, pose.positionY, pose.positionZ);
    // `lookAt` rather than a yaw and a pitch: the rig turns toward its subject on
    // every shot, and composing the view basis by hand is how the two come to
    // disagree. Three derives the same basis from the same two points.
    state.camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
    if (state.camera instanceof THREE.PerspectiveCamera && state.camera.fov !== pose.fov) {
      state.camera.fov = pose.fov;
      state.camera.updateProjectionMatrix();
    }

    /*
     * Advance the ink field, before anything is drawn.
     *
     * It has to run here rather than in an effect or a `useMemo`, and it has to run
     * *before* R3F's own render — the field's advection is a set of fullscreen passes
     * into its own render targets, and the frame that follows reads the result. R3F
     * renders after every priority-zero `useFrame` callback has returned, so this is
     * the last moment at which the field can be updated and still be the one the
     * frame samples.
     *
     * The renderer is cast to the field's own narrow interface rather than the field
     * being typed against `WebGPURenderer`: the field needs `setRenderTarget` and
     * `render` and nothing else, and typing it against the concrete class would make
     * it untestable without a GPU and would tie a simulation to a renderer version.
     */
    /*
     * The pointer, before the field advances.
     *
     * Order matters and is not incidental: the simulation step reads the brush, so writing
     * it afterwards would apply every gesture one frame late. Under reduced motion the
     * drag still works — it is direct manipulation, not ambient movement, and taking it
     * away would remove the page's only form of input rather than quieten it — but the
     * field's own attack and release rates are what a visitor feels, and those are
     * unchanged. What reduced motion stops is everything the visitor did *not* ask for.
     */
    updateBrush(
      state.raycaster,
      state.pointer,
      state.camera,
      ink,
      dragRef.current,
      brushRadius,
    );

    /*
     * A zero delta under reduced motion, which the field reads as "hold". The preference
     * is therefore honoured where the composition's motion actually comes from, and the two
     * clocks that drive it are frozen with it.
     */
    const inkTiming = resolveInkStepTiming(
      safeDelta,
      state.clock.elapsedTime,
      reducedMotion,
    );
    ink.step(
      gl as unknown as Parameters<InkField['step']>[0],
      inkTiming.ambientDelta,
      inkTiming.elapsed,
      inkTiming.interactionDelta,
    );

    if (onDomainLabels !== undefined) {
      onDomainLabels(
        projectDomainLabels({
          descriptor,
          camera: state.camera,
          width: size.width,
          height: size.height,
          hoveredDomainId: graphInteraction.hoveredNodeId as DomainId | null,
          focusedDomainId: graphInteraction.focusedNodeId as DomainId | null,
          scratch: labelScratch,
        }),
      );
    }

  });

  return (
    <>
      {/*
        There is no `<color attach="background">` here any more, and that is the
        point rather than an omission: the scene's background is installed on the
        scene itself by the effect above, because a node background is not a
        colour, a texture or a mesh and has no JSX form. The last colour this
        scene held was `ink`, and its flatness was the reason the far ground had
        nowhere to recede into.

        The fog is the landscape's air, and it is the descriptor's own figure
        rather than a constant here: the density varies per seed, and a scene
        whose air was written down separately from its world is a scene where the
        two can disagree. It is not a fade to the background colour — the terrain
        material treats distance as a multiplier on its whole term stack, so a
        feature far out settles into the dark as a silhouette rather than washing
        out to grey.

        Its `tint` is the sky's own horizon colour by construction, and that is
        the agreement the previous frame was missing: the far ground is driven
        toward this exact colour as depth grows, so it dissolves into the haze
        band instead of ending in a hard silhouette against a flat plate. Moving
        one without the other is what puts a visible edge along the world's own
        horizon.
      */}
      <fogExp2 attach="fog" args={[descriptor.fog.tint, descriptor.fog.density]} />
      {/*
        The ground. Everything else the landscape grows — the basin's strata, the
        rivers, the deposits, the membranes — is measured from this surface, so it
        is mounted first and its own dependencies are only the descriptor, the
        shared uniforms and the two framing numbers the descriptor does not carry.
      */}
      <TerrainView
        descriptor={descriptor}
        uniforms={uniforms}
        ink={ink}
        height={VEIL_HEIGHT}
        presence={VEIL_PRESENCE[quality]}
      />
      {/*
        The water, laid into the trough the ground above has just cut. Mounted
        second because it *depends* on the first: its vertices start on the same
        height field and receive the same displacement, so mounting it before the
        terrain would build a surface against a ground that does not exist yet —
        which is what the previous composition did, and why its rivers floated.
      */}
      <RiverView
        descriptor={descriptor}
        uniforms={uniforms}
        ink={ink}
        detail={settings.terrainDetail}
      />
      <ConvergenceView
        descriptor={descriptor}
        uniforms={uniforms}
        quality={quality}
      />
    </>
  );
}
