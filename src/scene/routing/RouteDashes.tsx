'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { RendererAdapterBackend } from '../../renderer/runtime';
import { MACHINE_PALETTE } from '../materials/machinePalette';
import {
  WEBGL2_DASH_CEILING,
  compressRouteProgress,
  deriveDashEnvelope,
  deriveDashPhase,
  deriveRouteAcross,
  deriveRouteDashDensity,
  deriveRouteDashIntensity,
  deriveRouteDashAttributes,
  deriveRouteDashDrawRange,
  deriveRouteDashIndexRange,
  resolveDashCurve,
  sampleRoutePoint,
  type RouteCurve,
  type RouteDashAttributes,
  type RouteFlowState,
} from './routeDash';
import {
  createDashQuadGeometry,
  createRouteDashGeometry,
  createRouteRibbonGeometry,
} from './routeDashGeometry';
import {
  createRouteDashMaterial,
  createRouteRibbonMaterial,
} from './routeDashMaterial';

export type RouteDashesProps = {
  readonly curves: readonly RouteCurve[];
  /**
   * Mutated in place by the owner every frame. Continuous scalars never travel
   * through React state, so this subtree does not re-render at frame rate.
   */
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly backend: RendererAdapterBackend;
  /**
   * Whether this profile pays for GPU advection.
   *
   * Together with the backend this selects the field's implementation, which is
   * the one thing `coreAdvection` has ever actually meant. It used to be read by
   * nothing: every WebGPU tier took the node path and every WebGL2 tier took the
   * instanced one, so the profile's "ULTRA only" claim was false in both
   * directions.
   */
  readonly advection: boolean;
  readonly reducedMotion: boolean;
  /** Highest route class lane the profile exposes. */
  readonly lanes: number;
  /** 0..1 additive density tier; SAFE stays a sparse channel. */
  readonly detail: number;
  readonly seed?: number;
};

const DASH_SEED = 17;

/** Per-frame working set for the CPU path. Allocated once, then mutated. */
type DashScratch = {
  readonly head: number[];
  readonly tail: number[];
  readonly across: number[];
  readonly tangent: number[];
  /** One reusable bent copy of a curve, so no route object is allocated. */
  readonly curve: {
    id: number;
    rank: number;
    route: RouteCurve['route'];
    group: number;
    start: readonly [number, number, number];
    control: readonly [number, number, number];
    end: readonly [number, number, number];
  };
  readonly xAxis: THREE.Vector3;
  readonly yAxis: THREE.Vector3;
  readonly zAxis: THREE.Vector3;
  readonly position: THREE.Vector3;
  readonly scale: THREE.Vector3;
  readonly color: THREE.Color;
  readonly matrix: THREE.Matrix4;
  /** A zero-scaled matrix collapses a hidden instance instead of popping it. */
  readonly hidden: THREE.Matrix4;
};

function createDashScratch(): DashScratch {
  return {
    head: [0, 0, 0],
    tail: [0, 0, 0],
    across: [0, 0, 0],
    tangent: [0, 0, 0],
    curve: {
      id: 0,
      rank: 0,
      route: 'primary',
      group: 0,
      start: [0, 0, 0],
      control: [0, 0, 0],
      end: [0, 0, 0],
    },
    xAxis: new THREE.Vector3(),
    yAxis: new THREE.Vector3(),
    zAxis: new THREE.Vector3(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(1, 1, 1),
    color: new THREE.Color(),
    matrix: new THREE.Matrix4(),
    hidden: new THREE.Matrix4().makeScale(0, 0, 0),
  };
}

/**
 * The curve as the deformed field sees it.
 *
 * Mirrors the vertex shader, which displaces the control point by the same
 * offset, so both backends bend along one definition.
 */
function bendCurve(
  curve: RouteCurve,
  bendX: number,
  bendY: number,
  bendZ: number,
  target: DashScratch['curve'],
): RouteCurve {
  if (bendX === 0 && bendY === 0 && bendZ === 0) return curve;

  target.id = curve.id;
  target.rank = curve.rank;
  target.route = curve.route;
  target.group = curve.group;
  target.start = curve.start;
  target.control = [
    curve.control[0] + bendX,
    curve.control[1] + bendY,
    curve.control[2] + bendZ,
  ];
  target.end = curve.end;
  return target;
}

/**
 * The semantic routing flowfield: one dash language for the whole scene.
 *
 * WebGPU evaluates the field in the vertex shader from attributes uploaded once,
 * so a frame only writes uniforms. WebGL2 drives a bounded instanced set with the
 * same envelope, compression and phase maths on the CPU.
 */
export function RouteDashes({
  curves,
  flowRef,
  backend,
  advection,
  reducedMotion,
  lanes,
  detail,
  seed = DASH_SEED,
}: RouteDashesProps) {
  const webgpu = backend === 'webgpu';
  // GPU advection needs a backend that can run it and a profile that asked for
  // it. Everything else — including WebGPU on SAFE — takes the instanced
  // fallback, which is what makes the flag observable rather than decorative.
  const advected = webgpu && advection;
  const boundedDetail = Math.min(1, Math.max(0, Number.isFinite(detail) ? detail : 0));
  const boundedLanes = Math.max(1, Math.round(Number.isFinite(lanes) ? lanes : 1));

  const attributes = useMemo(
    () =>
      deriveRouteDashAttributes(
        curves,
        deriveRouteDashDensity(advected, boundedDetail),
        seed,
        // The ceiling is the instanced fallback's, whose budget is the whole
        // field rather than one route; see `deriveCurveDashCounts`. The advected
        // field has no CPU pass to bound.
        advected ? undefined : WEBGL2_DASH_CEILING,
      ),
    [advected, boundedDetail, curves, seed],
  );
  const ribbonGeometry = useMemo(
    () => createRouteRibbonGeometry(curves, boundedDetail),
    [boundedDetail, curves],
  );
  const ribbonMaterial = useMemo(
    () =>
      createRouteRibbonMaterial({
        color: MACHINE_PALETTE.routeAmbient,
        webgpuPreferred: webgpu,
      }),
    [webgpu],
  );

  useEffect(
    () => () => {
      ribbonGeometry.dispose();
    },
    [ribbonGeometry],
  );
  useEffect(
    () => () => {
      ribbonMaterial.dispose();
    },
    [ribbonMaterial],
  );

  return (
    <group name="route-dashes">
      <mesh
        geometry={ribbonGeometry}
        material={ribbonMaterial.material}
        frustumCulled={false}
        renderOrder={1}
      />
      {advected ? (
        <WebgpuDashField
          attributes={attributes}
          flowRef={flowRef}
          lanes={boundedLanes}
          reducedMotion={reducedMotion}
          ribbonMaterial={ribbonMaterial}
        />
      ) : (
        <Webgl2DashField
          attributes={attributes}
          flowRef={flowRef}
          lanes={boundedLanes}
          reducedMotion={reducedMotion}
        />
      )}
    </group>
  );
}

/** WebGPU: geometry is uploaded once and only scalars change per frame. */
function WebgpuDashField({
  attributes,
  flowRef,
  lanes,
  reducedMotion,
  ribbonMaterial,
}: {
  readonly attributes: RouteDashAttributes;
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly lanes: number;
  readonly reducedMotion: boolean;
  readonly ribbonMaterial: ReturnType<typeof createRouteRibbonMaterial>;
}) {
  const geometry = useMemo(() => createRouteDashGeometry(attributes), [attributes]);
  // Each material owns its own uniform set, so the channel and its dashes are
  // updated separately rather than sharing state.
  const dashMaterial = useMemo(
    () =>
      createRouteDashMaterial({
        color: MACHINE_PALETTE.routeSignal,
        webgpuPreferred: true,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      dashMaterial.dispose();
    },
    [dashMaterial, geometry],
  );

  useEffect(() => {
    const range = deriveRouteDashIndexRange(attributes, lanes);
    geometry.setDrawRange(range.start, range.count);
  }, [attributes, geometry, lanes]);

  useFrame((state) => {
    const flow = flowRef.current;
    if (!flow) return;
    const elapsed = reducedMotion ? 0 : state.clock.elapsedTime;
    dashMaterial.updateFlow(flow, elapsed);
    ribbonMaterial.updateFlow(flow, elapsed);
  });

  return (
    <mesh
      geometry={geometry}
      material={dashMaterial.material}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}

/**
 * WebGL2: a bounded instanced dash set driven on the CPU.
 *
 * Reuses the same envelope, compression and phase maths as the vertex shader so
 * the two backends share one signal language rather than one look and one
 * imitation of it.
 */
function Webgl2DashField({
  attributes,
  flowRef,
  lanes,
  reducedMotion,
}: {
  readonly attributes: RouteDashAttributes;
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly lanes: number;
  readonly reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const instanceCount = Math.max(1, Math.min(WEBGL2_DASH_CEILING, attributes.dashCount));

  const quadGeometry = useMemo(() => createDashQuadGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: MACHINE_PALETTE.routeSignal,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  // Mutated every frame, so it lives in a ref rather than behind a memo: the
  // CPU path must never allocate per dash.
  const scratchRef = useRef<DashScratch | null>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const scratch = createDashScratch();
    scratchRef.current = scratch;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    // Instance colours are per-dash brightness, so the buffer must exist before
    // the first frame writes to it.
    scratch.color.setRGB(1, 1, 1);
    for (let index = 0; index < instanceCount; index += 1) {
      mesh.setColorAt(index, scratch.color);
    }

    return () => {
      scratchRef.current = null;
      quadGeometry.dispose();
      material.dispose();
      mesh.dispose();
    };
  }, [instanceCount, material, quadGeometry]);

  useFrame((state) => {
    const mesh = meshRef.current;
    const scratch = scratchRef.current;
    const flow = flowRef.current;
    if (!mesh || !scratch || !flow) return;

    const elapsed = reducedMotion ? 0 : state.clock.elapsedTime;
    const visible = deriveRouteDashDrawRange(attributes, lanes).count / 4;
    const budget = Math.min(visible, instanceCount);
    const total = Math.min(attributes.dashCount, instanceCount);
    const compression = Number.isFinite(flow.compression) ? flow.compression : 0;
    const wake = Number.isFinite(flow.wake) ? flow.wake : 0;
    // Same field deformation the vertex shader applies: the control point leans
    // along one direction, so the CPU path bends the field too rather than only
    // dimming it.
    const bendAmount = Number.isFinite(flow.bendAmount) ? flow.bendAmount : 0;
    const bendX = (flow.bend[0] ?? 0) * bendAmount;
    const bendY = (flow.bend[1] ?? 0) * bendAmount;
    const bendZ = (flow.bend[2] ?? 0) * bendAmount;

    for (let dash = 0; dash < total; dash += 1) {
      const curve = dash < budget ? resolveDashCurve(attributes, dash) : undefined;
      if (!curve) {
        mesh.setMatrixAt(dash, scratch.hidden);
        continue;
      }

      const vertex = dash * 4;
      const length = attributes.length[vertex]!;
      const cycle = deriveDashPhase(
        attributes.phase[vertex]!,
        attributes.speed[vertex]! * flow.advectionSpeed,
        elapsed,
        flow.motionScale,
      );

      const bent = bendCurve(curve, bendX, bendY, bendZ, scratch.curve);
      const head = compressRouteProgress(cycle, compression);
      const tail = compressRouteProgress(Math.max(cycle - length, 0), compression);

      const routeWeight =
        (flow.laneWeights[attributes.route[vertex]!] ?? 0) *
        (flow.groupWeights[attributes.group[vertex]!] ?? 0);
      const intensity = deriveRouteDashIntensity(
        deriveDashEnvelope(head, wake),
        attributes.brightness[vertex]!,
        routeWeight,
      );

      // A route that has receded is removed rather than dimmed, and it is
      // removed before any geometry is built for it, so the fallback and the
      // vertex shader cull at one threshold rather than two.
      if (intensity <= 0) {
        mesh.setMatrixAt(dash, scratch.hidden);
        continue;
      }

      sampleRoutePoint(bent, tail, scratch.tail);
      sampleRoutePoint(bent, head, scratch.head);

      const arcX = scratch.head[0]! - scratch.tail[0]!;
      const arcY = scratch.head[1]! - scratch.tail[1]!;
      const arcZ = scratch.head[2]! - scratch.tail[2]!;
      const arcLength = Math.hypot(arcX, arcY, arcZ) || 0.001;

      // The dash's own chord is a better axis than the curve derivative here: it
      // is exactly the direction the quad is stretched along.
      scratch.tangent[0] = arcX / arcLength;
      scratch.tangent[1] = arcY / arcLength;
      scratch.tangent[2] = arcZ / arcLength;
      deriveRouteAcross(scratch.tangent, 0, scratch.across);

      scratch.xAxis.set(scratch.tangent[0]!, scratch.tangent[1]!, scratch.tangent[2]!);
      scratch.yAxis.set(scratch.across[0]!, scratch.across[1]!, scratch.across[2]!);
      scratch.zAxis.crossVectors(scratch.xAxis, scratch.yAxis).normalize();
      scratch.position.set(
        (scratch.tail[0]! + scratch.head[0]!) * 0.5,
        (scratch.tail[1]! + scratch.head[1]!) * 0.5,
        (scratch.tail[2]! + scratch.head[2]!) * 0.5,
      );
      scratch.scale.set(arcLength, attributes.width[vertex]! * (1 + wake * 1.4), 1);

      scratch.matrix.makeBasis(scratch.xAxis, scratch.yAxis, scratch.zAxis);
      scratch.matrix.scale(scratch.scale);
      scratch.matrix.setPosition(scratch.position);
      mesh.setMatrixAt(dash, scratch.matrix);

      scratch.color.setRGB(intensity * 0.92, intensity, intensity * 0.97);
      mesh.setColorAt(dash, scratch.color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[quadGeometry, material, instanceCount]}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}