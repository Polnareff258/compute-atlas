import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  float,
  mix,
  mx_fractal_noise_float,
  normalView,
  positionLocal,
  positionViewDirection,
  smoothstep,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { ConvergenceLayerKind } from './convergenceProfile';

export type ConvergenceMaterialOptions = {
  readonly kind: ConvergenceLayerKind;
  readonly phase: number;
  readonly gain: number;
  readonly displacement: number;
};

/**
 * A sliced computation volume at the confluence.
 *
 * It is intentionally neither a ring nor an orb. The boundary is an anisotropic,
 * noise-cut membrane and the brighter interference lives inside it, so the eye
 * reads a processing pocket rather than a symbol placed on the river.
 */
export function createConvergenceMaterial(
  uniforms: FieldUniforms,
  options: ConvergenceMaterialOptions,
) {
  const u = uniforms.uniforms;
  const material = new MeshBasicNodeMaterial();
  material.name = `convergence-${options.kind}`;
  material.transparent = true;
  material.depthWrite = false;
  material.toneMapped = false;
  material.side = DoubleSide;

  const coord = uv().sub(vec2(0.5, 0.5));
  const interaction = u.uHover.mul(0.52).add(u.uFocus.mul(0.88)).clamp(0, 1);
  const scrollDetail = u.uScrollLayers.y.mul(0.62).add(u.uScrollLayers.w.mul(0.38));
  const slowBend = coord.x
    .mul(5.8)
    .add(options.phase)
    .add(u.uFlowPhase.mul(0.028))
    .sin()
    .mul(0.11);

  const fold = mx_fractal_noise_float(
    vec3(
      positionLocal.x.mul(0.012),
      positionLocal.y.mul(0.016),
      u.uFlowPhase.mul(0.035).add(options.phase),
    ),
    4,
    2.04,
    0.53,
  )
    .mul(0.5)
    .add(0.5);

  const fineFold = mx_fractal_noise_float(
    vec3(
      positionLocal.x.mul(0.027).add(options.phase),
      positionLocal.y.mul(0.034),
      u.uFlowPhase.mul(0.052).add(options.phase * 0.37),
    ),
    3,
    2.12,
    0.5,
  )
    .mul(0.5)
    .add(0.5);

  const signedCross = coord.y.add(slowBend).add(fold.sub(0.5).mul(0.20));
  const cross = signedCross.abs();
  const longitudinalAxis = coord.x.add(
    coord.y.mul(options.kind === 'filament' ? 0.16 : 0.08),
  );
  const longitudinal = smoothstep(
    float(options.kind === 'filament' ? 0.46 : 0.52),
    float(options.kind === 'filament' ? 0.25 : 0.30),
    longitudinalAxis.abs(),
  );
  const tornEdge = smoothstep(float(0.31), float(0.07), cross)
    .mul(longitudinal)
    .mul(smoothstep(float(0.34), float(0.58), fold).mul(0.72).add(0.28));
  const innerFold = smoothstep(float(0.22), float(0.025), cross)
    .mul(longitudinal.pow(0.72));
  const interference = smoothstep(float(0.46), float(0.84), fold)
    .mul(tornEdge)
    .mul(innerFold.mul(0.4).add(0.6));
  const fresnel = float(1)
    .sub(normalView.dot(positionViewDirection).abs())
    .pow(1.7);
  const computationHotspot = smoothstep(float(0.76), float(0.94), fold)
    .mul(innerFold.pow(1.35))
    .mul(fresnel.mul(0.24).add(0.76));

  /*
   * Directional computation inside the volume.
   *
   * This is deliberately a family of broad, broken packets rather than a line or
   * a row of dots. They share the membrane's deformation and therefore read as
   * information moving through tissue, not as an overlay drawn on top of it.
   */
  const streamPhase = coord.x
    .mul(24)
    .sub(u.uFlowPhase.mul(0.19))
    .add(fold.mul(5.2))
    .add(options.phase);
  const streamPulse = streamPhase.sin().mul(0.5).add(0.5);
  const streamRidge = smoothstep(float(0.68), float(0.95), streamPulse)
    .mul(innerFold.pow(1.28))
    .mul(fineFold.mul(0.48).add(0.52));
  const packet = smoothstep(float(0.86), float(0.985), streamPulse)
    .mul(smoothstep(float(0.62), float(0.91), fineFold))
    .mul(innerFold.pow(1.9));
  const activeAccent = mix(u.uFlow, u.uRegionAccent, interaction.mul(0.78));

  if (options.kind === 'filament') {
    material.blending = AdditiveBlending;
    const parallelStroke = smoothstep(
      float(0.034),
      float(0.006),
      signedCross.sub(0.092).abs(),
    )
      .mul(longitudinal.pow(0.82))
      .mul(smoothstep(float(0.28), float(0.72), fineFold).mul(0.76).add(0.24));
    const hairline = smoothstep(
      float(0.016),
      float(0.0035),
      signedCross.add(0.052).abs(),
    )
      .mul(longitudinal.pow(1.18))
      .mul(smoothstep(float(0.48), float(0.82), fold));
    const filamentBody = innerFold
      .pow(1.55)
      .mul(smoothstep(float(0.28), float(0.72), fineFold).mul(0.58).add(0.42))
      .add(parallelStroke.mul(fineFold.mul(0.34).add(0.66)))
      .add(hairline.mul(0.42))
      .clamp(0, 1);
    const filamentColour = mix(
      mix(u.uDeep, u.uCobalt, fineFold.mul(0.38)),
      activeAccent,
      streamRidge
        .mul(0.68)
        .add(parallelStroke.mul(0.32))
        .add(hairline.mul(0.18))
        .add(interaction.mul(0.18))
        .min(1),
    );

    material.colorNode = mix(
      filamentColour,
      mix(u.uPalePink, u.uBone, interaction.mul(0.28)),
      packet.mul(0.38),
    )
      // A single lavender hairline gives the cyan tissue a chromatic counterpoint.
      // It follows the rarer broken edge only, so colour hierarchy is carried by
      // line hierarchy rather than washing the whole sheet purple.
      .add(mix(u.uSpectral, u.uPalePink, float(0.28)).mul(hairline).mul(0.16))
      .mul(options.gain)
      .mul(1.72);
    material.opacityNode = filamentBody
      .mul(0.045)
      .add(parallelStroke.mul(0.12))
      .add(hairline.mul(0.055))
      .add(streamRidge.mul(0.26))
      .add(packet.mul(0.34))
      .mul(interaction.mul(0.62).add(0.72))
      .mul(scrollDetail.mul(0.24).add(0.82))
      .mul(options.gain)
      .clamp(0, 0.38);
    material.positionNode = positionLocal.add(
      vec3(
        0,
        fineFold.sub(0.5).mul(options.displacement * 0.12),
        fold
          .sub(0.5)
          .mul(options.displacement)
          .add(streamRidge.mul(options.displacement * 0.28))
          .mul(filamentBody),
      ),
    );

    return material;
  }

  const membraneColour = mix(
    mix(u.uDeep, u.uCobalt, fold.mul(0.64)),
    mix(activeAccent, u.uPalePink, fold.mul(0.32)),
    interference.mul(0.62).add(fresnel.mul(0.38)).min(1),
  );
  const thinFilm = smoothstep(
    float(0.58),
    float(0.91),
    fold.mul(0.62).add(fineFold.mul(0.38)),
  )
    .mul(tornEdge)
    .mul(fresnel.mul(0.42).add(0.58));
  const warmFilm = smoothstep(float(0.79), float(0.96), fineFold)
    .mul(thinFilm.pow(1.35))
    .mul(innerFold.mul(0.54).add(0.46));
  const edgeEnergy = fresnel
    .pow(1.25)
    .mul(tornEdge)
    .mul(interaction.mul(0.10).add(0.085));
  const surfacedColour = mix(
    membraneColour,
    mix(activeAccent, u.uRegionAmbient, fineFold.mul(0.24)),
    thinFilm.mul(0.58).add(streamRidge.mul(0.12)).min(1),
  );
  /*
   * Warm interference is a response, not a second base colour. Keeping half-strength pink
   * present at rest made a frozen/reduced-motion frame reveal the rectangular membrane layers
   * as lavender patches. A trace remains in idle; hover/focus opens the spectrum locally.
   */
  const warmResponse = interaction.mul(0.42).add(0.08);
  const chromaticSurface = mix(surfacedColour, u.uPalePink, warmFilm.mul(warmResponse));
  material.colorNode = mix(chromaticSurface, u.uBone, computationHotspot.mul(0.56))
    .add(activeAccent.mul(edgeEnergy))
    .mul(options.gain)
    .mul(1.72);
  material.opacityNode = interference
    .mul(fold.mul(0.12).add(0.065))
    .add(tornEdge.mul(0.045))
    .add(fresnel.mul(tornEdge).mul(0.10))
    .add(computationHotspot.mul(0.18))
    .add(thinFilm.mul(0.06))
    .add(edgeEnergy.mul(0.16))
    .add(streamRidge.mul(interaction.mul(0.045).add(0.025)))
    .mul(options.gain)
    .clamp(0, 0.34);
  material.positionNode = positionLocal.add(
    vec3(
      0,
      0,
      fold
        .sub(0.5)
        .mul(
          float(options.displacement)
            .mul(interaction.mul(0.18).add(0.92))
            .mul(scrollDetail.mul(0.16).add(0.94)),
        )
        .add(innerFold.mul(options.displacement * 0.42))
        .mul(tornEdge),
    ),
  );

  return material;
}
