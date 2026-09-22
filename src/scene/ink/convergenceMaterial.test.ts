import { describe, expect, it } from 'vitest';
import { AdditiveBlending } from 'three/webgpu';

import { createFieldUniforms } from '../field/fieldUniforms';
import { createConvergenceMaterial } from './convergenceMaterial';

describe('createConvergenceMaterial', () => {
  it('identifies the internal signal tissue as a distinct transparent material', () => {
    const uniforms = createFieldUniforms();
    const material = createConvergenceMaterial(uniforms, {
      kind: 'filament',
      phase: 1,
      gain: 0.7,
      displacement: 30,
    });

    expect(material.name).toBe('convergence-filament');
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(AdditiveBlending);

    material.dispose();
    uniforms.dispose();
  });
});
