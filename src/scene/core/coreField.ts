import type { CoreParameters } from './coreTypes';

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

function sampleCount(parameters: Pick<CoreParameters, 'particleBudget' | 'fieldResolution'>): number {
  const particleBudget = Math.floor(safePositive(parameters.particleBudget));
  const resolution = Math.floor(safePositive(parameters.fieldResolution));

  return Math.min(particleBudget, resolution * resolution * 4);
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
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
  const resolution = Math.floor(safePositive(parameters.fieldResolution));
  const streamCount = resolution > 0 ? Math.max(1, Math.min(8, Math.floor(resolution / 8))) : 0;
  const positions = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const region = new Float32Array(count);
  const weight = new Float32Array(count);

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
    weight[index] = firstVoid || secondVoid
      ? 0
      : (0.42 + noise * 0.58) * clusterEnvelope;
  }

  return {
    attributes: { positions, drift, phase, region, weight },
    bounds: FIELD_BOUNDS,
    streamCount,
  };
}
