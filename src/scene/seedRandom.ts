/**
 * Shared deterministic hash for descriptor generation.
 *
 * Every descriptor in the scene must be a pure function of `(parameters, seed)`
 * so equal inputs produce byte-identical output. Keeping one integer hash in one
 * place is what makes that guarantee auditable instead of per-module folklore.
 */
export function hashSeed(seed: number, index: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x45d9f3b)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Deterministic value in [0, 1). */
export function hashUnit(seed: number, index: number): number {
  return hashSeed(seed, index) / 0x1_0000_0000;
}

/** Deterministic value in [-1, 1). */
export function hashSigned(seed: number, index: number): number {
  return hashUnit(seed, index) * 2 - 1;
}

export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : 17;
}