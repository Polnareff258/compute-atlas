import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreFieldAttributes = {
  readonly positions: Float32Array;
  readonly drift: Float32Array;
  readonly phase: Float32Array;
  readonly region: Float32Array;
  readonly weight: Float32Array;
};

export type CoreFieldDescriptor = {
  readonly attributes: CoreFieldAttributes;
  readonly bounds: readonly [number, number, number];
  readonly streamCount: number;
};
/** Serializable state inputs consumed by the field view without mutating its descriptor. */
export type CoreFieldState = {
  readonly directionalBias: readonly [number, number, number];
  readonly activity: number;
  readonly activeStreamCount: number;
};
const FIELD_BOUNDS: readonly [number, number, number] = [3.25, 2.55, 2.85];
const TAU = Math.PI * 2;

function hash(seed: number, index: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x45d9f3b)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function unit(seed: number, index: number): number {
  return hash(seed, index) / 0x100000000;
}

function safePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeResolution(value: number): number {
  const finiteResolution = safePositive(value);
  return Math.max(1, Math.floor(finiteResolution));
}

function sampleCount(parameters: Pick<CoreParameters, 'particleBudget' | 'fieldResolution'>): number {
  const particleBudget = Math.floor(safePositive(parameters.particleBudget));
  const resolution = safeResolution(parameters.fieldResolution);

  return Math.min(particleBudget, resolution * resolution * 4);
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function normalizedUnit(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 1);
}

function normalizedDirection(
  x: number,
  y: number,
  z: number,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  const safeX = normalizedUnit(x);
  const safeY = normalizedUnit(y);
  const safeZ = normalizedUnit(z);
  const length = Math.hypot(safeX, safeY, safeZ);

  if (length < 0.0001) {
    return fallback;
  }

  return [safeX / length, safeY / length, safeZ / length];
}

function normalizedIntensity(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function availableStreamCount(field: Pick<CoreFieldDescriptor, 'streamCount'>): number {
  return Math.max(1, Math.floor(Number.isFinite(field.streamCount) ? field.streamCount : 1));
}

function stateActivity(base: number, intensity: number, reducedMotion: boolean): number {
  const animatedActivity = Math.min(1, base + intensity * 0.16);

  return reducedMotion ? animatedActivity * 0.52 : animatedActivity;
}

/**
 * Maps shared Core visual input to bounded field controls. The field descriptor
 * remains immutable: changes select existing directional streams and alter
 * scalar displacement inputs rather than simulating or rewriting attributes.
 */
export function deriveCoreFieldState(
  field: Pick<CoreFieldDescriptor, 'streamCount'>,
  input: CoreVisualInput,
): CoreFieldState {
  const streamCount = availableStreamCount(field);
  const intensity = normalizedIntensity(input.intensity);
  const pointerDirection = normalizedDirection(
    input.pointerX,
    input.pointerY,
    0.28,
    [0.76, 0.08, -0.2],
  );
  const focusDirection = normalizedDirection(
    input.focusX,
    input.focusY,
    input.focusZ,
    [0.84, 0.12, 0.3],
  );

  switch (input.visualState) {
    case 'dormant':
      return {
        directionalBias: [0.62, 0.04, -0.18],
        activity: stateActivity(0.08, intensity, input.reducedMotion),
        activeStreamCount: 1,
      };
    case 'awakening':
      return {
        directionalBias: [0.72, 0.18, 0.12],
        activity: stateActivity(0.3, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 2),
      };
    case 'hover_response':
      return {
        directionalBias: pointerDirection,
        activity: stateActivity(0.5, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 2),
      };
    case 'focusing':
      return {
        directionalBias: focusDirection,
        activity: stateActivity(0.7, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 2),
      };
    case 'agent_activity':
      return {
        directionalBias: normalizedDirection(
          pointerDirection[0] + focusDirection[0],
          pointerDirection[1] + focusDirection[1],
          pointerDirection[2] + focusDirection[2],
          focusDirection,
        ),
        activity: stateActivity(0.84, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 3),
      };
    case 'idle':
      return {
        directionalBias: [0.74, 0.08, -0.24],
        activity: stateActivity(0.2, intensity, input.reducedMotion),
        activeStreamCount: 1,
      };
  }
}
/**
 * Derives the static field consumed by later GPU views.
 *
 * The field is intentionally ribbon-like rather than radial: each stream has
 * a directional spine, local clusters, and explicit zero-weight void bands.
 * All per-sample inputs are written once into typed arrays and are safe to
 * upload as immutable GPU attributes.
 */
export function deriveCoreField(
  parameters: Pick<CoreParameters, 'particleBudget' | 'fieldResolution'>,
  seed = 17,
): CoreFieldDescriptor {
  const count = sampleCount(parameters);
  const resolution = safeResolution(parameters.fieldResolution);
  const streamCount = Math.max(1, Math.min(8, Math.floor(resolution / 8)));
  const positions = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const region = new Float32Array(count);
  const weight = new Float32Array(count);
  let hasVoidSample = false;

  for (let index = 0; index < count; index += 1) {
    const stream = streamCount === 0 ? 0 : index % streamCount;
    const streamT = (Math.floor(index / Math.max(1, streamCount)) + 0.5) /
      Math.ceil(count / Math.max(1, streamCount));
    const noise = unit(seed, index * 7 + 1);
    const local = unit(seed, index * 7 + 2) - 0.5;
    const cluster = unit(seed, stream * 17 + 3);
    const angle = stream * 1.37 + cluster * 0.42;
    const ribbonWave = Math.sin(streamT * TAU * (1.1 + cluster * 0.35) + angle);
    const x = (streamT - 0.5) * 5.35 + Math.sin(streamT * TAU + angle) * 0.22;
    const y = (stream - (streamCount - 1) * 0.5) * 0.34 + ribbonWave * 0.56 + local * 0.42;
    const z = Math.cos(streamT * TAU * 0.72 + angle) * 0.72 + (noise - 0.5) * 0.58;
    const clusterBias = (cluster - 0.5) * 0.7;
    const base = index * 3;

    positions[base] = clamp(x + clusterBias, FIELD_BOUNDS[0]);
    positions[base + 1] = clamp(y, FIELD_BOUNDS[1]);
    positions[base + 2] = clamp(z + Math.sin(streamT * Math.PI) * clusterBias, FIELD_BOUNDS[2]);

    const directionalSign = stream % 2 === 0 ? 1 : -1;
    drift[base] = 0.18 + directionalSign * (0.06 + noise * 0.1);
    drift[base + 1] = Math.cos(streamT * TAU + angle) * 0.12;
    drift[base + 2] = directionalSign * (0.07 + streamT * 0.24) + clusterBias * 0.05;

    phase[index] = (streamT + noise * 0.17) % 1;
    region[index] = stream % 3;

    // Two deterministic gaps interrupt every ribbon and preserve negative space.
    const firstVoid = stream % 2 === 0 && streamT > 0.34 && streamT < 0.43;
    const secondVoid = stream % 3 === 1 && streamT > 0.72 && streamT < 0.79;
    const clusterEnvelope = 0.48 + 0.52 * Math.sin(streamT * Math.PI);
    const isVoid = firstVoid || secondVoid;
    weight[index] = isVoid ? 0 : (0.42 + noise * 0.58) * clusterEnvelope;
    hasVoidSample ||= isVoid;
  }

  if (count > 0 && !hasVoidSample) {
    weight[count - 1] = 0;
  }

  return {
    attributes: { positions, drift, phase, region, weight },
    bounds: FIELD_BOUNDS,
    streamCount,
  };
}
