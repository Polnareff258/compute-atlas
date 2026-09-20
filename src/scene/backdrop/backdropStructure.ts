import type { StructurePart } from '../materials/structureGeometry';
import { hashSigned, normalizeSeed } from '../seedRandom';

type Vector = readonly [number, number, number];

export type BackdropStructure = {
  readonly parts: readonly StructurePart[];
  readonly detail: number;
};

/**
 * The far field: the machine the foundry is *inside*.
 *
 * This exists because the hero used to carry its own backdrop. The rift's part
 * list ended with four large plates at z = −17 to −66, sized from 44 by 26 up to
 * 120 by 70 — and those numbers were half-extents, so the outermost was a box
 * two hundred and forty units wide. They were baked as ordinary structure and
 * rendered with the ordinary energy material, which meant the largest, brightest,
 * most vein-covered surfaces in the frame belonged to something the visitor was
 * never meant to look at directly. The first capture of this composition was
 * mostly those plates.
 *
 * The mistake was not the size. It was that the far field was *structure* — it
 * wanted to be depth, and it was authored as four boxes.
 *
 * So the far field lives here now, with its own gain, and the hero's own bounds
 * describe the hero again. What is built is deliberately not a set of cards:
 * every member is an open swept shell with a profile that tapers along its
 * length, so it has a silhouette that changes as the camera moves and an edge
 * that is a curve rather than a rectangle. A distant thing seen at this scale is
 * legible almost entirely by silhouette, and a rectangle has none.
 *
 * Nothing here is centred and nothing here is parallel. The far field is the
 * argument that the space continues past the frame, and an argument that
 * continues in every direction equally is a skybox.
 */
export function deriveBackdropStructure(input: {
  readonly detail: number;
  readonly seed?: number;
}): BackdropStructure {
  const detail = Number.isFinite(input.detail)
    ? Math.min(1, Math.max(0, input.detail))
    : 0;
  const seed = normalizeSeed(input.seed ?? 17);

  const parts: StructurePart[] = [];

  /**
   * One far member: a folded, tapering ribbon.
   *
   * `halfWidth` is the ribbon's breadth and `halfHeight` its thickness, and both
   * are given per point so the sweep gets heavy at one end and feather at the
   * other. A constant profile around a fold reads as a piece of bent card; a
   * tapering one reads as a mass with a direction.
   */
  const ribbon = (options: {
    readonly points: readonly Vector[];
    readonly breadth: number | readonly number[];
    readonly thickness: number | readonly number[];
    readonly reference: Vector;
  }): void => {
    parts.push({
      shape: 'path',
      tier: 'backdrop',
      surface: 'recess',
      points: options.points,
      closed: false,
      halfWidth: options.breadth,
      halfHeight: options.thickness,
      chamfer: 0.18,
      reference: options.reference,
    });
  };

  // The near curtain: a long fold sweeping from below the frame's left corner up
  // and back out to the right. It is the closest thing in the far field and the
  // one that does most of the work of saying the space has a near wall.
  ribbon({
    points: [
      [-58, -30, -30],
      [-22, -14 + hashSigned(seed, 1) * 6, -37],
      [16, 9, -44],
      [62, 26 + hashSigned(seed, 2) * 8, -54],
    ],
    breadth: [26, 30, 30, 24],
    thickness: [0.7, 0.85, 0.85, 0.7],
    reference: [0, 0, 1],
  });

  // The high shelf: a wide shallow arc across the top of the frame, folded down
  // at both ends so it reads as the underside of something rather than as a
  // horizon.
  ribbon({
    points: [
      [-72, 30, -46],
      [-18, 42 + hashSigned(seed, 3) * 5, -52],
      [34, 40, -58],
      [84, 24 + hashSigned(seed, 4) * 6, -66],
    ],
    breadth: [30, 38, 38, 28],
    thickness: [1.1, 1.4, 1.4, 1.1],
    reference: [0, 1, 0],
  });

  // A blade crossing the frame nearly edge-on. Viewed this way a ribbon is a
  // dark wedge with one lit edge, which is the single most useful far-field
  // shape there is: it is unmistakably a large object and it occupies almost no
  // area.
  ribbon({
    points: [
      [-40, 34, -62],
      [-4, 6, -68],
      [30, -22, -74],
      [58, -48 + hashSigned(seed, 5) * 7, -82],
    ],
    breadth: [16, 20, 20, 14],
    thickness: [2.2, 2.6, 2.6, 2.2],
    reference: [0, 0, 1],
  });

  // The bottom far mass: the counterweight to the high shelf, and the reason the
  // frame does not read as top-heavy. It sits low and slightly nearer than the
  // blade so the two cross in depth rather than reading as one plane.
  ribbon({
    points: [
      [-64, -44, -40],
      [-10, -52 - hashSigned(seed, 6) * 5, -48],
      [46, -44, -56],
      [88, -30, -64],
    ],
    breadth: [22, 28, 28, 20],
    thickness: [0.9, 1.2, 1.2, 0.9],
    reference: [0, 0, 1],
  });

  // The deep shelf: the last thing, and the faintest. It is the argument that
  // there is a fourth layer behind the third, and it is the only member here
  // that is allowed to be as wide as the frame — because by this distance it is
  // mostly hidden by everything in front of it, which is the point.
  if (detail >= 0.4) {
    ribbon({
      points: [
        [-150, -18, -108],
        [-40, 6 + hashSigned(seed, 7) * 8, -116],
        [70, 4, -124],
        [170, -26, -134],
      ],
      breadth: [46, 60, 60, 44],
      thickness: [1.6, 2.2, 2.2, 1.6],
      reference: [0, 0, 1],
    });
  }

  return { parts, detail };
}
