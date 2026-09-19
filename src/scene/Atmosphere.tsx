'use client';

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { deriveAtmosphereDescriptor } from './atmosphereDescriptor';

type AtmosphereProps = {
  readonly reducedMotion?: boolean;
};

export function Atmosphere({ reducedMotion = false }: AtmosphereProps): JSX.Element {
  const descriptor = useMemo(() => deriveAtmosphereDescriptor(), []);
  const resources = useMemo(() => {
    const lines = descriptor.traces.map((trace) => {
      const values = new Float32Array(trace.points.length * 3);
      trace.points.forEach((point, index) => values.set(point, index * 3));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
      const material = new THREE.LineBasicMaterial({
        color: '#859a9a',
        depthWrite: false,
        opacity: trace.opacity * (reducedMotion ? 0.76 : 1),
        transparent: true,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      return line;
    });
    const pointValues = new Float32Array(
      descriptor.traces.flatMap((trace) => trace.points.flatMap((point) => [...point])),
    );
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(pointValues, 3));
    const pointMaterial = new THREE.PointsMaterial({
      color: '#afc0bf',
      depthWrite: false,
      opacity: reducedMotion ? 0.08 : 0.13,
      size: 0.018,
      sizeAttenuation: true,
      transparent: true,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);
    points.frustumCulled = false;
    return { lines, points };
  }, [descriptor, reducedMotion]);

  useEffect(() => () => {
    for (const line of resources.lines) {
      line.geometry.dispose();
      line.material.dispose();
    }
    resources.points.geometry.dispose();
    resources.points.material.dispose();
  }, [resources]);

  return (
    <group name="scene-atmosphere">
      {resources.lines.map((line, index) => <primitive key={'trace-' + index} object={line} />)}
      <primitive object={resources.points} />
    </group>
  );
}
