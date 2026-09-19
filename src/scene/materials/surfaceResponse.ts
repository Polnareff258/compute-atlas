import {
  SURFACE_RESPONSE_CURVES,
  type SurfaceResponseCurve,
  type SurfaceRole,
} from './machinePalette';
import { deriveMembraneOpacity } from './surfaceGeometry';

/**
 * The state a surface is in, as scalars only.
 *
 * Nothing here allocates and nothing here is a vector: view layers publish
 * numbers every frame, so the response has to be computed from numbers.
 */
export type SurfaceInput = {
  readonly activity: number;
  readonly focus: number;
  /**
   * How much of this surface the composition is showing, 0..1, default 1.
   *
   * This is the one input that can take a surface *below* its resting response,
   * which is what "the other domains recede" needs and what brightness alone
   * cannot express: `gainAtRest` is a floor, so a receded surface handed
   * `activity: 0` renders exactly as a rested one does. Presence is a property of
   * the composition, not of the surface's own state, so it scales the resolved
   * response rather than serving as a third increment alongside activity.
   */
  readonly presence?: number;
};

/** What a surface should actually show. */
export type SurfaceResponse = {
  /** Multiplier for the surface's own colour. */
  readonly gain: number;
  /**
   * Alpha for a blending tier, or 1 for an opaque one.
   *
   * Opaque surfaces get exactly 1 rather than a number near it: an opaque
   * material ignores alpha, so any other value here would be a response the
   * renderer never applies.
   */
  readonly alpha: number;
};

function boundedUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function responseCurveFor(role: SurfaceRole): SurfaceResponseCurve {
  return SURFACE_RESPONSE_CURVES[role];
}

/**
 * Resolves state into the two numbers a material can actually be written with.
 *
 * Both backends call this and nothing else, so a surface cannot answer a hover
 * one way on WebGPU and another way on WebGL2 — which is exactly the failure
 * this replaced. There is one derivation, and the backends differ only in which
 * property they write it to.
 *
 * `baseFade` is the surface's own resting openness, because the hero's
 * membranes and a domain's membranes layer over different amounts of structure
 * and were tuned apart; the curve supplies only the increments, so the resting
 * openness has exactly one home.
 *
 * Presence multiplies the whole resolved response — colour gain and membrane
 * openness alike — so a receded surface loses its interior *and* its light
 * together. Scaling only one of the two would leave a domain that reads as a
 * bright sliver, which is the opposite of receding.
 */
export function deriveSurfaceResponse(
  role: SurfaceRole,
  input: SurfaceInput,
  baseFade = 0,
): SurfaceResponse {
  const curve = responseCurveFor(role);
  const activity = boundedUnit(input.activity);
  const focus = boundedUnit(input.focus);
  const presence = input.presence === undefined ? 1 : boundedUnit(input.presence);

  const gain =
    (curve.gainAtRest +
      curve.gainFromActivity * activity +
      curve.gainFromFocus * focus) *
    presence;

  if (role !== 'membrane') {
    return { gain, alpha: 1 };
  }

  const fade = boundedUnit(
    boundedUnit(baseFade) * presence +
      curve.fadeFromActivity * activity +
      curve.fadeFromFocus * focus,
  );

  return { gain, alpha: deriveMembraneOpacity(fade) };
}
