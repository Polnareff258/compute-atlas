'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  type GraphInteractionAction,
  type GraphInteractionState,
} from '../../graph/interaction';
import type { GraphManifest, GraphNodeId } from '../../graph/types';
import type { RendererAdapterBackend } from '../../renderer/runtime';
import type { RouteCurve, RouteFlowState } from '../routing/routeDash';
import { DomainEnvironmentView } from './DomainEnvironment';
import type { DomainEnvironment } from './domainEnvironments';
import { GraphEdges } from './GraphEdges';

/** A domain sub-environment plus the route group that drives its response. */
export type DomainEnvironmentEntry = {
  readonly environment: DomainEnvironment;
  readonly group: number;
};

export type KnowledgeGraphProps = {
  readonly manifest: GraphManifest;
  /** Every domain's sub-environment, in manifest routing order. */
  readonly environments: readonly DomainEnvironmentEntry[];
  /** Trunks, branches, approaches and each domain's own internal circuits. */
  readonly fieldCurves: readonly RouteCurve[];
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly backend: RendererAdapterBackend;
  readonly routeLanes: number;
  readonly fieldDetail: number;
  readonly interaction: GraphInteractionState;
  readonly onAction: (action: GraphInteractionAction) => void;
  readonly reducedMotion: boolean;
};

/** Hover lifts a domain most of the way; focus commits it fully. */
const HOVER_ACTIVATION = 0.55;

type ProjectedNode = {
  readonly id: GraphNodeId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
};

/**
 * Screen-space picking against each domain's own envelope.
 *
 * Domains are now large objects with depth, so the pick radius comes from the
 * projected extent rather than from a fixed constant — otherwise the outer
 * layers of a sub-environment would be visible but not clickable.
 */
function projectDomainNodes(
  environments: readonly DomainEnvironmentEntry[],
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): readonly ProjectedNode[] {
  const rect = canvas.getBoundingClientRect();
  const projected: ProjectedNode[] = [];
  const center = new THREE.Vector3();
  const edge = new THREE.Vector3();

  for (const entry of environments) {
    const { anchor, extent, ingressLocal } = entry.environment;
    center.set(anchor[0], anchor[1], anchor[2]);
    edge.set(anchor[0] + extent * 0.8, anchor[1] + extent * 0.6, anchor[2] + ingressLocal[2]);
    center.project(camera);
    edge.project(camera);

    projected.push({
      id: entry.environment.nodeId,
      x: rect.left + ((center.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - center.y) / 2) * rect.height,
      radius: Math.max(
        24,
        (Math.abs(edge.x - center.x) * rect.width) / 2 + 12,
      ),
    });
  }

  return projected;
}

function pickDomainNode(
  event: PointerEvent,
  projectedNodes: readonly ProjectedNode[],
): GraphNodeId | null {
  let nearest: ProjectedNode | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const node of projectedNodes) {
    const distance = Math.hypot(event.clientX - node.x, event.clientY - node.y);
    if (distance <= node.radius && distance < nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }

  return nearest?.id ?? null;
}

function GraphPointerBoundary({
  environments,
  interaction,
  onAction,
}: Pick<KnowledgeGraphProps, 'environments' | 'interaction' | 'onAction'>) {
  const { camera, gl } = useThree();
  const hoveredNodeRef = useRef<GraphNodeId | null>(interaction.hoveredNodeId);

  useEffect(() => {
    const canvas = gl.domElement;
    const updateHover = (event: PointerEvent) => {
      const nextNodeId = pickDomainNode(
        event,
        projectDomainNodes(environments, camera, canvas),
      );
      if (nextNodeId === hoveredNodeRef.current) {
        return;
      }

      const previousNodeId = hoveredNodeRef.current;
      hoveredNodeRef.current = nextNodeId;
      if (previousNodeId !== null) {
        onAction({ type: 'POINTER_LEAVE_NODE', nodeId: previousNodeId });
      }
      if (nextNodeId !== null) {
        onAction({ type: 'POINTER_ENTER_NODE', nodeId: nextNodeId });
      }
    };
    const clearHover = () => {
      const previousNodeId = hoveredNodeRef.current;
      if (previousNodeId === null) {
        return;
      }
      hoveredNodeRef.current = null;
      onAction({ type: 'POINTER_LEAVE_NODE', nodeId: previousNodeId });
    };
    const focusFromPointer = (event: MouseEvent) => {
      const nodeId = pickDomainNode(
        event as unknown as PointerEvent,
        projectDomainNodes(environments, camera, canvas),
      );
      if (nodeId === null) {
        return;
      }
      onAction(
        nodeId === interaction.focusedNodeId
          ? { type: 'CLEAR_FOCUS' }
          : { type: 'FOCUS_NODE', nodeId },
      );
    };

    canvas.addEventListener('pointermove', updateHover, { passive: true });
    canvas.addEventListener('pointerleave', clearHover, { passive: true });
    canvas.addEventListener('click', focusFromPointer);
    return () => {
      canvas.removeEventListener('pointermove', updateHover);
      canvas.removeEventListener('pointerleave', clearHover);
      canvas.removeEventListener('click', focusFromPointer);
    };
  }, [camera, environments, gl, interaction.focusedNodeId, onAction]);

  return null;
}

export function KnowledgeGraph({
  manifest,
  environments,
  fieldCurves,
  flowRef,
  backend,
  routeLanes,
  fieldDetail,
  interaction,
  onAction,
  reducedMotion,
}: KnowledgeGraphProps) {
  const labelsById = useMemo(() => {
    const labels = new Map<string, { label: string; description: string }>();
    for (const node of manifest.nodes) {
      labels.set(node.id, { label: node.label, description: node.description });
    }
    return labels;
  }, [manifest]);

  return (
    <group name="knowledge-graph">
      <GraphPointerBoundary
        environments={environments}
        interaction={interaction}
        onAction={onAction}
      />
      <GraphEdges
        backend={backend}
        curves={fieldCurves}
        detail={fieldDetail}
        flowRef={flowRef}
        lanes={routeLanes}
        reducedMotion={reducedMotion}
      />
      {environments.map((entry) => {
        const { nodeId } = entry.environment;
        const isFocused = interaction.focusedNodeId === nodeId;
        const isHovered = interaction.hoveredNodeId === nodeId;
        const copy = labelsById.get(nodeId);
        // Focus is one domain's story: the others recede to outlines and give up
        // their text, so the selected title is the only thing being read.
        const othersRecede = interaction.focusedNodeId !== null && !isFocused;

        return (
          <DomainEnvironmentView
            activation={isFocused ? 1 : isHovered ? HOVER_ACTIVATION : 0}
            description={copy?.description ?? ''}
            dimmed={othersRecede}
            environment={entry.environment}
            key={nodeId}
            label={copy?.label ?? nodeId}
            reducedMotion={reducedMotion}
            showDescription={isFocused || isHovered}
            showLabel={!othersRecede}
          />
        );
      })}
    </group>
  );
}
