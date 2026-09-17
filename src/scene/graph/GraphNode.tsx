'use client';

import { Html } from '@react-three/drei';

import type { GraphInteractionState } from '../../graph/interaction';
import type { GraphNode as GraphNodeData, GraphPosition } from '../../graph/types';

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
  if (isDimmed) {
    return { color: '#4b5961', opacity: 0.28 };
  }

  if (isFocused) {
    return { color: '#d6e4e1', opacity: 0.94 };
  }

  if (isHovered) {
    return { color: '#a8bbc1', opacity: 0.84 };
  }

  return { color: '#748893', opacity: 0.56 };
}

export function GraphNodeView({
  node,
  position,
  interaction,
}: GraphNodeViewProps) {
  const isHovered = interaction.hoveredNodeId === node.id;
  const isFocused = interaction.focusedNodeId === node.id;
  const isDimmed =
    interaction.focusedNodeId !== null && !isFocused;
  const tone = visualTone(isHovered, isFocused, isDimmed);
  const radius = 0.105 + node.importance * 0.032;
  const ringScale = isFocused ? 1.36 : isHovered ? 1.2 : 1;

  return (
    <group
      name={'graph-node-' + node.id}
      position={[position[0], position[1], position[2]]}
      scale={isFocused ? 1.12 : isHovered ? 1.06 : 1}
    >
      <mesh scale={ringScale}>
        <torusGeometry args={[radius * 1.45, 0.008, 6, 32]} />
        <meshBasicMaterial
          color={tone.color}
          depthWrite={false}
          opacity={tone.opacity * 0.76}
          transparent
        />
      </mesh>
      <mesh scale={isFocused ? 1.16 : 1}>
        <icosahedronGeometry args={[radius, 1]} />
        <meshBasicMaterial
          color={tone.color}
          depthWrite={false}
          opacity={tone.opacity}
          transparent
          wireframe
        />
      </mesh>
      <Html
        center={false}
        className='graph-node-label-wrapper'
        distanceFactor={8}
        position={[radius * 1.9, radius * 0.9, 0]}
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
            <span className="graph-node-label__description">
              {node.description}
            </span>
          ) : null}
        </div>
      </Html>
    </group>
  );
}