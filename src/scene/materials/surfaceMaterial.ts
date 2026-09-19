import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  float,
  normalView,
  normalize,
  positionView,
  pow,
  saturate,
  uniform,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';

import { deriveMembraneOpacity } from './surfaceGeometry';

/**
 * Boundary: this factory owns synchronous material allocation and its node
 * graph, plus cleanup when setup fails. It does not build renderer programs:
 * WebGPU compilation and WebGL2 program linking are owned by the existing
 * renderer/scene integration.
 *
 * Roles map to distinct physical reads rather than to different colours:
 * - `volume` / `beam` / `port`: solid structure, writes depth, occludes.
 * - `membrane`: thin layered surface, blended, no depth write.
 */
export type SurfaceRole = 'volume' | 'beam' | 'port' | 'membrane';

export type SurfaceMaterialConfig = {
  readonly role: SurfaceRole;
  readonly color: string;
  /** Membrane openness at rest, 0 (closed silhouette) .. 1 (fully open). */
  readonly baseFade?: number;
  /** Strength of the view-dependent edge term. */
  readonly edgeResponse?: number;
  /**
   * Capability choice supplied by the renderer integration. The factory cannot
   * infer the active renderer, so WebGL2 callers pass false.
   */
  readonly webgpuPreferred: boolean;
};

/** Scalar state only; view layers never allocate this per frame. */
export type SurfaceInput = {
  readonly activity: number;
  readonly focus: number;
  readonly reducedMotion: boolean;
};

export type SurfaceMaterialHandle = {
  readonly material: THREE.Material;
  readonly backend: 'node' | 'standard';
  readonly updateInput: (input: SurfaceInput) => void;
  readonly dispose: () => void;
};

const DEFAULT_EDGE_RESPONSE = 0.35;

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundedUnit(value: number): number {
  return Math.min(1, Math.max(0, finite(value, 0)));
}

function isMembrane(config: SurfaceMaterialConfig): boolean {
  return config.role === 'membrane';
}

function createInputState(): {
  activity: number;
  focus: number;
  fade: number;
} {
  return { activity: 0, focus: 0, fade: 0 };
}

type SurfaceInputState = ReturnType<typeof createInputState>;

/**
 * `UniformNode` is a default-only type export, so the uniform's concrete type is
 * derived from the factory instead of imported.
 */
function createEdgeUniform(edgeResponse: number | undefined) {
  return uniform(
    finite(edgeResponse, DEFAULT_EDGE_RESPONSE),
    'float',
  ).setName('surfaceEdgeResponse');
}

type EdgeUniform = ReturnType<typeof createEdgeUniform>;

function applyState(
  state: SurfaceInputState,
  input: SurfaceInput,
  baseFade: number,
): void {
  state.activity = boundedUnit(input.activity);
  state.focus = boundedUnit(input.focus);
  state.fade = boundedUnit(baseFade + state.activity * 0.34 + state.focus * 0.5);
}

/**
 * Shared view-edge term: faces seen edge-on brighten, faces seen head-on stay
 * at their baked luminance. This is what keeps large flat panels from reading
 * as paper cut-outs as the camera reframes.
 */
function createEdgeTerm(edgeUniform: EdgeUniform) {
  const viewDirection = normalize(positionView.negate());
  const facing = saturate(normalView.dot(viewDirection).abs());
  return vec3(pow(float(1).sub(facing), float(2.2)).mul(edgeUniform));
}

function createNodeHandle(config: SurfaceMaterialConfig): SurfaceMaterialHandle {
  const baseFade = boundedUnit(config.baseFade ?? 0.5);
  const inputState = createInputState();
  const edgeUniform = createEdgeUniform(config.edgeResponse);
  const activityUniform = uniform(0, 'float').setName('surfaceActivity');
  const membrane = isMembrane(config);
  // Alpha rides its own uniform rather than `material.opacity`: a node material
  // reads built-in material properties through cached nodes, so a property
  // written after the node graph is built is not guaranteed to reach the shader.
  const alphaUniform = uniform(1, 'float').setName('surfaceAlpha');
  const baseColorValue = new THREE.Color(config.color);
  let material: MeshBasicNodeMaterial | null = null;

  try {
    material = new MeshBasicNodeMaterial({
      color: baseColorValue,
      depthWrite: !membrane,
      transparent: membrane,
      vertexColors: true,
    });

    const baseColor = vec3(
      baseColorValue.r,
      baseColorValue.g,
      baseColorValue.b,
    );
    const edge = createEdgeTerm(edgeUniform);
    material.colorNode = vec4(
      baseColor.mul(vertexColor().rgb).add(edge.mul(activityUniform.add(float(0.35)))),
      alphaUniform,
    );
  } catch (error) {
    material?.dispose();
    throw error;
  }

  const nodeMaterial = material;
  let disposed = false;

  return {
    material: nodeMaterial,
    backend: 'node',
    updateInput: (input) => {
      if (disposed) return;

      applyState(inputState, input, baseFade);
      edgeUniform.value = finite(config.edgeResponse, DEFAULT_EDGE_RESPONSE) *
        (input.reducedMotion ? 0.6 : 1);
      activityUniform.value = inputState.activity * 0.5 + inputState.focus * 0.3;
      alphaUniform.value = membrane ? deriveMembraneOpacity(inputState.fade) : 1;
    },
    dispose: () => {
      if (disposed) return;

      disposed = true;
      nodeMaterial.dispose();
    },
  };
}

function createStandardHandle(config: SurfaceMaterialConfig): SurfaceMaterialHandle {
  const baseFade = boundedUnit(config.baseFade ?? 0.5);
  const inputState = createInputState();
  const membrane = isMembrane(config);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(config.color),
    depthWrite: !membrane,
    transparent: membrane,
    opacity: membrane ? deriveMembraneOpacity(baseFade) : 1,
    vertexColors: true,
  });

  let disposed = false;

  return {
    material,
    backend: 'standard',
    updateInput: (input) => {
      if (disposed) return;

      applyState(inputState, input, baseFade);
      if (membrane) {
        material.opacity = deriveMembraneOpacity(inputState.fade);
        return;
      }

      // Baked luminance already carries the read; opacity only adds the
      // activity gradient, and never becomes the primary fix.
      material.opacity = Math.min(
        1,
        0.82 + inputState.activity * 0.14 + inputState.focus * 0.06,
      );
    },
    dispose: () => {
      if (disposed) return;

      disposed = true;
      material.dispose();
    },
  };
}

export function createSurfaceMaterial(
  config: SurfaceMaterialConfig,
): SurfaceMaterialHandle {
  if (!config.webgpuPreferred) {
    return createStandardHandle(config);
  }

  try {
    return createNodeHandle(config);
  } catch {
    // Preserve a safe built-in fallback rather than failing the whole scene
    // when node material support is unusable in the active runtime.
    return createStandardHandle(config);
  }
}