export type JourneyState = {
  form: number;
  melt: number;
  fracture: number;
  echo: number;
  chapter: 0 | 1 | 2 | 3;
};

export type QualityBudget = {
  dpr: number;
  particles: number;
};

export function clampProgress(progress: number): number {
  if (Number.isNaN(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function smoothstep(start: number, end: number, progress: number): number {
  const position = clampProgress((progress - start) / (end - start));
  return position * position * (3 - 2 * position);
}

export function getJourney(progress: number): JourneyState {
  const p = clampProgress(progress);
  const fracture = smoothstep(0.43, 0.67, p);

  return {
    form: 1 - fracture,
    melt: smoothstep(0.16, 0.4, p),
    fracture,
    echo: smoothstep(0.76, 0.98, p),
    chapter: p >= 0.78 ? 3 : p >= 0.48 ? 2 : p >= 0.22 ? 1 : 0,
  };
}

export function getQuality(mobile: boolean): QualityBudget {
  return mobile ? { dpr: 1, particles: 1800 } : { dpr: 1.5, particles: 3600 };
}
