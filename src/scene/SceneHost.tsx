'use client';

import { extend } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import * as THREE from 'three';

import { createCommandBus, type CommandBus } from '../commands/bus';
import { createCommandRegistry } from '../commands/registry';

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
import {
  createCameraController,
  deriveCameraFocusTarget,
} from './camera/cameraController';
import type { ComputeCoreVisualState } from './core/coreTypes';
import { ComputeCore } from './core/ComputeCore';
import { KnowledgeGraph } from './graph/KnowledgeGraph';

extend({
  BufferAttribute: THREE.BufferAttribute,
  BufferGeometry: THREE.BufferGeometry,
  Color: THREE.Color,
  FogExp2: THREE.FogExp2,
  Group: THREE.Group,
  IcosahedronGeometry: THREE.IcosahedronGeometry,
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
  readonly onTelemetry?: ComponentProps<typeof ComputeCore>['onTelemetry'];
  readonly onQualityChange?: (profile: QualityProfile) => void;
  readonly onCommandBusReady?: (bus: CommandBus | null) => void;
};

export function SceneHost({
  quality,
  backend,
  reducedMotion = false,
  onTelemetry,
  onQualityChange,
  onCommandBusReady,
}: SceneHostProps) {
  const sceneQuality = quality;
  const graphLayout = useMemo(() => deriveGraphLayout(GRAPH_MANIFEST), []);
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

  const coreProps = {
    quality: sceneQuality,
    backend,
    cameraController,
    reducedMotion,
    visualState: coreVisualState,
  } as const;

  return (
    <>
      <color attach="background" args={['#050609']} />
      <fogExp2 attach="fog" args={['#050609', 0.035]} />
      {onTelemetry ? (
        <ComputeCore {...coreProps} onTelemetry={onTelemetry} />
      ) : (
        <ComputeCore {...coreProps} />
      )}
      <KnowledgeGraph
        graphDensity={getQualityProfile(sceneQuality).graphDensity}
        interaction={graphInteraction}
        layout={graphLayout}
        manifest={GRAPH_MANIFEST}
        onAction={handleGraphAction}
      />
    </>
  );
}