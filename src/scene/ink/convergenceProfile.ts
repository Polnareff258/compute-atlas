import type { QualityProfile } from '../../renderer/types';

export type ConvergenceLayerKind = 'membrane' | 'filament';

/**
 * What a layer is for, and therefore whether a tier may drop it.
 *
 * `primary` layers are the ones that carry the volume's identity: the broad
 * sheet that draws its silhouette, the near sheet that faces the camera, and the
 * signal tissue the composition's "main path" is. `secondary` layers deepen the
 * volume — a second membrane to give the stack mass, a second tissue to make the
 * directional computation read as a system rather than as one stroke — and a
 * lower tier drops them whole rather than dimming them.
 *
 * The two-way split exists because "reduce the layer count" and "reduce the
 * picture" are not the same instruction. What has to survive every tier is the
 * silhouette, the scale, the colour and the main path; what a tier is allowed to
 * spend less on is sampling and the layers that only add depth.
 */
export type ConvergenceLayerRole = 'primary' | 'secondary';

export type ConvergenceLayer = {
  readonly id: string;
  readonly kind: ConvergenceLayerKind;
  readonly role: ConvergenceLayerRole;
  readonly height: number;
  readonly phase: number;
  readonly gain: number;
  readonly displacement: number;
  readonly rotation: number;
  readonly tilt: number;
  /** Longitudinal, lateral and normal scale: the line hierarchy lives in the second value. */
  readonly scale: readonly [number, number, number];
  /** Deliberate XZ offset from the basin centre; prevents the internal strokes becoming rails. */
  readonly offset: readonly [number, number];
  readonly renderOrder: number;
};

/**
 * The convergence is one volume with two optical tissues.
 *
 * Three broad membranes provide mass and silhouette. Three tapered filament sheets
 * live close to the surface and carry directional computation. Keeping the profile
 * as data makes the depth order deliberate and prevents later art passes from
 * growing an arbitrary pile of nearly identical planes.
 *
 * **The role column is a classification of what is already here, not a
 * re-authoring of it.** Nothing above changed when it was added: the same six
 * layers, the same heights, the same rotations and the same gains that the
 * authored frame is drawn from. It exists so that "which layers may a lower
 * tier drop" is answered by the profile rather than decided again at the call
 * site, which is how a quality ladder quietly becomes a second art direction.
 *
 * The three primaries are chosen against the volume's own envelope. `rear` is
 * the widest sheet and the one the silhouette is read from; `front` sits at the
 * top of the stack and closes it; `signal-tissue-a` is the larger of the two
 * tissues and is what the "main path" is drawn out of. Dropping the other three
 * thins the volume between those three planes and leaves the planes themselves,
 * their scale, their order and their colour untouched.
 */
export const CONVERGENCE_LAYERS: readonly ConvergenceLayer[] = [
  {
    id: 'rear-membrane',
    kind: 'membrane',
    role: 'primary',
    height: 8,
    phase: 0.8,
    gain: 0.92,
    displacement: 12,
    rotation: -0.31,
    tilt: 0.12,
    scale: [1.08, 0.76, 1],
    offset: [0, 0],
    renderOrder: 5,
  },
  {
    id: 'lower-membrane',
    kind: 'membrane',
    role: 'secondary',
    height: 18,
    phase: 3.1,
    gain: 0.68,
    displacement: 15,
    rotation: 0.22,
    tilt: -0.11,
    scale: [0.98, 0.64, 1],
    offset: [8, -4],
    renderOrder: 6,
  },
  {
    id: 'signal-tissue-a',
    kind: 'filament',
    role: 'primary',
    height: 16,
    phase: 4.4,
    gain: 0.74,
    displacement: 8,
    rotation: -0.12,
    tilt: 0.04,
    scale: [1.18, 0.33, 1],
    offset: [-10, -8],
    renderOrder: 7,
  },
  {
    id: 'signal-tissue-b',
    kind: 'filament',
    role: 'secondary',
    height: 20,
    phase: 6.2,
    gain: 0.46,
    displacement: 12,
    rotation: 0.21,
    tilt: -0.05,
    scale: [0.92, 0.20, 1],
    offset: [18, 6],
    renderOrder: 8,
  },
  {
    id: 'signal-tissue-c',
    kind: 'filament',
    role: 'secondary',
    height: 24,
    phase: 8.1,
    gain: 0.34,
    displacement: 6,
    rotation: -0.27,
    tilt: 0.08,
    scale: [0.70, 0.12, 1],
    offset: [-24, 14],
    renderOrder: 9,
  },
  {
    id: 'front-membrane',
    kind: 'membrane',
    role: 'primary',
    height: 36,
    phase: 7.6,
    gain: 0.40,
    displacement: 18,
    rotation: -0.11,
    tilt: -0.14,
    scale: [0.91, 0.48, 1],
    offset: [-6, 5],
    renderOrder: 10,
  },
] as const;

/**
 * Segments per axis, as `[across, along]`.
 *
 * Both axes, rather than a single count, because the two sheets are not the same
 * shape: the membrane is wide and shallow (about 1.9 to 1) and the filament is
 * long and narrow (about 3 to 1), and a single segment count would either
 * over-tessellate the filament across its width or starve the membrane along it.
 */
export type ConvergenceSegments = readonly [across: number, along: number];

export type ConvergenceTier = {
  readonly segments: {
    readonly membrane: ConvergenceSegments;
    readonly filament: ConvergenceSegments;
  };
  /** Layer ids to draw, in the order the profile lists them. */
  readonly layerIds: readonly string[];
};

/**
 * The four tiers, as two separate decisions.
 *
 * ## Why this exists at all
 *
 * Six sheets at 288 by 150 segments is 43,938 vertices apiece, and every tier was
 * built at that figure: SAFE, which exists to be the profile a weak machine can
 * run, drew 263,628 vertices and six alpha-blended fullscreen-ish sheets through
 * the same volume as ULTRA. A quality ladder that does not appear in the
 * geometry is not a ladder, it is a label.
 *
 * ## What each tier is allowed to change
 *
 * Only two things: how finely the two sheets are sampled, and how many of the
 * six layers exist. Nothing else — not a scale, not a height, not a rotation, not
 * a gain, not a colour. ULTRA is the approved frame's own figures, so the
 * reference captures are untouched by this table; every other tier is a
 * coarsening of the same geometry or a subset of the same planes, and the sheets
 * a tier keeps are the same sheets at the same places.
 *
 * ## Why the numbers are what they are
 *
 * `HIGH` at three quarters is a real saving (44% of the vertices) that is under
 * the sampling rate of the two sheets' own deformation — the vertex shader's
 * displacement is a low-frequency arch and torsion, so the surfaces are smooth
 * functions and the only thing a finer grid buys is the silhouette's curve.
 * `MEDIUM` at half takes that silhouette to roughly a segment per four pixels at
 * the basin's distance, which is where the curve stops reading as a curve at all
 * on a 1080-line frame. `SAFE` is the floor: a third of the segments, which is
 * about one segment per eight pixels, and the three primary planes, which keep
 * the silhouette, the scale and the main path while paying for three sheets
 * instead of six.
 *
 * ## Why there is no automatic downgrade
 *
 * Nothing here reads the backend or a frame time. A tier is chosen by the runtime
 * and by the command bus, and a tier that quietly changed itself because the
 * renderer reported WebGL2 would be a picture that cannot be filed under the
 * tier it was captured at — the WebGL2 and WebGPU frames of the same tier are
 * compared against each other all over this project's evidence, and an automatic
 * step would make that comparison meaningless exactly when it matters. If a
 * runtime measurement ever justifies a downgrade it should be an explicit,
 * reported decision made by `RendererRuntime`, which owns quality — not a
 * side-effect of a renderer name.
 */
export const CONVERGENCE_TIERS: Readonly<Record<QualityProfile, ConvergenceTier>> = {
  ultra: {
    segments: { membrane: [288, 150], filament: [220, 72] },
    layerIds: CONVERGENCE_LAYERS.map((layer) => layer.id),
  },
  high: {
    segments: { membrane: [216, 112], filament: [165, 54] },
    layerIds: CONVERGENCE_LAYERS.map((layer) => layer.id),
  },
  medium: {
    segments: { membrane: [144, 75], filament: [110, 36] },
    // Three of the five non-primary layers, named rather than counted, so this
    // row keeps meaning the same thing if the profile's secondary set is
    // re-composed. What it keeps is the lower membrane, which gives the stack its
    // mass, and one of the two tissues, so the directional computation still
    // reads as a system rather than as a single stroke. What it gives up is a
    // tissue — the layer that sits *between* the two tissues rather than at the
    // envelope, so the top and the bottom of the stack are still closed by
    // `front-membrane` and `rear-membrane` and the silhouette is untouched.
    layerIds: ['rear-membrane', 'lower-membrane', 'signal-tissue-a', 'signal-tissue-b', 'front-membrane'],
  },
  safe: {
    segments: { membrane: [88, 46], filament: [66, 22] },
    // The three primaries and nothing else: the silhouette, the near sheet that
    // closes the stack, and the main path.
    layerIds: ['rear-membrane', 'signal-tissue-a', 'front-membrane'],
  },
};

/**
 * The layers a tier draws, in profile order.
 *
 * Order comes from the profile rather than from the tier table, so the depth
 * sequence cannot be re-sorted by editing a list of names — which is the one way
 * a subset of a render-ordered stack can silently change what occludes what.
 */
export function resolveConvergenceLayers(
  tier: QualityProfile,
): readonly ConvergenceLayer[] {
  const wanted = new Set(CONVERGENCE_TIERS[tier].layerIds);
  return CONVERGENCE_LAYERS.filter((layer) => wanted.has(layer.id));
}
