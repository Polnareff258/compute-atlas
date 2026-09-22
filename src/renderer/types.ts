export type QualityProfile = 'ultra' | 'high' | 'medium' | 'safe';

export type RendererBackend = 'webgpu' | 'webgl2' | 'unavailable';

export type RendererStatus =
  | 'idle'
  | 'probing'
  | 'initializing'
  | 'ready'
  | 'fallback'
  | 'degraded'
  | 'stopped';

/**
 * The knobs a quality tier turns.
 *
 * ## Every field here is read, and that is now enforced by the type
 *
 * The sentence above this one used to be aspirational. An audit of the tier
 * table found five settings that were declared, given a different value per
 * tier, and read by nothing at all:
 *
 * | setting | readers before this pass |
 * |---|---|
 * | `graphDensity` | none |
 * | `membraneRegions` | none |
 * | `allowVolumetricFog` | none — there is no volumetric pass |
 * | `allowTrails` | none — there is no trail or distortion pass |
 * | `allowBloom` | one: `renderer.info.autoReset = !quality.allowBloom`, and there is no bloom |
 *
 * They were not harmless. `allowBloom` is what made the frame counters' meaning
 * depend on the tier — via a post pipeline that does not exist — and that is the
 * bug this pass fixed: for ULTRA and HIGH nothing reset `info`, so `drawCalls`
 * and `triangles` were session totals reported under a per-frame name. A dead
 * `allowVolumetricFog` is worse than dead code: it reads as a switch somebody
 * could flip, and flipping it would change the picture the art direction was
 * approved at.
 *
 * So they are gone rather than kept "for later". What a tier may change is the
 * five settings below, each of which has exactly one reader.
 *
 * Detail is a *count* multiplier, never a position one: `watershedDescriptor`
 * asserts that reducing `detail` removes strata, deposits and resolution without
 * moving the basin, the domain anchors or a single river spine. If detail could
 * move something, the SAFE capture would be a different picture from the ULTRA
 * one and the two could not be compared at all.
 */
export type QualitySettings = {
  /**
   * Structured units across every river, stratum, membrane and deposit.
   *
   * A *plan*, not a measurement, and read only as `configuredFieldBudget` in the
   * telemetry — where it is deliberately reported beside `renderedFieldSamples`
   * and never as it. See `rendererTelemetry`.
   */
  particleBudget: number;
  /** Ceiling on the drawing-buffer scale. Read by `deriveEffectiveDpr`. */
  maxDpr: number;
  /** Scale applied to the device ratio before `maxDpr` clamps it. */
  pixelRatioScale: number;
  /**
   * How much of the terrain's own relief, strata, deposits and membrane regions
   * exist at all. Passed straight to `createWatershedDescriptor` as its detail.
   *
   * There is deliberately one of these rather than one per feature. The
   * descriptor takes a single number and its tests hold it to a single meaning —
   * detail changes counts and never positions — so a second dial here would
   * either have to be threaded through as a second descriptor argument, or be a
   * field nothing reads.
   */
  terrainDetail: number;
};
