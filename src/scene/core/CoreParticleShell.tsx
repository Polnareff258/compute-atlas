'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import type { CoreParameters } from './coreTypes';
import { CORE_COLORS } from './coreMaterials';

function createShellPositions(count: number, radius: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const normalized = (index + 0.5) / count;
    const y = 1 - normalized * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    const shellVariation = 1 + Math.sin(index * 0.37) * 0.055;
    const offset = index * 3;

    positions[offset] = Math.cos(angle) * ringRadius * radius * shellVariation;
    positions[offset + 1] = y * radius * shellVariation;
    positions[offset + 2] = Math.sin(angle) * ringRadius * radius * shellVariation;
  }

  return positions;
}

export function CoreParticleShell({
  parameters,
  reducedMotion = false,
}: {
  readonly parameters: CoreParameters;
  readonly reducedMotion?: boolean;
}) {
  const points = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        createShellPositions(parameters.particleBudget, parameters.shellRadius),
        3,
      ),
    );
    const material = new THREE.PointsMaterial({
      color: CORE_COLORS.shell,
      depthWrite: false,
      opacity: 0.36,
      size: parameters.profile === 'ultra' ? 0.014 : 0.018,
      sizeAttenuation: true,
      transparent: true,
    });
    const nextPoints = new THREE.Points(geometry, material);
    nextPoints.frustumCulled = false;
    return nextPoints;
  }, [parameters]);

  const pointsRef = useRef(points);

  useFrame((_, delta) => {
    if (reducedMotion) {
      return;
    }

    pointsRef.current.rotation.y += delta * 0.018;
    pointsRef.current.rotation.x =
      Math.sin(pointsRef.current.rotation.y * 0.46) * 0.035;
  });

  return <primitive object={points} />;
}