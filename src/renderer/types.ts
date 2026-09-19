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

export type QualitySettings = {
  particleBudget: number;
  maxDpr: number;
  allowBloom: boolean;
  graphDensity: number;
  pixelRatioScale: number;
  coreParticleBudget: number;
  /**
   * How much structure, membrane and foreground layering exists at all.
   * 0 keeps only the hero silhouette, spine, primary route and domain
   * silhouette; later tiers add surfaces rather than scaling brightness.
   */
  coreStructureDetail: number;
  /** Number of distinct routing lanes the flowfield may expose. */
  coreRouteLanes: number;
  /** GPU advection, trails and surface wake. ULTRA only. */
  coreAdvection: boolean;
  /** Layered structure inside each domain sub-environment. */
  domainDetail: number;
};
