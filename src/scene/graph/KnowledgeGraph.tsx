'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  type GraphInteractionAction,
  type GraphInteractionState,
} from '../../graph/interaction';
import {
  NAMED_DOMAIN_PROMINENCE,
  type GraphProminence,
} from '../../graph/layout';
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
  /**
   * How much of the composition each node is given at rest, from the layout.
   *
   * Idle is ranked rather than uniform: the brief's "only two or three domains
   * mid-visible, the rest dormant" is a property of the composition, so it is
   * read from the layout rather than recomputed here.
   */
  readonly prominence: GraphProminence;
  /** Every domain's sub-environment, in manifest routing order. */
  readonly environments: readonly DomainEnvironmentEntry[];
  /** Trunks, branches, approaches and each domain's own internal circuits. */
  readonly fieldCurves: readonly RouteCurve[];
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly backend: RendererAdapterBackend;
  /** Whether this profile pays for GPU advection; selects the field's implementation. */
  readonly advection: boolean;
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
 * Domains are large objects with depth, so the pick radius comes from the
 * projected envelope rather than from a fixed constant — otherwise the outer
 * layers of a sub-environment would be visible but not clickable.
 *
 * The envelope is the domain's own box, projected corner by corner. Measuring
 * it with one diagonal offset instead was a real defect and not a subtle one:
 * the estimate came out at about a fifth of the body's screen width, so the
 * outer four fifths of a domain looked like a thing you could point at and was
 * not. Nothing caught it while the camera sat close, because the estimate was
 * generous enough at that distance to cover most of the body; moving the camera
 * back to frame the rebuilt Core is what exposed it.
 *
 * The radius is the *smaller* half-extent rather than the diagonal, so a wide
 * domain does not claim the space beside it. Two domains are never within a
 * factor of two on screen, so nothing is stolen either way.
 */
function projectDomainNodes(
  environments: readonly DomainEnvironmentEntry[],
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): readonly ProjectedNode[] {
  const rect = canvas.getBoundingClientRect();
  const projected: ProjectedNode[] = [];
  const center = new THREE.Vector3();
  const corner = new THREE.Vector3();

  for (const entry of environments) {
    const { anchor, extent } = entry.environment;
    center.set(anchor[0], anchor[1], anchor[2]).project(camera);

    let halfWidth = 0;
    let halfHeight = 0;
    for (const [signX, signY] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      corner
        .set(anchor[0] + extent * signX, anchor[1] + extent * signY, anchor[2])
        .project(camera);
      halfWidth = Math.max(halfWidth, Math.abs(corner.x - center.x));
      halfHeight = Math.max(halfHeight, Math.abs(corner.y - center.y));
    }

    projected.push({
      id: entry.environment.nodeId,
      x: rect.left + ((center.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - center.y) / 2) * rect.height,
      radius: Math.max(
        24,
        Math.min(halfWidth * rect.width, halfHeight * rect.height) * 0.7,
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
  prominence,
  environments,
  fieldCurves,
  flowRef,
  backend,
  advection,
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
        advection={advection}
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
        const resting = prominence[nodeId];
        // At rest, only the domains the composition is about carry their name.
        // Text is the scarcest thing in the frame, and the idle composition
        // spends it on three domains rather than on all five.
        const named = Number.isFinite(resting) && resting >= NAMED_DOMAIN_PROMINENCE;

        return (
          <DomainEnvironmentView
            activation={isFocused ? 1 : isHovered ? HOVER_ACTIVATION : 0}
            description={copy?.description ?? ''}
            dimmed={othersRecede}
            environment={entry.environment}
            key={nodeId}
            label={copy?.label ?? nodeId}
            presence={Number.isFinite(resting) ? resting : 0}
            reducedMotion={reducedMotion}
            showDescription={isFocused || isHovered}
            showLabel={(isFocused || isHovered || named) && !othersRecede}
          />
        );
      })}
    </group>
  );
}
