'use client';

import { useEffect, useMemo } from 'react';

import type { FieldUniforms } from '../field/fieldUniforms';
import { createEnergySurfaceMaterial } from '../materials/energyMaterial';
import {
  buildStructureGeometry,
  usedSurfaceClasses,
  type SurfaceClass,
} from '../materials/structureGeometry';
import type { RiftStructure as RiftStructureDescriptor } from './riftStructure';

export type RiftStructureViewProps = {
  readonly structure: RiftStructureDescriptor;
  readonly uniforms: FieldUniforms;
};

/**
 * Per-finish shading constants.
 *
 * The rift is one body in eight finishes, and the finishes are not brightness
 * settings — they are different physical surfaces, so they take different
 * amounts of rim, vein and corridor response. The mass holds its silhouette and
 * barely answers; the recesses are where the machine's insides are and answer
 * most; the wafers are the only thing allowed to read as a light source of their
 * own.
 */
const FINISHES: Readonly<
  Record<
    SurfaceClass,
    {
      readonly rimGain: number;
      readonly veinGain: number;
      readonly corridorGain: number;
      readonly baseGain: number;
      readonly deepGain: number;
      readonly veinScale: number;
    }
  >
> = {
  // The base gains all came down by roughly a third, and the reason is the value
  // range rather than the taste. With every finish sitting at eight or nine
  // tenths of its baked luminance, the machine's unlit surfaces were within a
  // stop of its lit ones and the frame had no black in it — a hero rendered in
  // one value is a hero rendered in no lighting at all. The baked palette's own
  // darks are the composition's floor; these gains decide how much of that floor
  // is kept, and keeping it is what makes the corridor read as light.
  //
  // They came down again, and further, once the eleventh capture showed what the
  // first round had not fixed. `baseGain` is a multiplier on a *baked orientation
  // luminance*, so it does not darken a member evenly — it leaves the face turned
  // into the key light at very nearly full value, and the large flat sweeps are
  // exactly the members with such a face. The near massif's inner blade was
  // therefore a pale unbroken wedge across the bottom of the frame at a gain that
  // looked conservative in the table. The gain is what sets a *plane*'s value
  // here, and a plane with no other term on it is a slab however dark the palette
  // entry is. So the flat classes gave up brightness and took vein gain instead:
  // the value is now carried by a term that varies across the surface rather than
  // by one that does not.
  shell: {
    // Down from 0.78, and the reduction is the near blade's. `shell` is the
    // finish of every large sweep in the hero, and a large sweep at a grazing
    // angle is precisely the case a rim cannot distinguish from a small one: the
    // term is uniform across it, so the biggest member in the frame takes the
    // largest single unbroken value in it. The cut edges — which are what a rim
    // is actually *for* — are the `edge` class and are unchanged at 1.05.
    rimGain: 0.55,
    veinGain: 0.2,
    corridorGain: 0.5,
    baseGain: 0.34,
    deepGain: 0.12,
    veinScale: 0.3,
  },
  edge: {
    rimGain: 1.05,
    veinGain: 0.34,
    corridorGain: 0.85,
    baseGain: 0.42,
    deepGain: 0.18,
    veinScale: 0.5,
  },
  recess: {
    rimGain: 0.45,
    veinGain: 0.22,
    corridorGain: 1.3,
    baseGain: 0.3,
    deepGain: 0.34,
    veinScale: 0.36,
  },
  // The wafers are the brightest class in the scene and they were the class that
  // broke the second capture. Their vein gain was the highest of the five, at a
  // lattice finer than any other finish, on plates a few units across — so each
  // wafer carried a handful of small bright blobs, and a cavity of them read as
  // a surface with mould on it. A vein is a *line*: it wants to be finer than the
  // member it is on and it wants to be dim enough to be a texture on that member
  // rather than an object in its own right. Both of those were wrong here.
  accent: {
    rimGain: 0.42,
    veinGain: 0.12,
    corridorGain: 1.35,
    baseGain: 0.62,
    deepGain: 0.22,
    veinScale: 1.1,
  },
  // The membrane's rim was the highest in the scene, at more than twice the
  // shell's — and a rim is a function of the view, so a thin blending surface at
  // a grazing angle turned its whole area into a bright striated band. Two of
  // them read as discs hanging in the dark. A membrane is a veil: it is allowed
  // to be brighter than the surface behind it and it is not allowed to be the
  // brightest thing in the frame.
  membrane: {
    rimGain: 0.62,
    veinGain: 0.12,
    corridorGain: 1.05,
    baseGain: 0.28,
    deepGain: 0.3,
    veinScale: 0.6,
  },
};

/** Membranes are the one finish that blends, so they draw after the solids. */
const MEMBRANE_OPACITY = 0.3;

/**
 * The rift.
 *
 * One geometry per finish rather than one per member, so an entire massif of
 * shells is one draw call and the whole hero costs between two and five. The
 * bake already carries orientation luminance and depth darkening in its vertex
 * colours, so what is left here is entirely the part that has to move — see
 * `energyMaterial.ts`.
 */
export function RiftStructureView({
  structure,
  uniforms,
}: RiftStructureViewProps) {
  const geometry = useMemo(
    () => buildStructureGeometry(structure.parts),
    [structure],
  );
  const classes = useMemo(
    () => usedSurfaceClasses(structure.parts),
    [structure],
  );
  /**
   * The membrane's blend state is set where the material is *made*, not in an
   * effect afterwards.
   *
   * A membrane is a different physical surface, not a solid with a flag flipped
   * on it a frame later, and the material it is handed to is drawn on that same
   * frame. Configuring it here also keeps the whole of a material's construction
   * in one place, which is the property that makes the finished object the only
   * thing anything downstream has to reason about.
   */
  const materials = useMemo(
    () =>
      classes.map((surface) => {
        const handle = createEnergySurfaceMaterial({
          uniforms,
          ...FINISHES[surface],
        });
        if (surface === 'membrane') {
          handle.material.transparent = true;
          handle.material.depthWrite = false;
          handle.material.opacity = MEMBRANE_OPACITY;
        }
        return handle;
      }),
    [classes, uniforms],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      for (const handle of materials) handle.dispose();
    },
    [geometry, materials],
  );

  return (
    <group name="rift-structure">
      {classes.map((surface, index) => {
        const handle = materials[index];
        if (!handle) return null;
        return (
          <mesh
            key={surface}
            geometry={geometry.surfaces[surface]}
            material={handle.material}
            renderOrder={surface === 'membrane' ? 4 : 1}
          />
        );
      })}
    </group>
  );
}
