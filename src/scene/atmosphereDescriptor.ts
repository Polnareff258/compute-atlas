export type AtmospherePosition = readonly [number, number, number];

export type AtmosphereTrace = {
  readonly points: readonly AtmospherePosition[];
  readonly opacity: number;
};

export type AtmosphereDescriptor = {
  readonly traces: readonly AtmosphereTrace[];
};

const TRACES: readonly AtmosphereTrace[] = [
  { points: [[-5.2, 2.08, -5.8], [-3.4, 1.88, -5.3], [-1.7, 2.02, -5.6]], opacity: 0.12 },
  { points: [[1.8, 2.4, -6.2], [3.3, 2.05, -5.7], [5.1, 2.2, -6]], opacity: 0.1 },
  { points: [[-5.4, -1.78, -6.1], [-3.2, -1.96, -5.65], [-1.9, -1.72, -5.9]], opacity: 0.09 },
  { points: [[1.6, -2.12, -5.7], [3.2, -1.84, -6.15], [5.4, -2.02, -5.8]], opacity: 0.11 },
  { points: [[-4.8, 0.08, -7], [-2.6, 0.26, -6.8], [-0.6, 0.14, -7.2]], opacity: 0.07 },
  { points: [[0.8, 0.04, -7.1], [2.8, -0.16, -6.8], [4.9, -0.02, -7.2]], opacity: 0.07 },
];

/** Sparse fixed spatial traces; no star dust, enclosing shell or orbit rings. */
export function deriveAtmosphereDescriptor(): AtmosphereDescriptor {
  return { traces: TRACES };
}
