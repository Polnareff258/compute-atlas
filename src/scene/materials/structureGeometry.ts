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

export type StructurePart = StructureFormPart | StructureSpanPart;

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

export function tierColor(tier: StructureTier): THREE.Color {
  return new THREE.Color(MACHINE_PALETTE[resolveStructureTier(tier)]);
}

/**
 * A single box, baked on its own.
 *
 * Sockets and other parts whose brightness has to move independently of the
 * mass around them are drawn from their own small geometry like this.
 */
export function buildPartGeometry(part: StructurePart): THREE.BufferGeometry {
  const template = createUnitBox();
  const writer = createSurfaceWriter(template);
  if (part.shape === 'span') {
    appendSpan(writer, part);
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
