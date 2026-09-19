import * as THREE from 'three';

import { MACHINE_PALETTE } from './machinePalette';
import { deriveSurfaceLuminance, resolveStructureTier } from './surfaceGeometry';

type Vector = readonly [number, number, number];

export type StructureTier = Parameters<typeof resolveStructureTier>[0];

/**
 * One axis-oriented member: a slab, plate, socket or slice.
 *
 * `membrane` is a physical distinction, not a flag on the tier: membranes bake
 * into their own geometry so they can be drawn as translucent layers that do
 * not write depth, while solids write depth and occlude.
 */
export type StructureFormPart = {
  readonly shape: 'form';
  readonly tier: StructureTier;
  readonly membrane: boolean;
  readonly position: Vector;
  readonly rotation: Vector;
  readonly scale: Vector;
};

/** One endpoint-defined member: a beam aimed from `start` to `end`. */
export type StructureSpanPart = {
  readonly shape: 'span';
  readonly tier: StructureTier;
  readonly membrane: boolean;
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
  readonly membrane: boolean;
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

export type StructurePart = StructureFormPart | StructureSpanPart | StructureHullPart;

export type BakedStructureGeometry = {
  readonly solid: THREE.BufferGeometry;
  readonly membrane: THREE.BufferGeometry;
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
  const solid = createSurfaceWriter(template);
  const membrane = createSurfaceWriter(template);

  for (const part of parts) {
    const writer = part.membrane ? membrane : solid;
    if (part.shape === 'span') {
      appendSpan(writer, part);
    } else if (part.shape === 'hull') {
      appendHull(writer, part);
    } else {
      appendForm(writer, part);
    }
  }

  template.dispose();
  const solidGeometry = toGeometry(solid);
  const membraneGeometry = toGeometry(membrane);

  return {
    solid: solidGeometry,
    membrane: membraneGeometry,
    dispose: () => {
      solidGeometry.dispose();
      membraneGeometry.dispose();
    },
  };
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

function createSurfaceWriter(template: THREE.BoxGeometry): SurfaceWriter {
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

        const luminance = deriveSurfaceLuminance(normal.x, normal.y, normal.z);
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
      const luminance = deriveSurfaceLuminance(normal[0], normal[1], normal[2]);
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
  const writer = createSurfaceWriter(template);
  if (part.shape === 'span') {
    appendSpan(writer, part);
  } else if (part.shape === 'hull') {
    appendHull(writer, part);
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
    membrane: false,
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
