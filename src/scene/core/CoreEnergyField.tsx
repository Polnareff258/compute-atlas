'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';

export function CoreEnergyField({
  radius = 1.94,
  resolution = 48,
  reducedMotion = false,
}: {
  readonly radius?: number;
  readonly resolution?: number;
  readonly reducedMotion?: boolean;
}) {
  const fieldMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: CORE_COLORS.field,
        depthWrite: false,
        opacity: 0.065,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    [],
  );
  const shellMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CORE_COLORS.field,
        depthWrite: false,
        opacity: 0.115,
        side: THREE.DoubleSide,
        transparent: true,
        wireframe: true,
      }),
    [],
  );
  const fieldMaterialRef = useRef(fieldMaterial);
  const shellMaterialRef = useRef(shellMaterial);
  const field = useMemo(() => {
    const geometry = new THREE.SphereGeometry(
      radius,
      resolution,
      Math.max(12, Math.floor(resolution * 0.66)),
    );
    return new THREE.Mesh(geometry, fieldMaterial);
  }, [radius, resolution, fieldMaterial]);
  const shell = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(radius * 0.98, 2);
    return new THREE.Mesh(geometry, shellMaterial);
  }, [radius, shellMaterial]);
  const shellRef = useRef(shell);

  useFrame((state, delta) => {
    const pulse = reducedMotion
      ? 0.78
      : 0.78 + Math.sin(state.clock.elapsedTime * 1.35) * 0.09;
    fieldMaterialRef.current.opacity = pulse * 0.085;
    shellMaterialRef.current.opacity = pulse * 0.14;

    if (!reducedMotion) {
      shellRef.current.rotation.y -= delta * 0.025;
      shellRef.current.rotation.x =
        Math.sin(state.clock.elapsedTime * 0.26) * 0.025;
    }
  });

  return (
    <group>
      <primitive object={field} />
      <primitive object={shell} />
    </group>
  );
}