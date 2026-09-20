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
import { deriveGraphLayout, deriveGraphProminence } from '../graph/layout';
import type { QualityProfile, RendererBackend } from '../renderer/types';
import {
  createCameraController,
  deriveCameraFocusTarget,
  deriveCameraFraming,
} from './camera/cameraController';
import { createFieldUniforms } from './field/fieldUniforms';
import { deriveFieldState } from './field/deriveFieldState';
import {
  createWatershedDescriptor,
  DOMAIN_IDS,
  WATERSHED_PALETTE,
  type DomainId,
} from './watershed/watershedDescriptor';

/**
 * R3F 9 resolves intrinsic elements from this catalogue rather than from the
 * THREE namespace at large, so anything the scene mounts as a JSX element has to
 * be registered before the first render. It is very short at the moment because
 * the scene is being rebuilt: the landscape's own views are not here yet, and
 * what remains is the background and the fog.
 */
extend({
  Color: THREE.Color,
  FogExp2: THREE.FogExp2,
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
  const graphLayout = useMemo(() => deriveGraphLayout(GRAPH_MANIFEST), []);
  const graphProminence = useMemo(() => deriveGraphProminence(GRAPH_MANIFEST), []);

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

  useEffect(() => {
    uniforms.setQuality(settings.terrainDetail);
  }, [uniforms, settings.terrainDetail]);

  useEffect(() => {
    uniforms.setBasin(descriptor.basin.centre, descriptor.basinFloor);
  }, [uniforms, descriptor]);

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
    const focusedNodeId = graphInteraction.focusedNodeId;
    const position =
      focusedNodeId === null ? ([0, 0, 0] as const) : graphLayout[focusedNodeId];
    const target = deriveCameraFocusTarget(position);
    cameraController.setFocusTarget(target[0], target[1], target[2]);
    cameraController.setFocusDistance(
      Math.hypot(position[0], position[1], position[2]),
    );
  }, [cameraController, graphInteraction.focusedNodeId, graphLayout]);

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
  const { gl } = useThree();

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

    // Framing is a translate-and-dolly rig: the camera moves and pulls back and
    // never turns toward the subject. The shot system that replaces it — seven
    // authored framings with their own poses, focal distances and hero regions —
    // is what this rig is standing in for.
    cameraController.setVisualState(
      eased.focus > 0.5 ? 'focusing' : eased.hover > 0.35 ? 'hover_response' : 'idle',
    );
    cameraController.update(safeDelta);
    const framing = deriveCameraFraming({
      pointerX: cameraController.getPointerX(),
      pointerY: cameraController.getPointerY(),
      focusX: cameraController.getFocusX(),
      focusY: cameraController.getFocusY(),
      focusZ: cameraController.getFocusZ(),
      focusDistance: cameraController.getFocusDistance(),
      response: cameraController.getResponseStrength(),
      amplitudeScale: cameraController.getAmplitudeScale(),
      aspect: state.size.width / Math.max(1, state.size.height),
    });
    state.camera.position.set(framing.positionX, framing.positionY, framing.positionZ);
    state.camera.rotation.set(framing.pitch, framing.yaw, 0);

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
      <color attach="background" args={[WATERSHED_PALETTE.ink]} />
      {/*
        The fog is the landscape's air, and it is the descriptor's own figure
        rather than a constant here: the density varies per seed, and a scene
        whose air was written down separately from its world is a scene where the
        two can disagree. It is not a fade to the background colour — the terrain
        material treats distance as a multiplier on its whole term stack, so a
        feature far out settles into the dark as a silhouette rather than washing
        out to grey.
      */}
      <fogExp2 attach="fog" args={[descriptor.fog.tint, descriptor.fog.density]} />
    </>
  );
}
