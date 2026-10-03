import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  float,
  mix,
  mx_fractal_noise_float,
  normalView,
  positionLocal,
  positionWorld,
  positionViewDirection,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from './inkField';
import { GILDED_CURRENT_PROFILE, INK_MARBLING_PROFILE } from './inkVisualProfile';
import type { ConvergenceLayerKind } from './convergenceProfile';

export type ConvergenceMaterialOptions = {
  readonly kind: ConvergenceLayerKind;
  readonly phase: number;
  readonly gain: number;
  readonly currentGain: number;
  readonly displacement: number;
  readonly visualMode?: 'relief' | 'ink';
  readonly ink?: InkField;
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
  const relief = options.visualMode === 'relief';
  const material = new MeshBasicNodeMaterial();
  material.name = `convergence-${options.kind}`;
  material.transparent = true;
  material.depthWrite = false;
  material.toneMapped = false;
  material.side = DoubleSide;

  const coord = uv().sub(vec2(0.5, 0.5));
  // Couple raised pigment to the existing world simulation, never a second brush.
  const livePressure = options.ink
    ? texture(options.ink.sampleTexture, vec2(
      positionWorld.x.sub(options.ink.extent.minX).div(options.ink.extent.maxX - options.ink.extent.minX),
      positionWorld.z.sub(options.ink.extent.minZ).div(options.ink.extent.maxZ - options.ink.extent.minZ),
    )).w.clamp(0, 1)
    : float(0);
  const interaction = u.uHover.mul(0.52).add(u.uFocus.mul(0.88)).clamp(0, 1);
  const scrollDetail = u.uScrollLayers.y.mul(0.62).add(u.uScrollLayers.w.mul(0.38));
  const slowBend = coord.x
    .mul(5.8)
    .add(options.phase)
    .add(u.uFlowPhase.mul(0.028))
    .sin()
    .mul(0.16);

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
  const longitudinalAxis = coord.x
    .add(coord.y.mul(options.kind === 'filament' ? 0.13 : 0.08))
    .add(fold.sub(0.5).mul(options.kind === 'filament' ? 0.15 : 0.09))
    .add(fineFold.sub(0.5).mul(0.045));
  const geometryFeather = smoothstep(float(0.5), float(0.425), coord.x.abs())
    // Both axes must disappear before the mesh boundary. A cross-section
    // reaching the edge otherwise reads as the cut end of a plastic sheet.
    .mul(smoothstep(float(0.5), float(relief ? 0.30 : 0.425), coord.y.abs()));
  const longitudinal = smoothstep(
    float(options.kind === 'filament' ? -0.57 : -0.61),
    float(options.kind === 'filament' ? -0.31 : -0.34),
    longitudinalAxis,
  ).mul(
    smoothstep(
      float(options.kind === 'filament' ? 0.54 : 0.60),
      float(options.kind === 'filament' ? 0.27 : 0.32),
      longitudinalAxis,
    ),
  ).mul(geometryFeather);
  const tornEdge = smoothstep(float(relief ? 0.38 : 0.31), float(0.07), cross)
    .mul(longitudinal)
    .mul(smoothstep(float(0.34), float(0.58), fold).mul(0.72).add(0.28));
  const innerFold = smoothstep(float(0.22), float(0.025), cross)
    .mul(longitudinal.pow(0.72));
  const marblingPhase = coord.x
    .mul(INK_MARBLING_PROFILE.alongFrequency)
    .add(coord.y.mul(INK_MARBLING_PROFILE.acrossFrequency))
    .add(fold.sub(0.5).mul(INK_MARBLING_PROFILE.foldWarp))
    .add(fineFold.sub(0.5).mul(INK_MARBLING_PROFILE.fineWarp))
    .sub(u.uFlowPhase.mul(INK_MARBLING_PROFILE.driftRate));
  const marbling = smoothstep(
    float(INK_MARBLING_PROFILE.onset),
    float(INK_MARBLING_PROFILE.full),
    marblingPhase.sin().mul(0.5).add(0.5),
  )
    .mul(innerFold.pow(0.72))
    .mul(fineFold.mul(0.35).add(0.65));
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
  const activeAccent = mix(relief ? u.uFlow : u.uSpectral, u.uRegionAccent, interaction.mul(0.78));
  const currentPhase = coord.x
    .mul(GILDED_CURRENT_PROFILE.frequency)
    .add(fold.mul(GILDED_CURRENT_PROFILE.seedInfluence))
    .sub(u.uFlowPhase.mul(GILDED_CURRENT_PROFILE.rate));
  const currentCrest = smoothstep(
    float(GILDED_CURRENT_PROFILE.crestStart),
    float(GILDED_CURRENT_PROFILE.crestEnd),
    currentPhase.sin().mul(0.5).add(0.5),
  );
  const currentBank = signedCross.sub(0.105).add(fineFold.sub(0.5).mul(0.045));
  const currentThread = smoothstep(float(0.017), float(0.0035), currentBank.abs())
    .mul(longitudinal)
    .mul(fold.mul(0.38).add(0.62));
  const currentAura = smoothstep(float(0.115), float(0.018), currentBank.abs())
    .mul(longitudinal)
    .mul(0.08);
  const currentAccent = currentThread
    .mul(currentCrest.mul(0.52).add(0.48))
    .add(currentAura)
    .mul(relief ? options.currentGain * 0.035 : options.currentGain);

  if (options.kind === 'filament') {
    material.blending = AdditiveBlending;
    const strokeDrift = fineFold
      .sub(0.5)
      .mul(0.17)
      .add(
        coord.x
          .mul(7.2)
          .add(options.phase)
          .sub(u.uFlowPhase.mul(0.045))
          .sin()
          .mul(0.028),
      );
    const calligraphicStroke = smoothstep(
      float(0.105),
      float(0.012),
      signedCross.sub(strokeDrift).abs(),
    )
      .mul(longitudinal.pow(0.82))
      .mul(smoothstep(float(0.24), float(0.78), fineFold).mul(0.78).add(0.22));
    const brokenGlint = smoothstep(
      float(0.030),
      float(0.0045),
      signedCross.sub(strokeDrift.mul(0.46)).abs(),
    )
      .mul(longitudinal.pow(1.16))
      .mul(smoothstep(float(0.67), float(0.91), fold));
    const filamentBody = innerFold
      .pow(1.55)
      .mul(smoothstep(float(0.28), float(0.72), fineFold).mul(0.58).add(0.42))
      .add(calligraphicStroke.mul(fineFold.mul(0.34).add(0.66)))
      .add(brokenGlint.mul(0.28))
      .clamp(0, 1);
    const filamentColour = mix(
      mix(u.uDeep, u.uCobalt, fineFold.mul(0.38)),
      activeAccent,
      streamRidge
        .mul(0.68)
        .add(calligraphicStroke.mul(0.28))
        .add(brokenGlint.mul(0.14))
        .add(interaction.mul(0.18))
        .min(1),
    );

    material.colorNode = mix(
      filamentColour,
      mix(u.uPalePink, u.uBone, interaction.mul(0.28)),
      packet.mul(0.38),
    )
      .add(mix(u.uSpectral, u.uPalePink, float(0.28)).mul(brokenGlint).mul(0.13))
      .add(u.uRiverGold.mul(calligraphicStroke).mul(options.currentGain * (relief ? 0.015 : 0.55)))
      .mul(options.gain)
      .mul(1.72);
    material.opacityNode = filamentBody
      .mul(0.045)
      .add(calligraphicStroke.mul(0.10))
      .add(brokenGlint.mul(0.045))
      .add(streamRidge.mul(0.26))
      .add(packet.mul(0.34))
      .add(calligraphicStroke.mul(options.currentGain * 0.10))
      .mul(interaction.mul(0.62).add(0.72))
      .mul(scrollDetail.mul(0.24).add(0.82))
      .mul(options.gain)
      .mul(relief ? 0.25 : 1)
      .clamp(0, 0.29);
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
    mix(u.uDeep, relief ? u.uCobalt : u.uGreyViolet, fold.mul(0.34)),
    mix(activeAccent, u.uPalePink, fold.mul(0.22)),
    interference.mul(0.44).add(fresnel.mul(0.20)).min(1),
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
    thinFilm.mul(0.36).add(streamRidge.mul(0.10)).min(1),
  );
  /*
   * Warm interference is a response, not a second base colour. Keeping half-strength pink
   * present at rest made a frozen/reduced-motion frame reveal the rectangular membrane layers
   * as lavender patches. A trace remains in idle; hover/focus opens the spectrum locally.
   */
  const warmResponse = interaction.mul(0.42).add(0.08);
  const chromaticSurface = mix(surfacedColour, u.uPalePink, warmFilm.mul(warmResponse));
  const currentWashedSurface = mix(
    chromaticSurface,
    mix(relief ? u.uDeep : u.uGreyViolet, u.uCobalt, fineFold.mul(0.28)),
    marbling.mul(relief ? 0.35 : 0.68),
  );
  const pigmentSurface = mix(currentWashedSurface, mix(u.uSpectral, u.uFlow, fold), livePressure.mul(0.32));
  material.colorNode = mix(pigmentSurface, u.uBone, computationHotspot.mul(relief ? 0.18 : 0.56))
    .add(activeAccent.mul(edgeEnergy))
    .add(u.uRiverGold.mul(currentAccent).mul(0.68))
    .mul(options.gain)
    .mul(relief ? 2.15 : 1.72);
  material.opacityNode = interference
    .mul(fold.mul(0.12).add(0.065))
    .add(tornEdge.mul(relief ? 0.09 : 0.045))
    .add(fresnel.mul(tornEdge).mul(0.10))
    .add(computationHotspot.mul(0.18))
    .add(thinFilm.mul(0.06))
    .add(edgeEnergy.mul(0.16))
    .add(streamRidge.mul(interaction.mul(0.045).add(0.025)))
    .add(marbling.mul(INK_MARBLING_PROFILE.opacityGain))
    .add(currentAccent.mul(0.14))
    .mul(options.gain)
    .mul(relief ? 0.58 : 1)
    .clamp(0, 0.56);
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
        .add(livePressure.mul(relief ? 9 : 3))
        .mul(tornEdge),
    ),
  );

  return material;
}
