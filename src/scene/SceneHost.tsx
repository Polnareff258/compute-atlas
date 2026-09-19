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
import { deriveGraphLayout } from '../graph/layout';
import type {
  QualityProfile,
  RendererBackend,
} from '../renderer/types';
import type { RendererAdapterBackend } from '../renderer/runtime';
import {
  createCameraController,
  deriveCameraFocusTarget,
} from './camera/cameraController';
import { deriveCoreStructure } from './core/coreStructure';
import { deriveCoreCirculation } from './core/coreCirculation';
import { getCoreParameters } from './core/coreParameters';
import type { ComputeCoreVisualState } from './core/coreTypes';
import { ComputeCore } from './core/ComputeCore';
import { deriveDomainCircuits } from './graph/domainCircuits';
import { deriveDomainEnvironment } from './graph/domainEnvironments';
import { deriveGraphRouting } from './routing/graphRoutes';
import {
  advanceRouteFlow,
  createRouteFlowState,
  deriveRouteFlowTarget,
} from './routing/routeFlow';
import type { RouteFlowState } from './routing/routeDash';
import {
  createRouteFieldSample,
  deriveRouteFieldTelemetryCounts,
} from './routing/routeTelemetry';
import { Atmosphere } from './Atmosphere';
import { KnowledgeGraph } from './graph/KnowledgeGraph';

extend({
  BoxGeometry: THREE.BoxGeometry,
  BufferAttribute: THREE.BufferAttribute,
  BufferGeometry: THREE.BufferGeometry,
  Color: THREE.Color,
  FogExp2: THREE.FogExp2,
  Group: THREE.Group,
  IcosahedronGeometry: THREE.IcosahedronGeometry,
  // The WebGL2 routing fallback drives a bounded instanced dash set, and R3F 9
  // resolves intrinsic elements from this catalogue rather than from the THREE
  // namespace at large. Without it `<instancedMesh>` throws during render, which
  // took the whole fallback scene down rather than degrading one effect.
  InstancedMesh: THREE.InstancedMesh,
  Mesh: THREE.Mesh,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  Points: THREE.Points,
  PointsMaterial: THREE.PointsMaterial,
  SphereGeometry: THREE.SphereGeometry,
  TorusGeometry: THREE.TorusGeometry,
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

export function SceneHost({
  quality,
  backend,
  reducedMotion = false,
  onTelemetry,
  onQualityChange,
  onCommandBusReady,
}: SceneHostProps) {
  const sceneQuality = quality;
  const settings = getQualityProfile(sceneQuality);
  const coreParameters = useMemo(() => getCoreParameters(sceneQuality), [sceneQuality]);
  const graphLayout = useMemo(() => deriveGraphLayout(GRAPH_MANIFEST), []);
  // The Core's own structure is derived here rather than inside ComputeCore so
  // routing can leave from real Core ports. The Core still never reads the Graph.
  const structure = useMemo(
    () => deriveCoreStructure({ structureDetail: coreParameters.structureDetail }),
    [coreParameters.structureDetail],
  );
  // The Core's interior circulation is derived here too, for the same reason the
  // structure is: it is part of what the scene draws, so the boundary that
  // reports on the scene has to be able to describe it without asking a view.
  const circulation = useMemo(
    () => deriveCoreCirculation(structure, coreParameters.structureDetail),
    [coreParameters.structureDetail, structure],
  );
  const routing = useMemo(
    () => deriveGraphRouting(GRAPH_MANIFEST, graphLayout, structure, settings.domainDetail),
    [graphLayout, settings.domainDetail, structure],
  );
  // Each domain is built as its own sub-environment around the point its route
  // actually arrives at, so the ingress opening and the route agree by
  // construction rather than by two modules agreeing on a constant.
  const environments = useMemo(
    () =>
      routing.routes.map((route) => ({
        group: route.group,
        environment: deriveDomainEnvironment(
          route.domainId,
          graphLayout[route.domainId],
          route.ingress,
          settings.domainDetail,
        ),
      })),
    [graphLayout, routing, settings.domainDetail],
  );
  // One field for the whole Graph: the channels between the Core and the domains
  // plus the flow inside each domain, because a domain's interior is where its
  // route ends up and the two have to be the same signal language.
  const graphFieldCurves = useMemo(
    () => [
      ...routing.curves,
      ...environments.flatMap((entry) =>
        deriveDomainCircuits(entry.environment, entry.group),
      ),
    ],
    [environments, routing],
  );
  // One field state for the whole scene: the Core's circulation and the Graph
  // routes are the same signal language, so they cannot each own a copy.
  const routeFlowRef = useRef<RouteFlowState>(createRouteFlowState());
  // Telemetry throttling lives in a ref because it is frame-loop state, not
  // React state: sampling it must never re-render the scene.
  const telemetryClockRef = useRef({ elapsed: 0, last: 0 });
  const { gl } = useThree();
  // An unavailable backend still needs a defined visual: the CPU path is the
  // honest answer, so anything that is not WebGPU takes the fallback route.
  const routeBackend: RendererAdapterBackend =
    backend === 'webgpu' ? 'webgpu' : 'webgl2';
  // The field's implementation, resolved in one place and read by both the view
  // and telemetry, so the count that is reported is the count that is drawn.
  const coreAdvected = routeBackend === 'webgpu' && coreParameters.advection;
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
    // How far the camera has to travel and how wide the frame has to open are
    // both functions of this one number, so framing stays a property of where the
    // domain actually is rather than of a constant tuned for one of the five.
    cameraController.setFocusDistance(
      Math.hypot(position[0], position[1], position[2]),
    );
  }, [cameraController, graphInteraction.focusedNodeId, graphLayout]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

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

  const coreVisualState: ComputeCoreVisualState | null =
    graphInteraction.focusedNodeId !== null
      ? 'focusing'
      : graphInteraction.hoveredNodeId !== null
        ? 'hover_response'
        : null;

  // Continuous field scalars are eased here, in one place, from discrete
  // interaction state. Nothing below this line re-renders at frame rate.
  useFrame((_, delta) => {
    const target = deriveRouteFlowTarget(routing, graphInteraction);
    advanceRouteFlow(routeFlowRef.current, target, delta, reducedMotion);

    if (onTelemetry === undefined) return;

    const safeDelta = Math.min(Math.max(delta, 0), 0.1);
    telemetryClockRef.current.elapsed += safeDelta;
    if (telemetryClockRef.current.elapsed - telemetryClockRef.current.last < TELEMETRY_INTERVAL) {
      return;
    }
    telemetryClockRef.current.last = telemetryClockRef.current.elapsed;

    // Counted from the same descriptors the views are handed, so the reported
    // samples are the dashes on screen rather than a separately maintained guess.
    const counts = deriveRouteFieldTelemetryCounts(coreParameters.configuredFieldBudget, [
      createRouteFieldSample(coreAdvected, {
        curves: circulation.curves,
        detail: coreParameters.structureDetail,
        lanes: coreParameters.routeLanes,
      }),
      createRouteFieldSample(coreAdvected, {
        curves: graphFieldCurves,
        detail: settings.domainDetail,
        lanes: coreParameters.routeLanes,
      }),
    ]);

    onTelemetry(
      sampleRendererTelemetry({
        renderer: gl,
        backend,
        quality: sceneQuality,
        configuredFieldBudget: counts.configuredFieldBudget,
        renderedFieldSamples: counts.renderedFieldSamples,
        activeSignalSamples: counts.activeSignalSamples,
        deltaSeconds: safeDelta,
        sampledAt: performance.now(),
      }),
    );
  });

  return (
    <>
      <color attach="background" args={['#050609']} />
      <fogExp2 attach="fog" args={['#050609', 0.035]} />
      <Atmosphere />
      <ComputeCore
        backend={backend}
        cameraController={cameraController}
        circulation={circulation}
        flowRef={routeFlowRef}
        parameters={coreParameters}
        reducedMotion={reducedMotion}
        structure={structure}
        visualState={coreVisualState}
      />
      <KnowledgeGraph
        advection={coreAdvected}
        backend={routeBackend}
        environments={environments}
        fieldCurves={graphFieldCurves}
        fieldDetail={settings.domainDetail}
        flowRef={routeFlowRef}
        interaction={graphInteraction}
        manifest={GRAPH_MANIFEST}
        onAction={handleGraphAction}
        reducedMotion={reducedMotion}
        routeLanes={coreParameters.routeLanes}
      />
    </>
  );
}
