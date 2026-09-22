export type InkStepTiming = {
  /** Ambient advection, diffusion and return-to-authored-field time. */
  readonly ambientDelta: number;
  /** Direct-manipulation time. It remains live under reduced motion. */
  readonly interactionDelta: number;
  /** Phase clock for autonomous flow. */
  readonly elapsed: number;
};

/**
 * Separates motion the page causes from motion the visitor causes.
 *
 * Reduced motion freezes the autonomous field and its phase clock. It must not
 * disable the drag response: that is direct manipulation, not ambient animation.
 */
export function resolveInkStepTiming(
  delta: number,
  elapsed: number,
  reducedMotion: boolean,
): InkStepTiming {
  const safeDelta = Math.min(Math.max(delta, 0), 0.1);
  return {
    ambientDelta: reducedMotion ? 0 : safeDelta,
    interactionDelta: safeDelta,
    elapsed: reducedMotion ? 0 : elapsed,
  };
}
