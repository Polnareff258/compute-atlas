import { BASE_CAMERA_DISTANCE, CAMERA_FOV_DEGREES } from './camera/cameraController';
import type { StructureFormPart } from './materials/structureGeometry';

/**
 * The backdrop is depth, not decoration.
 *
 * It is a nested stack of large plates built in the machine's own vocabulary —
 * the same `form` primitive, the same surface classes, the same baked
 * orientation luminance as the hero — so what sits behind the composition is a
 * low-frequency depth gradient with very weak large-scale structure rather than
 * a field of drifting motes.
 *
 * There is deliberately nothing here that moves. A backdrop that drifted would
 * be continuous background motion with no semantic meaning, which is exactly
 * what the scene must not spend its budget on.
 *
 * It also carries a colour of its own. It used to reuse the recessed interior
 * tier, which is the right instinct — nothing behind the scene should compete
 * with it — but the wrong number: that tier is dark enough that the whole stack
 * resolved to *below* the scene background, so the backdrop was not a quiet
 * field, it was a hole slightly blacker than the void, and the mass of the Core
 * had nothing to be a silhouette against. See `MACHINE_PALETTE.backdrop`.
 */
export type AtmosphereDescriptor = {
  /** Merged into one mass; the backdrop costs one draw call. */
  readonly parts: readonly StructureFormPart[];
};

/**
 * Plates nested so the frame is a gradient rather than one card.
 *
 * Every plate is sized by the angle it subtends from the camera rather than by
 * a world size, because the angle is the only number that says what the viewer
 * sees. The rig's framing half-angle is fixed at `tan(fov/2)`, so a plate whose
 * half-extent over its own distance falls below that shows its edge inside the
 * frame, and one above it runs off the frame and is pure fill.
 *
 * `BACKDROP_INSET` is a fraction of that framing half-angle, and it is the whole
 * design: each plate sits inside the one behind it, so the frame reads as four
 * nested field steps and then the rear fill. Fog grades by distance and so does
 * the recess depth darkening, so the plates step down from about 0.044 to about
 * 0.037 in display value from the middle of the frame outwards, with the last
 * plate far enough back to have fallen to the background itself.
 *
 * Each of those steps is under a tenth of a value on a dark frame, which is the
 * point. The first version of this stack stepped by nearly a fifth per plate and
 * the plates read as flat slabs with hard edges stacked across the composition —
 * large grey surfaces, which is the thing the frame is not allowed to be. A
 * backdrop is allowed to have structure only at the threshold of visibility.
 *
 * The previous revision had three plates and none of that. They were 40x23 and
 * larger at 10.2, 14.5 and 21 units, which subtends between 0.89 and 1.05 of the
 * framing angle: all three ran off the frame, the nearest occluded the other
 * two, and the gradient was a single flat card. Three draw calls, one value.
 *
 * The rear plate is the exception — it is placed *beyond* the framing angle on
 * purpose, so it fills to the frame edge and past it under any legal camera.
 * That is what guarantees no seam can open at the frame boundary, and it is why
 * the nested plates above it are free to be sized for the idle composition.
 */
const BACKDROP_INSET = [0.66, 0.8, 0.9, 0.975] as const;
/** Beyond the framing angle: fill to the frame edge and past it. */
const BACKDROP_REAR_INSET = 1.25;

/**
 * Lateral drift, as a fraction of the plate's own distance — that is, as an
 * angle.
 *
 * A constant angle rather than a constant offset, so the nesting stays
 * concentric in screen space instead of the far plates sliding out of alignment
 * with the near ones. The values are small and signed differently per plate so
 * the stack does not read as one symmetric bullseye behind the Core.
 */
const BACKDROP_DRIFT: readonly (readonly [number, number])[] = [
  [-0.09, 0.06],
  [0.11, -0.07],
  [-0.13, 0.08],
  [0.15, -0.1],
];

const BACKDROP_DEPTHS = [5.5, 9.5, 15, 22] as const;
const BACKDROP_REAR_DEPTH = 32;
/** The framing half-angle the insets are a fraction of. */
const FRAMING_TAN = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);

/** One plate, sized so its half-extents subtend `inset` of the framing angle. */
function backdropPlate(
  depth: number,
  inset: number,
  drift: readonly [number, number],
  spin: readonly [number, number, number],
): StructureFormPart {
  // Half-extents are resolved at the idle camera, because idle is the framing
  // the composition is authored against: a plate sized for the farthest dolly
  // would be a third of the frame at rest.
  const distance = depth + BASE_CAMERA_DISTANCE;
  const halfHeight = inset * FRAMING_TAN * distance;
  return {
    shape: 'form',
    tier: 'backdrop',
    surface: 'recess',
    position: [drift[0] * distance, drift[1] * distance, -depth],
    rotation: [spin[0], spin[1], spin[2]],
    scale: [halfHeight * 2 * (16 / 9), halfHeight * 2, 0.5],
  };
}

const BACKDROP: readonly StructureFormPart[] = [
  ...BACKDROP_DEPTHS.map((depth, index) =>
    backdropPlate(
      depth,
      BACKDROP_INSET[index]!,
      BACKDROP_DRIFT[index]!,
      // A slight tilt and roll per plate. The tilt is what stops the value step
      // at each edge from being a perfectly level horizon; the plates are large
      // enough that a few hundredths of a radian is several units of depth
      // across one, which the fog then grades along it.
      [
        0.03 - index * 0.015,
        (index % 2 === 0 ? 1 : -1) * 0.04,
        index * 0.02 - 0.03,
      ],
    ),
  ),
  backdropPlate(BACKDROP_REAR_DEPTH, BACKDROP_REAR_INSET, [0.05, 0.02], [0.01, -0.02, 0.02]),
];

export function deriveAtmosphereDescriptor(): AtmosphereDescriptor {
  return { parts: BACKDROP };
}
