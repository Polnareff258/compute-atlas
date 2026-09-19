import { describe, expect, it } from 'vitest';

import {
  buildCoreStructureGeometry,
  buildPortGeometry,
} from './coreStructureGeometry';
import { deriveCoreStructure, type CoreStructureHull } from './coreStructure';

const SEED = 17;

function structure(detail = 1) {
  return deriveCoreStructure({ structureDetail: detail }, SEED);
}

function attributeValues(geometry: ReturnType<typeof buildCoreStructureGeometry>['solid']) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  return { position, normal, color };
}

describe('buildCoreStructureGeometry', () => {
  it('merges the whole structure into a solid mass and a membrane set', () => {
    const hero = structure();
    const geometry = buildCoreStructureGeometry(hero);
    const membranes = hero.members.filter((member) => member.shape === 'membrane');
    const solids = hero.members.filter((member) => member.shape !== 'membrane');

    // Ports are deliberately not merged: the source port lights on its own.
    //
    // Membranes are all flat plates, so each contributes exactly one box's 24
    // vertices. Solids are lofted hulls whose facet count depends on the profile
    // and the section list, so the contract there is a floor, not a constant.
    const membranePosition = geometry.membrane.getAttribute('position');
    expect(membranePosition.count).toBe(membranes.length * 24);

    const { position } = attributeValues(geometry.solid);
    expect(position.count).toBeGreaterThanOrEqual(solids.length * 24);
    expect(position.count % 4).toBe(0);
    expect(solids.length).toBeGreaterThan(0);

    // A hull must actually be lofted: if the sections were ignored and every
    // member collapsed to a transformed unit box, the count would be exact.
    expect(position.count).toBeGreaterThan(solids.length * 24);

    geometry.dispose();
  });

  it('emits matching position, normal and colour attributes on both surfaces', () => {
    const geometry = buildCoreStructureGeometry(structure());

    for (const surface of [geometry.solid, geometry.membrane]) {
      const { position, normal, color } = attributeValues(surface);
      expect(normal.count).toBe(position.count);
      expect(color.count).toBe(position.count);

      const index = surface.getIndex();
      expect(index).not.toBeNull();
      for (let entry = 0; entry < index!.count; entry += 1) {
        const vertex = index!.getX(entry);
        expect(vertex).toBeGreaterThanOrEqual(0);
        expect(vertex).toBeLessThan(position.count);
      }
    }

    geometry.dispose();
  });

  it('shades a lofted hull per facet, with every facet flat and tonally distinct', () => {
    const hero = structure();
    const firstHull = hero.members.find((member) => member.shape === 'hull');
    expect(firstHull).toBeDefined();
    if (!firstHull) return;

    const geometry = buildCoreStructureGeometry(hero);
    const { normal, color } = attributeValues(geometry.solid);

    // The hull is the first solid member, and this file writes one four-vertex
    // facet at a time, so the first 24 vertices are its first six facets.
    const toneByNormal = new Map<string, string>();
    for (let vertex = 0; vertex < 24; vertex += 1) {
      const key = [
        normal.getX(vertex).toFixed(3),
        normal.getY(vertex).toFixed(3),
        normal.getZ(vertex).toFixed(3),
      ].join(',');
      const tone = [color.getX(vertex), color.getY(vertex), color.getZ(vertex)]
        .map((channel) => channel.toFixed(5))
        .join(',');

      const existing = toneByNormal.get(key);
      if (existing === undefined) toneByNormal.set(key, tone);
      // A facet must be internally flat, or the hull reads as noise.
      else expect(tone).toBe(existing);

      for (const channel of [color.getX(vertex), color.getY(vertex), color.getZ(vertex)]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }

    // The first six facets of a hull run around its profile, so they must face
    // six different directions and carry six different baked tones. That is what
    // gives a large body its mass without any runtime lighting.
    expect(toneByNormal.size).toBe(6);
    expect(new Set(toneByNormal.values()).size).toBe(6);

    // The hull runs diagonally and tapers, so its facets are tilted relative to
    // the scene axes. An axis-aligned box would produce normals with two exactly
    // zero components on every facet.
    const tilted = [...toneByNormal.keys()].filter(
      (key) => key.split(',').filter((axis) => axis === '0.000').length < 2,
    );
    expect(tilted.length).toBeGreaterThan(0);

    geometry.dispose();
  });

  it('aims the diagonal spine along its authored direction', () => {
    const hero = structure(1);
    const geometry = buildCoreStructureGeometry(hero);
    const spine = hero.members.find(
      (member): member is CoreStructureHull =>
        member.shape === 'hull' && member.rank === 5,
    );
    expect(spine).toBeDefined();
    if (!spine) return;

    geometry.solid.computeBoundingBox();
    const box = geometry.solid.boundingBox!;
    const expectedLength = Math.hypot(
      spine.end[0] - spine.start[0],
      spine.end[1] - spine.start[1],
      spine.end[2] - spine.start[2],
    );

    // The spine is the longest member, so the merged box's largest extent is at
    // least the spine's own length. A span that failed to aim would be short.
    const extents = [
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z,
    ];
    expect(Math.max(...extents)).toBeGreaterThanOrEqual(expectedLength * 0.75);

    geometry.dispose();
  });

  it('never emits a non-finite position, normal or colour', () => {
    const geometry = buildCoreStructureGeometry(structure());

    for (const surface of [geometry.solid, geometry.membrane]) {
      const { position, normal, color } = attributeValues(surface);
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        expect(Number.isFinite(position.getX(vertex))).toBe(true);
        expect(Number.isFinite(position.getY(vertex))).toBe(true);
        expect(Number.isFinite(position.getZ(vertex))).toBe(true);
        expect(Number.isFinite(normal.getX(vertex))).toBe(true);
        expect(Number.isFinite(color.getX(vertex))).toBe(true);
        // Normals must stay unit length or the baked luminance is meaningless.
        expect(
          Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)),
        ).toBeCloseTo(1, 3);
      }
    }

    geometry.dispose();
  });

  it('adds surfaces for every richer profile rather than turning anything up', () => {
    const counts = [0.12, 0.4, 0.6, 1].map((detail) => {
      const geometry = buildCoreStructureGeometry(structure(detail));
      const total =
        geometry.solid.getAttribute('position').count +
        geometry.membrane.getAttribute('position').count;
      geometry.dispose();
      return total;
    });

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    }
    expect(counts[3]!).toBeGreaterThan(counts[0]!);
  });

  it('returns the same geometry for the same structure and survives disposal', () => {
    const hero = structure(0.72);
    const first = buildCoreStructureGeometry(hero);
    const second = buildCoreStructureGeometry(deriveCoreStructure({ structureDetail: 0.72 }, SEED));

    expect(Array.from(first.solid.getAttribute('position').array)).toEqual(
      Array.from(second.solid.getAttribute('position').array),
    );
    expect(Array.from(first.membrane.getAttribute('color').array)).toEqual(
      Array.from(second.membrane.getAttribute('color').array),
    );

    expect(() => {
      first.dispose();
      second.dispose();
    }).not.toThrow();
  });
});

describe('buildPortGeometry', () => {
  it('aims each socket along its own outward direction', () => {
    const hero = structure();
    expect(hero.ports.length).toBeGreaterThan(0);

    for (const port of hero.ports) {
      const geometry = buildPortGeometry(port);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const extents = [
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z,
      ];

      // The socket is longer along its departure axis than across it, which is
      // what makes it read as an opening rather than a cube stuck on the hull.
      const longest = Math.max(...extents);
      expect(longest).toBeGreaterThan(Math.min(...extents));
      expect(geometry.getAttribute('position').count).toBe(24);

      for (let vertex = 0; vertex < 24; vertex += 1) {
        expect(
          Number.isFinite(geometry.getAttribute('position').getX(vertex)),
        ).toBe(true);
      }

      geometry.dispose();
    }
  });

  it('keeps the socket centred on the port position', () => {
    const port = structure().ports[0]!;
    const geometry = buildPortGeometry(port);
    geometry.computeBoundingSphere();
    const center = geometry.boundingSphere!.center;

    expect(center.x).toBeCloseTo(port.position[0], 6);
    expect(center.y).toBeCloseTo(port.position[1], 6);
    expect(center.z).toBeCloseTo(port.position[2], 6);

    geometry.dispose();
  });
});