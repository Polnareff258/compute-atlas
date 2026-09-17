import { describe, expect, it } from 'vitest';

import { createCoreFlowMaterial } from './coreFlowMaterial';
import type { CoreVisualInput } from './coreTypes';

const idleInput: CoreVisualInput = {
  pointerX: 0.12,
  pointerY: -0.18,
  focusX: 0.4,
  focusY: -0.2,
  focusZ: 0.7,
  intensity: 0.65,
  visualState: 'idle',
  reducedMotion: false,
};

describe('createCoreFlowMaterial', () => {
  it('creates a node material handle when WebGPU is preferred', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: true,
    });

    expect(handle.backend).toBe('node');
    expect(handle.material.isMaterial).toBe(true);
    expect(handle.material.type).toBe('PointsNodeMaterial');
    expect('isShaderMaterial' in handle.material && handle.material.isShaderMaterial).toBe(false);

    handle.dispose();
  });

  it('creates a standard material fallback when WebGPU is not preferred', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: false,
    });

    expect(handle.backend).toBe('standard');
    expect(handle.material.isMaterial).toBe(true);
    expect(handle.material.type).toBe('PointsMaterial');
    expect('isShaderMaterial' in handle.material && handle.material.isShaderMaterial).toBe(false);

    handle.dispose();
  });

  it('updates stable inputs idempotently without replacing the material', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: true,
    });
    const material = handle.material;

    expect(() => {
      handle.updateInput(idleInput, 2.4);
      handle.updateInput(idleInput, 2.4);
    }).not.toThrow();
    expect(handle.material).toBe(material);

    handle.dispose();
  });

  it('disposes its material exactly once', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: false,
    });
    let disposeEvents = 0;

    handle.material.addEventListener('dispose', () => {
      disposeEvents += 1;
    });

    handle.dispose();
    handle.dispose();

    expect(disposeEvents).toBe(1);
  });
});
