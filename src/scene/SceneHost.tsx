'use client';

import { extend } from '@react-three/fiber';
import * as THREE from 'three';

import { Atmosphere } from './Atmosphere';

extend({
  BufferAttribute: THREE.BufferAttribute,
  BufferGeometry: THREE.BufferGeometry,
  Color: THREE.Color,
  FogExp2: THREE.FogExp2,
  Group: THREE.Group,
  IcosahedronGeometry: THREE.IcosahedronGeometry,
  Mesh: THREE.Mesh,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  Points: THREE.Points,
  PointsMaterial: THREE.PointsMaterial,
  TorusGeometry: THREE.TorusGeometry,
});

export function SceneHost() {
  return (
    <>
      <color attach="background" args={['#050609']} />
      <fogExp2 attach="fog" args={['#050609', 0.035]} />
      <Atmosphere />
    </>
  );
}
