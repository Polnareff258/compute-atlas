import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, mix, mx_fractal_noise_float, positionLocal, positionWorld, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import type { FieldUniforms } from '../field/fieldUniforms';
import type { InkField } from './inkField';
import type { InkMaterial } from './inkMaterial';

/** A raised pigment wash. Shares the simulation, not the river's luminous contour. */
export function createInkReliefMaterial(uniforms: FieldUniforms, ink: InkField): InkMaterial {
  const u = uniforms.uniforms;
  const material = new MeshBasicNodeMaterial();
  material.name = 'ink-relief-wash';
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;
  material.toneMapped = false;

  const coord = uv();
  const state = texture(ink.sampleTexture, coord);
  // Fixed world-axis taps avoid silhouette jumps at course ownership boundaries.
  const softened = state.x.mul(0.36)
    .add(texture(ink.sampleTexture, coord.add(vec2(0.018, 0))).x.mul(0.16))
    .add(texture(ink.sampleTexture, coord.sub(vec2(0.018, 0))).x.mul(0.16))
    .add(texture(ink.sampleTexture, coord.add(vec2(0, 0.018))).x.mul(0.16))
    .add(texture(ink.sampleTexture, coord.sub(vec2(0, 0.018))).x.mul(0.16)).clamp(0, 1);
  const slowTime = u.uFlowPhase.mul(0.045);
  const broad = mx_fractal_noise_float(vec3(
    positionLocal.x.mul(0.0034).add(slowTime.mul(0.12)),
    positionLocal.z.mul(0.0052).sub(slowTime.mul(0.1)), slowTime,
  ), 3, 1.97, 0.48).mul(0.5).add(0.5).clamp(0, 1);
  const shear = mx_fractal_noise_float(vec3(
    positionLocal.x.mul(0.005).add(broad.mul(1.8)),
    positionLocal.z.mul(0.012).sub(broad.mul(0.8)), slowTime.mul(0.7),
  ), 3, 2.0, 0.48).mul(0.5).add(0.5).clamp(0, 1);
  const pigment = smoothstep(float(0.005), float(0.68), softened);
  const wash = pigment.pow(0.7);
  const folds = broad.mul(0.65).add(shear.mul(0.35));
  // A warped, anisotropic pigment texture: long internal blooms rather than
  // repeated contour stripes or surface-wide decorative grain.
  const marbling = mx_fractal_noise_float(vec3(
    positionLocal.x.mul(0.014).add(broad.mul(2.4)),
    positionLocal.z.mul(0.036).sub(shear.mul(1.7)),
    slowTime.mul(0.8),
  ), 3, 2.03, 0.47).mul(0.5).add(0.5).clamp(0, 1);
  const pressure = state.w.clamp(0, 1);
  const height = wash.mul(folds.pow(1.6)).mul(118)
    .add(pressure.mul(7))
    .sub(state.y.clamp(0, 1).mul(3));
  material.positionNode = positionLocal.add(vec3(0, height, 0));

  // An optical normal over a broad pigment neighbourhood, not per-triangle
  // derivatives: amplified texel derivatives turn fluid folds into terraced rock.
  const gx = texture(ink.sampleTexture, coord.add(vec2(0.012, 0))).x
    .sub(texture(ink.sampleTexture, coord.sub(vec2(0.012, 0))).x);
  const gz = texture(ink.sampleTexture, coord.add(vec2(0, 0.012))).x
    .sub(texture(ink.sampleTexture, coord.sub(vec2(0, 0.012))).x);
  const normal = vec3(gx.mul(-1.4), 0.85, gz.mul(-1.4)).normalize();
  const facing = normal.dot(vec3(-0.38, 0.74, 0.56).normalize()).abs();
  const view = cameraPosition.sub(positionWorld).normalize();
  const grazing = float(1).sub(normal.dot(view).abs()).pow(2.2);
  const pigmentPool = smoothstep(float(0.24), float(0.86), softened)
    .mul(broad.mul(0.42).add(0.58));
  const shoulder = smoothstep(float(0.012), float(0.3), softened)
    .mul(float(1).sub(smoothstep(float(0.4), float(0.98), softened)));
  const absorption = mix(u.uInk, u.uDeep, wash.mul(0.78));
  const wetPigment = mix(absorption, u.uCobalt, facing.mul(folds).mul(0.64));
  const lightWash = mix(wetPigment, u.uFlow,
    facing.pow(2).mul(shear).mul(shoulder.mul(0.62).add(0.18)).mul(0.46));
  const pooledWash = mix(lightWash, mix(u.uInk, u.uDeep, float(0.68)), pigmentPool.mul(0.58));
  const suspendedVein = smoothstep(float(0.46), float(0.78), marbling)
    .mul(shoulder).mul(shear);
  const pearlescentWash = mix(pooledWash, mix(u.uGreyViolet, u.uCobalt, broad), suspendedVein.mul(0.42));
  const targetDistance = vec2(positionLocal.x, positionLocal.z)
    .sub(vec2(u.uSignalTarget.x, u.uSignalTarget.z)).length();
  const localActivity = smoothstep(float(240), float(45), targetDistance)
    .mul(u.uHover.mul(0.45).add(u.uFocus.mul(0.8)).clamp(0, 1));
  const localSpectrum = mix(u.uFlow, u.uSpectral, shear);
  material.colorNode = mix(pearlescentWash, u.uRegionAccent, localActivity.mul(0.16))
    .mul(facing.mul(0.55).add(0.45))
    .add(u.uFlow.mul(grazing).mul(wash).mul(0.025))
    .add(localSpectrum.mul(pressure).mul(0.34))
    .mul(2.35);
  const margin = coord.x.min(coord.y).min(float(1).sub(coord.x)).min(float(1).sub(coord.y));
  material.opacityNode = wash
    .mul(folds.mul(0.34).add(0.5))
    .mul(marbling.mul(0.18).add(0.82))
    .mul(smoothstep(float(0), float(0.06), margin))
    .clamp(0, 0.82);
  return { material, dispose: () => material.dispose() };
}
