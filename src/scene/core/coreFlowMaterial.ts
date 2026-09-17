import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  Fn,
  positionLocal,
  time,
  uniform,
  vec3,
} from 'three/tsl';

import type { CoreVisualInput } from './coreTypes';

export type CoreFlowMaterialConfig = {
  readonly color: string;
  readonly pointSize: number;
  /**
   * Capability choice supplied by the renderer integration. The factory cannot
   * infer the active renderer, so WebGL2 callers pass false for a standard
   * PointsMaterial fallback.
   */
  readonly webgpuPreferred: boolean;
};

export type CoreFlowMaterialHandle = {
  readonly material: THREE.Material;
  readonly backend: 'node' | 'standard';
  readonly updateInput: (input: CoreVisualInput, elapsedSeconds: number) => void;
  readonly dispose: () => void;
};

type CoreFlowInputState = {
  pointerX: number;
  pointerY: number;
  focusX: number;
  focusY: number;
  focusZ: number;
  intensity: number;
  activity: number;
  elapsedSeconds: number;
};


const EMPTY_INPUT_STATE: CoreFlowInputState = {
  pointerX: 0,
  pointerY: 0,
  focusX: 0,
  focusY: 0,
  focusZ: 0,
  intensity: 0,
  activity: 0,
  elapsedSeconds: 0,
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizedIntensity(value: number): number {
  return THREE.MathUtils.clamp(finite(value), 0, 1);
}

function activityForState(input: CoreVisualInput): number {
  if (input.reducedMotion) {
    return 0.2;
  }

  switch (input.visualState) {
    case 'dormant':
      return 0.1;
    case 'awakening':
      return 0.45;
    case 'hover_response':
      return 0.65;
    case 'focusing':
      return 0.9;
    case 'agent_activity':
      return 1;
    case 'idle':
      return 0.35;
  }
}

function createInputState(): CoreFlowInputState {
  return { ...EMPTY_INPUT_STATE };
}

function applyInput(
  state: CoreFlowInputState,
  input: CoreVisualInput,
  elapsedSeconds: number,
): void {
  state.pointerX = finite(input.pointerX);
  state.pointerY = finite(input.pointerY);
  state.focusX = finite(input.focusX);
  state.focusY = finite(input.focusY);
  state.focusZ = finite(input.focusZ);
  state.intensity = normalizedIntensity(input.intensity);
  state.activity = activityForState(input);
  state.elapsedSeconds = Math.max(0, finite(elapsedSeconds));
}

function createInputUniforms() {
  return {
    pointerX: uniform(0, 'float'),
    pointerY: uniform(0, 'float'),
    focusX: uniform(0, 'float'),
    focusY: uniform(0, 'float'),
    focusZ: uniform(0, 'float'),
    intensity: uniform(0, 'float'),
    activity: uniform(0, 'float'),
    elapsedSeconds: uniform(0, 'float'),
  };
}

type CoreFlowUniforms = ReturnType<typeof createInputUniforms>;

function applyUniforms(uniforms: CoreFlowUniforms, state: CoreFlowInputState): void {
  uniforms.pointerX.value = state.pointerX;
  uniforms.pointerY.value = state.pointerY;
  uniforms.focusX.value = state.focusX;
  uniforms.focusY.value = state.focusY;
  uniforms.focusZ.value = state.focusZ;
  uniforms.intensity.value = state.intensity;
  uniforms.activity.value = state.activity;
  uniforms.elapsedSeconds.value = state.elapsedSeconds;
}

function createFlowPositionNode(uniforms: CoreFlowUniforms) {
  return Fn(() => {
    const drift = attribute('coreDrift', 'vec3');
    const phase = attribute('corePhase', 'float');
    const weight = attribute('coreWeight', 'float');
    const temporalWave = time
      .add(uniforms.elapsedSeconds)
      .mul(float(0.72))
      .add(phase)
      .sin();
    const amplitude = uniforms.intensity
      .add(uniforms.activity.mul(float(0.6)))
      .mul(weight)
      .mul(float(0.055));
    const pointerBias = vec3(uniforms.pointerX, uniforms.pointerY, float(0))
      .mul(uniforms.activity)
      .mul(float(0.012));
    const focusBias = vec3(uniforms.focusX, uniforms.focusY, uniforms.focusZ)
      .mul(uniforms.activity)
      .mul(float(0.008));

    return positionLocal.add(drift.mul(temporalWave.mul(amplitude))).add(pointerBias).add(focusBias);
  })();
}

function createNodeHandle(config: CoreFlowMaterialConfig): CoreFlowMaterialHandle {
  const inputState = createInputState();
  const uniforms = createInputUniforms();
  const material = new PointsNodeMaterial({
    color: new THREE.Color(config.color),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let disposed = false;

  material.positionNode = createFlowPositionNode(uniforms);
  material.size = Math.max(0.01, finite(config.pointSize));

  return {
    material,
    backend: 'node',
    updateInput: (input, elapsedSeconds) => {
      if (disposed) {
        return;
      }

      applyInput(inputState, input, elapsedSeconds);
      applyUniforms(uniforms, inputState);
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      material.dispose();
    },
  };
}

function createStandardHandle(config: CoreFlowMaterialConfig): CoreFlowMaterialHandle {
  const inputState = createInputState();
  const material = new THREE.PointsMaterial({
    color: new THREE.Color(config.color),
    size: Math.max(0.01, finite(config.pointSize)),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let disposed = false;

  return {
    material,
    backend: 'standard',
    updateInput: (input, elapsedSeconds) => {
      if (disposed) {
        return;
      }

      applyInput(inputState, input, elapsedSeconds);
      material.opacity = 0.28 + inputState.intensity * 0.42 + inputState.activity * 0.12;
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      material.dispose();
    },
  };
}

/**
 * Creates one reusable material handle. Geometry owns the precomputed
 * `coreDrift`, `corePhase`, and `coreWeight` attributes; callers update only
 * stable scalar inputs during a frame. This factory intentionally does not
 * query renderer state, keeping WebGPU/WebGL2 ownership in the renderer seam.
 */
export function createCoreFlowMaterial(
  config: CoreFlowMaterialConfig,
): CoreFlowMaterialHandle {
  if (!config.webgpuPreferred) {
    return createStandardHandle(config);
  }

  try {
    return createNodeHandle(config);
  } catch {
    // A renderer integration may request WebGPU before NodeMaterial support is
    // usable in its runtime. Preserve a safe standard-material fallback rather
    // than constructing a ShaderMaterial with backend-specific GLSL.
    return createStandardHandle(config);
  }
}
