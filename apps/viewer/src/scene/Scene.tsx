import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, TiltShift2, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useAra } from '../store.ts';
import { CameraRig } from './CameraRig.tsx';
import { HexGround } from './HexGround.tsx';
import { Backdrop } from './Backdrop.tsx';
import { Landmarks } from './Landmarks.tsx';
import { Pods } from './Pods.tsx';
import { Figures } from './Figures.tsx';
import { EffectsLayer } from './EffectsLayer.tsx';
import { Labels } from './Labels.tsx';
import { useDaylight, type Daylight } from './daylight.ts';
import { TokenPillars } from './TokenPillars.tsx';
import { AmbientLife } from './AmbientLife.tsx';
import { DistrictLife } from './DistrictLife.tsx';
import { Props } from './Props.tsx';
import { Crowd } from './Crowd.tsx';
import { Weather } from './Weather.tsx';
import { Drones } from './Drones.tsx';

/**
 * Adaptieve kwaliteit in twee trappen:
 *  - < 25fps: schaduwen uit, dpr 1, postprocessing uit
 *  - < 14fps: ook de sier-lagen (crowd, district-leven, weer) uit
 * Sterke hardware merkt er niets van.
 */
function QualityGovernor(): null {
  const { gl, scene, setDpr } = useThree();
  const frames = useRef(0);
  const startedAt = useRef(0);
  const decided = useRef(false);

  useFrame(({ clock }) => {
    if (decided.current) return;
    if (startedAt.current === 0) startedAt.current = clock.elapsedTime;
    frames.current += 1;
    const elapsed = clock.elapsedTime - startedAt.current;
    if (elapsed < 4) return;
    decided.current = true;
    const fps = frames.current / elapsed;
    if (fps < 25) {
      gl.shadowMap.enabled = false;
      gl.shadowMap.autoUpdate = false;
      scene.traverse((obj) => {
        obj.castShadow = false;
        obj.receiveShadow = false;
      });
      setDpr(1);
      useAra.getState().setPostFxOn(false);
      console.info(`[ara] lage framerate (${fps.toFixed(0)}fps) — schaduwen/postfx uit, dpr 1`);
    }
    if (fps < 14) {
      useAra.getState().setPerfLow(true);
      console.info('[ara] zeer lage framerate — sier-lagen uit');
    }
  });
  return null;
}

/**
 * Bewegende zon: positie volgt de echte kloktijd (06:00 oost → 22:00 west),
 * 's nachts een koele maan aan de andere kant. Schaduwen draaien dus echt
 * mee met de dag. ?time= forceert een vaste stand.
 */
function SunRig({ daylight }: { daylight: Daylight }): JSX.Element {
  const light = useRef<THREE.DirectionalLight | null>(null);
  const lastUpdate = useRef(0);

  const apply = (): void => {
    const l = light.current;
    if (!l) return;
    const now = new Date();
    const dayFraction = Math.min(1, Math.max(0, (now.getHours() + now.getMinutes() / 60 - 6) / 16));
    const forced: Record<Daylight['period'], number | null> = {
      dawn: 0.08,
      day: 0.5,
      dusk: 0.92,
      night: null,
    };
    const f = forced[daylight.period] ?? dayFraction;
    if (daylight.period === 'night') {
      // Maan: laag in het noorden, koel en zwak.
      l.position.set(-20, 14, -18);
    } else {
      const azimuth = Math.PI * (1 - f); // oost (π) → west (0)
      const elevation = 0.25 + Math.sin(f * Math.PI) * 0.85;
      const r = 34;
      l.position.set(
        Math.cos(azimuth) * r,
        Math.sin(elevation) * r,
        Math.sin(azimuth) * r * 0.6 + 8,
      );
    }
    l.color.set(daylight.lightColor);
    l.intensity = daylight.directional;
  };

  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastUpdate.current < 5) return; // 1× per 5s is genoeg
    lastUpdate.current = clock.elapsedTime;
    apply();
  });

  return (
    <directionalLight
      ref={(l) => {
        light.current = l;
        apply();
      }}
      position={[18, 26, 10]}
      intensity={daylight.directional}
      color={daylight.lightColor}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-25}
      shadow-camera-right={25}
      shadow-camera-top={25}
      shadow-camera-bottom={-25}
    />
  );
}

export function Scene(): JSX.Element {
  const world = useAra((s) => s.world);
  const select = useAra((s) => s.select);
  const postFxOn = useAra((s) => s.postFxOn);
  const perfLow = useAra((s) => s.perfLow);
  const daylight = useDaylight();

  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [14, 16, 14], zoom: 38, near: -100, far: 300 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[daylight.stops[0]]} />
      <fog attach="fog" args={[daylight.fogColor, 55, 120]} />
      <ambientLight intensity={daylight.ambient} color="#fff1e0" />
      <SunRig daylight={daylight} />
      <hemisphereLight args={['#9db8ff', '#e2a49a', 0.3]} />

      <Suspense fallback={null}>
        <Backdrop />
        <HexGround world={world} />
        <Landmarks world={world} />
        <AmbientLife />
        {!perfLow && <Weather />}
        {world && (
          <>
            <Props world={world} />
            {!perfLow && <Crowd world={world} />}
            {!perfLow && <DistrictLife world={world} />}
            {!perfLow && <Drones world={world} />}
            <Labels world={world} />
            <TokenPillars world={world} />
            <Pods world={world} />
            <Figures world={world} />
            <EffectsLayer world={world} />
          </>
        )}
      </Suspense>
      <CameraRig />
      <QualityGovernor />

      {postFxOn && !perfLow && (
        <EffectComposer multisampling={0}>
          <SMAA />
          <Bloom intensity={0.55} luminanceThreshold={0.72} mipmapBlur radius={0.65} />
          <TiltShift2 blur={0.12} />
          <Vignette eskil={false} offset={0.22} darkness={0.5} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
