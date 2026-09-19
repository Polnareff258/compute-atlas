import { getQualityProfile } from '../../config/quality';
import type { QualityProfile } from '../../renderer/types';
import { ROUTE_CLASS_ORDER } from '../routing/routeDash';
import type { CoreParameters, CoreVisualInput } from './coreTypes';

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : 0;
}

/**
 * Bounds controller scalars in place.
 *
 * The frame loop owns exactly one live input object, so it sanitizes that object
 * rather than building a replacement — a per-frame copy of a visual input is
 * precisely the allocation the React/GPU split exists to avoid.
 */
export function sanitizeCoreVisualInput(target: CoreVisualInput): void {
  target.pointerX = finiteClamp(target.pointerX, -1, 1);
  target.pointerY = finiteClamp(target.pointerY, -1, 1);
  target.focusX = finiteClamp(target.focusX, -1, 1);
  target.focusY = finiteClamp(target.focusY, -1, 1);
  target.focusZ = finiteClamp(target.focusZ, -1, 1);
  target.intensity = finiteClamp(target.intensity, 0, 1.2);
}

/** Sanitizes controller scalars at the serializable visual boundary. */
export function deriveCoreVisualInput(input: CoreVisualInput): CoreVisualInput {
  const sanitized: CoreVisualInput = { ...input };
  sanitizeCoreVisualInput(sanitized);
  return sanitized;
}

/**
 * Converts a renderer quality profile into the hero's structure and field
 * budgets.
 *
 * The profile's job is not to change a point count: SAFE keeps the Hero
 * silhouette, spine and main route, MEDIUM adds membranes and low-density flow,
 * HIGH adds secondary surfaces and interaction response, and ULTRA turns on GPU
 * advection and the densest route field. Those tiers are carried by
 * `structureDetail`, `domainDetail`, `routeLanes` and `advection`; the field
 * budget only ever caps the result.
 */
export function getCoreParameters(profile: QualityProfile): CoreParameters {
  const quality = getQualityProfile(profile);

  return {
    profile,
    configuredFieldBudget: quality.coreParticleBudget,
    structureDetail: quality.coreStructureDetail,
    // The flowfield packs lanes by route class, so more than the class count is
    // not a tier, it is a clamp. Exposing the ceiling keeps the parameter honest.
    routeLanes: Math.max(
      1,
      Math.min(ROUTE_CLASS_ORDER.length, Math.round(quality.coreRouteLanes)),
    ),
    advection: quality.coreAdvection,
    domainDetail: quality.domainDetail,
  };
}
