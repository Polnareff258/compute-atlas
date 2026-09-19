'use client';

import { Html } from '@react-three/drei';
import { useMemo } from 'react';

import type { GraphInteractionState } from '../../graph/interaction';
import type { GraphNode as GraphNodeData, GraphPosition } from '../../graph/types';
import { deriveDomainVisualDescriptor, type DomainVisualNodeId } from './domainVisuals';

export type GraphNodeViewProps = {
  readonly node: GraphNodeData;
  readonly position: GraphPosition;
  readonly interaction: GraphInteractionState;
};

function visualTone(
  isHovered: boolean,
  isFocused: boolean,
  isDimmed: boolean,
): { readonly color: string; readonly opacity: number } {
  if (isDimmed) return { color: '#4b5961', opacity: 0.2 };
  if (isFocused) return { color: '#d6e4e1', opacity: 0.92 };
  if (isHovered) return { color: '#a8bbc1', opacity: 0.78 };
  return { color: '#748893', opacity: 0.48 };
}

/** Distinct deterministic processing silhouette; semantic labels stay secondary. */
export function GraphNodeView({ node, position, interaction }: GraphNodeViewProps) {
  const isHovered = interaction.hoveredNodeId === node.id;
  const isFocused = interaction.focusedNodeId === node.id;
  const isDimmed = interaction.focusedNodeId !== null && !isFocused;
  const tone = visualTone(isHovered, isFocused, isDimmed);
  const descriptor = useMemo(
    () => node.kind === 'domain'
      ? deriveDomainVisualDescriptor(node.id as DomainVisualNodeId, 1)
      : null,
    [node.id, node.kind],
  );

  if (!descriptor) return null;

  return (
    <group
      name={'graph-node-' + node.id}
      position={[position[0], position[1], position[2]]}
      scale={isFocused ? 1.1 : isHovered ? 1.045 : 1}
    >
      {descriptor.members.map((member, index) => (
        <mesh
          key={descriptor.kind + '-' + index}
          position={[...member.position]}
          rotation={[...member.rotation]}
          scale={[...member.scale]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={tone.color}
            depthWrite={false}
            opacity={tone.opacity * (index === 0 ? 0.9 : 0.58)}
            transparent
          />
        </mesh>
      ))}
      <Html
        center={false}
        className='graph-node-label-wrapper'
        distanceFactor={8}
        position={[0.62, 0.32, 0.04]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className={
            'graph-node-label graph-node-label--' +
            (isDimmed ? 'dimmed' : isFocused ? 'focused' : isHovered ? 'hovered' : 'idle')
          }
        >
          <span className="graph-node-label__name">{node.label}</span>
          {isHovered || isFocused ? (
            <span className="graph-node-label__description">{node.description}</span>
          ) : null}
        </div>
      </Html>
    </group>
  );
}
