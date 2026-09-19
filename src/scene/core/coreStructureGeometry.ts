import type * as THREE from 'three';

import {
  buildPartGeometry,
  buildStructureGeometry,
  type BakedStructureGeometry,
  type StructurePart,
} from '../materials/structureGeometry';
import type {
  CoreStructure,
  CoreStructureMember,
  CoreStructurePort,
} from './coreStructure';

export type CoreStructureGeometry = BakedStructureGeometry;

/**
 * Translates the hero's own member vocabulary into the shared structure
 * vocabulary.
 *
 * The Core keeps `band` and `fade` because it uses them for its own layering and
 * for membrane openness; the baker needs the tier, the finish and the shape, so
 * that is all this passes on.
 */
function toStructureParts(
  members: readonly CoreStructureMember[],
): StructurePart[] {
  return members.map((member): StructurePart => {
    if (member.shape === 'hull') {
      return {
        shape: 'hull',
        tier: member.tier,
        surface: member.surface,
        start: member.start,
        end: member.end,
        facets: member.facets,
        chamfer: member.chamfer,
        sections: member.sections,
      };
    }

    if (member.shape === 'path') {
      return {
        shape: 'path',
        tier: member.tier,
        surface: member.surface,
        points: member.points,
        closed: member.closed,
        halfWidth: member.halfWidth,
        halfHeight: member.halfHeight,
        chamfer: member.chamfer,
        reference: member.reference,
      };
    }

    if (member.shape === 'beam') {
      return {
        shape: 'span',
        tier: member.tier,
        surface: member.surface,
        start: member.start,
        end: member.end,
        width: member.width,
        depth: member.depth,
      };
    }

    return {
      shape: 'form',
      tier: member.tier,
      surface: member.surface,
      position: member.position,
      rotation: member.rotation,
      scale: member.scale,
    };
  });
}

/**
 * Merges the whole structure into one geometry per finish.
 *
 * Ports are excluded: they are drawn individually so the active source zone can
 * light up on its own.
 */
export function buildCoreStructureGeometry(
  structure: CoreStructure,
): CoreStructureGeometry {
  return buildStructureGeometry(toStructureParts(structure.members));
}

/** Long enough to read as a socket in the hull, short enough not to be a spike. */
const PORT_LENGTH = 0.11;
const PORT_CROSS = 0.075;

/**
 * The per-port geometry a caller draws on its own, because the source port has
 * to brighten independently of the rest of the hull when a domain is targeted.
 */
export function buildPortGeometry(port: CoreStructurePort): THREE.BufferGeometry {
  const direction: readonly [number, number, number] = port.direction;
  const scale = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const half = PORT_LENGTH * 0.5;
  const unit: readonly [number, number, number] = [
    direction[0] / scale,
    direction[1] / scale,
    direction[2] / scale,
  ];
  const center = port.position;

  return buildPartGeometry({
    shape: 'span',
    tier: 'primary',
    // A socket is baked in the accent finish because it is a small, bright,
    // precisely placed element and that is what the accent class means. Its
    // material role is `port`: the socket answers state through the port curve
    // while its baked colour comes from the accent finish.
    surface: 'accent',
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
    width: PORT_CROSS,
    depth: PORT_CROSS,
  });
}
