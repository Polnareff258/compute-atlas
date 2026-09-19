import type { StructureFormPart } from './materials/structureGeometry';

/**
 * The backdrop is depth, not decoration.
 *
 * It is three large, depth-separated planes built in the machine's own recessed
 * tier — the same vocabulary the hero and the domains use — so what sits behind
 * the composition is a low-frequency depth gradient with very weak large-scale
 * structure rather than a field of drifting motes. `FogExp2` does the grading:
 * at the near plane it thins the plane by about a tenth, at the far plane by
 * about two fifths, and the gap between them *is* the gradient.
 *
 * There is deliberately nothing here that moves. A backdrop that drifted would
 * be continuous background motion with no semantic meaning, which is exactly
 * what the scene must not spend its budget on.
 */
export type AtmosphereDescriptor = {
  /** Merged into one mass; the backdrop costs one draw call. */
  readonly parts: readonly StructureFormPart[];
};

/**
 * Planes sized to over-cover the widest frame the camera rig can hold at the
 * depth they sit at, with a margin for their own slight rotation.
 *
 * The rig's farthest reachable framing is `1.5 · reach / tan(fov/2)` ≈ 12 units
 * back, so each plane covers its depth plus 12 e.g. the near plane spans
 * `(10.2 + 12) · tan(24°) · 16/9` ≈ 17.6 half-widths and is built 20 wide. A
 * backdrop that ran out at the frame edge would put a visible seam behind the
 * composition the moment the camera reframed.
 */
const BACKDROP: readonly StructureFormPart[] = [
  {
    shape: 'form',
    tier: 'recess',
    membrane: false,
    position: [0, 0, -21],
    rotation: [0, 0.06, 0.03],
    scale: [60, 34, 0.6],
  },
  {
    shape: 'form',
    tier: 'recess',
    membrane: false,
    position: [-2.4, 1.2, -14.5],
    rotation: [0.02, -0.05, -0.04],
    scale: [48, 27, 0.5],
  },
  {
    shape: 'form',
    tier: 'recess',
    membrane: false,
    position: [3.2, -0.8, -10.2],
    rotation: [-0.03, 0.04, 0.05],
    scale: [40, 23, 0.4],
  },
];

export function deriveAtmosphereDescriptor(): AtmosphereDescriptor {
  return { parts: BACKDROP };
}
