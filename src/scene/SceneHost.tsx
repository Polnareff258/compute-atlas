'use client';

import { extend, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { createCommandBus, type CommandBus } from '../commands/bus';
import { createCommandRegistry } from '../commands/registry';
import { sampleRendererTelemetry } from '../telemetry/rendererTelemetry';
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
import { createFieldUniforms } from './field/fieldUniforms';
import { createSkyBackground, installSkyBackground } from './materials/skyBackground';
import { deriveFieldState } from './field/deriveFieldState';
import { createFlowField } from './watershed/flowField';
import { BasinView } from './views/BasinView';
import { RiverView } from './views/RiverView';
import { TerrainView } from './views/TerrainView';
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
  readonly reducedMotion?: boolean;
  readonly onTelemetry?: (snapshot: RendererTelemetrySnapshot) => void;
  readonly onQualityChange?: (profile: QualityProfile) => void;
  readonly onCommandBusReady?: (bus: CommandBus | null) => void;
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
 * asked of it. Under reduced motion this is the one thing that keeps moving, at
 * a rate chosen to be legible as motion and not as animation.
 */
const FLOW_RATE = 0.018;

export function SceneHost({
  quality,
  backend,
  reducedMotion = false,
  onTelemetry,
  onQualityChange,
  onCommandBusReady,
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
   */
  const attentionZ = useMemo(() => {
    const corridor = descriptor.cameraCorridors[0];
    if (corridor === undefined) return 0;
    return (corridor.from[2] + corridor.to[2]) / 2;
  }, [descriptor]);

  /**
   * The key light, as one constant for the whole scene.
   *
   * `shots.ts`'s own `KEY_LIGHT` and the terrain's baked orientation term are the
   * same light, and they have to be: the baked colour is the only lighting this
   * scene has, so a shot whose `lightDirection` disagreed with the bake would be a
   * shot lit from two directions at once. A `Vector3` readonly tuple, which is
   * what `TerrainGeometryOptions` asks for.
   */
  const keyLight = useMemo<readonly [number, number, number]>(
    () => [KEY_LIGHT[0], KEY_LIGHT[1], KEY_LIGHT[2]],
    [],
  );

  useEffect(() => {
    uniforms.setQuality(settings.terrainDetail);
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

  /**
   * The flow field, built once and shared by the ground and the water.
   *
   * It lives here rather than in either view because it stopped being one view's
   * business the moment there were two: the ground erodes by it and the water
   * stands in the trough it cut, and both derive that from the same four channels.
   * A copy per view would be two answers to "where is the channel" — and since the
   * water's own cross-section is a *quotient* of two of those channels, the two
   * copies disagreeing by a texel would be the water sitting off its own bed by a
   * texel's worth of world.
   *
   * The texture is a 384×384 RGBA upload and the build is a CPU sweep over eight
   * rivers; small, but there is no reason to do it twice and every reason not to
   * do it twice differently.
   */
  const flow = useMemo(
    () =>
      createFlowField({
        field: descriptor.field,
        // The rivers' own bodies, not the channels that carve them: the flow field
        // is what the *material* erodes by, and a channel exists precisely because
        // a river does. Passing both would count every river's work twice.
        rivers: descriptor.rivers.map((river) => ({
          spine: river.spine,
          width: river.width,
          flowRate: river.flowRate,
        })),
        deposits: descriptor.deposits,
        resolution: descriptor.flowResolution,
      }),
    [descriptor],
  );

  useEffect(() => () => flow.dispose(), [flow]);

  const cameraController = useMemo(
    () => createCameraController({ reducedMotion }),
    [reducedMotion],
  );

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
  const shots = useMemo(
    () => planShots(descriptor, aspect, activeDomainId ?? undefined),
    [descriptor, aspect, activeDomainId],
  );

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
  const bootedRef = useRef(true);

  /**
   * The entry, re-armed when the rig itself is replaced.
   *
   * Not when the *framings* change: the entry is something a visitor does on
   * arrival, and re-running it because the window was resized would send
   * somebody who had already arrived back through the gate. A new controller is
   * a different rig with no pose at all, which is the one case that does have to
   * start again. The snap itself happens in the frame loop, so that there is one
   * place deciding what the camera does rather than two.
   */
  useEffect(() => {
    bootedRef.current = false;
    enteredRef.current = false;
    intentRef.current = 'entry';
    sequenceKeyRef.current = null;
  }, [cameraController]);

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
    eased.flow = (eased.flow + safeDelta * FLOW_RATE) % 1;

    uniforms.update(
      {
        ...target,
        activityStrength: eased.activity,
        activityPhase: eased.phase,
      },
      eased,
      reducedMotion ? 0 : state.clock.elapsedTime,
      state.clock.elapsedTime,
    );

    // The shot. Which one it is follows from the interaction and from where the
    // camera already is, and the run of shots it plays is the choreography.
    // Derived here rather than in an effect so that "the entry has landed" is a
    // fact this frame establishes rather than one a re-render has to be told
    // about — and because it is the same clock that advances the transition.
    if (!bootedRef.current) {
      bootedRef.current = true;
      // Snapped, not travelled: the approach pose is where the entry move
      // begins, so arriving at it is not a move anybody should see.
      cameraController.snapTo(entryApproachPose(shots.entry));
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

    if (onTelemetry === undefined) return;
    telemetryClockRef.current.elapsed += safeDelta;
    if (telemetryClockRef.current.elapsed - telemetryClockRef.current.last < TELEMETRY_INTERVAL) {
      return;
    }
    telemetryClockRef.current.last = telemetryClockRef.current.elapsed;

    onTelemetry(
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
        flow={flow}
        attentionZ={attentionZ}
        keyLight={keyLight}
      />
      {/*
        The water, laid into the trough the ground above has just cut. Mounted
        second because it *depends* on the first: its vertices start on the same
        height field and receive the same displacement, so mounting it before the
        terrain would build a surface against a ground that does not exist yet —
        which is what the previous composition did, and why its rivers floated.
      */}
      <RiverView descriptor={descriptor} uniforms={uniforms} flow={flow} />
      {/*
        The Convergence Basin's levels, mounted last and deliberately so. They are
        the only transparent surfaces in the frame that sit *inside* the terrain
        rather than on it, so they have to be drawn after both the ground they are
        set into and the water that arrives at them — a sheet drawn before the
        river would have the river composited behind the level it is filling.
      */}
      <BasinView descriptor={descriptor} uniforms={uniforms} />
    </>
  );
}
