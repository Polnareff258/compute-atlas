import * as THREE from 'three';

import { MACHINE_PALETTE } from './machinePalette';
import { deriveSurfaceLuminance, resolveStructureTier } from './surfaceGeometry';

type Vector = readonly [number, number, number];

export type StructureTier = Parameters<typeof resolveStructureTier>[0];

/**
 * The finish a surface carries, which is what a viewer actually reads.
 *
 * This is the seam that makes one mass behave like several materials. Every
 * member bakes into the class it names, so a hover can light the recesses and
 * the accent wafers of a structure while its outer shell holds still — which is
 * the difference between a machine answering a state and a machine being
 * tinted. It is also why `membrane` is a class rather than a boolean: a
 * membrane is a finish, and it is the only one that blends.
 *
 * - `shell`  — the mass. Holds the silhouette; barely answers.
 * - `edge`   — thin strips along the corners that form the silhouette. Carries
 *              the restrained view-dependent response, because which facets are
 *              grazing is a property of the view rather than of the mass.
 * - `recess` — set-back faces inside apertures and pockets. Dark at rest, rises
 *              furthest, and darkens with depth inside the body.
 * - `accent` — the sparse pale wafers and dies. Rare on purpose; the only class
 *              allowed near the top of the value range.
 * - `membrane` — layered translucent surfaces. Blends.
 */
export type SurfaceClass = 'shell' | 'edge' | 'recess' | 'accent' | 'membrane';

/**
 * Every class, in a stable order. Exporting the order rather than letting each
 * caller re-derive it keeps the baked geometry record and the material record
 * keyed the same way, which is what stops a class from rendering with the wrong
 * finish.
 */
export const SURFACE_CLASSES = Object.freeze([
  'shell',
  'edge',
  'recess',
  'accent',
  'membrane',
] as const satisfies readonly SurfaceClass[]);

/** How far back inside the body each class is darkened by its own depth. */
const CLASS_DEPTH_DARKENING: Readonly<Record<SurfaceClass, number>> = {
  shell: 0.34,
  edge: 0.18,
  recess: 0.62,
  accent: 0.12,
  membrane: 0.5,
};

/**
 * One axis-oriented member: a slab, plate, socket or slice.
 *
 * `surface` is a physical distinction as much as an aesthetic one: a membrane
 * bakes into its own geometry so it can be drawn as a translucent layer that
 * does not write depth, while every solid class writes depth and occludes.
 */
export type StructureFormPart = {
  readonly shape: 'form';
  readonly tier: StructureTier;
  readonly surface: SurfaceClass;
  readonly position: Vector;
  readonly rotation: Vector;
  readonly scale: Vector;
};

/** One endpoint-defined member: a beam aimed from `start` to `end`. */
export type StructureSpanPart = {
  readonly shape: 'span';
  readonly tier: StructureTier;
  readonly surface: SurfaceClass;
  readonly start: Vector;
  readonly end: Vector;
  /** Cross-section across and through the span axis. */
  readonly width: number;
  readonly depth: number;
};

/**
 * One cross-section of a hull, along its own axis.
 *
 * The half-extents are what make a hull tapered rather than a scaled box: a
 * section that narrows toward the end produces a real wedge silhouette, and the
 * offset lets the section centre walk sideways so the hull can be cranked.
 */
export type StructureSection = {
  /** Position along the hull axis, 0 at `start`, 1 at `end`. */
  readonly t: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** Section centre offset on the section's own x/y, for swept or cranked hulls. */
  readonly offset: readonly [number, number];
};

/**
 * A lofted hull: a profile swept along an axis through a list of sections.
 *
 * This is the primitive a machined body needs and a transformed unit box cannot
 * give. A box scaled non-uniformly still has parallel faces and a rectangular
 * silhouette at every angle; a hull's sections differ, so its sides converge,
 * its ends close at the profile's shape and its silhouette changes as the camera
 * moves. Every vertex and normal here is constructed directly in world space
 * rather than produced by transforming a template.
 */
export type StructureHullPart = {
  readonly shape: 'hull';
  readonly tier: StructureTier;
  readonly surface: SurfaceClass;
  readonly start: Vector;
  readonly end: Vector;
  /**
   * Section profile. `0` is a chamfered rectangle — the machined default, whose
   * corner cut is `chamfer` as a fraction of the smaller half-extent. `3` and
   * above is a regular `facets`-gon, which reads as a turned prism.
   */
  readonly facets: number;
  readonly chamfer: number;
  readonly sections: readonly StructureSection[];
};

/**
 * A profile swept along a polyline — the one primitive that can express a hole.
 *
 * Every other shape in this file closes on itself: a lofted hull is a convex
 * prism and a box is a box, so no arrangement of them produces a body with an
 * aperture *through* it. A path swept along a closed polyline is a tube, so a
 * closed path whose profile is a wall section is a ring of solid material with
 * an opening in the middle — which is what a computing monolith is, and why
 * this exists rather than a fourth arrangement of hulls.
 *
 * The same generator covers the rest of what the composition needs, because an
 * open path is a different object from a closed one:
 *
 * - a closed path with thick walls → a monolith and its deep central aperture;
 * - a closed path with a thin profile → an integrated manifold channel;
 * - an open path with a wide flat profile → a folded blade shell;
 * - an open path with a small square profile → a routed conduit.
 *
 * The profile's half-extents may vary point by point, which is what keeps the
 * result from reading as an extruded outline: a wall that is heavy at the foot
 * and thin at the shoulder is a machined body, whereas one thickness carried
 * around a closed path is a picture frame.
 */
export type StructurePathPart = {
  readonly shape: 'path';
  readonly tier: StructureTier;
  readonly surface: SurfaceClass;
  /** Path vertices in world space. A closed path needs at least three. */
  readonly points: readonly Vector[];
  /** Closes the sweep back onto its first point, producing an apertured ring. */
  readonly closed: boolean;
  /**
   * Profile half-extents, either one value for the whole path or one per point.
   * A per-point list lets the section taper along the sweep, which is how a
   * curved shell gets a heavy base and a light edge without a second part.
   */
  readonly halfWidth: number | readonly number[];
  readonly halfHeight: number | readonly number[];
  /** Corner cut as a fraction of the smaller half-extent, as on a hull. */
  readonly chamfer: number;
  /**
   * Reference direction for the profile's local +y, projected perpendicular to
   * the path at every vertex. Frames are parallel-transported from the first
   * vertex, so a path that folds through space does not twist around its own
   * axis — which is what lets a folded shell be one sweep rather than two.
   */
  readonly reference: Vector;
};

export type StructurePart =
  | StructureFormPart
  | StructureSpanPart
  | StructureHullPart
  | StructurePathPart;

/**
 * A structure bakes into one geometry per surface class.
 *
 * The classes are the reason a whole structure can still answer state: one
 * merged mass with one material has exactly one lever, so everything about it
 * moves together or nothing does. Split by finish, a hover reaches the recesses
 * and the accents while the shell holds — several draw calls for a part of the
 * frame that costs a handful, bought back as a machine that reads as though it
 * is doing something.
 */
export type BakedStructureGeometry = {
  readonly surfaces: Readonly<Record<SurfaceClass, THREE.BufferGeometry>>;
  readonly dispose: () => void;
};

/**
 * A structure is one merged mass, not a list of parts.
 *
 * Members bake into two geometries — solid and membrane — so a whole structure
 * costs two draw calls instead of one per box. Tier colour and orientation
 * luminance are both pre-multiplied into vertex colours, which is what lets a
 * single material render every tier honestly on both backends.
 *
 * Baking also buys correctness the runtime cannot: the luminance a rotated face
 * should carry is a property of its final orientation, so it is computed after
 * the member's own transform is applied rather than before.
 *
 * Shared by the hero and by the domain sub-environments, so both speak one
 * machine language from one implementation rather than two that resemble
 * each other.
 */
export function buildStructureGeometry(
  parts: readonly StructurePart[],
): BakedStructureGeometry {
  const template = createUnitBox();
  const depth = resolveDepthRange(parts);
  const writers: Record<SurfaceClass, SurfaceWriter> = {
    shell: createSurfaceWriter(template, 'shell', depth),
    edge: createSurfaceWriter(template, 'edge', depth),
    recess: createSurfaceWriter(template, 'recess', depth),
    accent: createSurfaceWriter(template, 'accent', depth),
    membrane: createSurfaceWriter(template, 'membrane', depth),
  };

  for (const part of parts) {
    const writer = writers[part.surface];
    if (part.shape === 'span') {
      appendSpan(writer, part);
    } else if (part.shape === 'hull') {
      appendHull(writer, part);
    } else if (part.shape === 'path') {
      appendPath(writer, part);
    } else {
      appendForm(writer, part);
    }
  }

  template.dispose();

  const surfaces = {} as Record<SurfaceClass, THREE.BufferGeometry>;
  for (const surface of SURFACE_CLASSES) {
    surfaces[surface] = toGeometry(writers[surface]);
  }

  return {
    surfaces,
    dispose: () => {
      for (const surface of SURFACE_CLASSES) surfaces[surface].dispose();
    },
  };
}

/**
 * The span of z the structure occupies, measured from the parts themselves.
 *
 * Recess darkening needs to know how far back a facet sits, and "back" is only
 * meaningful against the mass's own front plane — so the reference is derived
 * from the thing being built rather than passed in and kept in sync by hand.
 */
function resolveDepthRange(parts: readonly StructurePart[]): DepthRange {
  let front = Number.NEGATIVE_INFINITY;
  let back = Number.POSITIVE_INFINITY;

  const consider = (point: Vector) => {
    if (point[2] > front) front = point[2];
    if (point[2] < back) back = point[2];
  };

  for (const part of parts) {
    if (part.shape === 'form') {
      consider(part.position);
      continue;
    }
    if (part.shape === 'span') {
      consider(part.start);
      consider(part.end);
      continue;
    }
    if (part.shape === 'hull') {
      consider(part.start);
      consider(part.end);
      continue;
    }
    for (const point of part.points) consider(point);
  }

  if (!Number.isFinite(front) || !Number.isFinite(back) || front - back < 1e-4) {
    return { front: 0, back: 1 };
  }

  return { front, back };
}

type DepthRange = {
  readonly front: number;
  readonly back: number;
};

/**
 * How much of its own colour a facet keeps at a given depth in the body.
 *
 * This is the procedural darkening of recessed areas, baked rather than shaded:
 * a face deep inside an aperture loses more of its value than one on the front
 * plane, and how much it loses is a property of the finish. That is what gives
 * a deep opening a floor instead of a hole, and it is view-independent, so both
 * backends read the same number from the same attribute.
 */
function depthFactor(depth: DepthRange, surface: SurfaceClass, z: number): number {
  const span = depth.front - depth.back || 1;
  const t = Math.min(1, Math.max(0, (depth.front - z) / span));
  return 1 - CLASS_DEPTH_DARKENING[surface] * t;
}

/**
 * Which finishes a part list actually uses, in the canonical class order.
 *
 * A view that renders one mesh per class should render the classes it has and
 * not the ones it does not: an empty geometry is a draw call that produces
 * nothing, and on a scene that already spends most of its budget on the routing
 * field those add up across a hero, five domains and a backdrop.
 */
export function usedSurfaceClasses(
  parts: readonly StructurePart[],
): SurfaceClass[] {
  const used = new Set<SurfaceClass>();
  for (const part of parts) used.add(part.surface);
  return SURFACE_CLASSES.filter((surface) => used.has(surface));
}

/** Unit box template: 24 vertices, 36 indices, one normal per face corner. */
function createUnitBox(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

type SurfaceWriter = {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  appendBox: (matrix: THREE.Matrix4, color: THREE.Color) => void;
  /** A convex facet given directly in world space, with its own flat normal. */
  appendFacet: (points: readonly Vector[], normal: Vector, color: THREE.Color) => void;
};

function createSurfaceWriter(
  template: THREE.BoxGeometry,
  surface: SurfaceClass,
  depth: DepthRange,
): SurfaceWriter {
  const sourcePosition = template.getAttribute('position');
  const sourceNormal = template.getAttribute('normal');
  const sourceIndex = template.getIndex();
  const vertexCount = sourcePosition.count;
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  const writer: SurfaceWriter = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    appendBox: (matrix, color) => {
      const base = writer.positions.length / 3;
      normalMatrix.getNormalMatrix(matrix);

      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        position
          .set(
            sourcePosition.getX(vertex),
            sourcePosition.getY(vertex),
            sourcePosition.getZ(vertex),
          )
          .applyMatrix4(matrix);

        // Transformed by the inverse transpose, so a non-uniformly scaled slab
        // still faces the direction its surface actually faces.
        normal
          .set(
            sourceNormal.getX(vertex),
            sourceNormal.getY(vertex),
            sourceNormal.getZ(vertex),
          )
          .applyMatrix3(normalMatrix)
          .normalize();

        const luminance =
          deriveSurfaceLuminance(normal.x, normal.y, normal.z) *
          depthFactor(depth, surface, position.z);
        writer.positions.push(position.x, position.y, position.z);
        writer.normals.push(normal.x, normal.y, normal.z);
        writer.colors.push(
          color.r * luminance,
          color.g * luminance,
          color.b * luminance,
        );
      }

      if (sourceIndex) {
        for (let index = 0; index < sourceIndex.count; index += 1) {
          writer.indices.push(base + sourceIndex.getX(index));
        }
      }
    },
    appendFacet: (points, normal, color) => {
      if (points.length < 3) return;
      const base = writer.positions.length / 3;
      const luminance =
        deriveSurfaceLuminance(normal[0], normal[1], normal[2]) *
        depthFactor(depth, surface, facetCentre(points)[2]);
      const red = color.r * luminance;
      const green = color.g * luminance;
      const blue = color.b * luminance;

      for (const point of points) {
        writer.positions.push(point[0], point[1], point[2]);
        writer.normals.push(normal[0], normal[1], normal[2]);
        writer.colors.push(red, green, blue);
      }

      for (let index = 1; index < points.length - 1; index += 1) {
        writer.indices.push(base, base + index, base + index + 1);
      }
    },
  };

  return writer;
}

function toGeometry(writer: SurfaceWriter): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  // A structure with no membranes is normal, and a zero-vertex bounding sphere
  // is NaN, which frustum culling would then propagate into the projection.
  if (writer.positions.length === 0) {
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setIndex([]);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    return geometry;
  }

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(writer.positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array(writer.normals), 3),
  );
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(writer.colors), 3),
  );
  geometry.setIndex(writer.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const FORM_MATRIX = new THREE.Matrix4();
const FORM_QUATERNION = new THREE.Quaternion();
const FORM_EULER = new THREE.Euler();
const FORM_POSITION = new THREE.Vector3();
const FORM_SCALE = new THREE.Vector3();

const SPAN_QUATERNION = new THREE.Quaternion();
const SPAN_DIRECTION = new THREE.Vector3();
const SPAN_MIDPOINT = new THREE.Vector3();
const SPAN_START = new THREE.Vector3();
const SPAN_END = new THREE.Vector3();
const SPAN_AXIS = new THREE.Vector3(0, 0, 1);

/** A slab, plate, socket or slice at its authored position and orientation. */
function appendForm(writer: SurfaceWriter, part: StructureFormPart): void {
  FORM_POSITION.set(part.position[0], part.position[1], part.position[2]);
  FORM_EULER.set(part.rotation[0], part.rotation[1], part.rotation[2]);
  FORM_QUATERNION.setFromEuler(FORM_EULER);
  FORM_SCALE.set(part.scale[0], part.scale[1], part.scale[2]);
  FORM_MATRIX.compose(FORM_POSITION, FORM_QUATERNION, FORM_SCALE);
  writer.appendBox(FORM_MATRIX, tierColor(part.tier));
}

/**
 * A beam. The unit box's own z axis is aimed down the span, so a beam is a box
 * that has been rotated into its direction rather than a separate geometry type.
 */
function appendSpan(writer: SurfaceWriter, part: StructureSpanPart): void {
  SPAN_START.set(part.start[0], part.start[1], part.start[2]);
  SPAN_END.set(part.end[0], part.end[1], part.end[2]);
  SPAN_DIRECTION.subVectors(SPAN_END, SPAN_START);
  const length = SPAN_DIRECTION.length();
  if (length < 1e-6) return;

  SPAN_DIRECTION.divideScalar(length);
  SPAN_QUATERNION.setFromUnitVectors(SPAN_AXIS, SPAN_DIRECTION);
  SPAN_MIDPOINT.addVectors(SPAN_START, SPAN_END).multiplyScalar(0.5);
  FORM_SCALE.set(part.width, part.depth, length);
  FORM_MATRIX.compose(SPAN_MIDPOINT, SPAN_QUATERNION, FORM_SCALE);
  writer.appendBox(FORM_MATRIX, tierColor(part.tier));
}

/**
 * A hull section is never allowed to collapse to a point. A true singularity
 * produces degenerate facets with NaN normals, and a real machined part has a
 * finite tip anyway, so the profile closes on a narrow edge instead.
 */
const MIN_HALF_EXTENT = 0.004;

/** Ring points in section-local x/y, counter-clockwise, for one hull section. */
function hullProfile(
  facets: number,
  chamfer: number,
  halfWidth: number,
  halfHeight: number,
): Vector[] {
  const halfW = Math.max(halfWidth, MIN_HALF_EXTENT);
  const halfH = Math.max(halfHeight, MIN_HALF_EXTENT);

  if (facets >= 3) {
    const points: Vector[] = [];
    const step = (Math.PI * 2) / facets;
    for (let index = 0; index < facets; index += 1) {
      const angle = step * index + step * 0.5;
      points.push([Math.cos(angle) * halfW, Math.sin(angle) * halfH, 0]);
    }
    return points;
  }

  const cut = Math.min(Math.max(chamfer, 0), 0.5) * Math.min(halfW, halfH);
  if (cut < 1e-4) {
    return [
      [halfW, halfH, 0],
      [-halfW, halfH, 0],
      [-halfW, -halfH, 0],
      [halfW, -halfH, 0],
    ];
  }

  return [
    [halfW - cut, halfH, 0],
    [-(halfW - cut), halfH, 0],
    [-halfW, halfH - cut, 0],
    [-halfW, -(halfH - cut), 0],
    [-(halfW - cut), -halfH, 0],
    [halfW - cut, -halfH, 0],
    [halfW, -(halfH - cut), 0],
    [halfW, halfH - cut, 0],
  ];
}

const HULL_START = new THREE.Vector3();
const HULL_END = new THREE.Vector3();
const HULL_AXIS = new THREE.Vector3();
const HULL_LOCAL = new THREE.Vector3();
const HULL_QUATERNION = new THREE.Quaternion();
const HULL_Z_AXIS = new THREE.Vector3(0, 0, 1);
const HULL_EDGE_A = new THREE.Vector3();
const HULL_EDGE_B = new THREE.Vector3();
const HULL_NORMAL = new THREE.Vector3();

/** Flat normal of a facet, or null when the facet is degenerate. */
function facetNormal(points: readonly Vector[], a: number, b: number, c: number): Vector | null {
  const p0 = points[a];
  const p1 = points[b];
  const p2 = points[c];
  if (!p0 || !p1 || !p2) return null;

  HULL_EDGE_A.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  HULL_EDGE_B.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
  HULL_NORMAL.crossVectors(HULL_EDGE_A, HULL_EDGE_B);
  const length = HULL_NORMAL.length();
  if (!Number.isFinite(length) || length < 1e-8) return null;

  HULL_NORMAL.divideScalar(length);
  return [HULL_NORMAL.x, HULL_NORMAL.y, HULL_NORMAL.z];
}

function facetCentre(points: readonly Vector[]): Vector {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
    z += point[2];
  }
  const count = points.length || 1;
  return [x / count, y / count, z / count];
}

/**
 * Writes a facet with its normal pointing away from a point known to be inside
 * the hull. Winding is decided here rather than trusted, so a section list that
 * runs backwards produces the same solid rather than an inside-out one.
 */
function appendOrientedFacet(
  writer: SurfaceWriter,
  points: readonly Vector[],
  interior: Vector,
  color: THREE.Color,
): void {
  const normal = facetNormal(points, 0, 1, 2);
  if (!normal) return;

  const centre = facetCentre(points);
  const toInterior =
    (interior[0] - centre[0]) * normal[0] +
    (interior[1] - centre[1]) * normal[1] +
    (interior[2] - centre[2]) * normal[2];

  if (toInterior <= 0) {
    writer.appendFacet(points, normal, color);
    return;
  }

  writer.appendFacet([...points].reverse(), [-normal[0], -normal[1], -normal[2]], color);
}

/**
 * A lofted hull: one profile swept through several sections and capped at both
 * ends, with every vertex and normal built in world space.
 *
 * Facets are flat-shaded on purpose. A smooth normal would round off the very
 * edges the silhouette depends on, and it would fight the baked per-face
 * orientation luminance that every other member in this file carries.
 */
function appendHull(writer: SurfaceWriter, part: StructureHullPart): void {
  const sections = part.sections;
  if (sections.length < 2) return;

  HULL_START.set(part.start[0], part.start[1], part.start[2]);
  HULL_END.set(part.end[0], part.end[1], part.end[2]);
  HULL_AXIS.subVectors(HULL_END, HULL_START);
  const length = HULL_AXIS.length();
  if (!Number.isFinite(length) || length < 1e-6) return;

  HULL_AXIS.divideScalar(length);
  HULL_QUATERNION.setFromUnitVectors(HULL_Z_AXIS, HULL_AXIS);
  const color = tierColor(part.tier);

  const rings: Vector[][] = [];
  for (const section of sections) {
    const along = Math.min(1, Math.max(0, section.t)) * length;
    const profile = hullProfile(
      part.facets,
      part.chamfer,
      section.halfWidth,
      section.halfHeight,
    );
    const ring: Vector[] = [];
    for (const point of profile) {
      HULL_LOCAL.set(point[0] + section.offset[0], point[1] + section.offset[1], 0);
      HULL_LOCAL.applyQuaternion(HULL_QUATERNION);
      ring.push([
        HULL_START.x + HULL_AXIS.x * along + HULL_LOCAL.x,
        HULL_START.y + HULL_AXIS.y * along + HULL_LOCAL.y,
        HULL_START.z + HULL_AXIS.z * along + HULL_LOCAL.z,
      ]);
    }
    rings.push(ring);
  }

  const centres = rings.map((ring) => facetCentre(ring));

  for (let index = 0; index < rings.length - 1; index += 1) {
    const near = rings[index];
    const far = rings[index + 1];
    const nearCentre = centres[index];
    const farCentre = centres[index + 1];
    if (!near || !far || !nearCentre || !farCentre || near.length !== far.length) continue;

    const interior: Vector = [
      (nearCentre[0] + farCentre[0]) / 2,
      (nearCentre[1] + farCentre[1]) / 2,
      (nearCentre[2] + farCentre[2]) / 2,
    ];

    for (let side = 0; side < near.length; side += 1) {
      const next = (side + 1) % near.length;
      const a = near[side];
      const b = near[next];
      const c = far[next];
      const d = far[side];
      if (!a || !b || !c || !d) continue;
      appendOrientedFacet(writer, [a, b, c, d], interior, color);
    }
  }

  // A cap's interior reference is its own centre pushed in along the axis, which
  // is what makes the cap face outward rather than back into the hull.
  const first = rings[0];
  const firstCentre = centres[0];
  if (first && firstCentre) {
    appendOrientedFacet(
      writer,
      first,
      [
        firstCentre[0] + HULL_AXIS.x * length,
        firstCentre[1] + HULL_AXIS.y * length,
        firstCentre[2] + HULL_AXIS.z * length,
      ],
      color,
    );
  }

  const last = rings[rings.length - 1];
  const lastCentre = centres[centres.length - 1];
  if (last && lastCentre) {
    appendOrientedFacet(
      writer,
      last,
      [
        lastCentre[0] - HULL_AXIS.x * length,
        lastCentre[1] - HULL_AXIS.y * length,
        lastCentre[2] - HULL_AXIS.z * length,
      ],
      color,
    );
  }
}

const PATH_INCOMING = new THREE.Vector3();
const PATH_OUTGOING = new THREE.Vector3();
const PATH_BISECTOR = new THREE.Vector3();
const PATH_REFERENCE = new THREE.Vector3();
const PATH_SIDE = new THREE.Vector3();
const PATH_UP = new THREE.Vector3();
const PATH_ROTATION = new THREE.Quaternion();
const PATH_TMP = new THREE.Vector3();

/** A mitre may not stretch a section more than this before it is left blunt. */
const MAX_MITER = 2.6;
const PARALLEL_EPSILON = 1e-6;

/**
 * Widest a section is allowed to be at one path vertex.
 *
 * A closed path turns a corner, and a section left flat across that corner
 * would leave a notch on the outside and overlap itself on the inside. Scaling
 * the section by the reciprocal of its alignment with the outgoing segment is
 * the ordinary mitre fix: the two cut faces meet on the angle's bisector, so the
 * sweep keeps one wall thickness the whole way round instead of pinching at
 * every corner. The cap is what stops a near-reversal from throwing a section
 * out to infinity.
 */
function miterScale(alignment: number): number {
  const bounded = Math.max(1 / MAX_MITER, Math.min(1, Math.abs(alignment)));
  return Math.min(MAX_MITER, 1 / bounded);
}

function extentAt(
  value: number | readonly number[],
  index: number,
): number {
  if (typeof value === 'number') return value;
  const exact = value[index];
  if (exact !== undefined) return exact;
  return value[value.length - 1] ?? 0;
}

/**
 * A profile swept along a polyline, mitred at its corners, capped when open.
 *
 * Every vertex is built directly in world space from a frame that is parallel
 * transported along the path, so a path that folds out of its starting plane
 * keeps a coherent section rather than spinning about its own axis. Facets are
 * flat-shaded for the same reason the hulls are: a smoothed corner here would
 * erase precisely the folded edges the silhouette is made of.
 */
function appendPath(writer: SurfaceWriter, part: StructurePathPart): void {
  const points = part.points;
  const count = points.length;
  if (count < 2) return;

  const closed = part.closed && count >= 3;
  const color = tierColor(part.tier);

  const positions: THREE.Vector3[] = [];
  for (const point of points) {
    positions.push(new THREE.Vector3(point[0], point[1], point[2]));
  }

  const ringNormals: THREE.Vector3[] = [];
  const miters: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const current = positions[index]!;
    const next = positions[closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!;
    const previous = positions[closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!;

    PATH_INCOMING.subVectors(current, previous);
    PATH_OUTGOING.subVectors(next, current);

    const incomingLength = PATH_INCOMING.length();
    const outgoingLength = PATH_OUTGOING.length();

    if (incomingLength < PARALLEL_EPSILON && outgoingLength < PARALLEL_EPSILON) {
      ringNormals.push(new THREE.Vector3(0, 0, 1));
      miters.push(1);
      continue;
    }

    if (incomingLength < PARALLEL_EPSILON) {
      PATH_INCOMING.copy(PATH_OUTGOING).divideScalar(outgoingLength);
      PATH_OUTGOING.divideScalar(outgoingLength);
    } else if (outgoingLength < PARALLEL_EPSILON) {
      PATH_OUTGOING.copy(PATH_INCOMING).divideScalar(incomingLength);
      PATH_INCOMING.divideScalar(incomingLength);
    } else {
      PATH_INCOMING.divideScalar(incomingLength);
      PATH_OUTGOING.divideScalar(outgoingLength);
    }

    // The section plane is the angle bisector, which is the only plane on which
    // two mitred wall faces can meet.
    PATH_BISECTOR.addVectors(PATH_INCOMING, PATH_OUTGOING);
    if (PATH_BISECTOR.lengthSq() < PARALLEL_EPSILON) {
      PATH_BISECTOR.copy(PATH_OUTGOING);
    } else {
      PATH_BISECTOR.normalize();
    }

    ringNormals.push(PATH_BISECTOR.clone());
    miters.push(miterScale(PATH_BISECTOR.dot(PATH_OUTGOING)));
  }

  // Parallel transport: the first frame is built from the reference, and every
  // later frame is the previous one rotated by the turn between their planes.
  PATH_REFERENCE.set(part.reference[0], part.reference[1], part.reference[2]).normalize();
  const firstNormal = ringNormals[0]!;
  PATH_SIDE.crossVectors(PATH_REFERENCE, firstNormal);
  if (PATH_SIDE.lengthSq() < PARALLEL_EPSILON) {
    // The reference lies in the first section's plane, so any perpendicular
    // will do; picking it from the plane's own normal keeps the frame defined.
    PATH_TMP.set(1, 0, 0);
    PATH_SIDE.crossVectors(PATH_TMP, firstNormal);
    if (PATH_SIDE.lengthSq() < PARALLEL_EPSILON) {
      PATH_TMP.set(0, 1, 0);
      PATH_SIDE.crossVectors(PATH_TMP, firstNormal);
    }
  }
  PATH_SIDE.normalize();
  PATH_UP.crossVectors(firstNormal, PATH_SIDE).normalize();

  const rings: Vector[][] = [];

  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      const previousNormal = ringNormals[index - 1]!;
      const normal = ringNormals[index]!;
      PATH_ROTATION.setFromUnitVectors(previousNormal, normal);
      PATH_SIDE.applyQuaternion(PATH_ROTATION).normalize();
      PATH_UP.applyQuaternion(PATH_ROTATION).normalize();
    }

    const centre = positions[index]!;
    const miter = miters[index]!;
    const profile = hullProfile(
      0,
      part.chamfer,
      extentAt(part.halfWidth, index),
      extentAt(part.halfHeight, index),
    );

    const ring: Vector[] = [];
    for (const point of profile) {
      ring.push([
        centre.x + PATH_SIDE.x * point[0] * miter + PATH_UP.x * point[1] * miter,
        centre.y + PATH_SIDE.y * point[0] * miter + PATH_UP.y * point[1] * miter,
        centre.z + PATH_SIDE.z * point[0] * miter + PATH_UP.z * point[1] * miter,
      ]);
    }
    rings.push(ring);
  }

  const centres = rings.map((ring) => facetCentre(ring));
  const bridge = (nearIndex: number, farIndex: number) => {
    const near = rings[nearIndex];
    const far = rings[farIndex];
    const nearCentre = centres[nearIndex];
    const farCentre = centres[farIndex];
    if (!near || !far || !nearCentre || !farCentre || near.length !== far.length) return;

    const interior: Vector = [
      (nearCentre[0] + farCentre[0]) / 2,
      (nearCentre[1] + farCentre[1]) / 2,
      (nearCentre[2] + farCentre[2]) / 2,
    ];

    for (let side = 0; side < near.length; side += 1) {
      const nextSide = (side + 1) % near.length;
      const a = near[side];
      const b = near[nextSide];
      const c = far[nextSide];
      const d = far[side];
      if (!a || !b || !c || !d) continue;
      appendOrientedFacet(writer, [a, b, c, d], interior, color);
    }
  };

  for (let index = 0; index < count - 1; index += 1) bridge(index, index + 1);
  // The closing bridge is what turns the sweep from an extruded outline into a
  // ring of material with an opening through it.
  if (closed) bridge(count - 1, 0);

  if (closed) return;

  const span =
    PATH_TMP.subVectors(positions[count - 1]!, positions[0]!).length() || 1;

  const firstRing = rings[0];
  const firstCentre = centres[0];
  if (firstRing && firstCentre) {
    appendOrientedFacet(
      writer,
      firstRing,
      [
        firstCentre[0] - ringNormals[0]!.x * span,
        firstCentre[1] - ringNormals[0]!.y * span,
        firstCentre[2] - ringNormals[0]!.z * span,
      ],
      color,
    );
  }

  const lastNormal = ringNormals[count - 1]!;
  const lastRing = rings[count - 1];
  const lastCentre = centres[count - 1];
  if (lastRing && lastCentre) {
    appendOrientedFacet(
      writer,
      lastRing,
      [
        lastCentre[0] + lastNormal.x * span,
        lastCentre[1] + lastNormal.y * span,
        lastCentre[2] + lastNormal.z * span,
      ],
      color,
    );
  }
}

export function tierColor(tier: StructureTier): THREE.Color {
  return new THREE.Color(MACHINE_PALETTE[resolveStructureTier(tier)]);
}

/**
 * A single part, baked on its own.
 *
 * Sockets and other parts whose brightness has to move independently of the
 * mass around them are drawn from their own small geometry like this.
 */
export function buildPartGeometry(part: StructurePart): THREE.BufferGeometry {
  const template = createUnitBox();
  const writer = createSurfaceWriter(template, part.surface, resolveDepthRange([part]));
  if (part.shape === 'span') {
    appendSpan(writer, part);
  } else if (part.shape === 'hull') {
    appendHull(writer, part);
  } else if (part.shape === 'path') {
    appendPath(writer, part);
  } else {
    appendForm(writer, part);
  }
  template.dispose();
  return toGeometry(writer);
}

/**
 * A box aimed along a direction, centred on a point.
 *
 * This is the ingress/socket primitive: the caller supplies where the opening is
 * and which way it faces, and the box is rotated into that direction.
 */
export function createAimedSpan(
  center: Vector,
  direction: Vector,
  length: number,
  width: number,
  depth: number,
  tier: StructureTier,
): StructureSpanPart {
  const scale = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const unit: Vector = [
    direction[0] / scale,
    direction[1] / scale,
    direction[2] / scale,
  ];
  const half = length * 0.5;

  return {
    shape: 'span',
    tier,
    surface: 'shell',
    start: [
      center[0] - unit[0] * half,
      center[1] - unit[1] * half,
      center[2] - unit[2] * half,
    ],
    end: [
      center[0] + unit[0] * half,
      center[1] + unit[1] * half,
      center[2] + unit[2] * half,
    ],
    width,
    depth,
  };
}
