import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  TiltShift2,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Environment, Lightformer, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { windTime } from './wind.ts';
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

// Subtiele lens-imperfectie; als constante zodat de prop referentie-stabiel is.
const CHROMATIC_OFFSET = new THREE.Vector2(0.0008, 0.0008);

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
  // ?fx=force houdt alle lagen aan, ongeacht fps (screenshots/demo-opnames).
  const forced = useRef(new URLSearchParams(location.search).get('fx') === 'force');

  useFrame(({ clock }) => {
    if (decided.current || forced.current) return;
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
      // Zonder composer geen ToneMapping-pass meer → renderer neemt het over,
      // anders oogt alles rauw-lineair uitgewassen.
      gl.toneMapping = THREE.ACESFilmicToneMapping;
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

/** Tikt de gedeelde windklok — alle wind-shaders lopen op deze ene uniform. */
function WindTicker(): null {
  useFrame(({ clock }) => {
    windTime.value = clock.elapsedTime;
  });
  return null;
}

/** IBL volgt de dag: 's nachts dimt de studio-omgeving, anders is het nooit donker. */
function EnvIntensity({ daylight }: { daylight: Daylight }): null {
  const scene = useThree((s) => s.scene);
  const target =
    daylight.period === 'night' ? 0.12 : daylight.period === 'day' ? 1 : 0.45;
  scene.environmentIntensity = target;
  return null;
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
      // Grading gebeurt éénmalig in de composer (ToneMapping-effect); de
      // governor zet de renderer-tonemapping terug zodra postfx uitgaat.
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
      onPointerMissed={() => select(null)}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[daylight.stops[0]]} />
      <fog attach="fog" args={[daylight.fogColor, 55, 120]} />
      <ambientLight intensity={daylight.ambient * 0.8} color="#fff1e0" />
      <SunRig daylight={daylight} />
      <hemisphereLight args={['#9db8ff', '#e2a49a', 0.25]} />

      {/* Procedurele studio-omgeving: zachte reflecties op koepels, goud en
          water — één PMREM-bake (frames=1), nul netwerk-assets. */}
      <EnvIntensity daylight={daylight} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#ffe9c9" position={[6, 5, 3]} scale={[9, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#9db8ff" position={[-6, 4, -4]} scale={[7, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={0.7} color="#ffd0c0" position={[0, -3, 0]} scale={6} target={[0, 2, 0]} />
      </Environment>

      <WindTicker />
      <Suspense fallback={null}>
        <Backdrop />
        <HexGround world={world} />
        <Landmarks world={world} />
        <AmbientLife />
        {!perfLow && <Weather />}
        {/* Vuurvliegjes zodra het schemert/nacht is; goudstof overdag boven de hub. */}
        {!perfLow && (daylight.period === 'night' || daylight.period === 'dusk') && (
          <Sparkles count={90} scale={[26, 3, 26]} position={[0, 1.4, 0]} size={2.4} speed={0.25} color="#ffdf80" opacity={0.65} />
        )}
        {!perfLow && daylight.period === 'day' && (
          <Sparkles count={30} scale={[6, 3, 6]} position={[0, 2, 0]} size={1.6} speed={0.15} color="#fff3d6" opacity={0.35} />
        )}
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
          {/* AO eerst (scene-pass), daarna beeldeffecten, grading als laatste stap vóór de garnish. */}
          <N8AO quality="performance" halfRes aoRadius={0.9} intensity={1.15} distanceFalloff={1} />
          <SMAA />
          <Bloom intensity={0.7} luminanceThreshold={0.72} mipmapBlur radius={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={0.14} />
          <BrightnessContrast brightness={0.03} contrast={0.07} />
          <TiltShift2 blur={0.12} />
          <ChromaticAberration offset={CHROMATIC_OFFSET} radialModulation={false} modulationOffset={0} />
          <Vignette eskil={false} offset={0.22} darkness={0.5} />
          <Noise premultiply opacity={0.06} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
