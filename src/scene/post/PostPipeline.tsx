'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { RenderPipeline, type Node, type Renderer } from 'three/webgpu';
import {
  cameraPosition,
  float,
  pass,
  saturate,
  screenUV,
  vec2,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

import type { FieldUniforms } from '../field/fieldUniforms';

export type PostPipelineProps = {
  readonly uniforms: FieldUniforms;
  /** Whether the pipeline runs at all. Below ULTRA and HIGH this is false. */
  readonly enabled: boolean;
  /** Depth of field is the most expensive pass, so it is ULTRA's alone. */
  readonly depthOfField: boolean;
};

/**
 * Bloom, kept restrained on purpose.
 *
 * The brief is explicit that bloom must not be used to hide coarse geometry, and
 * the way to obey that is a threshold high enough that only the compression
 * peaks and the charged corridor contribute. A low threshold blooms everything
 * equally, which is exactly the "whole screen is neon" failure — the frame gets
 * brighter and reads as softer, and no part of it becomes the subject.
 */
const BLOOM_STRENGTH = 0.34;
const BLOOM_RADIUS = 0.62;
const BLOOM_THRESHOLD = 0.72;

/**
 * Chromatic separation is confined to high-energy events.
 *
 * It is driven by the same interaction strengths the field uses, so it appears
 * where the frame is already doing something and is exactly zero at rest. Fringe
 * on a still frame is a lens defect; fringe on a frame that is compressing
 * matter is the frame telling you it is moving.
 */
const FRINGE_MAX = 0.0032;

/**
 * Vignette, hand-built.
 *
 * There is no vignette display node in this build — the list is Bloom, DOF,
 * chromatic aberration, RGB shift, film, FXAA, SMAA, TAAU and the rest, and no
 * vignette — so it is four nodes of arithmetic rather than a dependency. It is
 * also the one effect whose *shape* matters more than its strength: a vignette
 * that is a plain radial multiply darkens the corners of a frame that is already
 * mostly dark, and the brief asks for depth rather than for a hole, so the
 * falloff is kept tight and shallow.
 */
const VIGNETTE_INNER = 0.62;
const VIGNETTE_STRENGTH = 0.42;

/**
 * How far the lens opens, and how far it is held.
 *
 * `focalLength` is what decides whether the frame has depth or merely has a
 * blurry background, and the depth of field has to leave the far shelf and the
 * near massif both readable while it softens what is between them. A short focal
 * length blurs almost nothing; a long one turns the composition into a subject
 * and a wash, which would throw away the depth the whole scene is built on.
 */
const FOCAL_LENGTH = 14;
const BOKEH_SCALE = 2.2;

/**
 * The display nodes are declared against the runtime's own node types, and the
 * declarations lag the runtime in two places: a few of them are typed as their
 * concrete node class rather than as `Node<'vec4'>`, which is what a chain needs
 * them to be. Passing them through here keeps that gap in one place instead of
 * scattering casts across the graph.
 */
function asPostNode(value: unknown): Node<'vec4'> {
  return value as Node<'vec4'>;
}

export function PostPipeline({
  uniforms,
  enabled,
  depthOfField,
}: PostPipelineProps) {
  const { gl, scene, camera } = useThree();

  const pipeline = useMemo(() => {
    if (!enabled) return null;

    // R3F types its renderer as a `WebGLRenderer`, which is the only renderer it
    // knows how to construct itself. The scene runs on the node renderer on both
    // backends — see `canvasAdapters.ts` — so this is a narrowing of a type that
    // is already correct at runtime rather than a cast over a real difference.
    const handle = new RenderPipeline(gl as unknown as Renderer);
    const scenePass = pass(scene, camera);
    const colour = scenePass.getTextureNode('output');

    /**
     * The energy the frame is currently carrying, 0..1.
     *
     * One term rather than three, because three effects each reading a different
     * uniform would drift apart under a fast pointer and produce a frame where
     * the fringe has already decayed and the bloom has not. Everything
     * post-process in this file is driven from this one number.
     */
    const energy = saturate(
      uniforms.uniforms.uFocus.mul(0.75).add(uniforms.uniforms.uHover.mul(0.45)),
    );

    let composed = asPostNode(
      colour.add(bloom(colour, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)),
    );

    if (depthOfField) {
      // Focus pulls the lens open. The bokeh scale is driven from the field's
      // own focus term, so the depth of field arrives with the camera's advance
      // and is gone again once the view has decompressed — a frame at rest is
      // sharp everywhere, which is what makes the softening under focus read as
      // a lens rather than as a filter over the whole site.
      //
      // The focal plane is the signal's own target rather than a constant,
      // because that is the thing the camera is advancing toward; a hard-coded
      // distance would be correct only at one point of the approach and would
      // put the focused region in front of or behind the region being examined
      // for the rest of it.
      const focalPlane = cameraPosition
        .sub(uniforms.uniforms.uSignalTarget)
        .length();
      composed = asPostNode(
        dof(
          composed,
          scenePass.getViewZNode('depth'),
          focalPlane,
          float(FOCAL_LENGTH),
          energy.mul(BOKEH_SCALE),
        ),
      );
    }

    // Confined to the events that justify it, and confined to the edges even
    // then: a uniform fringe on the whole frame is a filter, and a filter is the
    // thing this scene must not look like it has.
    const fringed = asPostNode(
      chromaticAberration(
        composed,
        energy.mul(energy).mul(FRINGE_MAX),
        vec2(0.5, 0.5),
        float(1.1),
      ),
    );

    const centred = screenUV.sub(vec2(0.5, 0.5));
    const radial = centred.dot(centred).mul(2).sqrt();
    const vignette = saturate(
      float(1).sub(
        saturate(radial.sub(VIGNETTE_INNER).mul(1 / (1 - VIGNETTE_INNER))).mul(
          VIGNETTE_STRENGTH,
        ),
      ),
    );

    const vignetted = vec4(fringed.rgb.mul(vignette), fringed.a);

    // No lift and no grade at the end. Lifting the blacks is the fog layers'
    // job and they do it with depth rather than with a constant, because a
    // constant lift is uniform across the frame and the brief asks the darks to
    // *have* depth rather than merely to stop being black.
    handle.outputNode = vignetted;
    handle.needsUpdate = true;
    return handle;
  }, [camera, depthOfField, enabled, gl, scene, uniforms]);

  useEffect(
    () => () => {
      pipeline?.dispose();
    },
    [pipeline],
  );

  /**
   * Taking over the render call.
   *
   * R3F renders the scene itself from any subscriber at priority 0, and skips
   * that render entirely once a subscriber claims a higher priority. So the
   * pipeline's frame is one subscriber at priority 1 and the fallback is the
   * absence of one — which is why the priority is a value here rather than two
   * code paths, and why `RenderPipeline.render()` is called here rather than
   * left to the renderer.
   *
   * The reset sits at the top of this callback rather than at the bottom so the
   * counter read by `SceneHost` — a priority-0 subscriber, and therefore one
   * that runs earlier in the same frame — is a complete frame's worth of work
   * rather than a partial one. Telemetry is then one frame behind the screen,
   * which is what a counter has to be.
   */
  useFrame(() => {
    if (pipeline === null) return;
    gl.info.reset();
    pipeline.render();
  }, pipeline !== null ? 1 : 0);

  return null;
}
