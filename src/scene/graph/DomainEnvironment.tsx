'use client';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';

import { MACHINE_PALETTE } from '../materials/machinePalette';
import { createSurfaceMaterial } from '../materials/surfaceMaterial';
import {
  buildPartGeometry,
  buildStructureGeometry,
} from '../materials/structureGeometry';
import type { RendererAdapterBackend } from '../../renderer/runtime';
import { easeApproach } from '../routing/routeFlow';
import type { DomainEnvironment } from './domainEnvironments';

export type DomainEnvironmentViewProps = {
  readonly environment: DomainEnvironment;
  readonly backend: RendererAdapterBackend;
  readonly reducedMotion: boolean;
  /** 0 dormant, ~0.55 hovered, 1 focused. */
  readonly activation: number;
  readonly label: string;
  readonly description: string;
  /** Focus keeps one title and one line of copy; idle names every visible domain. */
  readonly showLabel: boolean;
  readonly showDescription: boolean;
  readonly dimmed: boolean;
};

/**
 * One domain as a sub-environment.
 *
 * The mass is baked into two geometries and carries real occlusion and
 * orientation luminance, so a domain reads as a small machine with interior
 * layering rather than as a cluster of thin plates. Its ingress jaws and
 * interior layers then move on their own, because a domain whose parts never
 * separate would still be a picture of a machine rather than one.
 */
export function DomainEnvironmentView({
  environment,
  backend,
  reducedMotion,
  activation,
  label,
  description,
  showLabel,
  showDescription,
  dimmed,
}: DomainEnvironmentViewProps) {
  const webgpu = backend === 'webgpu';
  /**
   * Which way the label runs off its anchor.
   *
   * Labels annotate inward, toward the composition: a domain on the right half
   * of the frame offsets its text to the left of itself. Placing every label to
   * the same side pushed the outermost domain's name off the frame edge, which
   * is the one label the idle composition actually needs.
   */
  const labelSide = environment.anchor[0] > 0 ? -1 : 1;
  const geometry = useMemo(() => buildStructureGeometry(environment.parts), [environment]);
  const movableGeometries = useMemo(
    () => environment.movables.map((movable) => buildPartGeometry(movable.part)),
    [environment],
  );

  const materials = useMemo(() => {
    return {
      solid: createSurfaceMaterial({
        role: 'volume',
        color: '#ffffff',
        edgeResponse: 0.5,
        webgpuPreferred: webgpu,
      }),
      membrane: createSurfaceMaterial({
        role: 'membrane',
        color: MACHINE_PALETTE.membrane,
        baseFade: 0.3,
        edgeResponse: 0.62,
        webgpuPreferred: webgpu,
      }),
      interior: createSurfaceMaterial({
        role: 'port',
        color: MACHINE_PALETTE.portQuiet,
        edgeResponse: 0.55,
        webgpuPreferred: webgpu,
      }),
      ingress: createSurfaceMaterial({
        role: 'port',
        color: MACHINE_PALETTE.port,
        edgeResponse: 0.7,
        webgpuPreferred: webgpu,
      }),
    };
  }, [webgpu]);

  const meshesRef = useRef<(THREE.Mesh | null)[]>([]);
  /** Eased locally, so the surfaces settle at the rate the routes do. */
  const poseRef = useRef(0);
  const appliedRef = useRef('');

  useEffect(
    () => () => {
      geometry.dispose();
      for (const movable of movableGeometries) movable.dispose();
      materials.solid.dispose();
      materials.membrane.dispose();
      materials.interior.dispose();
      materials.ingress.dispose();
    },
    [geometry, materials, movableGeometries],
  );

  useFrame((_, delta) => {
    const pose = easeApproach(poseRef.current, activation, delta, reducedMotion);
    const changed = Math.abs(pose - poseRef.current) > 1e-4 || poseRef.current === 0;
    poseRef.current = pose;

    // Geometry only moves while the pose is actually travelling; once settled,
    // the frame writes nothing at all.
    if (changed) {
      for (let index = 0; index < environment.movables.length; index += 1) {
        const mesh = meshesRef.current[index];
        const movable = environment.movables[index];
        if (!mesh || !movable) continue;
        const [tx, ty, tz] = movable.travel;
        mesh.position.set(tx * pose, ty * pose, tz * pose);
      }
    }

    // Material state is keyed on the quantised pose, so a static frame is free
    // and a transition still reads smoothly.
    const key = `${Math.round(pose * 64)}:${reducedMotion ? 'r' : 'f'}:${dimmed ? 'd' : 'a'}`;
    if (key === appliedRef.current) return;
    appliedRef.current = key;

    // Receding domains keep their silhouette and lose their interior: presence
    // is a property of the composition, not of brightness alone.
    const presence = dimmed ? 0.22 : 1;
    materials.solid.updateInput({
      activity: pose * presence,
      focus: pose * pose * presence,
      reducedMotion,
    });
    materials.membrane.updateInput({
      activity: pose * 0.8 * presence,
      focus: pose * presence,
      reducedMotion,
    });
    materials.interior.updateInput({
      activity: (0.25 + pose * 0.75) * presence,
      focus: pose * presence,
      reducedMotion,
    });
    materials.ingress.updateInput({
      activity: (0.3 + pose * 0.7) * presence,
      focus: pose * presence,
      reducedMotion,
    });
  });

  return (
    <group
      name={'domain-' + environment.nodeId}
      position={[
        environment.anchor[0],
        environment.anchor[1],
        environment.anchor[2],
      ]}
    >
      <mesh geometry={geometry.solid} material={materials.solid.material} renderOrder={0} />
      <mesh
        geometry={geometry.membrane}
        material={materials.membrane.material}
        renderOrder={3}
      />
      {environment.movables.map((movable, index) => {
        const movableGeometry = movableGeometries[index];
        if (!movableGeometry) return null;
        return (
          <mesh
            geometry={movableGeometry}
            key={movable.id}
            material={
              movable.role === 'ingress'
                ? materials.ingress.material
                : materials.interior.material
            }
            ref={(mesh) => {
              meshesRef.current[index] = mesh;
            }}
            renderOrder={4}
          />
        );
      })}
      {showLabel ? (
        <Html
          center={false}
          className="graph-node-label-wrapper"
          distanceFactor={8}
          position={[
            labelSide * environment.extent * 0.72,
            environment.extent * 0.66,
            environment.ingressLocal[2],
          ]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={
              'graph-node-label graph-node-label--' +
              (dimmed ? 'dimmed' : activation >= 1 ? 'focused' : activation > 0 ? 'hovered' : 'idle')
            }
          >
            <span className="graph-node-label__name">{label}</span>
            {showDescription ? (
              <span className="graph-node-label__description">{description}</span>
            ) : null}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
