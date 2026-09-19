'use client';

import { useMemo } from 'react';

import { CORE_COLORS } from './coreMaterials';
import { deriveCoreTopologyActivation } from './coreTopology';
import type { CoreTopology } from './coreTopology';
import type { CoreVisualInput } from './coreTypes';

export type CoreStructuralViewProps = {
  readonly topology: CoreTopology;
  readonly visualInput: CoreVisualInput;
  readonly reducedMotion: boolean;
};

const ORIGIN: readonly [number, number, number] = [0, 0, 0];

/** Layered processing slabs around a compact nucleus; geometry is declarative and static. */
export function CoreNucleus({
  topology,
  visualInput,
  reducedMotion,
}: CoreStructuralViewProps) {
  const activation = useMemo(
    () => deriveCoreTopologyActivation(topology, visualInput),
    [topology, visualInput],
  );
  const activeTarget = topology.nodes.find(
    (node) => node.region !== 'anchor' && activation.activeNodeIds.includes(node.id),
  );
  const direction = activeTarget?.position ?? ORIGIN;
  const stateScale =
    visualInput.visualState === 'focusing'
      ? 1.08
      : visualInput.visualState === 'agent_activity'
        ? 1.04
        : 1;
  const responsiveRotation = reducedMotion
    ? 0
    : direction[0] * 0.08 + direction[2] * 0.035;

  return (
    <group scale={1.85} rotation={[0.18 + direction[1] * 0.04, -0.26 + responsiveRotation, 0.08]}>
      <mesh scale={[0.76 * stateScale, 0.2, 0.42]} position={[-0.08, -0.02, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.nucleus}
          depthWrite={false}
          opacity={0.54}
          transparent
        />
      </mesh>
      <mesh scale={[0.52 * stateScale, 0.12, 0.48]} position={[-0.32, 0.2, 0.02]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.fragment}
          depthWrite={false}
          opacity={0.66}
          transparent
        />
      </mesh>
      <mesh
        position={[0.3, 0.12, -0.02]}
        rotation={[0.08, -0.18, 0.02]}
        scale={[0.46 * stateScale, 0.13, 0.4]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.fragment}
          depthWrite={false}
          opacity={0.46}
          transparent
        />
      </mesh>
      <mesh position={[direction[0] * 0.04, direction[1] * 0.035, 0.205 + direction[2] * 0.025]}>
        <boxGeometry args={[0.34, 0.26, 0.16]} />
        <meshBasicMaterial color={CORE_COLORS.nucleusAccent} depthWrite={false} opacity={0.74} transparent />
      </mesh>
      <mesh position={[-0.58, -0.16, 0.19]} rotation={[0.08, 0.02, -0.12]}>
        <boxGeometry args={[0.3, 0.075, 0.22]} />
        <meshBasicMaterial color={CORE_COLORS.nucleus} depthWrite={false} opacity={0.64} transparent />
      </mesh>
      <mesh position={[0.06, -0.22, -0.28]} rotation={[0.08, 0.12, 0.22]}>
        <boxGeometry args={[0.72, 0.075, 0.14]} />
        <meshBasicMaterial color={CORE_COLORS.nucleusAccent} depthWrite={false} opacity={0.42} transparent />
      </mesh>
      <mesh position={[0.12, 0.34, -0.24]} rotation={[-0.08, -0.14, -0.16]}>
        <boxGeometry args={[0.56, 0.065, 0.12]} />
        <meshBasicMaterial color={CORE_COLORS.nucleus} depthWrite={false} opacity={0.5} transparent />
      </mesh>
    </group>
  );
}
