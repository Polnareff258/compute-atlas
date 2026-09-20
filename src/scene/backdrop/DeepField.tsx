'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  Fn,
  float,
  mix,
  mx_fractal_noise_float,
  positionWorld,
  pow,
  saturate,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { RiftStructure } from '../hero/riftStructure';
import { createEnergySurfaceMaterial } from '../materials/energyMaterial';
import {
  buildStructureGeometry,
  usedSurfaceClasses,
} from '../materials/structureGeometry';
import { deriveBackdropStructure } from './backdropStructure';

export type DeepFieldProps = {
  readonly uniforms: FieldUniforms;
  readonly rift: RiftStructure;
  readonly detail: number;
};

/**
 * The depth stack.
 *
 * Each entry is one fog bank: where it sits, how big it is, how thick it is and
 * how fast it drifts. They are placed *through* the composition rather than only
 * behind it — the near layer sits in front of the far shelf and behind the near
 * massif — so the frame has real atmospheric separation instead of a gradient
 * painted on the back wall. The order of the list is the order light travels
 * outward, and the drifts slow as it goes, because the further a thing is the
 * less of its motion should be legible per second.
 *
 * The brief forbids the background being a starfield, a grid floor, character
 * rain, ordinary noise or scattered dots. What is left after removing those is
 * exactly what a foundry's air would be: scale, and haze, and the fact that the
 * far end of a large space is never black.
 */
const LAYERS: readonly {
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly scale: number;
}[] = [
  { z: -18, width: 168, height: 114, thickness: 0.14, driftX: 0.011, driftY: 0.005, scale: 0.028 },
  { z: -54, width: 240, height: 160, thickness: 0.12, driftX: 0.007, driftY: -0.004, scale: 0.022 },
  { z: -112, width: 340, height: 226, thickness: 0.1, driftX: 0.004, driftY: 0.002, scale: 0.015 },
];

/**
 * How far a fog bank reaches before it fades out.
 *
 * The planes are enormous and their edges must never be findable, so the shader
 * fades them out. The previous revision faded them *radially*, on the reasoning
 * that a circle has no corners, and the second capture of this scene showed
 * exactly what that reasoning misses: a radial falloff on a rectangle is an
 * ellipse with a findable boundary, and two of them were legible in the frame as
 * striated discs hanging in the dark. A falloff is not made unfindable by its
 * shape. It is made unfindable by being irregular and by never reaching zero
 * anywhere the camera can see.
 *
 * So the fade is now a product of a very soft box falloff and the bank's own
 * noise. The noise is the part that matters: it breaks whatever contour the
 * geometry would otherwise produce into something with no describable outline.
 */
const EDGE_FALLOFF = 0.62;

/**
 * Base opacity of the nearest bank, before the falloff and the noise breakup.
 *
 * Halved from the previous revision, which put a veil at z = 2.5 — in front of
 * the hero, seventeen units from the lens — at a tenth of full opacity with
 * high-frequency grain. That is a milk filter over the subject, and it is why
 * the second capture's hero read as soft. Air belongs between things, not on top
 * of the nearest one.
 */
const BASE_DENSITY = 0.22;

/**
 * The deep field.
 *
 * A foundry is legible as *large* before it is legible as anything else, and
 * scale in a dark frame is mostly a claim about air: how much of it there is,
 * and how much of the far end it hides. So this is not a background image. It is
 * five volumes of slowly moving haze threaded through the composition, each one
 * brighter along the rift's own axis so the light in the frame agrees with where
 * the machine's light comes from, and each one carrying a stretched-noise term
 * that reads as blurred traffic far out — moving, but too far away to resolve
 * into anything you could point at.
 *
 * Nothing here is a particle and nothing here is a dot. Dots at this scale are
 * the one thing that would make the whole frame read as a starfield.
 */
function FogLayer({
  uniforms,
  rift,
  layer,
}: {
  readonly uniforms: FieldUniforms;
  readonly rift: RiftStructure;
  readonly layer: (typeof LAYERS)[number];
}) {
  const material = useMemo(() => {
    // Local uniforms rather than members of the shared block: the drift rates
    // belong to the layer, and putting five per-layer scalars into a block that
    // every other material also reads would make the shared block a dumping
    // ground instead of a contract.
    const driftX = uniform(layer.driftX);
    const driftY = uniform(layer.driftY);
    const scale = uniform(layer.scale);
    const thickness = uniform(layer.thickness);
    const axis = uniform(
      new THREE.Vector3(
        rift.riftAxis[0],
        rift.riftAxis[1],
        rift.riftAxis[2],
      ),
    );

    const handle = new MeshBasicNodeMaterial();
    handle.transparent = true;
    handle.depthWrite = false;
    handle.side = THREE.DoubleSide;
    handle.fog = false;

    handle.colorNode = Fn(() => {
      const world = positionWorld;
      const time = uniforms.uniforms.uTime;

      // Two noise fields at different rates and different scales. The slow one
      // is the bank's own shape; the fast one is the fine grain that keeps the
      // bank from reading as a single soft rectangle.
      const shape = mx_fractal_noise_float(
        vec3(
          world.x.mul(scale).add(time.mul(driftX)),
          world.y.mul(scale).add(time.mul(driftY)),
          world.z.mul(scale).mul(0.6),
        ),
        3,
      );
      // The grain is a *broad* second field, not a fine one. At three and a half
      // times the bank's own scale it resolved into visible parallel hatching
      // across the whole of a two-hundred-unit plane, which reads as a texture
      // rather than as air. At 1.6 it does what it is for, which is to stop the
      // bank's density from being a smooth gradient.
      const grain = mx_fractal_noise_float(
        vec3(
          world.x.mul(scale.mul(1.6)).sub(time.mul(driftX.mul(4))),
          world.y.mul(scale.mul(1.3)),
          world.z.mul(scale.mul(1.1)),
        ),
        2,
      );

      // Blurred far traffic: the shape noise stretched along the rift axis, so
      // the haze has a direction rather than only a density. This is the term
      // that turns a fog bank into a place where something is going on.
      const along = world.dot(axis).mul(scale.mul(0.28));
      const traffic = mx_fractal_noise_float(
        vec3(along.sub(time.mul(0.05)), world.y.mul(scale.mul(5)), float(0.5)),
        2,
      );

      const density = saturate(
        shape.mul(0.78).add(0.4).add(grain.mul(0.14)).add(traffic.mul(0.09)),
      );
      const body = pow(density, mix(2.4, 0.9, saturate(uniforms.uniforms.uActivity)));

      // Lit along the rift: where the machine's energy is, the air is brighter.
      // Nothing is actually emissive here — it is haze catching a light that is
      // off-frame, and the frame only agrees with itself if the haze agrees with
      // the axis.
      const facing = saturate(world.dot(axis).mul(0.014).add(0.6));

      return vec3(
        uniforms.uniforms.uDeep
          .mul(body.mul(facing).mul(0.9))
          .add(uniforms.uniforms.uFlow.mul(body.mul(facing).mul(0.22)))
          .add(uniforms.uniforms.uMass.mul(body.mul(0.12))),
      );
    })();

    handle.opacityNode = Fn(() => {
      const centre = uv().sub(vec2(0.5, 0.5)).mul(2);
      // A soft box rather than a radius. `centre.dot(centre)` reaches one at the
      // mid-edge and two at the corner, so a radial falloff is a *different
      // shape* in the corners than in the middle, and the shape it settles into
      // is the ellipse the second capture showed. The product of two one-axis
      // falloffs has the opposite property: it is widest where the plane is
      // widest, which is what a bank of haze in a rectangular volume does.
      const edgeX = saturate(float(1).sub(centre.x.abs().mul(EDGE_FALLOFF)));
      const edgeY = saturate(float(1).sub(centre.y.abs().mul(EDGE_FALLOFF)));
      const box = edgeX.mul(edgeY);
      // Break the contour with the bank's own density. This is the term that
      // makes the edge unfindable rather than merely soft, and it costs one
      // multiply because the noise has already been sampled for the colour.
      const breakup = saturate(
        mx_fractal_noise_float(
          vec3(
            positionWorld.x.mul(scale.mul(0.6)),
            positionWorld.y.mul(scale.mul(0.6)),
            positionWorld.z.mul(scale.mul(0.4)),
          ),
          2,
        )
          .mul(1.9)
          .add(0.55),
      );
      // Thickness is a property of the bank, not of its texture: a thin bank has
      // to be faint everywhere rather than a thin bright sheet.
      return box.mul(box).mul(breakup).mul(thickness).mul(BASE_DENSITY);
    })();

    return handle;
  }, [layer, rift, uniforms]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh position={[0, 0, layer.z]} renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[layer.width, layer.height]} />
      <primitive attach="material" object={material} />
    </mesh>
  );
}

/**
 * The gain the far field runs at, relative to the machine's own.
 *
 * One finish, applied to the whole far field, and it is the same material the
 * hero uses. That is not a shortcut: the brief asks for one unified procedural
 * material system, and a far field shaded by a second model would be a second
 * look, which is what makes an assembled frame read as assembled. What separates
 * the two is gain and the depth floor, not the model.
 *
 * The rim is the term that would betray this if it were left alone. A ribbon
 * seen nearly edge-on presents a grazing angle across its entire visible area, so
 * its fresnel term sits near one everywhere — at the hero's rim gain a member
 * seventy units out would carry a hard bright edge around its whole silhouette
 * and immediately become a second subject. Hence the very low rim, and hence the
 * veins being finer than the hero's rather than the same: a lattice that reads as
 * veins across a twenty-unit body reads as large soft blotches across a hundred
 * and fifty, and blotches were the specific failure this module was written to
 * repair.
 */
const BACKDROP_FINISH = {
  veinScale: 1.6,
  baseGain: 0.9,
  rimGain: 0.16,
  veinGain: 0.06,
  corridorGain: 0.5,
  deepGain: 0.02,
  waveGain: 0,
  depthFadeFloor: 0.34,
} as const;

/**
 * The far field's own structure.
 *
 * Swept, folded, tapering ribbons at thirty to a hundred and thirty units out,
 * every one of them larger than the frame. They are the machine continuing: the
 * reason the composition has a far end rather than a wall. Rendered with the
 * scene's one energy material, which is what the energy material's own header
 * always claimed the far shelves did.
 */
function BackdropStructure({
  uniforms,
  detail,
}: {
  readonly uniforms: FieldUniforms;
  readonly detail: number;
}) {
  const parts = useMemo(() => deriveBackdropStructure({ detail }).parts, [detail]);
  const baked = useMemo(() => buildStructureGeometry(parts), [parts]);
  const classes = useMemo(() => usedSurfaceClasses(parts), [parts]);

  const materials = useMemo(
    () =>
      classes.map((surface) => ({
        surface,
        ...createEnergySurfaceMaterial({
          uniforms,
          ...BACKDROP_FINISH,
        }),
      })),
    [classes, uniforms],
  );

  useEffect(
    () => () => {
      baked.dispose();
      for (const entry of materials) entry.dispose();
    },
    [baked, materials],
  );

  return (
    <group name="backdrop-structure">
      {materials.map(({ surface, material }) => (
        <mesh
          key={surface}
          geometry={baked.surfaces[surface]}
          material={material}
          // The far field writes depth: the near curtain is genuinely in front
          // of the deep shelf, and the hero has to be occluded by it where the
          // composition says it is. It is drawn early so the fog banks in front
          // of it still composite over it.
          renderOrder={-6}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

/**
 * There is no frame loop here.
 *
 * The banks are driven entirely from the shared uniform block, which `SceneHost`
 * already advances once per frame — the layers read `uTime`, `uActivity` and the
 * energy colours from it and have no independent state of their own. A second
 * subscriber would be a second time source, and two time sources are two things
 * that can disagree about how fast the foundry is breathing.
 *
 * The far field's *structure* is likewise static: it is geometry with a material,
 * and the material samples the same block. The only thing that moves in this
 * whole module is haze.
 */
export function DeepField({ uniforms, rift, detail }: DeepFieldProps) {
  return (
    <group name="deep-field">
      <BackdropStructure uniforms={uniforms} detail={detail} />
      {LAYERS.map((layer) => (
        <FogLayer
          key={layer.z}
          layer={layer}
          rift={rift}
          uniforms={uniforms}
        />
      ))}
    </group>
  );
}
