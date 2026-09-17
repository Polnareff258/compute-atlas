'use client';

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';

const ORBIT_DATA = [
  { radius: 2.48, tube: 0.006, rotation: [Math.PI / 2.3, 0.16, 0.18] },
  { radius: 2.76, tube: 0.004, rotation: [0.38, -0.48, -0.52] },
  { radius: 3.02, tube: 0.003, rotation: [1.02, 0.42, 0.28] },
] as const;

export function CoreOrbitals({
  count,
  reducedMotion = false,
}: {
  readonly count: number;
  readonly reducedMotion?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const orbitData = ORBIT_DATA.slice(0, count);

  useFrame((_, delta) => {
    if (!groupRef.current || reducedMotion) {
      return;
    }

    groupRef.current.rotation.y -= delta * 0.032;
    groupRef.current.rotation.x = Math.sin(groupRef.current.rotation.y * 0.3) * 0.03;
  });

  return (
    <group ref={groupRef}>
      {orbitData.map((orbit, index) => (
        <mesh key={orbit.radius} rotation={orbit.rotation}>
          <torusGeometry args={[orbit.radius, orbit.tube, 8, 192]} />
          <meshBasicMaterial
            color={index === 0 ? CORE_COLORS.orbit : CORE_COLORS.quiet}
            depthWrite={false}
            opacity={index === 0 ? 0.42 : 0.22}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
}