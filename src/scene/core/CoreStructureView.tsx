'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  MACHINE_PALETTE,
  STRUCTURE_VIEW_AXIS,
  type SurfaceRole,
} from '../materials/machinePalette';
import { createSurfaceMaterial } from '../materials/surfaceMaterial';
import {
  SURFACE_CLASSES,
  type SurfaceClass,
} from '../materials/structureGeometry';
import {
  buildCoreStructureGeometry,
  buildPortGeometry,
} from './coreStructureGeometry';
import {
  deriveCorePortActivation,
  type CoreStructure,
} from './coreStructure';
import type { CoreVisualInput } from './coreTypes';

export type CoreStructureViewProps = {
  readonly structure: CoreStructure;
  /**
   * Continuous visual scalars live here, not in React state: the hero updates its
   * material state every frame without re-rendering a single component.
   */
  readonly visualRef: React.RefObject<CoreVisualInput>;
};

/**
 * The colour each finish is rendered with, multiplied over the baked tier value.
 *
 * The two are separate jobs and are kept separate. The tier decides how bright a
 * member is, from the palette's own value ladder, and it is baked per facet with
 * the orientation and depth terms already folded in. The finish decides what
 * that value is made of — graphite, mineral, or the pale icy accent — and it is
 * a live material property, so it can move.
 *
 * Membranes are the one class whose colour is its own palette entry rather than
 * a tint, because a translucent layer over structure has to read as a layer and
 * not as the structure underneath it.
 */
const CLASS_COLORS: Readonly<Record<SurfaceClass, string>> = {
  shell: '#ffffff',
  edge: '#dff0f0',
  recess: '#ffffff',
  accent: '#ffffff',
  membrane: MACHINE_PALETTE.membrane,
};

/** Membranes layer over structure, so they all rest partly open. */
const MEMBRANE_BASE_FADE = 0.34;

/**
 * How far the camera may push the `edge` class away from its resting response.
 *
 * This is the scene's one genuinely view-dependent term, and it is deliberately
 * bounded and slow. The composition is authored against a nominal view axis, so
 * what the camera can actually change is how grazing the silhouette corners are:
 * at the idle framing they sit almost edge-on and barely read, and as the rig
 * translates and dollies into a reframe they turn toward the lens. A restrained
 * increment on the class that exists for it is the honest way to express that —
 * a full fresnel would put a rim light on every corner in the scene and make the
 * mass look wet.
 */
const EDGE_VIEW_GAIN = 1.1;
const EDGE_VIEW_CEILING = 0.42;

const CAMERA_DIRECTION = new THREE.Vector3();
const VIEW_AXIS = new THREE.Vector3(
  STRUCTURE_VIEW_AXIS[0],
  STRUCTURE_VIEW_AXIS[1],
  STRUCTURE_VIEW_AXIS[2],
);

/**
 * The hero Compute Core.
 *
 * One asymmetric monolith with a deep central aperture, two folded shells, an
 * aperture full of wafers, membranes and compute dies, three machined routing
 * manifolds and two attached processing assemblies — merged into one geometry
 * per finish, so it reads as a single computed body rather than a pile of boxes
 * and still answers state one surface family at a time.
 *
 * Ports are drawn separately because routing leaves from them, and the source
 * port has to brighten on its own when a domain is targeted.
 */
export function CoreStructureView({
  structure,
  visualRef,
}: CoreStructureViewProps) {
  const geometry = useMemo(() => buildCoreStructureGeometry(structure), [structure]);
  const portGeometries = useMemo(
    () => structure.ports.map((port) => buildPortGeometry(port)),
    [structure],
  );

  const materials = useMemo(() => {
    const record = {} as Record<SurfaceClass, ReturnType<typeof createSurfaceMaterial>>;
    for (const surface of SURFACE_CLASSES) {
      record[surface] = createSurfaceMaterial({
        role: surface as SurfaceRole,
        color: CLASS_COLORS[surface],
        ...(surface === 'membrane' ? { baseFade: MEMBRANE_BASE_FADE } : {}),
      });
    }
    return record;
  }, []);

  const portMaterials = useMemo(
    () =>
      structure.ports.map((port) =>
        createSurfaceMaterial({
          role: 'port',
          color: port.rank % 2 === 0 ? MACHINE_PALETTE.port : MACHINE_PALETTE.portQuiet,
        }),
      ),
    [structure],
  );

  // The last published state, so a static frame still reads correctly even
  // before the first animation frame lands.
  const appliedRef = useRef('');

  useEffect(
    () => () => {
      geometry.dispose();
      for (const portGeometry of portGeometries) portGeometry.dispose();
      for (const surface of SURFACE_CLASSES) materials[surface].dispose();
      for (const portMaterial of portMaterials) portMaterial.dispose();
    },
    [geometry, materials, portGeometries, portMaterials],
  );

  useFrame((frame) => {
    const input = visualRef.current;
    if (!input) return;

    const activation = deriveCorePortActivation(structure, input);
    const activity = input.intensity;
    const focus =
      input.visualState === 'focusing'
        ? 1
        : input.visualState === 'hover_response'
          ? 0.55
          : 0;

    // View response: how far the camera has left the axis the composition was
    // authored against. The group's own pointer rotation is a fortieth of a
    // radian, so this is the camera's travel and nothing else.
    CAMERA_DIRECTION.copy(frame.camera.position).normalize();
    const deviation = Math.acos(
      Math.min(1, Math.max(-1, CAMERA_DIRECTION.dot(VIEW_AXIS))),
    );
    const edgeView = Math.min(EDGE_VIEW_CEILING, deviation * EDGE_VIEW_GAIN);

    // Structural material state only changes when the semantic state does, so a
    // frame that changes nothing writes nothing. The edge class is the exception:
    // its whole response is the camera, so it is part of the key.
    const key = `${input.visualState}:${Math.round(activity * 64)}:${Math.round(
      edgeView * 64,
    )}`;
    if (key === appliedRef.current) {
      updatePorts(portMaterials, structure, activation.sourcePortId, activation.routingAuthority, focus);
      return;
    }
    appliedRef.current = key;

    // The field's own presence in the body. Idle keeps a slow internal
    // circulation, so the aperture is never completely cold; a committed route
    // puts the field through the manifolds, which is when the recesses and the
    // wafers answer.
    const proximity = 0.3 + 0.7 * activation.routingAuthority;

    materials.shell.updateInput({ activity, focus, proximity: proximity * 0.4 });
    materials.edge.updateInput({
      activity: activity * 0.6 + edgeView,
      focus,
      proximity,
    });
    materials.recess.updateInput({ activity, focus, proximity });
    materials.accent.updateInput({ activity, focus, proximity });
    materials.membrane.updateInput({
      activity: activity * 0.7,
      focus,
      proximity,
    });

    updatePorts(portMaterials, structure, activation.sourcePortId, activation.routingAuthority, focus);
  });

  return (
    <group name="core-structure">
      {SURFACE_CLASSES.map((surface) => (
        <mesh
          geometry={geometry.surfaces[surface]}
          key={surface}
          material={materials[surface].material}
          renderOrder={surface === 'membrane' ? 3 : 0}
        />
      ))}
      {structure.ports.map((port, index) => {
        const portGeometry = portGeometries[index];
        const portMaterial = portMaterials[index];
        if (!portGeometry || !portMaterial) return null;
        return (
          <mesh
            geometry={portGeometry}
            key={port.id}
            material={portMaterial.material}
            renderOrder={4}
          />
        );
      })}
    </group>
  );
}

function updatePorts(
  portMaterials: readonly ReturnType<typeof createSurfaceMaterial>[],
  structure: CoreStructure,
  sourcePortId: number,
  routingAuthority: number,
  focus: number,
): void {
  for (let index = 0; index < portMaterials.length; index += 1) {
    const port = structure.ports[index];
    const handle = portMaterials[index];
    if (!port || !handle) continue;
    const isSource = port.id === sourcePortId;
    handle.updateInput({
      activity: isSource ? 0.35 + 0.65 * routingAuthority : 0.1 * routingAuthority,
      focus,
      proximity: isSource ? routingAuthority : 0,
    });
  }
}
