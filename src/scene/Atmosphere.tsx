'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const PARTICLE_COUNT = 1_800;

function createParticlePositions(): Float32Array {
  const positions = new Float32Array(PARTICLE_COUNT * 3);

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const angle = index * 2.39996323;
    const radius = 1.4 + ((index * 17) % 100) / 100 * 2.8;
    const height = Math.sin(index * 0.73) * 1.2;
    const offset = index * 3;

    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = height;
    positions[offset + 2] = Math.sin(angle) * radius;
  }

  return positions;
}

export function Atmosphere() {
  const groupRef = useRef<THREE.Group>(null);
  const particlePositions = useMemo(() => createParticlePositions(), []);

  useFrame((_, delta) => {
    if (!groupRef.current) {
      return;
    }

    groupRef.current.rotation.y += delta * 0.028;
    groupRef.current.rotation.x = Math.sin(performance.now() * 0.00012) * 0.06;
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particlePositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#b6c8c4"
          depthWrite={false}
          opacity={0.32}
          size={0.018}
          sizeAttenuation
          transparent
        />
      </points>
      <mesh rotation={[0.28, 0.15, 0]}>
        <icosahedronGeometry args={[1.05, 2]} />
        <meshBasicMaterial
          color="#c8d4d0"
          depthWrite={false}
          opacity={0.17}
          transparent
          wireframe
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0.1, 0]}>
        <torusGeometry args={[1.62, 0.004, 12, 180]} />
        <meshBasicMaterial
          color="#91aaa7"
          depthWrite={false}
          opacity={0.38}
          transparent
        />
      </mesh>
      <mesh rotation={[0.12, 0, -0.52]}>
        <torusGeometry args={[1.92, 0.0025, 10, 180]} />
        <meshBasicMaterial
          color="#718582"
          depthWrite={false}
          opacity={0.26}
          transparent
        />
      </mesh>
    </group>
  );
}
