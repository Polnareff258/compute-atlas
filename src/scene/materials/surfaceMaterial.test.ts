import { describe, expect, it } from 'vitest';

import * as THREE from 'three';

import { SURFACE_RESPONSE_CURVES, type SurfaceRole } from './machinePalette';
import { createSurfaceMaterial } from './surfaceMaterial';

const ROLES: readonly SurfaceRole[] = [
  'shell',
  'edge',
  'recess',
  'accent',
  'membrane',
  'port',
];

/** The opaque tier, which is the one whose whole vocabulary is colour. */
const SOLID_ROLES: readonly SurfaceRole[] = [
  'shell',
  'edge',
  'recess',
  'accent',
  'port',
];

function create(role: SurfaceRole, overrides: Record<string, unknown> = {}) {
  return createSurfaceMaterial({
    role,
    color: '#ffffff',
    ...overrides,
  } as Parameters<typeof createSurfaceMaterial>[0]);
}

describe('createSurfaceMaterial', () => {
  it('builds a stock material with no custom colour chain', () => {
    const stock = new THREE.MeshBasicMaterial();

    for (const role of ROLES) {
      const handle = create(role);
      const material = handle.material as unknown as Record<string, unknown>;

      expect((handle.material as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial).toBe(true);
      expect(handle.material.type).toBe('MeshBasicMaterial');

      // The regression guard, and the reason this test exists.
      //
      // The scene used to build a `MeshBasicNodeMaterial` on WebGPU whose colour
      // node read `baseColor * vertexColor()`, while three's own
      // `NodeMaterial.setupDiffuseColor` multiplies `colorNode` by
      // `vertexColor()` again. Every baked facet luminance was applied twice, so
      // a face baked at 0.5 rendered at 0.25, and the same frame read 83 on
      // WebGPU against 143 on WebGL2. A stock material applies the vertex colour
      // exactly once, and these assertions are what stop a private colour chain
      // coming back and disagreeing with WebGL2.
      expect(material.colorNode).toBeUndefined();
      expect(material.shaderNode).toBeUndefined();
      expect(material.onBeforeCompile).toBe(stock.onBeforeCompile);
      expect(material.customProgramCacheKey).toBe(stock.customProgramCacheKey);

      // Both backends read the same `color` attribute, which is where the whole
      // orientation read lives.
      expect(handle.material.vertexColors).toBe(true);

      handle.dispose();
    }

    stock.dispose();
  });

  it('takes no backend argument, so it cannot draw two different images', () => {
    const first = create('shell');
    const second = create('shell');

    // Same config, same result: there is no branch left to disagree about.
    expect(first.material.color.getHex()).toBe(second.material.color.getHex());

    first.dispose();
    second.dispose();
  });

  it('answers state through the colour multiplier on opaque roles', () => {
    for (const role of SOLID_ROLES) {
      const handle = create(role);
      const material = handle.material;

      handle.updateInput({ activity: 0, focus: 0 });
      const rest = material.color.r;

      handle.updateInput({ activity: 1, focus: 1 });
      const active = material.color.r;

      // The response has to be visible on an opaque surface, which means it has
      // to land on `color`. Opacity is the trap: an opaque material ignores it,
      // and the scene previously wrote its whole response there.
      expect(active).toBeGreaterThan(rest);
      expect(material.opacity).toBe(1);
      expect(material.transparent).toBe(false);

      const curve = SURFACE_RESPONSE_CURVES[role];
      expect(rest).toBeCloseTo(curve.gainAtRest, 6);
      // The base colour is white here, so the multiplier is the red channel
      // exactly. It is *not* clamped: the response is a bounded ramp and a
      // clipping term would be a second, invisible one.
      expect(active).toBeCloseTo(
        curve.gainAtRest + curve.gainFromActivity + curve.gainFromFocus,
        6,
      );

      handle.dispose();
    }
  });

  it('answers a routing field arriving without any other state', () => {
    // This is what lets a manifold light where the flow is, rather than lighting
    // whole because the structure it belongs to is busy.
    for (const role of SOLID_ROLES) {
      const handle = create(role);

      handle.updateInput({ activity: 0, focus: 0 });
      const rest = handle.material.color.r;

      handle.updateInput({ activity: 0, focus: 0, proximity: 1 });
      const arriving = handle.material.color.r;

      expect(arriving).toBeGreaterThan(rest);
      expect(arriving - rest).toBeCloseTo(
        SURFACE_RESPONSE_CURVES[role].gainFromProximity,
        6,
      );

      handle.dispose();
    }
  });

  it('recedes below its resting response when the composition gives it less room', () => {
    const handle = create('recess');

    handle.updateInput({ activity: 0, focus: 0 });
    const rest = handle.material.color.r;

    handle.updateInput({ activity: 0, focus: 0, presence: 0.25 });
    const receded = handle.material.color.r;

    // `gainAtRest` is a floor on every other input, so presence is the only one
    // that can draw a dormant domain's silhouette back into the depth.
    expect(receded).toBeLessThan(rest);
    expect(receded).toBeCloseTo(rest * 0.25, 6);

    handle.dispose();
  });

  it('keeps structural solids depth-writing and membranes blended', () => {
    for (const role of ROLES) {
      const handle = create(role);

      if (role === 'membrane') {
        // No depth write: membranes layer over the structure instead of
        // occluding it, and they blend rather than dithering to a hard edge.
        expect(handle.material.depthWrite).toBe(false);
        expect(handle.material.transparent).toBe(true);
        expect(handle.material.opacity).toBeGreaterThan(0);
        expect(handle.material.opacity).toBeLessThan(1);
      } else {
        expect(handle.material.depthWrite).toBe(true);
        expect(handle.material.transparent).toBe(false);
        expect(handle.material.opacity).toBe(1);
      }

      // Depth attenuation is the scene's one shared depth term on both
      // backends; a handle that opted out would recede differently per backend.
      expect(handle.material.fog).toBe(true);

      handle.dispose();
    }
  });

  it('advances membrane openness with activity and focus without passing the bounds', () => {
    const handle = create('membrane', { baseFade: 0.2, color: '#a3c0b6' });

    const closedAtRest = handle.material.opacity;
    handle.updateInput({ activity: 1, focus: 1 });
    const openUnderFocus = handle.material.opacity;

    expect(openUnderFocus).toBeGreaterThan(closedAtRest);
    expect(openUnderFocus).toBeLessThanOrEqual(0.46);

    handle.updateInput({
      activity: Number.POSITIVE_INFINITY,
      focus: Number.NaN,
    });
    expect(Number.isFinite(handle.material.opacity)).toBe(true);
    expect(handle.material.opacity).toBeLessThanOrEqual(0.46);

    handle.dispose();
  });

  it('scales from the base colour rather than compounding on the last frame', () => {
    const handle = create('port', { color: '#d6e6de' });
    const material = handle.material;

    handle.updateInput({ activity: 1, focus: 1 });
    const saturated = material.color.r;

    handle.updateInput({ activity: 0, focus: 0 });
    const rested = material.color.r;

    // Ten frames of the same input must land on the same colour, or the scene
    // would drift brighter the longer it was left alone.
    for (let frame = 0; frame < 10; frame += 1) {
      handle.updateInput({ activity: 1, focus: 1 });
    }
    expect(material.color.r).toBeCloseTo(saturated, 10);

    for (let frame = 0; frame < 10; frame += 1) {
      handle.updateInput({ activity: 0, focus: 0 });
    }
    expect(material.color.r).toBeCloseTo(rested, 10);

    handle.dispose();
  });

  it('sanitizes non-finite scalar inputs on solid roles', () => {
    const handle = create('edge', { color: '#546a67' });

    handle.updateInput({
      activity: Number.NaN,
      focus: Number.POSITIVE_INFINITY,
    });

    const color = handle.material.color;
    expect(Number.isFinite(color.r)).toBe(true);
    expect(color.r).toBeGreaterThan(0);

    handle.dispose();
  });

  it('makes dispose idempotent and stops further input updates', () => {
    const handle = create('membrane', { baseFade: 0.3, color: '#a3c0b6' });

    handle.dispose();
    const opacityAfterDispose = handle.material.opacity;

    expect(() => handle.dispose()).not.toThrow();
    handle.updateInput({ activity: 1, focus: 1 });
    expect(handle.material.opacity).toBe(opacityAfterDispose);
  });
});
