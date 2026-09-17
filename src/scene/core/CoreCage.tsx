'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

import { CORE_COLORS } from './coreMaterials';

export function CoreCage({
  detail,
  radius = 1.28,
}: {
  readonly detail: number;
  readonly radius?: number;
}) {
  const lineSegments = useMemo(() => {
    const base = new THREE.IcosahedronGeometry(radius, detail);
    const edges = new THREE.EdgesGeometry(base, 12);
    base.dispose();
    const material = new THREE.LineBasicMaterial({
      color: CORE_COLORS.quiet,
      depthWrite: false,
      opacity: 0.42,
      transparent: true,
    });
    return new THREE.LineSegments(edges, material);
  }, [detail, radius]);

  return <primitive object={lineSegments} />;
}