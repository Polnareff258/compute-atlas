import { describe, expect, it } from 'vitest';
import { terrainHeight } from './terrainField';
import { buildRiverGeometry, EROSION_REACH, type RiverRibbon } from './riverGeometry';
import { createWatershedDescriptor } from './watershedDescriptor';

/**
 * The water is the subject, so these are the assertions that keep it *on* the
 * ground: that the ribbon spans the reach the flow field actually erodes, that its
 * vertices sit on the same surface the terrain mesh sits on, and that it is wound
 * to face up.
 *
 * The facing test is not ceremony. The terrain mesh was wound backwards for a whole
 * stage and the frame came back empty — every triangle culled — and nothing else in
 * that suite could see it, because the positions, the normals and the colours were
 * all correct. This file's geometry is built by the same kind of loop and is just as
 * capable of the same mistake.
 */

const descriptor = createWatershedDescriptor(2026, 0.8);

const RIVERS: RiverRibbon[] = [
  { spine: [[-80, 380], [20, 120], [0, -140]], width: 26 },
  { spine: [[160, 240], [40, -20]], width: 9 },
];

const FIELD = descriptor.field;

function build(rivers: RiverRibbon[] = RIVERS) {
  return buildRiverGeometry({ field: FIELD, rivers });
}

describe('the ribbon spans the reach the flow field erodes', () => {
  it('puts its outermost column exactly on the reach', () => {
    // The width is the whole reason the ribbon exists, and the flow field decides
    // it: `flowField` fades a river out over `width * EROSION_REACH`, so a ribbon
    // drawn to any other multiple either clips the water at a straight edge while
    // the alpha is still high, or hangs geometry over ground the field says is dry.
    // Measured as the maximum lateral distance from the spine rather than by
    // reading back a constant, so the loop that lays out the columns is what is
    // under test.
    const mesh = build([RIVERS[0]!]);
    const spine = RIVERS[0]!.spine;
    const reach = RIVERS[0]!.width * EROSION_REACH;

    let widest = 0;
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const x = mesh.positions[index * 3]!;
      const z = mesh.positions[index * 3 + 2]!;
      // The distance to the *nearest* point of the spine polyline, which is the
      // only definition that holds where the river bends.
      let nearest = Number.POSITIVE_INFINITY;
      for (let point = 0; point < spine.length - 1; point += 1) {
        nearest = Math.min(nearest, distanceToSegment(x, z, spine[point]!, spine[point + 1]!));
      }
      if (nearest > widest) widest = nearest;
    }

    // A hair over, because a vertex on a bend is measured against the segment it
    // belongs to and the join cuts the corner by a fraction of a unit.
    expect(widest).toBeLessThanOrEqual(reach * 1.02);
    // And it must actually reach it, or the ribbon is narrower than its own water.
    expect(widest).toBeGreaterThan(reach * 0.9);
  });

  it('keeps its columns strictly ordered across the channel', () => {
    // Two columns landing on each other is a row of degenerate triangles — a band
    // of dropped pixels straight along the river, which is the most visible place
    // in the frame for one.
    //
    // Measured on a *straight* spine, where the signed lateral offset is exact: run
    // the river along +Z and the offset is just the difference in X. The bent river
    // is not used because "signed distance from a polyline" is ambiguous past the
    // corner, and a test that has to special-case its own geometry is testing the
    // special case.
    const straight: RiverRibbon = { spine: [[0, 400], [0, 200], [0, 0]], width: 20 };
    const mesh = build([straight]);
    const columns = 13;
    const reach = straight.width * EROSION_REACH;

    for (let row = 0; row < straight.spine.length; row += 1) {
      const offsets: number[] = [];
      for (let column = 0; column < columns; column += 1) {
        offsets.push(mesh.positions[(row * columns + column) * 3]!);
      }
      for (let column = 1; column < columns; column += 1) {
        expect(offsets[column]!, `row ${row} column ${column}`).toBeGreaterThan(
          offsets[column - 1]!,
        );
      }
      // Symmetric about the centre line, and spanning the reach on both sides —
      // a ribbon that only reached out one way would be a river with one bank.
      expect(offsets[0]).toBeCloseTo(-reach, 6);
      expect(offsets[columns - 1]).toBeCloseTo(reach, 6);
      expect(offsets[(columns - 1) / 2]).toBeCloseTo(0, 6);
    }
  });
});

describe('the water sits on the ground the terrain mesh drew', () => {
  it('places every vertex on the height field', () => {
    // Not cosmetic. Both materials displace from `positionLocal`, including a 3D
    // noise for the relief, so a ribbon vertex whose Y came from anywhere else —
    // zero, or the spine's own elevation, or a lower-resolution copy of the field —
    // would displace against a different noise value and the water would float over
    // its bed or sink into it.
    //
    // The bound is not exact and cannot be: the builder evaluates the field at the
    // double-precision coordinate and stores the result into a `Float32Array`, so
    // reading X back and re-evaluating asks the field a very slightly different
    // question. Measured, the round trip costs 4e-6 world units at a height of 47,
    // which is float32's own resolution at that magnitude. What the bound has to do
    // is separate that from the failures this exists for — a Y of zero, a Y taken
    // from the spine, a Y from a coarser grid — and every one of those is wrong by
    // units. A thousandth of a unit leaves three orders of magnitude of headroom
    // under the smallest displacement term in `groundField` (the 1.1-unit
    // compression) without being so loose that a wrong height could hide in it.
    const mesh = build();
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const x = mesh.positions[index * 3]!;
      const z = mesh.positions[index * 3 + 2]!;
      const y = mesh.positions[index * 3 + 1]!;
      expect(Math.abs(y - terrainHeight(x, z, FIELD))).toBeLessThan(1e-3);
    }
  });

  it('follows the field along the spine rather than sitting at one height', () => {
    // The bound above would also be satisfied by a ribbon that was flat, since a
    // wrong-but-close height is the only thing it rules out. This is the other
    // half: the ribbon has to be *on the terrain*, which means it descends the way
    // the terrain does. The camera stands at z = 480 looking toward the basin, so
    // the near end of a river is hundreds of units above its mouth — if the spread
    // here ever collapses, the water has stopped being a surface on the landscape.
    const mesh = build([RIVERS[0]!]);
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const y = mesh.positions[index * 3 + 1]!;
      if (y < lowest) lowest = y;
      if (y > highest) highest = y;
    }
    expect(highest - lowest).toBeGreaterThan(10);
  });

  it('winds every triangle counter-clockwise as seen from above', () => {
    // The right-hand rule on the vertex order, which is what decides facing under
    // `FrontSide`. Wound the other way the river is culled and the frame is a
    // landscape with no water in it — and with the material transparent and
    // `depthWrite` off there would be no depth artefact to give it away either.
    const mesh = build();
    const at = (index: number): [number, number, number] => [
      mesh.positions[index * 3]!,
      mesh.positions[index * 3 + 1]!,
      mesh.positions[index * 3 + 2]!,
    ];

    for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
      const a = at(mesh.indices[triangle * 3]!);
      const b = at(mesh.indices[triangle * 3 + 1]!);
      const c = at(mesh.indices[triangle * 3 + 2]!);
      const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const y = ab[2] * ac[0] - ab[0] * ac[2];
      expect(y, `triangle ${triangle} faces down`).toBeGreaterThan(0);
    }
  });
});

describe('the mesh is sized to the rivers it is given', () => {
  it('indexes only vertices that exist', () => {
    const mesh = build();
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
    for (const index of mesh.indices) {
      expect(index).toBeLessThan(mesh.vertexCount);
    }
  });

  it('builds nothing for a spine that is a single point', () => {
    // Rivers are authored by hand and one of them will eventually be a single
    // point. A perpendicular taken from a point with no neighbours divides by zero
    // and the ribbon becomes NaNs, which WebGPU answers with a validation error.
    const mesh = build([{ spine: [[0, 0]], width: 12 }]);
    expect(mesh.vertexCount).toBe(0);
    expect(mesh.triangleCount).toBe(0);
  });

  it('stays within a sane budget for the descriptor’s own rivers', () => {
    // The real rivers, at the real widths. A ribbon is 13 columns wide, so a
    // 60-point spine is 780 vertices — the number that has to stay small enough
    // that the water is cheap next to the 194,000-vertex terrain it lies on.
    const mesh = build(
      descriptor.rivers.map((river) => ({ spine: river.spine, width: river.width })),
    );
    const rows = descriptor.rivers.reduce((total, river) => total + river.spine.length, 0);
    expect(mesh.vertexCount).toBe(rows * 13);
    // Twelve cells across and two triangles each, per step along the spine.
    expect(mesh.triangleCount).toBe(
      descriptor.rivers.reduce((total, river) => total + (river.spine.length - 1) * 24, 0),
    );
    expect(mesh.vertexCount).toBeLessThan(20_000);
  });
});

/** Distance from a point to a line segment, in the XZ plane. */
function distanceToSegment(
  x: number,
  z: number,
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) return Math.hypot(x - a[0], z - a[1]);
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared));
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}
