'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { deriveGraphEdgePoints } from '../../graph/layout';
import type { GraphInteractionState } from '../../graph/interaction';
import type { GraphEdge, GraphLayout } from '../../graph/types';

type GraphEdgesProps = {
  readonly edges: readonly GraphEdge[];
  readonly layout: GraphLayout;
  readonly graphDensity: number;
  readonly interaction: GraphInteractionState;
};

function isRelated(
  edge: GraphEdge,
  interaction: GraphInteractionState,
): boolean {
  const activeNodeId =
    interaction.focusedNodeId ?? interaction.hoveredNodeId;
  return (
    activeNodeId !== null &&
    (edge.source === activeNodeId || edge.target === activeNodeId)
  );
}

function edgeAppearance(
  edge: GraphEdge,
  interaction: GraphInteractionState,
): { readonly color: string; readonly opacity: number } {
  const activeNodeId =
    interaction.focusedNodeId ?? interaction.hoveredNodeId;
  const related = isRelated(edge, interaction);

  if (activeNodeId === null) {
    return { color: '#60717b', opacity: 0.11 + edge.strength * 0.07 };
  }

  if (related) {
    return {
      color: interaction.focusedNodeId ? '#b5c7c8' : '#8fa7ad',
      opacity: 0.36 + edge.strength * 0.18,
    };
  }

  return { color: '#39474f', opacity: 0.035 };
}

function GraphEdgeLine({
  edge,
  layout,
  graphDensity,
  interaction,
}: {
  readonly edge: GraphEdge;
  readonly layout: GraphLayout;
  readonly graphDensity: number;
  readonly interaction: GraphInteractionState;
}) {
  const points = useMemo(
    () => deriveGraphEdgePoints(edge, layout, graphDensity),
    [edge, graphDensity, layout],
  );
  const appearance = edgeAppearance(edge, interaction);
  const line = useMemo(() => {
    const values = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      const offset = index * 3;
      values[offset] = point[0];
      values[offset + 1] = point[1];
      values[offset + 2] = point[2];
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
    const material = new THREE.LineBasicMaterial({
      color: appearance.color,
      depthWrite: false,
      opacity: appearance.opacity,
      transparent: true,
    });
    const nextLine = new THREE.Line(geometry, material);
    nextLine.frustumCulled = false;
    return nextLine;
  }, [appearance.color, appearance.opacity, points]);

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      line.material.dispose();
    };
  }, [line]);

  return <primitive object={line} />;
}

export function GraphEdges({
  edges,
  layout,
  graphDensity,
  interaction,
}: GraphEdgesProps) {
  return (
    <group name="graph-edges">
      {edges.map((edge) => (
        <GraphEdgeLine
          edge={edge}
          graphDensity={graphDensity}
          interaction={interaction}
          key={edge.id}
          layout={layout}
        />
      ))}
    </group>
  );
}
