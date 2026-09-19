import type { CoreParameters, CoreVisualInput } from './coreTypes';

export type CoreFieldAttributes = {
  readonly positions: Float32Array;
  readonly drift: Float32Array;
  readonly phase: Float32Array;
  readonly region: Float32Array;
  readonly weight: Float32Array;
  readonly compression: Float32Array;
  readonly zone: Float32Array;
  readonly depthBias: Float32Array;
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
  readonly targetZone: number;
  readonly activeZoneCount: number;
};
const FIELD_BOUNDS: readonly [number, number, number] = [2.9, 1.7, 1.5];
const FIELD_ZONE_COUNT = 6;
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

function sampleCount(parameters: Pick<CoreParameters, 'fieldResolution'> & Partial<Pick<CoreParameters, 'fieldSampleBudget' | 'particleBudget'>>): number {
  const requestedSamples = parameters.fieldSampleBudget ?? parameters.particleBudget ?? 0;
  const fieldSampleBudget = Math.floor(safePositive(requestedSamples));
  const resolution = safeResolution(parameters.fieldResolution);

  return Math.min(fieldSampleBudget, resolution * resolution * 10);
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function normalizedSigned(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizedDirection(
  x: number,
  y: number,
  z: number,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  const safeX = normalizedSigned(x);
  const safeY = normalizedSigned(y);
  const safeZ = normalizedSigned(z);
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

function zoneForDirection(direction: readonly [number, number, number]): number {
  const normalizedAngle = (Math.atan2(direction[1], direction[0]) + Math.PI) / (Math.PI * 2);
  return Math.min(FIELD_ZONE_COUNT - 1, Math.floor(normalizedAngle * FIELD_ZONE_COUNT));
}

/** Counts positive-weight samples in the same stream prefix used by draw ranges. */
export function countVisibleCoreFieldSamples(
  descriptor: CoreFieldDescriptor,
  activeStreamCount: number,
): number {
  const streamCount = Math.max(1, Math.floor(Number.isFinite(descriptor.streamCount) ? descriptor.streamCount : 1));
  const selectedStreams = Math.max(0, Math.min(
    streamCount,
    Number.isFinite(activeStreamCount) ? Math.floor(activeStreamCount) : 0,
  ));
  let visibleCount = 0;

  for (let sample = 0; sample < descriptor.attributes.phase.length; sample += 1) {
    const weight = descriptor.attributes.weight[sample] ?? 0;
    if (weight > 0 && sample % streamCount < selectedStreams) visibleCount += 1;
  }
  return visibleCount;
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
  const idleDirection: readonly [number, number, number] = [0.74, 0.08, -0.24];

  switch (input.visualState) {
    case 'dormant':
      return {
        directionalBias: [0.62, 0.04, -0.18],
        activity: stateActivity(0.08, intensity, input.reducedMotion),
        activeStreamCount: 1,
        targetZone: zoneForDirection([0.62, 0.04, -0.18]),
        activeZoneCount: 1,
      };
    case 'awakening':
      return {
        directionalBias: [0.72, 0.18, 0.12],
        activity: stateActivity(0.3, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 2),
        targetZone: zoneForDirection([0.72, 0.18, 0.12]),
        activeZoneCount: Math.min(streamCount, 2),
      };
    case 'hover_response':
      return {
        directionalBias: pointerDirection,
        activity: stateActivity(0.5, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 3),
        targetZone: zoneForDirection(pointerDirection),
        activeZoneCount: Math.min(streamCount, 3),
      };
    case 'focusing':
      return {
        directionalBias: focusDirection,
        activity: stateActivity(0.7, intensity, input.reducedMotion),
        activeStreamCount: Math.min(streamCount, 3),
        targetZone: zoneForDirection(focusDirection),
        activeZoneCount: Math.min(streamCount, 3),
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
        activeStreamCount: Math.min(streamCount, 5),
        targetZone: zoneForDirection(focusDirection),
        activeZoneCount: Math.min(streamCount, 5),
      };
    case 'idle':
      return {
        directionalBias: idleDirection,
        activity: stateActivity(0.2, intensity, input.reducedMotion),
        activeStreamCount: 2,
        targetZone: zoneForDirection(idleDirection),
        activeZoneCount: 2,
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
  parameters: Pick<CoreParameters, 'fieldResolution'> & Partial<Pick<CoreParameters, 'fieldSampleBudget' | 'particleBudget'>>,
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
  const compression = new Float32Array(count);
  const zone = new Float32Array(count);
  const depthBias = new Float32Array(count);
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
    const x = (streamT - 0.5) * 4.55 + Math.sin(streamT * TAU + angle) * 0.18;
    const y = (stream - (streamCount - 1) * 0.5) * 0.2 + ribbonWave * 0.36 + local * 0.3;
    const z = Math.cos(streamT * TAU * 0.62 + angle) * 0.48 + (noise - 0.5) * 0.34;
    const clusterBias = (cluster - 0.5) * 0.46;
    const base = index * 3;

    positions[base] = clamp(x + clusterBias, FIELD_BOUNDS[0]);
    positions[base + 1] = clamp(y, FIELD_BOUNDS[1]);
    positions[base + 2] = clamp(z + Math.sin(streamT * Math.PI) * clusterBias, FIELD_BOUNDS[2]);

    const directionalSign = stream % 2 === 0 ? 1 : -1;
    drift[base] = 0.14 + directionalSign * (0.05 + noise * 0.08);
    drift[base + 1] = Math.cos(streamT * TAU + angle) * 0.09;
    drift[base + 2] = directionalSign * (0.05 + streamT * 0.16) + clusterBias * 0.045;

    phase[index] = (streamT + noise * 0.17) % 1;
    region[index] = stream % 3;
    zone[index] = Math.min(FIELD_ZONE_COUNT - 1, Math.floor(streamT * FIELD_ZONE_COUNT));
    compression[index] = Math.max(0, Math.min(1,
      0.2 + 0.56 * Math.exp(-Math.abs(y) * 0.76) + cluster * 0.16,
    ));
    depthBias[index] = clamp((noise - 0.5) * 0.52 + Math.sin(streamT * Math.PI * 2 + angle) * 0.14, 1);

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
    attributes: { positions, drift, phase, region, weight, compression, zone, depthBias },
    bounds: FIELD_BOUNDS,
    streamCount,
  };
}
