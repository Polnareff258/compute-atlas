import { describe, expect, it } from 'vitest';
import { InterleavedBufferAttribute } from 'three';
import type * as THREE from 'three';

import { deriveRouteDashAttributes, type RouteCurve } from './routeDash';
import { createRouteDashGeometry } from './routeDashGeometry';

/**
 * WebGPU's guaranteed `maxVertexBuffers`. A pipeline that exceeds it does not
 * build, so every attribute of one draw has to fit inside this budget.
 */
const MAX_VERTEX_BUFFERS = 8;

const CURVES: readonly RouteCurve[] = [
  {
    id: 0,
    rank: 0,
    route: 'primary',
    group: 0,
    start: [0, 0, 0],
    control: [1, 0.5, 0],
    end: [2, 0, 0],
  },
  {
    id: 1,
    rank: 1,
    route: 'secondary',
    group: 1,
    start: [0, 1, 0],
    control: [1, 1.5, 0],
    end: [2, 1, 0],
  },
];

function geometryFor() {
  return createRouteDashGeometry(deriveRouteDashAttributes(CURVES, 3, 17));
}

/**
 * Counts the buffers the GPU would actually bind.
 *
 * Three collapses attributes that share one `InterleavedBuffer` into a single
 * vertex buffer, so the count is distinct backing buffers rather than distinct
 * attribute names — which is what WebGPU validates.
 */
function vertexBufferCount(geometry: THREE.BufferGeometry): number {
  const buffers = new Set<unknown>();
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    buffers.add(
      attribute instanceof InterleavedBufferAttribute
        ? attribute.data
        : attribute,
    );
  }
  return buffers.size;
}

describe('createRouteDashGeometry', () => {
  it('binds one vertex buffer, so the WebGPU pipeline can build', () => {
    const geometry = geometryFor();

    // Twelve separate attributes is what the field needs, and twelve separate
    // buffers is what WebGPU refuses; interleaving is the whole point of this
    // builder rather than a storage detail it happens to have.
    expect(Object.keys(geometry.attributes).length).toBeGreaterThan(
      MAX_VERTEX_BUFFERS,
    );
    expect(vertexBufferCount(geometry)).toBe(1);
    expect(vertexBufferCount(geometry)).toBeLessThanOrEqual(MAX_VERTEX_BUFFERS);
  });

  it('reassembles the packed channels, component for component', () => {
    const attributes = deriveRouteDashAttributes(CURVES, 3, 17);
    const geometry = createRouteDashGeometry(attributes);
    const read = (name: string, vertex: number, component: number) =>
      geometry.getAttribute(name).getComponent(vertex, component);

    for (let vertex = 0; vertex < attributes.vertexCount; vertex += 1) {
      for (let component = 0; component < 3; component += 1) {
        expect(read('dashStart', vertex, component)).toBe(
          attributes.start[vertex * 3 + component],
        );
        expect(read('dashControl', vertex, component)).toBe(
          attributes.control[vertex * 3 + component],
        );
        expect(read('dashEnd', vertex, component)).toBe(
          attributes.end[vertex * 3 + component],
        );
      }
      expect(read('dashCorner', vertex, 0)).toBe(attributes.corner[vertex * 2]);
      expect(read('dashCorner', vertex, 1)).toBe(
        attributes.corner[vertex * 2 + 1],
      );
      // The geometry prefixes every channel; the packer names them bare.
      for (const [name, packed] of [
        ['dashPhase', attributes.phase],
        ['dashSpeed', attributes.speed],
        ['dashLength', attributes.length],
        ['dashWidth', attributes.width],
        ['dashRoute', attributes.route],
        ['dashGroup', attributes.group],
        ['dashBrightness', attributes.brightness],
      ] as const) {
        expect(read(name, vertex, 0)).toBe(packed[vertex]);
      }
    }
  });

  it('keeps the position channel zeroed, because the vertex shader ignores it', () => {
    const geometry = geometryFor();
    const position = geometry.getAttribute('position');
    const vertexCount = position.count;

    expect(vertexCount).toBeGreaterThan(0);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      for (let component = 0; component < 3; component += 1) {
        expect(position.getComponent(vertex, component)).toBe(0);
      }
    }
  });

  it('carries the index through unchanged so the draw range still selects it', () => {
    const attributes = deriveRouteDashAttributes(CURVES, 3, 17);
    const geometry = createRouteDashGeometry(attributes);
    const index = geometry.getIndex();

    expect(index).not.toBeNull();
    expect(index!.count).toBe(attributes.indices.length);
    for (let slot = 0; slot < attributes.indices.length; slot += 1) {
      expect(index!.getX(slot)).toBe(attributes.indices[slot]);
    }
  });

  it('is deterministic, so the uploaded buffer is stable across builds', () => {
    const first = geometryFor();
    const second = geometryFor();

    expect(
      Array.from(first.getAttribute('position').array as Float32Array),
    ).toEqual(Array.from(second.getAttribute('position').array as Float32Array));
    const a = first.getAttribute('dashStart').array as Float32Array;
    const b = second.getAttribute('dashStart').array as Float32Array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('builds an empty field rather than throwing when there are no curves', () => {
    const geometry = createRouteDashGeometry(deriveRouteDashAttributes([], 3, 17));

    expect(geometry.getAttribute('position').count).toBe(0);
    expect(vertexBufferCount(geometry)).toBe(1);
  });
});
