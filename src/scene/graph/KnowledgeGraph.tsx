'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  type GraphInteractionAction,
  type GraphInteractionState,
} from '../../graph/interaction';
import type {
  GraphLayout,
  GraphManifest,
  GraphNodeId,
} from '../../graph/types';
import { GraphEdges } from './GraphEdges';
import { GraphNodeView } from './GraphNode';

export type KnowledgeGraphProps = {
  readonly manifest: GraphManifest;
  readonly layout: GraphLayout;
  readonly graphDensity: number;
  readonly interaction: GraphInteractionState;
  readonly onAction: (action: GraphInteractionAction) => void;
  readonly reducedMotion: boolean;
};

type ProjectedNode = {
  readonly id: GraphNodeId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
};

function projectDomainNodes(
  manifest: GraphManifest,
  layout: GraphLayout,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): readonly ProjectedNode[] {
  const rect = canvas.getBoundingClientRect();
  const projected: ProjectedNode[] = [];

  for (const node of manifest.nodes) {
    if (node.kind !== 'domain') {
      continue;
    }

    const position = layout[node.id];
    const center = new THREE.Vector3(position[0], position[1], position[2]);
    const edge = new THREE.Vector3(
      position[0] + 0.62,
      position[1],
      position[2],
    );
    center.project(camera);
    edge.project(camera);

    projected.push({
      id: node.id,
      x: rect.left + ((center.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - center.y) / 2) * rect.height,
      radius: Math.max(18, Math.abs(edge.x - center.x) * rect.width / 2 + 10),
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
  manifest,
  layout,
  interaction,
  onAction,
}: Pick<KnowledgeGraphProps, 'manifest' | 'layout' | 'interaction' | 'onAction'>) {
  const { camera, gl } = useThree();
  const hoveredNodeRef = useRef<GraphNodeId | null>(interaction.hoveredNodeId);
  const domainNodes = useMemo(
    () => manifest.nodes.filter((node) => node.kind === 'domain'),
    [manifest],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    const updateHover = (event: PointerEvent) => {
      const projectedNodes = projectDomainNodes(
        { ...manifest, nodes: domainNodes },
        layout,
        camera,
        canvas,
      );
      const nextNodeId = pickDomainNode(event, projectedNodes);
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
      const projectedNodes = projectDomainNodes(
        { ...manifest, nodes: domainNodes },
        layout,
        camera,
        canvas,
      );
      const nodeId = pickDomainNode(event as unknown as PointerEvent, projectedNodes);
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
  }, [camera, domainNodes, gl, interaction.focusedNodeId, layout, manifest, onAction]);

  return null;
}

export function KnowledgeGraph({
  manifest,
  layout,
  graphDensity,
  interaction,
  onAction,
  reducedMotion,
}: KnowledgeGraphProps) {
  return (
    <group name="knowledge-graph">
      <GraphPointerBoundary
        interaction={interaction}
        layout={layout}
        manifest={manifest}
        onAction={onAction}
      />
      <GraphEdges
        edges={manifest.edges}
        graphDensity={graphDensity}
        interaction={interaction}
        layout={layout}
        reducedMotion={reducedMotion}
      />
      {manifest.nodes
        .filter((node) => node.kind === 'domain')
        .map((node) => (
          <GraphNodeView
            interaction={interaction}
            key={node.id}
            node={node}
            position={layout[node.id]}
          />
        ))}
    </group>
  );
}
