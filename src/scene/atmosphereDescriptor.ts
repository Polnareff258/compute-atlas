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
 * design: each plate sits inside the one behind it, so the frame reads as nested
 * field steps and then the rear fill. Fog grades by distance and so does the
 * recess depth darkening, so the plates step down from the middle of the frame
 * outwards, with the last plate far enough back to have fallen to the background
 * itself.
 *
 * There were four of them, and the arithmetic was right and the reading was
 * still wrong. "Each step is under a tenth of a value" is true and is not the
 * quantity that decides anything: what the eye compares a step against is the
 * value either side of it, and out there the frame is dark. A probe across the
 * left background of an idle capture read 7.9 then 13.1 then 15.7 — steps of
 * five, on a local value of eight, so every edge was a third again as bright as
 * what it sat on. The four steps were not a gradient, they were four nested
 * rectangles, which is a developer visualisation and not a depth field.
 *
 * So there are seven now, over a narrower depth ladder. The total span is much
 * the same, so the gradient is unchanged; what changed is that the same range is
 * divided into nearly twice as many steps, and the largest step in the stack
 * fell from 0.17 to 0.10 of a fog factor. Below the threshold where an edge
 * reads as an edge, the same seven boundaries read as one soft field instead,
 * which is the whole of the difference between a gradient and a staircase.
 *
 * The roll carries the rest. Each plate is fanned a few degrees further round
 * than the one inside it, so the boundaries are not parallel and the stack
 * cannot be read as concentric rings even if a step does become visible.
 *
 * The first version of this stack stepped by nearly a fifth per plate and the
 * plates read as flat slabs with hard edges stacked across the composition —
 * large grey surfaces, which is the thing the frame is not allowed to be. A
 * backdrop is allowed to have structure only at the threshold of visibility.
 *
 * The revision before that had three plates and none of the rest. They were
 * 40x23 and larger at 10.2, 14.5 and 21 units, which subtends between 0.89 and
 * 1.05 of the framing angle: all three ran off the frame, the nearest occluded
 * the other two, and the gradient was a single flat card. Three draw calls, one
 * value.
 *
 * The rear plate is the exception — it is placed *beyond* the framing angle on
 * purpose, so it fills to the frame edge and past it under any legal camera.
 * That is what guarantees no seam can open at the frame boundary, and it is why
 * the nested plates above it are free to be sized for the idle composition.
 */
const BACKDROP_INSET = [0.42, 0.52, 0.62, 0.71, 0.8, 0.88, 0.95] as const;
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
 *
 * They stay under a fifth of the framing angle on purpose. Drift is a lateral
 * shift and the plates are wide, so a plate pushed a third of a half-frame
 * sideways has run off one edge of the frame and left the other flat: the
 * gradient would become a left-to-right division with nothing in it, which is
 * the flat card this stack exists to avoid, arrived at from the side.
 */
const BACKDROP_DRIFT: readonly (readonly [number, number])[] = [
  [-0.1, 0.07],
  [0.12, -0.08],
  [-0.14, 0.06],
  [0.15, -0.09],
  [-0.12, 0.1],
  [0.13, -0.07],
  [-0.15, 0.08],
];

/**
 * Depths, on an even ladder.
 *
 * Even because the steps are what the eye reads and fog is not linear in depth:
 * a ladder bunched at the near end puts all its contrast in the first two plates
 * and leaves the far half of the frame as one card. The gaps are 3.5 units —
 * over the 3 the test asks for, and enough that no two plates resolve to the
 * same fog factor at any legal camera distance.
 *
 * The rear plate is a further six behind the last of them, and that is the one
 * large step left in the stack. It is free: its boundary is at the framing angle
 * and beyond, so it falls outside the frame and the step happens where nobody
 * can see it.
 */
const BACKDROP_DEPTHS = [9, 12.5, 16, 19.5, 23, 26.5, 30] as const;
const BACKDROP_REAR_DEPTH = 36;
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
      // A tilt and a roll, both on a monotone ladder rather than alternating:
      // a fan of nested planes leaning the same way reads as one layered field,
      // while an alternating roll reads as a pinwheel, which is a shape the eye
      // will find and name.
      //
      // The roll is the outer end of the fan and is deliberately small there.
      // A plate rolled far enough covers the frame on both axes at once, and the
      // one behind it is never seen again; the fan has to open slowly enough
      // that every plate keeps a corner of the frame to itself. At a twelfth of
      // a radian the outermost nested plate still runs off the top and bottom of
      // the frame while leaving all four corners uncovered, which is exactly the
      // amount of cover a plate this far back should have.
      //
      // The tilt is what stops the value step at each edge from being a
      // perfectly level horizon; the plates are large enough that a few
      // hundredths of a radian is several units of depth across one, which the
      // fog then grades along it.
      [
        0.03 - index * 0.015,
        (index % 2 === 0 ? 1 : -1) * 0.04,
        (index - 3) * 0.028,
      ],
    ),
  ),
  backdropPlate(BACKDROP_REAR_DEPTH, BACKDROP_REAR_INSET, [0.05, 0.02], [0.01, -0.02, 0.02]),
];

export function deriveAtmosphereDescriptor(): AtmosphereDescriptor {
  return { parts: BACKDROP };
}
