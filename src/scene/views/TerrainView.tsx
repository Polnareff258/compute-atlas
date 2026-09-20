'use client';

import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import { createTerrainMaterial } from '../materials/terrainMaterial';
import { createFlowField } from '../watershed/flowField';
import { buildTerrainGeometry } from '../watershed/terrainGeometry';
import type { FieldUniforms } from '../field/fieldUniforms';
import type { WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The landscape's ground, as one mesh.
 *
 * One draw call, one material, one geometry, built once per descriptor and
 * disposed with its owner. The three things it owns are the three things that
 * cost anything — the vertex buffer, the flow texture and the shader — and all
 * three are built in `useMemo` against a dependency list that only changes when
 * the descriptor does, which is to say once.
 *
 * **Why this is not a `<canvas>`-managed resource.** The geometry is a
 * `BufferGeometry` and the material a `MeshBasicNodeMaterial`, and both are handed
 * to R3F rather than created inside a render loop. There is no per-frame
 * allocation anywhere in this file: the uniforms are the scene's one shared
 * mutable singleton, written by `SceneHost` before this mesh draws, and the vertex
 * displacement happens in the shader.
 *
 * **`useMemo` for the build, and that is a deliberate choice about the freeze.**
 * Building the ULTRA mesh measures at about 1.6 seconds on the CPU, and building
 * the flow field adds roughly a quarter of that. That block lands after the entry
 * page has painted — `RendererHost` awaits `root.configure(...)` before it renders
 * the scene graph at all — so the visitor sees the entry page first and the
 * landscape resolves behind it. Doing the build in a worker would remove the
 * block; it would also mean shipping the descriptor's shape across a thread
 * boundary and getting back a buffer whose provenance the tests cannot check. The
 * decision is to measure the block in the browser first and only pay for the
 * worker if it is visible.
 */

export type TerrainViewProps = {
  readonly descriptor: WatershedDescriptor;
  readonly uniforms: FieldUniforms;
  /** World Z the camera stands at. Grading is densest around it. */
  readonly attentionZ: number;
  /** The key light's direction. Passed in so a shot can move it. */
  readonly keyLight: readonly [number, number, number];
};

export function TerrainView({
  descriptor,
  uniforms,
  attentionZ,
  keyLight,
}: TerrainViewProps) {
  const flow = useMemo(
    () =>
      createFlowField({
        field: descriptor.field,
        // The rivers' own bodies, not the channels that carve them: the flow field
        // is what the *material* erodes by, and a channel exists precisely because
        // a river does. Passing both would count every river's work twice.
        rivers: descriptor.rivers.map((river) => ({
          spine: river.spine,
          width: river.width,
          flowRate: river.flowRate,
        })),
        deposits: descriptor.deposits,
        resolution: descriptor.flowResolution,
      }),
    [descriptor],
  );

  const geometry = useMemo(() => {
    const built = buildTerrainGeometry({
      field: descriptor.field,
      resolution: descriptor.terrainResolution,
      attentionZ,
      basin: descriptor.basin.centre,
      basinFloor: descriptor.basinFloor,
      keyLight,
      regions: descriptor.domains.map((domain) => ({
        centre: domain.centre,
        radius: domain.radius,
        ground: domain.palette.ground,
        ambient: domain.palette.ambient,
      })),
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(built.positions, 3));
    result.setAttribute('normal', new BufferAttribute(built.normals, 3));
    result.setAttribute('color', new BufferAttribute(built.colors, 3));
    result.setAttribute('aRegion', new BufferAttribute(built.regions, 2));
    // `Uint32Array` indices have to be declared as such: a `Uint16Array`-typed
    // index buffer at 440 segments would silently truncate the last 130,000
    // vertices' indices, and the failure is a soup of triangles rather than an
    // error. WebGPU supports 32-bit indices unconditionally; WebGL2 needs
    // `OES_element_index_uint`, which is core in WebGL2.
    result.setIndex(new BufferAttribute(built.indices, 1));
    result.computeBoundingSphere();
    return result;
  }, [descriptor, attentionZ, keyLight]);

  const { material, dispose } = useMemo(
    () => createTerrainMaterial(uniforms, flow),
    [uniforms, flow],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      dispose();
      flow.dispose();
    },
    [geometry, dispose, flow],
  );

  return <mesh geometry={geometry} material={material} />;
}
