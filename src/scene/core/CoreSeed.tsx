'use client';

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';

export function CoreSeed({ reducedMotion = false }: { readonly reducedMotion?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const shellMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    if (!groupRef.current) {
      return;
    }

    if (!reducedMotion) {
      groupRef.current.rotation.x += delta * 0.12;
      groupRef.current.rotation.y -= delta * 0.18;
      groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.32) * 0.04;
    }

    if (shellMaterialRef.current) {
      shellMaterialRef.current.opacity =
        0.22 + Math.sin(state.clock.elapsedTime * 1.1) * 0.035;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[0.18, -0.28, 0.08]}>
        <icosahedronGeometry args={[0.7, 2]} />
        <meshBasicMaterial
          color={CORE_COLORS.ink}
          depthWrite={false}
          opacity={0.34}
          transparent
          wireframe
        />
      </mesh>
      <mesh scale={0.72}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshBasicMaterial
          ref={shellMaterialRef}
          color={CORE_COLORS.seed}
          depthWrite={false}
          opacity={0.22}
          transparent
          wireframe
        />
      </mesh>
      <mesh scale={0.36}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshBasicMaterial
          color={CORE_COLORS.ink}
          depthWrite={false}
          opacity={0.46}
          transparent
          wireframe
        />
      </mesh>
    </group>
  );
}