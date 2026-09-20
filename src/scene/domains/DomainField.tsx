'use client';

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { GRAPH_MANIFEST } from '../../graph/graphManifest';
import type {
  GraphInteractionAction,
  GraphInteractionState,
} from '../../graph/interaction';
import { NAMED_DOMAIN_PROMINENCE } from '../../graph/layout';
import type { GraphNodeId } from '../../graph/types';
import type { FieldUniforms } from '../field/fieldUniforms';
import { createEnergySurfaceMaterial } from '../materials/energyMaterial';
import {
  buildStructureGeometry,
  usedSurfaceClasses,
} from '../materials/structureGeometry';
import { buildDomainParts } from './domainGeometry';
import type { DomainFieldDescriptor, DomainPhenomenon } from './domainPhenomena';

export type DomainFieldProps = {
  readonly uniforms: FieldUniforms;
  readonly phenomena: readonly DomainFieldDescriptor[];
  readonly interaction: GraphInteractionState;
  readonly onAction: (action: GraphInteractionAction) => void;
  readonly prominence: Readonly<Record<string, number>>;
  readonly reducedMotion: boolean;
};

/** 0 dormant, ~0.6 hovered, 1 focused. */
const HOVER_ACTIVATION = 0.6;

/** How fast a region opens and closes. Escape is a retraction, not a cut. */
const OPEN_RATE = 2.6;
const CLOSE_RATE = 1.7;

/** Membranes thin as a region opens; that is how a pocket unfolds. */
const MEMBRANE_OPACITY = 0.22;
const MEMBRANE_OPENING = 1.1;

/**
 * The labels are HTML at a world-anchored position, so their size is a ratio
 * against the camera's distance. That ratio was tuned when the camera sat much
 * closer to the Core; the new composition frames a fault roughly twice as wide,
 * so the factor is raised to keep the same apparent size rather than inheriting
 * a smaller one.
 */
const LABEL_DISTANCE_FACTOR = 13;

/**
 * Per-phenomenon shading attitude.
 *
 * The five regions are not five tints of one finish. What a surface is *for*
 * differs between them, and the finish is where that shows: sampling sheets face
 * the viewer and must read as surfaces, so they take almost no rim and a very
 * fine, very strong vein lattice; systems buses are plain and bright with
 * nothing on them; research probes are dark, sparse and read by their silhouette
 * alone, which is the deep term's job.
 *
 * These are authored against each other rather than one at a time. A frame where
 * every region's finish had been tuned in isolation is five regions that look
 * equally expensive and therefore equally unimportant.
 */
const PHENOMENON_FINISH: Readonly<
  Record<
    DomainPhenomenon,
    {
      readonly rimGain: number;
      readonly veinGain: number;
      readonly corridorGain: number;
      readonly baseGain: number;
      readonly deepGain: number;
      readonly veinScale: number;
      readonly renderOrder: number;
    }
  >
> = {
  // Branch and merge: many candidates alive at once, so the vein lattice is
  // dense and quick and the corridor lights the whole fan.
  inference: {
    rimGain: 0.66,
    veinGain: 0.62,
    corridorGain: 1.25,
    baseGain: 0.62,
    deepGain: 0.2,
    veinScale: 0.62,
    renderOrder: 2,
  },
  // Sheets facing the viewer: rim is nearly absent because these surfaces are
  // met head-on, and the interference lattice is the phenomenon.
  sampling: {
    rimGain: 0.22,
    veinGain: 0.74,
    corridorGain: 1.4,
    baseGain: 0.94,
    deepGain: 0.14,
    veinScale: 0.9,
    renderOrder: 2,
  },
  // Two state streams evolving in parallel: both rails have to be lit at once
  // for the pair to read, which is a corridor job rather than a vein job.
  branching: {
    rimGain: 0.78,
    veinGain: 0.34,
    corridorGain: 1.6,
    baseGain: 0.5,
    deepGain: 0.16,
    veinScale: 0.4,
    renderOrder: 2,
  },
  // Buses under load: the plainest surface in the frame, and the brightest.
  // Nothing is written on a bus; the bus is the message.
  throughput: {
    rimGain: 0.3,
    veinGain: 0.12,
    corridorGain: 1.5,
    baseGain: 1.05,
    deepGain: 0.1,
    veinScale: 0.24,
    renderOrder: 2,
  },
  // Probes into unmeasured depth: almost no surface, almost no lattice, and the
  // highest deep term in the scene. Sparse geometry is legible by silhouette,
  // and a silhouette in the dark is a deep-term read.
  probe: {
    rimGain: 1.0,
    veinGain: 0.14,
    corridorGain: 0.9,
    baseGain: 0.42,
    deepGain: 0.46,
    veinScale: 0.55,
    renderOrder: 2,
  },
};

/**
 * The copy a region carries when it is being examined.
 *
 * Read from the manifest here rather than threaded through props because it is
 * the one piece of the semantic layer this view needs and it needs all of it at
 * once — the region descriptors have already been derived from the same manifest
 * upstream, so passing the strings separately would be a second copy of the same
 * fact with a second chance to disagree.
 */
const DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    GRAPH_MANIFEST.nodes
      .filter((node) => node.kind === 'domain')
      .map((node) => [node.id, node.description]),
  ),
);

/** One projected region envelope, in CSS pixels. */
type ProjectedRegion = {
  readonly id: GraphNodeId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
};

/**
 * Screen-space picking against each region's own envelope.
 *
 * Domains are large objects with depth, so the pick radius comes from the
 * projected envelope rather than from a fixed constant — otherwise the outer
 * layers of a region would be visible but not clickable.
 *
 * The envelope is the region's own box, projected corner by corner, and the
 * radius is its *smaller* projected half-extent rather than its diagonal, so a
 * wide region does not claim the space beside it. Two regions are never within a
 * factor of two on screen, so nothing is stolen either way.
 */
function projectRegions(
  phenomena: readonly DomainFieldDescriptor[],
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): readonly ProjectedRegion[] {
  const rect = canvas.getBoundingClientRect();
  const projected: ProjectedRegion[] = [];
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();

  for (const entry of phenomena) {
    const { centre: anchor, extent } = entry;
    centre.set(anchor[0], anchor[1], anchor[2]).project(camera);

    let halfWidth = 0;
    let halfHeight = 0;
    for (const [signX, signY] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      corner
        .set(
          anchor[0] + extent[0] * signX,
          anchor[1] + extent[1] * signY,
          anchor[2],
        )
        .project(camera);
      halfWidth = Math.max(halfWidth, Math.abs(corner.x - centre.x));
      halfHeight = Math.max(halfHeight, Math.abs(corner.y - centre.y));
    }

    projected.push({
      id: entry.id,
      x: rect.left + ((centre.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - centre.y) / 2) * rect.height,
      radius: Math.max(
        26,
        Math.min(halfWidth * rect.width, halfHeight * rect.height) * 0.7,
      ),
    });
  }

  return projected;
}

function pickRegion(
  event: { readonly clientX: number; readonly clientY: number },
  projected: readonly ProjectedRegion[],
): GraphNodeId | null {
  let nearest: ProjectedRegion | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const region of projected) {
    const distance = Math.hypot(event.clientX - region.x, event.clientY - region.y);
    if (distance <= region.radius && distance < nearestDistance) {
      nearest = region;
      nearestDistance = distance;
    }
  }

  return nearest?.id ?? null;
}

/**
 * Hover and click, resolved in screen space.
 *
 * This is a plain DOM listener on the canvas rather than R3F's own pointer
 * events, because R3F's raycaster would have to test the merged region geometry
 * — tens of thousands of triangles of thin, mostly-transparent members — to
 * answer a question the projected envelope answers exactly. The envelope is also
 * what the visitor is actually pointing at: they aim at the shape on screen, not
 * at its nearest triangle.
 */
function DomainPointerBoundary({
  phenomena,
  interaction,
  onAction,
}: Pick<DomainFieldProps, 'phenomena' | 'interaction' | 'onAction'>) {
  const { camera, gl } = useThree();
  const hoveredRef = useRef<GraphNodeId | null>(interaction.hoveredNodeId);

  useEffect(() => {
    const canvas = gl.domElement;
    const updateHover = (event: PointerEvent) => {
      const next = pickRegion(event, projectRegions(phenomena, camera, canvas));
      if (next === hoveredRef.current) return;

      const previous = hoveredRef.current;
      hoveredRef.current = next;
      if (previous !== null) {
        onAction({ type: 'POINTER_LEAVE_NODE', nodeId: previous });
      }
      if (next !== null) {
        onAction({ type: 'POINTER_ENTER_NODE', nodeId: next });
      }
    };
    const clearHover = () => {
      const previous = hoveredRef.current;
      if (previous === null) return;
      hoveredRef.current = null;
      onAction({ type: 'POINTER_LEAVE_NODE', nodeId: previous });
    };
    const toggleFocus = (event: MouseEvent) => {
      const id = pickRegion(event, projectRegions(phenomena, camera, canvas));
      if (id === null) return;
      onAction(
        id === interaction.focusedNodeId
          ? { type: 'CLEAR_FOCUS' }
          : { type: 'FOCUS_NODE', nodeId: id },
      );
    };

    canvas.addEventListener('pointermove', updateHover, { passive: true });
    canvas.addEventListener('pointerleave', clearHover, { passive: true });
    canvas.addEventListener('click', toggleFocus);
    return () => {
      canvas.removeEventListener('pointermove', updateHover);
      canvas.removeEventListener('pointerleave', clearHover);
      canvas.removeEventListener('click', toggleFocus);
    };
  }, [camera, phenomena, gl, interaction.focusedNodeId, onAction]);

  return null;
}

function DomainRegion({
  descriptor,
  uniforms,
  activation,
  dimmed,
  reducedMotion,
  showLabel,
  showDescription,
}: {
  readonly descriptor: DomainFieldDescriptor;
  readonly uniforms: FieldUniforms;
  readonly activation: number;
  readonly dimmed: boolean;
  readonly reducedMotion: boolean;
  readonly showLabel: boolean;
  readonly showDescription: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const openRef = useRef(activation);
  const breatheRef = useRef(0);

  const parts = useMemo(() => buildDomainParts(descriptor), [descriptor]);
  const geometry = useMemo(() => buildStructureGeometry(parts), [parts]);
  const classes = useMemo(() => usedSurfaceClasses(parts), [parts]);
  const finish = PHENOMENON_FINISH[descriptor.phenomenon];

  const materials = useMemo(
    () =>
      classes.map((surface) => {
        const handle = createEnergySurfaceMaterial({
          uniforms,
          ...finish,
          // A membrane's own depth term is what makes it read as a skin rather
          // than as a dimmed solid, so it keeps a floor of its own.
          deepGain: surface === 'membrane' ? finish.deepGain + 0.24 : finish.deepGain,
        });
        if (surface === 'membrane') {
          handle.material.transparent = true;
          handle.material.depthWrite = false;
          handle.material.opacity = MEMBRANE_OPACITY;
        }
        return handle;
      }),
    [classes, finish, uniforms],
  );

  /**
   * The frame loop reaches the materials through a ref rather than through the
   * memo value directly.
   *
   * A region opening is an animation, so the skin's opacity has to be written
   * every frame — that is what a frame loop is for, and there is no version of
   * this that goes through React state without rebuilding a material per frame.
   * What the ref buys is that the write is to a mutable handle the component
   * owns rather than to the return value of a hook, which is the difference
   * between an escape hatch and a render-time side effect.
   */
  const materialsRef = useRef(materials);

  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  useEffect(
    () => () => {
      geometry.dispose();
      for (const handle of materials) handle.dispose();
    },
    [geometry, materials],
  );

  /**
   * A region opening is three things at once, and one of them alone is not read
   * as opening: it grows slightly, it leans toward the source it is being fed
   * from, and its skin thins. The lean is the important one — a region that only
   * scaled would read as being zoomed rather than as being engaged.
   */
  useFrame((state, delta) => {
    const safeDelta = Math.min(Math.max(delta, 0), 0.1);
    const rate = activation > openRef.current ? OPEN_RATE : CLOSE_RATE;
    openRef.current += (activation - openRef.current) * Math.min(1, safeDelta * rate);
    const open = openRef.current;

    const group = groupRef.current;
    if (group === null) return;

    if (!reducedMotion) {
      breatheRef.current += safeDelta * descriptor.rate;
    }
    const breath = Math.sin(breatheRef.current * 0.42 + descriptor.kind) * 0.09;

    const scale = 1 + open * 0.07 + (dimmed ? -0.04 : 0);
    group.scale.setScalar(scale);
    // Lean toward the composition's centre of gravity, which is where the
    // region's supply comes from.
    group.position.set(
      descriptor.centre[0] - descriptor.centre[0] * open * 0.022,
      descriptor.centre[1] - descriptor.centre[1] * open * 0.022 + breath,
      descriptor.centre[2],
    );

    const live = materialsRef.current;
    for (let index = 0; index < classes.length; index += 1) {
      if (classes[index] !== 'membrane') continue;
      const handle = live[index];
      if (handle === null || handle === undefined) continue;
      handle.material.opacity = Math.min(
        0.62,
        (MEMBRANE_OPACITY + open * MEMBRANE_OPENING * MEMBRANE_OPACITY) *
          (dimmed ? 0.6 : 1),
      );
    }

    void state;
  });

  /**
   * Sideways the label annotates inward; vertically it runs away from the Core.
   * Both are resolved in the descriptor, so this is a placement and not a rule.
   */
  const labelState = dimmed
    ? 'dimmed'
    : activation >= 0.95
      ? 'focused'
      : activation > 0.05
        ? 'hovered'
        : 'idle';

  return (
    <group ref={groupRef} name={'domain-' + descriptor.id}>
      {classes.map((surface, index) => {
        const handle = materials[index];
        if (handle === undefined) return null;
        return (
          <mesh
            geometry={geometry.surfaces[surface]}
            key={surface}
            material={handle.material}
            renderOrder={surface === 'membrane' ? finish.renderOrder + 2 : finish.renderOrder}
          />
        );
      })}
      {showLabel ? (
        <Html
          center={false}
          className="graph-node-label-wrapper"
          distanceFactor={LABEL_DISTANCE_FACTOR}
          position={[
            descriptor.labelAnchor[0],
            descriptor.labelAnchor[1],
            descriptor.labelAnchor[2],
          ]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={'graph-node-label graph-node-label--' + labelState}>
            <span className="graph-node-label__name">{descriptor.label}</span>
            {showDescription ? (
              <span className="graph-node-label__description">
                {DESCRIPTIONS[descriptor.id] ?? ''}
              </span>
            ) : null}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * The five regions.
 *
 * Each one draws the temporary structure its own kind of work produces, on top
 * of the matter field that fills it. The division of labour is the point: the
 * field carries motion and density, and this carries *shape* — because a
 * phenomenon with no shape is a gradient, and five gradients arranged in space
 * are a diagram of five places rather than five kinds of computation.
 *
 * Text is the scarcest thing in the frame. At rest only the regions the
 * composition is about carry their name, focus withdraws every label but one,
 * and a description appears only on the region being examined.
 */
export function DomainField({
  uniforms,
  phenomena,
  interaction,
  onAction,
  prominence,
  reducedMotion,
}: DomainFieldProps) {
  return (
    <group name="domain-field">
      <DomainPointerBoundary
        phenomena={phenomena}
        interaction={interaction}
        onAction={onAction}
      />
      {phenomena.map((descriptor) => {
        const isFocused = interaction.focusedNodeId === descriptor.id;
        const isHovered = interaction.hoveredNodeId === descriptor.id;
        // Focus is one region's story: the others retract and give up their text,
        // so the selected title is the only thing being read.
        const dimmed = interaction.focusedNodeId !== null && !isFocused;
        const resting = prominence[descriptor.id] ?? 0;
        const named = Number.isFinite(resting) && resting >= NAMED_DOMAIN_PROMINENCE;

        return (
          <DomainRegion
            activation={isFocused ? 1 : isHovered ? HOVER_ACTIVATION : 0}
            descriptor={descriptor}
            dimmed={dimmed}
            key={descriptor.id}
            reducedMotion={reducedMotion}
            showDescription={isFocused || isHovered}
            showLabel={(isFocused || isHovered || named) && !dimmed}
            uniforms={uniforms}
          />
        );
      })}
    </group>
  );
}
