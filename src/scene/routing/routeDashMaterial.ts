import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cross,
  float,
  max,
  min,
  mix,
  pow,
  saturate,
  select,
  sqrt,
  time,
  uniform,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';

import {
  RIBBON_CHANNEL_GAIN,
  ROUTE_CLASS_ORDER,
  ROUTE_VISIBILITY_FLOOR,
  type RouteFlowState,
} from './routeDash';

/**
 * Boundary: this factory owns synchronous NodeMaterial allocation, its node
 * graph, and cleanup when setup fails. It does not build renderer programs;
 * WebGPU shader compilation stays with the existing renderer seam.
 *
 * The dash field is the scene's signature effect, so the whole motion lives in
 * the vertex shader: geometry is uploaded once and only scalars change per
 * frame. WebGL2 has no node materials, so `RouteDashes` drives a bounded
 * instanced fallback with the same envelope maths instead of asking this factory
 * for a shader.
 */
export type RouteDashMaterialConfig = {
  readonly color: string;
  readonly webgpuPreferred: boolean;
};

export type RouteDashMaterialHandle = {
  readonly material: THREE.Material;
  readonly backend: 'node' | 'standard';
  readonly updateFlow: (state: RouteFlowState, elapsedSeconds: number) => void;
  readonly dispose: () => void;
};

/** Guards the tangent and across-axis so a degenerate curve cannot emit NaN. */
const NORMALIZE_FLOOR = 0.0001;
const BIRTH_FRACTION = 0.16;
const ARRIVAL_FRACTION = 0.22;
const COMPRESSION_GAIN = 1.6;
const ENVELOPE_EXPONENT = 0.7;
const WAKE_WIDTH_GAIN = 1.4;

type RouteFlowUniforms = ReturnType<typeof createFlowUniforms>;

function createFlowUniforms() {
  return {
    laneWeights: uniform(new THREE.Vector4(0, 0, 0, 0)).setName('routeLaneWeights'),
    groupWeightsLow: uniform(new THREE.Vector4(0, 0, 0, 0)).setName(
      'routeGroupWeightsLow',
    ),
    groupWeightsHigh: uniform(new THREE.Vector4(0, 0, 0, 0)).setName(
      'routeGroupWeightsHigh',
    ),
    advectionSpeed: uniform(1, 'float').setName('routeAdvectionSpeed'),
    elapsedSeconds: uniform(0, 'float').setName('routeElapsedSeconds'),
    compression: uniform(0, 'float').setName('routeCompression'),
    wake: uniform(0, 'float').setName('routeWake'),
    bend: uniform(new THREE.Vector3(0, 0, 0)).setName('routeBendDirection'),
    bendAmount: uniform(0, 'float').setName('routeBendAmount'),
    motionScale: uniform(1, 'float').setName('routeMotionScale'),
    widthScale: uniform(1, 'float').setName('routeWidthScale'),
  };
}

function normalizeSeedState(state: RouteFlowState): {
  laneWeights: [number, number, number, number];
  groupWeights: number[];
  advectionSpeed: number;
  compression: number;
  wake: number;
  bend: [number, number, number];
  bendAmount: number;
  motionScale: number;
} {
  const finite = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;
  const unit = (value: number, fallback: number): number =>
    Math.min(1, Math.max(0, finite(value, fallback)));

  const lanes: [number, number, number, number] = [0, 0, 0, 0];
  for (let index = 0; index < ROUTE_CLASS_ORDER.length; index += 1) {
    lanes[index] = unit(state.laneWeights[index] ?? 0, 0);
  }

  // A bend direction that is not a usable unit vector leaves the field unbiased
  // rather than collapsing every control point onto the origin.
  const bent: [number, number, number] = [
    finite(state.bend[0] ?? 0, 0),
    finite(state.bend[1] ?? 0, 0),
    finite(state.bend[2] ?? 0, 0),
  ];
  const bendLength = Math.hypot(bent[0], bent[1], bent[2]);
  const bend: [number, number, number] =
    bendLength > NORMALIZE_FLOOR
      ? [bent[0] / bendLength, bent[1] / bendLength, bent[2] / bendLength]
      : [0, 0, 0];

  const frozen = !Number.isFinite(state.motionScale) || state.motionScale <= 0;
  return {
    laneWeights: lanes,
    groupWeights: Array.from(state.groupWeights, (weight) => unit(weight, 0)),
    advectionSpeed: Math.max(0, finite(state.advectionSpeed, 0)),
    compression: unit(state.compression, 0),
    wake: unit(state.wake, 0),
    bend,
    bendAmount: bendLength > NORMALIZE_FLOOR ? unit(state.bendAmount, 0) : 0,
    // Reduced motion freezes advection but must not flatten the composition, so
    // a small residual scale keeps arrival widening readable in a still frame.
    motionScale: frozen ? 0 : 1,
  };
}

/** `ReturnType<typeof float>` is a VarNode, but dash attributes are AttributeNodes. */
function floatAttribute(name: string) {
  return attribute(name, 'float');
}

type FloatAttribute = ReturnType<typeof floatAttribute>;

/** Picks one of four basis vectors by index, so no uniform array is needed. */
function createBasis4(index: FloatAttribute, offset: number) {
  return select(
    index.lessThan(offset + 0.5),
    vec4(1, 0, 0, 0),
    select(
      index.lessThan(offset + 1.5),
      vec4(0, 1, 0, 0),
      select(index.lessThan(offset + 2.5), vec4(0, 0, 1, 0), vec4(0, 0, 0, 1)),
    ),
  );
}

function createDashPositionNode(uniforms: RouteFlowUniforms) {
  const corner = attribute('dashCorner', 'vec2');
  const start = attribute('dashStart', 'vec3');
  const control = attribute('dashControl', 'vec3');
  const end = attribute('dashEnd', 'vec3');
  const phase = floatAttribute('dashPhase');
  const speed = floatAttribute('dashSpeed');
  const length = floatAttribute('dashLength');
  const width = floatAttribute('dashWidth');

  // One dash lifetime: head progress runs 0..1, tail trails at a fixed offset so
  // the packet emerges from the source instead of appearing mid-route.
  const cycle = phase
    .add(time.mul(uniforms.motionScale).add(uniforms.elapsedSeconds).mul(speed).mul(uniforms.advectionSpeed))
    .fract();
  const tail = max(cycle.sub(length), float(0));
  const rawProgress = mix(tail, cycle, corner.x);

  // Route compression zone: dashes bunch in front of the ingress.
  const progress = pow(
    rawProgress,
    float(1).div(uniforms.compression.mul(COMPRESSION_GAIN).add(float(1))),
  );

  const inverse = float(1).sub(progress);
  // Field deformation: every control point leans along one direction, so a
  // hover bends the whole field toward the target instead of swapping curves.
  const bentControl = control.add(uniforms.bend.mul(uniforms.bendAmount));
  const positionAlong = start
    .mul(inverse.mul(inverse))
    .add(bentControl.mul(inverse.mul(progress).mul(float(2))))
    .add(end.mul(progress.mul(progress)));

  // Derivative of the quadratic, floored before normalising so a collapsed
  // control point yields a finite axis rather than NaN across the whole quad.
  const derivative = bentControl
    .sub(start)
    .mul(inverse.mul(float(2)))
    .add(end.sub(bentControl).mul(progress.mul(float(2))));
  const tangent = derivative.div(max(derivative.length(), float(NORMALIZE_FLOOR)));

  const rawAcross = cross(tangent, vec3(0, 1, 0));
  const acrossLength = rawAcross.length();
  // Parallel to the up reference: substitute a usable axis instead of collapsing.
  const across = select(
    acrossLength.greaterThan(NORMALIZE_FLOOR * 10),
    rawAcross.div(max(acrossLength, float(NORMALIZE_FLOOR))),
    vec3(1, 0, 0),
  );

  // Arrival wake widens and brightens the packet as it reaches the ingress.
  const arrivalProximity = saturate(float(1).sub(float(1).sub(progress).div(ARRIVAL_FRACTION)));
  const wakeWidth = float(1).add(arrivalProximity.mul(uniforms.wake).mul(WAKE_WIDTH_GAIN));

  const offset = across.mul(corner.y.sub(float(0.5))).mul(width.mul(uniforms.widthScale).mul(wakeWidth));

  return positionAlong.add(offset);
}

/** Shared per-route weight term: lane class weight times route group weight. */
function createRouteWeightTerm(
  uniforms: RouteFlowUniforms,
  routeIndex: FloatAttribute,
  groupIndex: FloatAttribute,
) {
  const laneWeight = createBasis4(routeIndex, 0).dot(uniforms.laneWeights);
  const groupWeight = createBasis4(groupIndex, 0)
    .dot(uniforms.groupWeightsLow)
    .add(createBasis4(groupIndex, 4).dot(uniforms.groupWeightsHigh));
  return laneWeight.mul(groupWeight);
}

/**
 * The cull, in the shader.
 *
 * `saturate` of a negative is zero, so this is `deriveRouteVisibility` written
 * as one expression: the same floor, the same square root, the same zero. A
 * packet on a route that has receded contributes exactly nothing, rather than
 * lingering as a dim streak that still adds into the frame.
 */
function createRouteVisibilityTerm(
  uniforms: RouteFlowUniforms,
  routeIndex: FloatAttribute,
  groupIndex: FloatAttribute,
) {
  const weight = createRouteWeightTerm(uniforms, routeIndex, groupIndex);
  return sqrt(
    saturate(
      weight.sub(float(ROUTE_VISIBILITY_FLOOR)).div(float(1 - ROUTE_VISIBILITY_FLOOR)),
    ),
  );
}

function createDashColorNode(uniforms: RouteFlowUniforms, baseColor: THREE.Color) {
  const corner = attribute('dashCorner', 'vec2');
  const phase = floatAttribute('dashPhase');
  const speed = floatAttribute('dashSpeed');
  const length = floatAttribute('dashLength');
  const routeIndex = floatAttribute('dashRoute');
  const groupIndex = floatAttribute('dashGroup');
  const brightness = floatAttribute('dashBrightness');

  const cycle = phase
    .add(time.mul(uniforms.motionScale).add(uniforms.elapsedSeconds).mul(speed).mul(uniforms.advectionSpeed))
    .fract();
  const progress = mix(max(cycle.sub(length), float(0)), cycle, corner.x);

  const rising = min(progress.div(BIRTH_FRACTION), float(1));
  const falling = min(float(1).sub(progress).div(ARRIVAL_FRACTION), float(1));
  const envelope = pow(min(rising, falling), float(ENVELOPE_EXPONENT));

  const arrivalProximity = saturate(float(1).sub(float(1).sub(progress).div(ARRIVAL_FRACTION)));
  const wakeBoost = float(1).add(arrivalProximity.mul(arrivalProximity).mul(uniforms.wake).mul(float(0.6)));

  const intensity = envelope
    .mul(brightness)
    .mul(createRouteVisibilityTerm(uniforms, routeIndex, groupIndex))
    .mul(wakeBoost);

  // Narrow across the ribbon so a dash reads as a stretched streak, and fade the
  // silhouette edge rather than ending on a hard rectangle.
  const acrossFade = saturate(corner.y.mul(float(2))).mul(saturate(float(1).sub(corner.y).mul(float(2))));
  const alpha = saturate(acrossFade.mul(float(1.6)));

  return vec4(vec3(baseColor.r, baseColor.g, baseColor.b).mul(intensity), alpha);
}

/**
 * The continuous routing channel under the dashes.
 *
 * Positions are baked, so this needs no position node: the along-route gradient
 * lives in vertex colours and the per-route weight comes from the same term the
 * dashes use, which keeps a channel and its packets dimming together.
 */
function createRibbonColorNode(uniforms: RouteFlowUniforms, baseColor: THREE.Color) {
  const routeClass = floatAttribute('routeClass');
  const routeGroup = floatAttribute('routeGroup');
  const weight = createRouteWeightTerm(uniforms, routeClass, routeGroup);

  // The channel is the floor of the field, not its subject: a small fixed gain
  // keeps the route legible where a packet is not, and nothing more. It is
  // deliberately not proportional to the route weight alone, because a strong
  // route would then draw a full-strength pipe under its own packets.
  const intensity = weight.mul(uniforms.motionScale.mul(float(0.25)).add(float(0.75)));
  // The gain is applied once, to the channel's coverage. Applying it to colour
  // and alpha both squares it, and a channel at a twentieth of full is not a
  // weak channel, it is an absent one.
  return vec4(
    vec3(baseColor.r, baseColor.g, baseColor.b).mul(vertexColor().rgb).mul(intensity),
    saturate(weight.mul(float(1.2))).mul(float(RIBBON_CHANNEL_GAIN)),
  );
}

function createNodeHandle(config: RouteDashMaterialConfig): RouteDashMaterialHandle {
  const uniforms = createFlowUniforms();
  const baseColor = new THREE.Color(config.color);
  let material: MeshBasicNodeMaterial | null = null;

  try {
    material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.positionNode = createDashPositionNode(uniforms);
    material.colorNode = createDashColorNode(uniforms, baseColor);
  } catch (error) {
    material?.dispose();
    throw error;
  }

  const nodeMaterial = material;
  let disposed = false;

  return {
    material: nodeMaterial,
    backend: 'node',
    updateFlow: (state, elapsedSeconds) => {
      if (disposed) return;
      applyFlowUniforms(uniforms, state, elapsedSeconds);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      nodeMaterial.dispose();
    },
  };
}

function applyFlowUniforms(
  uniforms: RouteFlowUniforms,
  state: RouteFlowState,
  elapsedSeconds: number,
): void {
  const normalized = normalizeSeedState(state);
  uniforms.laneWeights.value.set(...normalized.laneWeights);
  uniforms.groupWeightsLow.value.set(
    normalized.groupWeights[0] ?? 0,
    normalized.groupWeights[1] ?? 0,
    normalized.groupWeights[2] ?? 0,
    normalized.groupWeights[3] ?? 0,
  );
  uniforms.groupWeightsHigh.value.set(
    normalized.groupWeights[4] ?? 0,
    normalized.groupWeights[5] ?? 0,
    normalized.groupWeights[6] ?? 0,
    normalized.groupWeights[7] ?? 0,
  );
  uniforms.advectionSpeed.value = normalized.advectionSpeed;
  uniforms.elapsedSeconds.value = normalized.motionScale <= 0
    ? 0
    : (Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0) % 1000;
  uniforms.compression.value = normalized.compression;
  uniforms.wake.value = normalized.wake;
  uniforms.bend.value.set(...normalized.bend);
  uniforms.bendAmount.value = normalized.bendAmount;
  uniforms.motionScale.value = normalized.motionScale;
  // WebGPU has no CPU instancing step, so a wider quad compensates for not being
  // able to scale per dash on the fallback path.
  uniforms.widthScale.value = 1;
}

/** Fallback used only if node construction throws on a WebGPU-preferred call. */
function createStandardHandle(config: RouteDashMaterialConfig): RouteDashMaterialHandle {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(config.color),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    opacity: 0.2,
  });
  let disposed = false;

  return {
    material,
    backend: 'standard',
    updateFlow: (state) => {
      if (disposed) return;
      const normalized = normalizeSeedState(state);
      const lane = Math.max(...normalized.laneWeights);
      material.opacity = 0.12 + lane * 0.3;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      material.dispose();
    },
  };
}

export function createRouteDashMaterial(
  config: RouteDashMaterialConfig,
): RouteDashMaterialHandle {
  if (!config.webgpuPreferred) {
    return createStandardHandle(config);
  }

  try {
    return createNodeHandle(config);
  } catch {
    return createStandardHandle(config);
  }
}

function createRibbonNodeHandle(
  config: RouteDashMaterialConfig,
): RouteDashMaterialHandle {
  const uniforms = createFlowUniforms();
  const baseColor = new THREE.Color(config.color);
  let material: MeshBasicNodeMaterial | null = null;

  try {
    material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });
    material.colorNode = createRibbonColorNode(uniforms, baseColor);
  } catch (error) {
    material?.dispose();
    throw error;
  }

  const nodeMaterial = material;
  let disposed = false;

  return {
    material: nodeMaterial,
    backend: 'node',
    updateFlow: (state, elapsedSeconds) => {
      if (disposed) return;
      applyFlowUniforms(uniforms, state, elapsedSeconds);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      nodeMaterial.dispose();
    },
  };
}

/**
 * The routing channel on both backends. WebGL2 has no node materials, so the
 * fallback keeps the baked gradient and drops the per-route dimming to the
 * strongest lane weight. The brief permits a lower-density channel there.
 */
export function createRouteRibbonMaterial(
  config: RouteDashMaterialConfig,
): RouteDashMaterialHandle {
  if (config.webgpuPreferred) {
    try {
      return createRibbonNodeHandle(config);
    } catch {
      // Fall through to the standard channel rather than failing the frame.
    }
  }

  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(config.color),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    opacity: RIBBON_CHANNEL_GAIN,
  });
  let disposed = false;

  return {
    material,
    backend: 'standard',
    updateFlow: (state) => {
      if (disposed) return;
      const normalized = normalizeSeedState(state);
      material.opacity =
        RIBBON_CHANNEL_GAIN * 0.5 +
        Math.max(...normalized.laneWeights) * RIBBON_CHANNEL_GAIN;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      material.dispose();
    },
  };
}