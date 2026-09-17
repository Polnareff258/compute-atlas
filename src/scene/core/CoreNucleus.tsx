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

/** A small, asymmetric anchor assembly rather than a second spherical core. */
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
    <group rotation={[0.18 + direction[1] * 0.04, -0.26 + responsiveRotation, 0.08]}>
      <mesh scale={[0.26 * stateScale, 0.07, 0.12]} position={[-0.05, 0.02, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.nucleus}
          depthWrite={false}
          opacity={0.62}
          transparent
          wireframe
        />
      </mesh>
      <mesh rotation={[0.42, 0.18, -0.24]} scale={[0.13, 0.24 * stateScale, 0.06]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.nucleusAccent}
          depthWrite={false}
          opacity={0.48}
          transparent
          wireframe
        />
      </mesh>
      <mesh
        position={[direction[0] * 0.025, direction[1] * 0.025, direction[2] * 0.025]}
        rotation={[0.12, -0.34, 0.3]}
        scale={[0.08, 0.05, 0.22]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.nucleusAccent}
          depthWrite={false}
          opacity={0.56}
          transparent
        />
      </mesh>
    </group>
  );
}
