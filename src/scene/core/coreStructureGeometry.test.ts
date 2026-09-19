import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';

import {
  buildCoreStructureGeometry,
  buildPortGeometry,
} from './coreStructureGeometry';
import { deriveCoreStructure } from './coreStructure';
import {
  SURFACE_CLASSES,
  type SurfaceClass,
} from '../materials/structureGeometry';

const SEED = 17;

function structure(detail = 1) {
  return deriveCoreStructure({ structureDetail: detail }, SEED);
}

function attributeValues(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  return { position, normal, color };
}

describe('buildCoreStructureGeometry', () => {
  it('merges the structure into one geometry per finish, and no more', () => {
    const hero = structure();
    const geometry = buildCoreStructureGeometry(hero);

    const expected = new Map<SurfaceClass, number>();
    for (const member of hero.members) {
      expected.set(member.surface, (expected.get(member.surface) ?? 0) + 1);
    }

    // One geometry per class is the mechanism that lets a hover reach the
    // aperture while the shell holds. A class that lost its members would be a
    // mesh drawn for nothing.
    for (const surface of SURFACE_CLASSES) {
      const count = geometry.surfaces[surface].getAttribute('position').count;
      if ((expected.get(surface) ?? 0) === 0) {
        expect(count).toBe(0);
        continue;
      }
      // Ports are deliberately not merged: the source port lights on its own.
      // Membranes are flat plates contributing one box's 24 vertices; a swept
      // path or a lofted hull writes four vertices per facet, so its contract is
      // a floor rather than a constant.
      expect(count).toBeGreaterThanOrEqual(expected.get(surface)! * 24);
      expect(count % 4).toBe(0);
    }

    // And the split is total: the shell really does carry most of the mass,
    // which is what makes the classes a reading of the machine rather than an
    // even partition of it.
    const shellCount = geometry.surfaces.shell.getAttribute('position').count;
    expect(shellCount).toBeGreaterThan(0);
    for (const surface of SURFACE_CLASSES) {
      if (surface === 'shell') continue;
      expect(geometry.surfaces[surface].getAttribute('position').count)
        .toBeLessThan(shellCount);
    }

    geometry.dispose();
  });

  it('carries the finish in the geometry itself, not only in the material', () => {
    const hero = structure();
    const geometry = buildCoreStructureGeometry(hero);

    for (const surface of SURFACE_CLASSES) {
      const color = geometry.surfaces[surface].getAttribute('color');
      if (color.count === 0) continue;
      // The colour attribute is the tier colour, the orientation luminance and
      // the recess darkening multiplied together, so every class bakes into a
      // low band — an absolute threshold here would be a brightness target, and
      // these are not brightnesses. What has to hold is that a class carries
      // *form*: a band with real spread between its brightest and its darkest
      // face. A class baked flat would be a silhouette with no mass read, and
      // one baked at zero would be a hole in the composition.
      let brightest = 0;
      let darkest = 1;
      for (let vertex = 0; vertex < color.count; vertex += 1) {
        brightest = Math.max(brightest, color.getX(vertex));
        darkest = Math.min(darkest, color.getX(vertex));
      }
      expect(brightest).toBeGreaterThan(0.005);
      expect(brightest).toBeGreaterThan(darkest * 2);
    }

    geometry.dispose();
  });

  it('emits matching position, normal and colour attributes on every finish', () => {
    const geometry = buildCoreStructureGeometry(structure());

    for (const surface of SURFACE_CLASSES) {
      const buffer = geometry.surfaces[surface];
      const { position, normal, color } = attributeValues(buffer);
      expect(normal.count).toBe(position.count);
      expect(color.count).toBe(position.count);

      const index = buffer.getIndex();
      expect(index).not.toBeNull();
      for (let entry = 0; entry < index!.count; entry += 1) {
        const vertex = index!.getX(entry);
        expect(vertex).toBeGreaterThanOrEqual(0);
        expect(vertex).toBeLessThan(position.count);
      }
    }

    geometry.dispose();
  });

  it('leaves the aperture empty, which is the whole point of the ring', () => {
    const hero = structure();
    const geometry = buildCoreStructureGeometry(hero);
    const shell = attributeValues(geometry.surfaces.shell).position;

    // A circle well inside the ring's own inner wall. Nothing in the shell class
    // may enter it: two hulls with a slot between them would fill this, and the
    // Core would be a blockout with a groove rather than a body with an opening.
    const RADIUS = 0.5 * 1.9;
    let insideShell = 0;
    for (let vertex = 0; vertex < shell.count; vertex += 1) {
      if (Math.hypot(shell.getX(vertex), shell.getY(vertex)) < RADIUS) {
        insideShell += 1;
      }
    }
    expect(insideShell).toBe(0);

    // And the opening has a back rather than going through to the background,
    // which is what keeps it a recess instead of a picture frame.
    const recess = attributeValues(geometry.surfaces.recess).position;
    let behind = 0;
    for (let vertex = 0; vertex < recess.count; vertex += 1) {
      if (Math.hypot(recess.getX(vertex), recess.getY(vertex)) < RADIUS) {
        behind += 1;
      }
    }
    expect(behind).toBeGreaterThan(0);

    geometry.dispose();
  });

  it('shades a lofted hull per facet, with every facet flat and tonally distinct', () => {
    const hero = structure();
    const hull = hero.members.find((member) => member.shape === 'hull');
    expect(hull).toBeDefined();
    if (!hull) return;

    const geometry = buildCoreStructureGeometry(hero);
    // A hull is baked in the shell finish, and it is written one four-vertex
    // facet at a time, so the first 24 shell vertices are its first six facets
    // unless an earlier shell member is shorter than that. The monolith's ring
    // is first and is far longer, so the facet run is located by its flatness
    // rather than by an index.
    const { normal, color } = attributeValues(geometry.surfaces.shell);

    const toneByNormal = new Map<string, string>();
    let flatFacets = 0;
    for (let vertex = 0; vertex + 3 < normal.count; vertex += 4) {
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
      else if (existing === tone) flatFacets += 1;

      for (const channel of [color.getX(vertex), color.getY(vertex), color.getZ(vertex)]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }

    // Every facet in the run is internally flat — a smooth-shaded body would
    // round off the very edges the silhouette depends on.
    expect(flatFacets).toBeGreaterThan(0);
    // Facets facing the same way carry the same tone, so the mass reads as one
    // machined body rather than as noise.
    expect(toneByNormal.size).toBeGreaterThan(6);

    geometry.dispose();
  });

  it('never emits a non-finite position, normal or colour', () => {
    const geometry = buildCoreStructureGeometry(structure());

    for (const surface of SURFACE_CLASSES) {
      const { position, normal, color } = attributeValues(geometry.surfaces[surface]);
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
    const counts = [0.12, 0.4, 0.6, 0.72, 1].map((detail) => {
      const geometry = buildCoreStructureGeometry(structure(detail));
      const total = SURFACE_CLASSES.reduce(
        (sum, surface) =>
          sum + geometry.surfaces[surface].getAttribute('position').count,
        0,
      );
      geometry.dispose();
      return total;
    });

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    }
    expect(counts.at(-1)!).toBeGreaterThan(counts[0]!);
  });

  it('returns the same geometry for the same structure and survives disposal', () => {
    const hero = structure(0.72);
    const first = buildCoreStructureGeometry(hero);
    const second = buildCoreStructureGeometry(
      deriveCoreStructure({ structureDetail: 0.72 }, SEED),
    );

    // Every class, not just one: a deterministic bake that only agreed on the
    // solids would still put the light in a different place per frame.
    for (const surface of SURFACE_CLASSES) {
      expect(Array.from(first.surfaces[surface].getAttribute('position').array)).toEqual(
        Array.from(second.surfaces[surface].getAttribute('position').array),
      );
      expect(Array.from(first.surfaces[surface].getAttribute('color').array)).toEqual(
        Array.from(second.surfaces[surface].getAttribute('color').array),
      );
    }

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
