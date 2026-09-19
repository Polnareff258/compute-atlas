import { describe, expect, it, vi } from 'vitest';
import { PointsNodeMaterial } from 'three/webgpu';

import { createCoreFlowMaterial } from './coreFlowMaterial';
import type { CoreVisualInput } from './coreTypes';

type TraversableNode = {
  readonly traverse: (callback: (node: unknown) => void) => void;
};

type NamedUniform = {
  readonly isUniformNode: true;
  readonly name: string;
  readonly value: number;
};

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

function collectNamedUniformValues(material: object): Map<string, number> {
  const positionNode = (material as { readonly positionNode?: TraversableNode }).positionNode;

  expect(positionNode).toBeDefined();

  const values = new Map<string, number>();
  positionNode!.traverse((node) => {
    const uniform = node as Partial<NamedUniform>;

    if (uniform.isUniformNode === true && typeof uniform.name === 'string' && typeof uniform.value === 'number') {
      values.set(uniform.name, uniform.value);
    }
  });

  return values;
}

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
    expect('positionNode' in handle.material).toBe(true);
    expect('isShaderMaterial' in handle.material && handle.material.isShaderMaterial).toBe(false);

    handle.dispose();
  });

  it('attaches a concrete positionNode graph ready for renderer build', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: true,
    });
    const material = handle.material as {
      readonly isNodeMaterial?: boolean;
      readonly positionNode?: { readonly traverse?: unknown } | null;
    };

    expect(handle.backend).toBe('node');
    expect(material.isNodeMaterial).toBe(true);
    expect(material.positionNode).toBeDefined();
    expect(typeof material.positionNode?.traverse).toBe('function');

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
    expect((handle.material as unknown as { readonly size: number }).size).toBe(0.0315);

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

  it('updates zone targeting and active-zone uniforms without rebuilding the node graph', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: true,
    });

    handle.updateInput({ ...idleInput, targetZone: 3, activeZoneCount: 2 }, 1.25);
    const uniforms = collectNamedUniformValues(handle.material);

    expect(uniforms.get('coreFlowTargetZone')).toBe(3);
    expect(uniforms.get('coreFlowActiveZoneCount')).toBe(2);
    handle.dispose();
  });

  it('freezes temporal flow in reduced-motion mode while retaining zone controls', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: true,
    });

    handle.updateInput({ ...idleInput, reducedMotion: true, targetZone: 4 }, 9);
    expect(collectNamedUniformValues(handle.material).get('coreFlowMotionScale')).toBe(0);
    handle.updateInput({ ...idleInput, reducedMotion: false, targetZone: 4 }, 9);
    expect(collectNamedUniformValues(handle.material).get('coreFlowMotionScale')).toBe(1);
    handle.dispose();
  });

  it('normalizes extreme node inputs before they reach material uniforms', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: true,
    });

    handle.updateInput(
      {
        ...idleInput,
        pointerX: Number.MAX_VALUE,
        pointerY: -Number.MAX_VALUE,
        focusX: Number.NaN,
        focusY: Number.POSITIVE_INFINITY,
        focusZ: Number.NEGATIVE_INFINITY,
        intensity: Number.POSITIVE_INFINITY,
      },
      Number.MAX_VALUE,
    );

    const uniforms = collectNamedUniformValues(handle.material);

    expect(uniforms.get('coreFlowPointerX')).toBe(1);
    expect(uniforms.get('coreFlowPointerY')).toBe(-1);
    expect(uniforms.get('coreFlowFocusX')).toBe(0);
    expect(uniforms.get('coreFlowFocusY')).toBe(0);
    expect(uniforms.get('coreFlowFocusZ')).toBe(0);
    expect(uniforms.get('coreFlowIntensity')).toBe(0);
    expect(uniforms.get('coreFlowActivity')).toBeGreaterThanOrEqual(0);
    expect(uniforms.get('coreFlowActivity')).toBeLessThanOrEqual(1);
    expect(uniforms.get('coreFlowElapsedSeconds')).toBeGreaterThanOrEqual(0);
    expect(uniforms.get('coreFlowElapsedSeconds')).toBeLessThan(120);
    expect([...uniforms.values()].every(Number.isFinite)).toBe(true);

    handle.updateInput(
      {
        ...idleInput,
        pointerX: Number.NaN,
        pointerY: Number.POSITIVE_INFINITY,
        focusX: -Number.MAX_VALUE,
        focusY: Number.MAX_VALUE,
        focusZ: Number.NaN,
        intensity: -Number.MAX_VALUE,
      },
      -Number.MAX_VALUE,
    );

    const normalizedUniforms = collectNamedUniformValues(handle.material);

    expect(normalizedUniforms.get('coreFlowPointerX')).toBe(0);
    expect(normalizedUniforms.get('coreFlowPointerY')).toBe(0);
    expect(normalizedUniforms.get('coreFlowFocusX')).toBe(-4);
    expect(normalizedUniforms.get('coreFlowFocusY')).toBe(4);
    expect(normalizedUniforms.get('coreFlowFocusZ')).toBe(0);
    expect(normalizedUniforms.get('coreFlowIntensity')).toBe(0);
    expect(normalizedUniforms.get('coreFlowElapsedSeconds')).toBe(0);
    expect([...normalizedUniforms.values()].every(Number.isFinite)).toBe(true);

    handle.dispose();
  });

  it('updates standard fallback opacity deterministically and ignores updates after dispose', () => {
    const handle = createCoreFlowMaterial({
      color: '#718c86',
      pointSize: 1.75,
      webgpuPreferred: false,
    });
    const material = handle.material as { opacity: number };
    const dormantInput: CoreVisualInput = {
      ...idleInput,
      intensity: 0.1,
      visualState: 'dormant',
    };
    const activeInput: CoreVisualInput = {
      ...idleInput,
      intensity: 0.9,
      visualState: 'agent_activity',
    };

    handle.updateInput(dormantInput, 3);
    const dormantOpacity = material.opacity;
    handle.updateInput(activeInput, 9);
    const activeOpacity = material.opacity;
    handle.updateInput(activeInput, 9);

    expect(activeOpacity).not.toBe(dormantOpacity);
    expect(material.opacity).toBe(activeOpacity);
    expect(Number.isFinite(activeOpacity)).toBe(true);
    expect(activeOpacity).toBeGreaterThanOrEqual(0);
    expect(activeOpacity).toBeLessThanOrEqual(1);

    handle.dispose();
    handle.updateInput(dormantInput, 11);

    expect(material.opacity).toBe(activeOpacity);
  });

  it('disposes an allocated node material when setup fails before falling back', () => {
    const dispose = vi.spyOn(PointsNodeMaterial.prototype, 'dispose');
    let pointSizeReads = 0;
    let handle: ReturnType<typeof createCoreFlowMaterial> | null = null;
    const config = {
      color: '#718c86',
      webgpuPreferred: true,
      get pointSize(): number {
        pointSizeReads += 1;

        if (pointSizeReads === 1) {
          throw new Error('point-size setup failed');
        }

        return 1.75;
      },
    };

    try {
      handle = createCoreFlowMaterial(config);

      expect(handle.backend).toBe('standard');
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      handle?.dispose();
      dispose.mockRestore();
    }
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
