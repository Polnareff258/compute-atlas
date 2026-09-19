'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import { deriveGraphEdgePoints } from '../../graph/layout';
import type { GraphInteractionState } from '../../graph/interaction';
import type { GraphEdge, GraphLayout } from '../../graph/types';

type GraphEdgesProps = {
  readonly edges: readonly GraphEdge[];
  readonly layout: GraphLayout;
  readonly graphDensity: number;
  readonly interaction: GraphInteractionState;
  readonly reducedMotion: boolean;
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
  reducedMotion,
}: {
  readonly edge: GraphEdge;
  readonly layout: GraphLayout;
  readonly graphDensity: number;
  readonly interaction: GraphInteractionState;
  readonly reducedMotion: boolean;
}) {
  const points = useMemo(
    () => deriveGraphEdgePoints(edge, layout, graphDensity),
    [edge, graphDensity, layout],
  );
  const appearance = edgeAppearance(edge, interaction);
  const related = isRelated(edge, interaction);
  const pulseRef = useRef<THREE.Mesh>(null);
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

  useFrame((state) => {
    const pulse = pulseRef.current;
    if (!pulse || !related || points.length < 2) return;
    const progress = reducedMotion ? 0.46 : (state.clock.elapsedTime * 0.32 + edge.strength * 0.13) % 1;
    const scaledProgress = progress * (points.length - 1);
    const segment = Math.min(points.length - 2, Math.floor(scaledProgress));
    const local = scaledProgress - segment;
    const start = points[segment];
    const end = points[segment + 1];
    if (!start || !end) return;
    pulse.position.set(
      start[0] + (end[0] - start[0]) * local,
      start[1] + (end[1] - start[1]) * local,
      start[2] + (end[2] - start[2]) * local,
    );
  });

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      line.material.dispose();
    };
  }, [line]);

  return (
    <group>
      <primitive object={line} />
      <mesh ref={pulseRef} visible={related}>
        <sphereGeometry args={[0.034 + edge.strength * 0.012, 8, 6]} />
        <meshBasicMaterial color={appearance.color} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function GraphEdges({
  edges,
  layout,
  graphDensity,
  interaction,
  reducedMotion,
}: GraphEdgesProps) {
  return (
    <group name="graph-edges">
      {edges.map((edge) => (
        <GraphEdgeLine
          edge={edge}
          graphDensity={graphDensity}
          interaction={interaction}
          reducedMotion={reducedMotion}
          key={edge.id}
          layout={layout}
        />
      ))}
    </group>
  );
}
