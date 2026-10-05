'use client';

/* R3F owns these mutable GPU objects; useFrame updates them without changing React state. */
/* eslint-disable react-hooks/immutability */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Group, MathUtils, PMREMGenerator, Vector2 } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRibbon, createParticleField } from './sculpture';
import { createDustMaterial, createSilverMaterial } from './materials';
import { getJourney, getQuality } from './journey';

type Props = { onReady: () => void; onFailure: () => void; reducedMotion: boolean };

function Sculpture({ onReady, mobile }: { onReady: () => void; mobile: boolean }) {
  const group = useRef<Group>(null);
  const pointer = useRef(new Vector2());
  const progress = useRef(0);
  const active = useRef(true);
  const time = useRef(0);
  const ready = useRef(false);
  const frameCost = useRef(0);
  const qualityTimer = useRef(0);
  const quality = getQuality(mobile);
  const { camera, gl, scene } = useThree();
  const geometry = useMemo(() => createRibbon(), []);
  const particles = useMemo(() => createParticleField(quality.particles), [quality.particles]);
  const silver = useMemo(() => createSilverMaterial(), []);
  const dust = useMemo(() => createDustMaterial(), []);
  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04, 0.1, 100, { size: 128 });
    room.dispose();
    generator.dispose();
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    const previousRotation = scene.environmentRotation.clone();
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;
    scene.environmentRotation.set(0, 1.7, 0);
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
      scene.environmentRotation.copy(previousRotation);
      target.dispose();
    };
  }, [gl, scene]);

  useEffect(() => {
    const visibility = () => { active.current = !document.hidden; };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => () => {
    geometry.dispose(); silver.material.dispose(); dust.dispose();
  }, [geometry, silver, dust]);
  useEffect(() => () => particles.dispose(), [particles]);

  useFrame((state, delta) => {
    if (!active.current) return;
    if (!ready.current) { ready.current = true; onReady(); }
    time.current += Math.min(delta, 0.05);
    // Read native scroll in the render loop; continuous values never enter React state.
    const documentRoot = document.scrollingElement;
    const range = Math.max(1, (documentRoot?.scrollHeight ?? 1) - window.innerHeight);
    const target = (documentRoot?.scrollTop ?? 0) / range;
    progress.current = MathUtils.damp(progress.current, target, 7, delta);
    const journey = getJourney(progress.current);
    const burst = journey.fracture * (1 - journey.echo);
    pointer.current.lerp(state.pointer, 1 - Math.exp(-delta * 3));
    silver.uniforms.uTime.value = time.current;
    silver.uniforms.uMelt.value = journey.melt;
    silver.uniforms.uPointer.value.copy(pointer.current);
    silver.uniforms.uBurst.value = burst;
    silver.material.roughness = 0.19 - journey.melt * 0.06;
    dust.uniforms.uTime!.value = time.current;
    dust.uniforms.uBurst!.value = burst + journey.echo * 0.14;
    dust.uniforms.uOpacity!.value = journey.fracture * (1 - journey.echo * 0.8);
    dust.uniforms.uDpr!.value = gl.getPixelRatio();
    frameCost.current = MathUtils.lerp(frameCost.current, Math.min(delta, 0.1), 0.025);
    qualityTimer.current += delta;
    if (qualityTimer.current > 5) {
      qualityTimer.current = 0;
      if (frameCost.current > (mobile ? 0.045 : 0.027) && gl.getPixelRatio() > 0.85) {
        gl.setPixelRatio(Math.max(0.85, gl.getPixelRatio() - 0.25));
      }
    }
    if (group.current) {
      group.current.rotation.x = pointer.current.y * 0.07 + journey.melt * 0.32;
      group.current.rotation.y = 0.3 + pointer.current.x * 0.1 + journey.melt * 1.2 + journey.fracture * 1.5 - journey.echo * 2.7;
      group.current.rotation.z = -0.22 + Math.sin(time.current * 0.16) * 0.025;
      group.current.position.x = mobile ? 0 : 1.45 * (1 - journey.melt);
      group.current.position.y = mobile ? 0.45 : 0.15;
    }
    camera.position.z = (mobile ? 10.5 : 8.6) - journey.melt * 3.1 + journey.fracture * 1.8;
    camera.position.x = journey.melt * 0.4;
    camera.lookAt(0, mobile ? 0.35 : 0.1, 0);
  });

  return <>
    <ambientLight intensity={0.12} />
    <spotLight position={[-4, 7, 3]} intensity={70} angle={0.5} penumbra={1} color="#dce5f2" />
    <pointLight position={[3, -1, 2]} intensity={18} color="#e24b37" />
    <group ref={group} scale={0.8}>
      <mesh geometry={geometry} material={silver.material} frustumCulled={false} />
      <points geometry={particles} material={dust} frustumCulled={false} />
    </group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.5, 0]}>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#0a0b0d" roughness={0.85} metalness={0.1} envMapIntensity={0.12} />
    </mesh>
    <fog attach="fog" args={['#101114', 11, 30]} />
  </>;
}

export default function ExperienceCanvas({ onReady, onFailure, reducedMotion }: Props) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const [visible, setVisible] = useState(true);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // Check the browser before R3F's asynchronous renderer initialization.
    // Its renderer-construction failures do not reach the scene error boundary.
    const probe = document.createElement('canvas');
    try {
      const context = probe.getContext('webgl2');
      if (!context) { onFailure(); return; }
      context.getExtension('WEBGL_lose_context')?.loseContext();
      // This state reflects the result of checking an external browser API.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(true);
    } catch { onFailure(); }
  }, [onFailure]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const resize = () => setMobile(media.matches);
    const change = () => setVisible(!document.hidden);
    media.addEventListener('change', resize);
    document.addEventListener('visibilitychange', change);
    return () => { media.removeEventListener('change', resize); document.removeEventListener('visibilitychange', change); };
  }, []);
  if (reducedMotion || !supported) return null;
  return <Canvas
    eventSource={document.body}
    eventPrefix="client"
    camera={{ position: [0, 0, 8.6], fov: 40, near: 0.1, far: 100 }}
    dpr={[1, getQuality(mobile).dpr]}
    frameloop={visible ? 'always' : 'never'}
    gl={{ antialias: !mobile, alpha: false, powerPreference: 'high-performance' }}
    fallback="此浏览器无法显示实时画面。"
    onCreated={({ gl, scene }) => {
      scene.background = null;
      gl.setClearColor('#101114', 1);
    }}
  >
    <ContextGuard onFailure={onFailure} />
    <Suspense fallback={null}><Sculpture onReady={onReady} mobile={mobile} /></Suspense>
  </Canvas>;
}

function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onFailure]);
  return null;
}
