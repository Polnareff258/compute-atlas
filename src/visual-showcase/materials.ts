import { AdditiveBlending, Color, DoubleSide, MeshPhysicalMaterial, ShaderMaterial, Vector2 } from 'three';

export function createSilverMaterial() {
  const uniforms = { uTime: { value: 0 }, uMelt: { value: 0 }, uBurst: { value: 0 }, uPointer: { value: new Vector2() } };
  const material = new MeshPhysicalMaterial({
    color: '#c4c9d0', metalness: 1, roughness: 0.19,
    clearcoat: 1, clearcoatRoughness: 0.12, side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform float uTime; uniform float uMelt; uniform float uBurst; uniform vec2 uPointer;
      attribute vec3 aCenter; attribute vec3 aScatter;
      ${shader.vertexShader}`.replace('#include <beginnormal_vertex>', `
      vec3 objectNormal = vec3(normal);
      float rippleSlope = cos(position.y * 8.0 + position.x * 6.0 - uTime * 1.8) * uMelt * sin(uv.x * 3.14159265);
      objectNormal = normalize(objectNormal + vec3(-rippleSlope * 0.2, -rippleSlope * 0.25, 0.0));
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
      #endif
    `).replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      float wave = sin(position.y * 8.0 + position.x * 6.0 - uTime * 1.8);
      float detail = sin(position.y * 24.0 + position.z * 13.0 + uTime);
      float seamEnvelope = sin(uv.x * 3.14159265);
      transformed += normal * (wave * 0.085 + detail * 0.023) * uMelt * seamEnvelope;
      float distanceToPointer = length(position.xy - uPointer * vec2(2.5, 3.5));
      transformed += normal * sin(distanceToPointer * 18.0 - uTime * 3.5) * exp(-distanceToPointer * 2.0) * uMelt * 0.075 * seamEnvelope;
      transformed *= 1.0 + sin(uTime * 0.6) * 0.006;
      vec3 local = transformed - aCenter;
      float a = uBurst * (aScatter.x + aScatter.z) * 0.6;
      mat2 rotation = mat2(cos(a), -sin(a), sin(a), cos(a));
      local.xy = rotation * local.xy;
      transformed = aCenter + local + aScatter * uBurst;
    `);
  };
  material.customProgramCacheKey = () => 'afterform-silver-v1';
  return { material, uniforms };
}

export function createDustMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uBurst: { value: 0 }, uOpacity: { value: 0 }, uDpr: { value: 1 }, uColor: { value: new Color('#dee4eb') } },
    vertexShader: `
      attribute vec3 aScatter; attribute float aSeed;
      uniform float uTime; uniform float uBurst; uniform float uDpr;
      varying float vSeed;
      void main() {
        vSeed = aSeed;
        vec3 p = position + aScatter * uBurst;
        p.x += sin(uTime * 0.35 + aSeed * 20.0) * uBurst * 0.18;
        p.y += cos(uTime * 0.25 + aSeed * 30.0) * uBurst * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((1.0 + aSeed * 1.4) * uDpr * 7.0 / max(1.0, -mv.z), 0.7, 4.0);
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uColor; varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = (1.0 - smoothstep(0.12, 0.5, d)) * uOpacity * (0.35 + vSeed * 0.65);
        gl_FragColor = vec4(uColor, alpha);
      }`,
  });
}
