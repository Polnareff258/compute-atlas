'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import type { FieldUniforms } from '../field/fieldUniforms';
import {
  buildMatterField,
  type MatterFieldSpec,
  type MatterRegion,
} from './dataMatter';
import { createDataMatterMaterial } from './dataMatterMaterial';

export type DataMatterProps = {
  readonly uniforms: FieldUniforms;
  readonly rift: MatterRegion;
  readonly regions: readonly MatterRegion[];
  readonly count: number;
  /** 0..1, from the quality profile. */
  readonly density: number;
  readonly seed?: number;
};

/** The quad every streak is an instance of. Two triangles, four vertices. */
function createStreakQuad(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * The information-matter field.
 *
 * One draw call for the whole substance. The geometry is a four-vertex quad and
 * the entire field — position, orientation, length, width, colour, opacity — is
 * decided in the vertex shader from static per-instance attributes and the
 * shared uniform block.
 *
 * `frustumCulled` is off on purpose. The bounding sphere of a field whose
 * positions are computed on the GPU is the bounding sphere of its *homes*, which
 * is a different and smaller volume than the one it actually occupies once the
 * flow and the corridor have moved it. Culling against it makes the field
 * disappear at the edge of the frame, which is the one place the composition
 * cannot afford a hole.
 */
export function DataMatterView({
  uniforms,
  rift,
  regions,
  count,
  density,
  seed = 17,
}: DataMatterProps) {
  const spec: MatterFieldSpec = useMemo(
    () => ({ regions, rift, count, density, seed }),
    [regions, rift, count, density, seed],
  );

  const geometry = useMemo(() => {
    const quad = createStreakQuad();
    const field = buildMatterField(spec);
    if (field.count === 0) return quad;

    quad.setAttribute(
      'aHome',
      new THREE.InstancedBufferAttribute(field.home, 3),
    );
    quad.setAttribute(
      'aSeed',
      new THREE.InstancedBufferAttribute(field.seed, 3),
    );
    quad.setAttribute(
      'aKind',
      new THREE.InstancedBufferAttribute(field.kind, 1),
    );
    quad.setAttribute(
      'aExtent',
      new THREE.InstancedBufferAttribute(field.extent, 3),
    );
    quad.setAttribute(
      'aForm',
      new THREE.InstancedBufferAttribute(field.form, 1),
    );
    quad.setAttribute(
      'aScale',
      new THREE.InstancedBufferAttribute(field.scale, 1),
    );
    quad.instanceCount = field.count;
    return quad;
  }, [spec]);

  const material = useMemo(
    () => createDataMatterMaterial({ uniforms, density }),
    [uniforms, density],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <mesh
      geometry={geometry}
      material={material.material}
      frustumCulled={false}
      name="data-matter"
    />
  );
}
