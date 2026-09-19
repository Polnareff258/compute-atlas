import * as THREE from 'three';

import type { SurfaceRole } from './machinePalette';
import {
  deriveSurfaceResponse,
  type SurfaceInput,
} from './surfaceResponse';

export type { SurfaceInput, SurfaceRole };

/**
 * Boundary: this factory owns synchronous material allocation and cleanup. It
 * does not build renderer programs: WebGPU compilation and WebGL2 program
 * linking are owned by the existing renderer/scene integration.
 *
 * ## One structural path, on both backends
 *
 * Every structural surface in the scene is a plain `MeshBasicMaterial`, on
 * WebGPU and on WebGL2 alike. That is a correctness constraint, not a
 * preference, and it is worth stating why, because the scene shipped for a
 * stage with the opposite arrangement and the two backends drew measurably
 * different images because of it.
 *
 * The WebGPU branch was a `MeshBasicNodeMaterial` whose colour node read
 * `baseColor * vertexColor() + edge`. But three's own
 * `NodeMaterial.setupDiffuseColor` multiplies `colorNode` by `vertexColor()`
 * again whenever `vertexColors` is true, so every baked facet luminance in the
 * scene — the whole mass read of the Core, closed over 0.14 .. 0.95 — was
 * applied twice. Squaring a luminance is not a subtle error: a face baked at
 * 0.5 rendered at 0.25. Measured on the same frame at (1152,497), WebGPU read
 * 83 where WebGL2 read 143, a ratio of 0.58, and it held across every sampled
 * pixel. The histograms told the same story from the other side — p50 4 / p90
 * 28 / p99 102 against WebGL2's p50 26 / p90 69 / p99 155 — because squaring
 * crushes mid-tones hardest and leaves the brightest faces nearly alone.
 *
 * The node path is therefore gone rather than patched. Once the double multiply
 * is removed it computes the same number as the standard path, so keeping it
 * would mean maintaining two shader permutations to produce one image. What it
 * genuinely added was a view-dependent edge term, and a term only one backend
 * can express is exactly the thing that made the two images differ. Orientation
 * response lives in the baked facet luminance, which both backends read from
 * the same `color` attribute; activity lives in the colour multiplier below.
 *
 * WebGPU's node and storage capability is spent where it buys something the
 * standard path cannot do at all — the routing flowfield in
 * `src/scene/routing/routeDashMaterial.ts` — not on static structure.
 */
export type SurfaceMaterialConfig = {
  readonly role: SurfaceRole;
  readonly color: string;
  /** Membrane openness at rest, 0 (closed silhouette) .. 1 (fully open). */
  readonly baseFade?: number;
};

export type SurfaceMaterialHandle = {
  /**
   * Always a `MeshBasicMaterial`. Stated concretely rather than as `Material`
   * because the response is written to `color` and `opacity`, and a caller that
   * cannot see those cannot verify the response landed.
   */
  readonly material: THREE.MeshBasicMaterial;
  readonly updateInput: (input: SurfaceInput) => void;
  readonly dispose: () => void;
};

export function createSurfaceMaterial(
  config: SurfaceMaterialConfig,
): SurfaceMaterialHandle {
  const membrane = config.role === 'membrane';
  const baseFade = Number.isFinite(config.baseFade) ? config.baseFade! : 0;
  const baseColor = new THREE.Color(config.color);
  // The multiplier is applied here rather than to `material.color` in place, so
  // repeated updates cannot compound: every frame writes base * gain.
  const appliedColor = new THREE.Color();
  const material = new THREE.MeshBasicMaterial({
    color: baseColor.clone(),
    depthWrite: !membrane,
    transparent: membrane,
    // Depth attenuation is the scene's one shared depth term, and it is the
    // same term on both backends. A per-material custom depth falloff would be
    // a second one, free to drift.
    fog: true,
    vertexColors: true,
  });

  let disposed = false;

  const applyResponse = (input: SurfaceInput): void => {
    const response = deriveSurfaceResponse(config.role, input, baseFade);

    // The colour multiplier is the response. It is written for opaque and
    // blending tiers alike: a membrane is lit material too, and scaling only its
    // alpha would make a focused membrane open up without ever brightening.
    appliedColor.copy(baseColor).multiplyScalar(response.gain);
    material.color.copy(appliedColor);

    if (membrane) material.opacity = response.alpha;
  };

  applyResponse({ activity: 0, focus: 0 });

  return {
    material,
    updateInput: (input) => {
      if (disposed) return;

      applyResponse(input);
    },
    dispose: () => {
      if (disposed) return;

      disposed = true;
      material.dispose();
    },
  };
}
