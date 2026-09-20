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
 * The knobs a quality tier turns, named for the watershed rather than for the
 * composition it replaced.
 *
 * Every field here is read by one system and only one, so a tier is a list of
 * separate decisions rather than one dial. That matters because the frame has to
 * degrade *in art direction* rather than in fidelity — the brief's rule is that
 * the fallback is an art-direction-consistent simplification, not a worse
 * picture — and separate knobs are what let a lower tier drop volumetric fog
 * while keeping the basin's terraces, which is the trade the spec's table asks
 * for.
 *
 * Detail is a *count* multiplier, never a position one: `watershedDescriptor`
 * asserts that reducing `detail` removes strata, deposits and resolution without
 * moving the basin, the domain anchors or a single river spine. If detail could
 * move something, the SAFE capture would be a different picture from the ULTRA
 * one and the two could not be compared at all.
 */
export type QualitySettings = {
  /** Structured units across every river, stratum, membrane and deposit. */
  particleBudget: number;
  maxDpr: number;
  allowBloom: boolean;
  graphDensity: number;
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
  /**
   * How many regions may carry a translucent membrane. A count rather than a
   * toggle because the middle tier's answer is "one", which a boolean cannot say.
   */
  membraneRegions: number;
  /** Raymarched volumetric fog. ULTRA only. */
  allowVolumetricFog: boolean;
  /** Temporal trails and screen-space distortion. ULTRA only. */
  allowTrails: boolean;
};
