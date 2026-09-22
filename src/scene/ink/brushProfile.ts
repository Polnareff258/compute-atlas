/**
 * Direct manipulation is an area response, not a cursor decoration.
 *
 * The minimum keeps the gesture legible at a 1920px desktop viewport; the
 * river-relative multiple preserves that reach if a descriptor changes scale.
 */
export function resolveBrushRadius(primaryRiverWidth: number): number {
  return Math.max(64, primaryRiverWidth * 3.4);
}

/**
 * The pointer's authored nib shape in its local drag frame.
 *
 * A wide, shallow crescent reads as a pressure front. The quadratic bow gives it
 * a calligraphic shoulder, while the small skew keeps both ends from closing into
 * the same mechanically perfect arc. These values belong together: tuning any of
 * them in isolation is how the gesture regresses to a capsule or cursor ring.
 */
export const BRUSH_SHAPE = Object.freeze({
  depth: 0.32,
  breadth: 0.82,
  bow: 0.34,
  skew: 0.065,
});
