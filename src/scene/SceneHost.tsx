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
import { deriveRiftStructure } from './hero/riftStructure';
import { RiftStructureView } from './hero/RiftStructureView';
import { deriveMatterCount, type MatterRegion } from './matter/dataMatter';
import { DataMatterView } from './matter/DataMatterView';
import { DomainField } from './domains/DomainField';
import { deriveDomainPhenomena } from './domains/domainPhenomena';
import { DeepField } from './backdrop/DeepField';
import { PostPipeline } from './post/PostPipeline';

/**
 * R3F 9 resolves intrinsic elements from this catalogue rather than from the
 * THREE namespace at large, so anything the scene mounts as a JSX element has
 * to be registered before the first render. This list is the whole of the
 * scene's element vocabulary, and it is deliberately short: the composition is
 * four draw calls of authored geometry plus one instanced field, and the rest of
 * the frame is shading.
 */
extend({
  Group: THREE.Group,
  InstancedMesh: THREE.InstancedMesh,
  Mesh: THREE.Mesh,
  Points: THREE.Points,
  BoxGeometry: THREE.BoxGeometry,
  PlaneGeometry: THREE.PlaneGeometry,
  SphereGeometry: THREE.SphereGeometry,
  BufferGeometry: THREE.BufferGeometry,
  BufferAttribute: THREE.BufferAttribute,
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
 * How fast the interaction strengths ease toward their targets.
 *
 * Escape has to be a decompression rather than a cut, so this rate is a real
 * design parameter and not a smoothing constant: too fast and escape snaps, too
 * slow and the site feels unresponsive to a pointer. The field's *shape* follows
 * this, so it is the shape that decompresses.
 */
const FIELD_APPROACH_RATE = 3.1;
const REDUCED_MOTION_RATE = 24;

/**
 * How much larger the field's volume is than the throat it lives in.
 *
 * See the note at `riftRegion`: the field describes the machine's air as well as
 * its metal, and the brief's "large-scale flowing sheets" are a claim about a
 * volume several times the throat's. At 2.4 the rift's populated ellipsoid is
 * about thirty-one by fourteen by twelve units — the size of the composition's
 * middle distance, which is where a sheet of matter can be seen to be a sheet.
 */
const RIFT_FIELD_SPREAD = 2.4;

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

  const rift = useMemo(
    () => deriveRiftStructure({ detail: settings.coreStructureDetail }),
    [settings.coreStructureDetail],
  );

  const phenomena = useMemo(
    () => deriveDomainPhenomena(GRAPH_MANIFEST, graphLayout, settings.domainDetail),
    [graphLayout, settings.domainDetail],
  );

  // The rift is region 0; the five domains are 1..5. The matter system is handed
  // plain points and half-extents, so it never learns what a domain is.
  //
  // The half-extents are the cavity's own, scaled up, and the scale is not a
  // fudge. The cavity is the *throat* — thirteen by six by five — and it is the
  // smallest of the three volumes the brief gives the field: the units circulate
  // deep in the Core, but they also form the sheets that extend past the rift and
  // arrive as streams from far out. Confining a hundred thousand units to the
  // throat's own box is what produced the third capture's solid ball at the
  // centre of the frame. The field's volume has to be the volume the field is
  // *about*, which is larger than the metal it passes through.
  const riftRegion: MatterRegion = useMemo(
    () => ({
      centre: rift.cavity.centre,
      extent: [
        rift.cavity.halfExtents[0] * RIFT_FIELD_SPREAD,
        rift.cavity.halfExtents[1] * RIFT_FIELD_SPREAD,
        rift.cavity.halfExtents[2] * RIFT_FIELD_SPREAD,
      ],
      kind: 0,
    }),
    [rift],
  );
  const matterRegions: readonly MatterRegion[] = useMemo(
    () =>
      phenomena.map((entry) => ({
        centre: entry.centre,
        extent: entry.extent,
        kind: entry.kind,
      })),
    [phenomena],
  );

  const uniforms = useMemo(() => createFieldUniforms(), []);
  // The count the view will actually allocate. Telemetry reads the same number
  // from the same function, so the reported samples are the drawn samples rather
  // than a separately maintained guess.
  const matterCount = useMemo(
    () => deriveMatterCount(settings.particleBudget, settings.coreStructureDetail),
    [settings.particleBudget, settings.coreStructureDetail],
  );
  const uniformQuality = useMemo(
    () => settings.coreStructureDetail * 0.5 + settings.domainDetail * 0.5,
    [settings.coreStructureDetail, settings.domainDetail],
  );

  useEffect(() => {
    uniforms.setQuality(uniformQuality);
  }, [uniforms, uniformQuality]);

  useEffect(() => {
    uniforms.setRift(rift.riftAxis, rift.riftCentre);
  }, [uniforms, rift]);

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
        layout: graphLayout,
        interaction: graphInteraction,
        prominence: graphProminence,
        rift,
      }),
    [graphInteraction, graphLayout, graphProminence, rift],
  );

  // Eased interaction strengths. They are the only thing in the scene that
  // changes on a frame without a semantic change, so they live in a ref and are
  // never React state.
  const easedRef = useRef({ hover: 0, focus: 0, activity: 0.24, phase: 0 });
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

    // The phase advances with the operation rather than with wall time, so a
    // still frame still says where the work is. Frozen under reduced motion,
    // which is the point of the reduced-motion path: the frame stops moving but
    // keeps its state.
    if (!reducedMotion) {
      eased.phase = (eased.phase + safeDelta * 0.06) % 1;
    }

    uniforms.update(
      {
        ...target,
        activityStrength: eased.activity,
        activityPhase: eased.phase,
      },
      eased,
      reducedMotion ? 0 : state.clock.elapsedTime,
    );

    // Framing is a translate-and-dolly rig: the camera moves and pulls back and
    // never turns toward the subject, so the rift is seen from one angle
    // throughout and only its place in the frame changes. That is what keeps the
    // hero the compositional centre of gravity under focus instead of becoming
    // a picture of one bay.
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
        renderedFieldSamples: matterCount,
        activeSignalSamples: Math.round(matterCount * eased.activity),
        deltaSeconds: safeDelta,
        sampledAt: performance.now(),
      }),
    );
  });

  return (
    <>
      <color attach="background" args={['#03050a']} />
      {/*
        Exponential fog, at half the density it carried while the hero owned its
        own backdrop.
        The fog and the energy material's depth fade are two independent depth
        cues, and while they were both tuned against a far field that filled the
        frame they agreed. They do not agree about the far field's own structure:
        at 0.012 a member a hundred units out is seventy-six percent of the way to
        the fog colour, and the fog colour is within two values of the background,
        so the far shelves arrived at exactly the value they were cut out of and
        the composition had no far end at all. The material's depth floor is the
        cue the far field is authored against; the fog is here to give the middle
        distance some air, and at 0.006 that is all it does.
      */}
      <fogExp2 attach="fog" args={['#050a12', 0.006]} />
      <DeepField uniforms={uniforms} rift={rift} detail={settings.coreStructureDetail} />
      <RiftStructureView structure={rift} uniforms={uniforms} />
      <DataMatterView
        uniforms={uniforms}
        rift={riftRegion}
        regions={matterRegions}
        count={settings.particleBudget}
        density={settings.coreStructureDetail}
      />
      <DomainField
        uniforms={uniforms}
        phenomena={phenomena}
        interaction={graphInteraction}
        onAction={handleGraphAction}
        prominence={graphProminence}
        reducedMotion={reducedMotion}
      />
      <PostPipeline
        uniforms={uniforms}
        enabled={settings.allowBloom}
        depthOfField={quality === 'ultra'}
      />
    </>
  );
}
