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
};
