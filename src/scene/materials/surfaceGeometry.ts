import { MACHINE_PALETTE, STRUCTURE_KEY_DIRECTION } from './machinePalette';

/**
 * Structure is fixed geometry under a bounded camera, so orientation-dependent
 * luminance is baked once per face instead of being lit every frame. Baking is
 * what lets both backends share one visual spec: WebGL2 has no node material,
 * and this keeps it from reading as flat `MeshBasicMaterial` wash.
 *
 * A key term alone would collapse every away-facing face to one flat value, so
 * a wrapped term keeps the shadow side graded. The result is six distinct,
 * monotonic tiers across a box, which is what gives a large form its mass.
 */
const AMBIENT_LUMINANCE = 0.14;
const KEY_LUMINANCE = 0.55;
const WRAP_LUMINANCE = 0.26;
/** Compresses the key so no face clips to white and tiers stay separated. */
const KEY_EXPONENT = 1.35;
const WRAP_EXPONENT = 2;

/**
 * Luminance for a surface facing `normal`.
 *
 * Exposed because structure geometry is merged and transformed before it ever
 * becomes a mesh, so its colours have to be baked from world-space normals by
 * the builder rather than from a freshly created BoxGeometry.
 */
export function deriveSurfaceLuminance(
  normalX: number,
  normalY: number,
  normalZ: number,
): number {
  const [keyX, keyY, keyZ] = STRUCTURE_KEY_DIRECTION;
  const keyLength = Math.hypot(keyX, keyY, keyZ) || 1;
  const facing =
    normalX * (keyX / keyLength) +
    normalY * (keyY / keyLength) +
    normalZ * (keyZ / keyLength);
  const keyTerm = Math.pow(Math.max(0, facing), KEY_EXPONENT);
  const wrapTerm = Math.pow(facing * 0.5 + 0.5, WRAP_EXPONENT);
  return Math.min(
    1,
    AMBIENT_LUMINANCE + KEY_LUMINANCE * keyTerm + WRAP_LUMINANCE * wrapTerm,
  );
}

/**
 * How opaque a membrane is at a given openness.
 *
 * The membrane tier used to fade by ordered dither — an alpha map and an alpha
 * test — so that it could stay in the depth pass without transparency sorting.
 * It never rendered: three samples an alpha map in the green channel, the map
 * was built as a single-channel red texture, and every membrane fragment in the
 * scene was therefore discarded against a constant zero. Fixing the channel
 * only exposed the second half of the problem, which is that an ordered dither
 * cannot be made to read as a fade here at all: the scene frames a world unit
 * at roughly two hundred pixels, so a Bayer cell of one or two pixels aliases
 * into a visible checkerboard across the large plates and into diagonal moiré
 * across the small ones. The tier is now a genuine blend, which is the other
 * half of what the material spec always allowed.
 *
 * The band is deliberately narrow: enough for the layer to read as its own
 * surface with its own edge response, never enough to hide the structure it
 * covers. The floor matters as much as the ceiling — a closed membrane stays a
 * visible layer rather than vanishing, which is what keeps a dormant domain's
 * layering legible in the idle composition.
 */
export function deriveMembraneOpacity(fade: number): number {
  const boundedFade = Number.isFinite(fade) ? Math.min(1, Math.max(0, fade)) : 0;
  return 0.16 + boundedFade * 0.3;
}

export type MachineColorTier = keyof Pick<
  typeof MACHINE_PALETTE,
  'shellHigh' | 'shellMid' | 'shellLow' | 'interior' | 'backdrop'
>;

/**
 * Resolves a structure tier to the luminance tier it should occupy.
 *
 * `backdrop` is the one case that is not a rung of the shell ladder. The four
 * orientation tiers are distances from the key light within the mass, and the
 * backdrop is not in the mass at all — it is what the mass is seen against. It
 * resolves to its own colour rather than to `interior` because the two have
 * opposite jobs: `interior` is a face inside the body that must stay under
 * everything, and the backdrop is the field the body's silhouette is cut out of,
 * which has to stay *above* the scene background or the composition reads as
 * objects floating in nothing.
 */
export function resolveStructureTier(
  tier: 'anchor' | 'primary' | 'secondary' | 'detail' | 'recess' | 'backdrop',
): MachineColorTier {
  switch (tier) {
    case 'anchor':
      return 'shellHigh';
    case 'primary':
      return 'shellMid';
    case 'secondary':
      return 'shellLow';
    case 'detail':
      return 'shellMid';
    case 'recess':
      return 'interior';
    case 'backdrop':
      return 'backdrop';
  }
}
