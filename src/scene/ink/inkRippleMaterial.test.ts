import { describe, expect, it } from 'vitest';
import {
  AdditiveBlending,
  DataTexture,
  FloatType,
  RGBAFormat,
} from 'three';

import { createFieldUniforms } from '../field/fieldUniforms';
import type { InkField } from './inkField';
import { createRippleMaterial } from './inkMaterial';

describe('createRippleMaterial', () => {
  it('renders the interaction front additively so it cannot punch a dark core', () => {
    const texture = new DataTexture(new Float32Array(16), 2, 2, RGBAFormat, FloatType);
    texture.needsUpdate = true;
    const ink = {
      sampleTexture: texture,
      baseTexture: texture,
      fluvialTexture: texture,
    } as unknown as InkField;
    const uniforms = createFieldUniforms();
    const ripple = createRippleMaterial(uniforms, ink);

    expect(ripple.material.name).toBe('ink-ripple-front');
    expect(ripple.material.transparent).toBe(true);
    expect(ripple.material.depthWrite).toBe(false);
    expect(ripple.material.blending).toBe(AdditiveBlending);

    ripple.dispose();
    uniforms.dispose();
    texture.dispose();
  });
});
