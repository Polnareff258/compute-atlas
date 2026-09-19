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
  usedSurfaceClasses,
} from '../materials/structureGeometry';
import { easeApproach } from '../routing/routeFlow';
import type { DomainEnvironment } from './domainEnvironments';

export type DomainEnvironmentViewProps = {
  readonly environment: DomainEnvironment;
  readonly reducedMotion: boolean;
  /** 0 dormant, ~0.55 hovered, 1 focused. */
  readonly activation: number;
  /**
   * How much of the composition this domain is given at rest, 0..1.
   *
   * Composition, not state: it is what makes idle a ranked frame rather than
   * five domains drawn at one brightness. It enters the surface response as
   * `presence`, which is the only input that can take a surface below its
   * resting response.
   */
  readonly presence: number;
  readonly label: string;
  readonly description: string;
  /** Focus keeps one title and one line of copy; idle names the prominent domains. */
  readonly showLabel: boolean;
  readonly showDescription: boolean;
  readonly dimmed: boolean;
};

/** What a domain recedes to while another one is focused. */
export const RECEDED_DOMAIN_PRESENCE = 0.26;

/**
 * One domain as a sub-environment.
 *
 * The mass is baked into two geometries and carries real occlusion and
 * orientation luminance, so a domain reads as a small machine with interior
 * layering rather than as a cluster of thin plates. Its ingress jaws and
 * interior layers then move on their own, because a domain whose parts never
 * separate would still be a picture of a machine rather than one.
 *
 * Engagement is expressed three ways at once, because one alone is not read as
 * engagement: the resting presence rises toward full, the surface response
 * answers through the curve, and the parts physically separate. The scene
 * previously had only the middle term, and it moved an opaque surface's gain by
 * about three percent.
 */
export function DomainEnvironmentView({
  environment,
  reducedMotion,
  activation,
  presence,
  label,
  description,
  showLabel,
  showDescription,
  dimmed,
}: DomainEnvironmentViewProps) {
  /**
   * Which way the label runs off its anchor.
   *
   * Sideways, labels annotate inward, toward the composition: a domain on the
   * right half of the frame offsets its text to the left of itself. Placing
   * every label to the same side pushed the outermost domain's name off the
   * frame edge, which is the one label the idle composition actually needs.
   */
  const labelSide = environment.anchor[0] > 0 ? -1 : 1;
  /**
   * Vertically, it runs *away from the route*.
   *
   * The route arrives from the Core, so the corridor occupies whichever
   * quadrant of the domain points back at the origin — and the label used to sit
   * at a fixed `+0.66 * extent` above its anchor, which for GRAPHICS is exactly
   * that quadrant. Its plate is opaque, so it drew a black rectangle over the
   * route's arrival and swallowed the one thing the focus frame is about. The
   * label now takes the other vertical side whenever the Core is above it.
   *
   * The Core is always at the origin, so it is above a domain exactly when that
   * domain's own height is negative.
   */
  const labelVerticalSide = environment.anchor[1] > 0 ? 1 : -1;
  const geometry = useMemo(() => buildStructureGeometry(environment.parts), [environment]);
  const classes = useMemo(() => usedSurfaceClasses(environment.parts), [environment]);
  const movableGeometries = useMemo(
    () => environment.movables.map((movable) => buildPartGeometry(movable.part)),
    [environment],
  );

  const materials = useMemo(
    () =>
      classes.map((surface) =>
        createSurfaceMaterial({
          role: surface,
          // A membrane's tint is its own palette entry; every solid class renders
          // white and lets the tier colour baked into its geometry carry the
          // value. These used to be tinted with the palette's port colours, so
          // every moving layer rendered as `portQuiet * tier` — two mid-tones
          // multiplied into a dark olive, which is why a focused GRAPHICS was a
          // small dark-green mass under a bright Core instead of the subject of
          // its own frame.
          color: surface === 'membrane' ? MACHINE_PALETTE.membrane : '#ffffff',
          ...(surface === 'membrane' ? { baseFade: 0.3 } : {}),
        }),
      ),
    [classes],
  );

  const movableMaterials = useMemo(
    () => ({
      // The domain's own machinery, not a socket: it rests deep and answers
      // hardest, so a working domain lights from the inside out.
      interior: createSurfaceMaterial({ role: 'accent', color: '#ffffff' }),
      ingress: createSurfaceMaterial({ role: 'port', color: '#ffffff' }),
    }),
    [],
  );

  const meshesRef = useRef<(THREE.Mesh | null)[]>([]);
  /** Eased locally, so the surfaces settle at the rate the routes do. */
  const poseRef = useRef(0);
  const appliedRef = useRef('');
  // Sanitised once per render rather than per frame: a hostile value here would
  // otherwise reach every material on every frame.
  const resting = Number.isFinite(presence)
    ? Math.min(1, Math.max(0, presence))
    : 0;

  useEffect(
    () => () => {
      geometry.dispose();
      for (const movable of movableGeometries) movable.dispose();
      for (const material of materials) material.dispose();
      movableMaterials.interior.dispose();
      movableMaterials.ingress.dispose();
    },
    [geometry, materials, movableGeometries, movableMaterials],
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
    const key = `${Math.round(pose * 64)}:${Math.round(resting * 64)}:${reducedMotion ? 'r' : 'f'}:${dimmed ? 'd' : 'a'}`;
    if (key === appliedRef.current) return;
    appliedRef.current = key;

    // A receding domain keeps its silhouette and gives up its interior: it drops
    // to the composition's recessed level whatever its resting prominence was,
    // so the frame behind a focused domain is one flat depth rather than a
    // second ranking competing with the subject.
    const shown = dimmed ? RECEDED_DOMAIN_PRESENCE : resting + (1 - resting) * pose;

    // Each finish answers at its own depth. The shell holds the silhouette and
    // barely moves; the recesses and the accents carry the engagement, which is
    // what makes a working domain read as lit from inside rather than as one
    // that has been turned up.
    for (let index = 0; index < classes.length; index += 1) {
      const surface = classes[index];
      const material = materials[index];
      if (!surface || !material) continue;
      const drive = surface === 'shell' ? pose * 0.35 : surface === 'recess' ? 0.3 + pose * 0.7 : pose;
      material.updateInput({
        activity: drive,
        focus: pose * pose,
        proximity: pose * 0.8,
        presence: shown,
      });
    }

    movableMaterials.interior.updateInput({
      activity: 0.25 + pose * 0.75,
      focus: pose,
      proximity: pose,
      presence: shown,
    });
    movableMaterials.ingress.updateInput({
      activity: 0.3 + pose * 0.7,
      focus: pose,
      proximity: pose,
      presence: shown,
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
      {classes.map((surface, index) => {
        const material = materials[index];
        if (!material) return null;
        return (
          <mesh
            geometry={geometry.surfaces[surface]}
            key={surface}
            material={material.material}
            renderOrder={surface === 'membrane' ? 3 : 0}
          />
        );
      })}
      {environment.movables.map((movable, index) => {
        const movableGeometry = movableGeometries[index];
        if (!movableGeometry) return null;
        return (
          <mesh
            geometry={movableGeometry}
            key={movable.id}
            material={
              movable.role === 'ingress'
                ? movableMaterials.ingress.material
                : movableMaterials.interior.material
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
            labelVerticalSide * environment.extent * 0.66,
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
