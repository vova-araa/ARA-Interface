import { Suspense, useEffect, useRef } from 'react';
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
import { Blocks } from './Blocks.tsx';
import { Traffic } from './Traffic.tsx';
import { Herd } from './Herd.tsx';
import { Doves } from './Doves.tsx';
import { Windows } from './Windows.tsx';
import { StreetLights } from './StreetLights.tsx';
import { Monuments } from './Monuments.tsx';
import { Volumetrics } from './Volumetrics.tsx';
import { Tour } from './Tour.tsx';
import { Crowd } from './Crowd.tsx';
import { Weather } from './Weather.tsx';
import { Seasons } from './Seasons.tsx';
import { Drones } from './Drones.tsx';
import { Petals } from './Petals.tsx';

// Subtiele lens-imperfectie; als constante zodat de prop referentie-stabiel is.
const CHROMATIC_OFFSET = new THREE.Vector2(0.0008, 0.0008);

/**
 * Adaptieve kwaliteit — in trappen, met de weg terug open.
 *
 * De vorige versie mat één keer, vanaf de allereerste frame, en legde de
 * uitkomst voor de hele sessie vast. Dat gaat mis op precies de machines waar
 * het niet zou moeten: de eerste seconden compileren shaders en uploaden
 * textures, dus een snelle Mac meet daar gerust 12fps. Hij zakte dan naar
 * dpr 1 — op een Retina-scherm een kwart van de pixels, zichtbaar wazig — en
 * kwam daar nooit meer vanaf.
 *
 * Nu: eerst opwarmen, dan meten in vensters, en zowel omlaag als omhoog. De
 * volgorde van afbouwen volgt wat het duurst is (gemeten: dit is fill-rate,
 * niet geometrie), dus postfx en schaduwen gaan eerst, resolutie pas daarna —
 * resolutie is het enige dat je meteen ziét.
 *
 *   trap 0  alles aan
 *   trap 1  postfx + schaduwen uit
 *   trap 2  ook resolutie omlaag
 *   trap 3  ook de sier-lagen uit (crowd, district-leven, weer, drones)
 *
 * ?fx=force of ?q=high houdt alles aan · ?q=low start op trap 3.
 */
const WARMUP_SEC = 3;
const WINDOW_SEC = 2;
/** Onder deze fps een trap omlaag. */
const DEGRADE_FPS = 26;
/** Boven deze fps, dit aantal vensters lang, een trap omhoog. */
const RECOVER_FPS = 52;
const RECOVER_WINDOWS = 3;
const MAX_STAGE = 3;

/**
 * De scherpte waarop we renderen. Retina geeft 2, een telefoon vaak 3 — en 3
 * is drie keer zoveel pixels voor een scherm dat je op armlengte houdt. 2 is
 * daar ruim, en het is precies de bovengrens die de Canvas ook meekrijgt.
 */
function maxDpr(): number {
  return Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
}

function QualityGovernor(): null {
  const { gl, scene, setDpr } = useThree();
  const frames = useRef(0);
  const windowStart = useRef(0);
  const warmedUp = useRef(false);
  const stage = useRef(0);
  const goodWindows = useRef(0);
  const params = useRef(new URLSearchParams(location.search));
  const forced = useRef(
    params.current.get('fx') === 'force' || params.current.get('q') === 'high',
  );

  // Eén plek die de trap toepast, zodat omhoog exact het omgekeerde is van
  // omlaag. Twee losse takken lopen altijd uit elkaar.
  const applyStage = (next: number): void => {
    const shadows = next < 1;
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.autoUpdate = shadows;
    gl.shadowMap.needsUpdate = shadows;
    // De castShadow/receiveShadow-vlaggen blijven staan: die wissen is
    // onomkeerbaar, en dan is "omhoog" een leugen. shadowMap.enabled alleen
    // is genoeg om het renderen te stoppen.
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const material = mesh.material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true;
    });
    // Zonder composer vervalt de ToneMapping-pass; dan moet de renderer het
    // overnemen, anders oogt alles rauw-lineair uitgewassen.
    gl.toneMapping = next < 1 ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    setDpr(next < 2 ? maxDpr() : 1);
    useAra.getState().setPostFxOn(next < 1);
    useAra.getState().setPerfLow(next >= 3);
    stage.current = next;
  };

  useEffect(() => {
    if (forced.current) return;
    if (params.current.get('q') === 'low') applyStage(MAX_STAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }) => {
    if (forced.current) return;
    const now = clock.elapsedTime;
    if (!warmedUp.current) {
      // Opwarmen: shaders compileren, textures uploaden. Wat je hier meet zegt
      // niets over wat de machine kan.
      if (now < WARMUP_SEC) return;
      warmedUp.current = true;
      windowStart.current = now;
      frames.current = 0;
      return;
    }

    frames.current += 1;
    const elapsed = now - windowStart.current;
    if (elapsed < WINDOW_SEC) return;

    const fps = frames.current / elapsed;
    frames.current = 0;
    windowStart.current = now;

    if (fps < DEGRADE_FPS && stage.current < MAX_STAGE) {
      goodWindows.current = 0;
      applyStage(stage.current + 1);
      console.info(`[ara] ${fps.toFixed(0)}fps — kwaliteit naar trap ${stage.current}`);
      return;
    }
    if (fps >= RECOVER_FPS && stage.current > 0) {
      goodWindows.current += 1;
      // Pas omhoog na een paar rustige vensters: anders pendelt hij heen en
      // weer, en dat ziet er slechter uit dan één trap te laag blijven staan.
      if (goodWindows.current >= RECOVER_WINDOWS) {
        goodWindows.current = 0;
        applyStage(stage.current - 1);
        console.info(`[ara] ${fps.toFixed(0)}fps — kwaliteit terug naar trap ${stage.current}`);
      }
      return;
    }
    goodWindows.current = 0;
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
  // Kantoor open = wereld bevroren: geen twee scenes die tegelijk de GPU vullen.
  const officeOpen = useAra((s) => s.officeProject !== null);

  return (
    <Canvas
      frameloop={officeOpen ? 'never' : 'always'}
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [14, 16, 14], zoom: 22, near: -100, far: 400 }}
      // Grading gebeurt éénmalig in de composer (ToneMapping-effect); de
      // governor zet de renderer-tonemapping terug zodra postfx uitgaat.
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
      onPointerMissed={() => select(null)}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[daylight.stops[0]]} />
      {/* 55–120 begon zo dicht bij de wereld dat de Ararat en de luchtkoepel
          erachter altijd in mist verdwenen — er wás een horizon, je zag hem
          alleen nooit. Nu begint de mist voorbij de wereldrand. */}
      <fog attach="fog" args={[daylight.fogColor, 95, 280]} />
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
        {/* Seizoen ligt over de hele wereld en is achtergrond; Weather hangt
            boven één district en is een melding. Die twee delen bewust geen
            enkel element — zie het blok bovenin Seasons.tsx. */}
        <Seasons world={world} daylight={daylight} />
        {!perfLow && <Doves />}
        {/* Abrikozenbloesem-drift overdag/schemer (niet 's nachts). */}
        {!perfLow && daylight.period !== 'night' && <Petals />}
        {/* Vuurvliegjes zodra het schemert/nacht is; goudstof overdag boven de hub. */}
        {!perfLow && (daylight.period === 'night' || daylight.period === 'dusk') && (
          <Sparkles count={90} scale={[26, 3, 26]} position={[0, 1.4, 0]} size={2.4} speed={0.25} color="#ffdf80" opacity={0.65} />
        )}
        {!perfLow && daylight.period === 'day' && (
          <Sparkles count={30} scale={[6, 3, 6]} position={[0, 2, 0]} size={1.6} speed={0.15} color="#fff3d6" opacity={0.35} />
        )}
        {world && (
          <>
            <Blocks world={world} />
            {/* Ramen en lantaarns regelen hun eigen zuinige stand; ze horen
                juist zichtbaar te blijven als de sier-lagen uitgaan, want ze
                dragen informatie in plaats van sfeer. */}
            <Windows world={world} />
            <StreetLights world={world} />
            {/* Lichtkegels horen bij de lantaarns die er net boven hangen; op
                perfLow geeft hij zelf null terug, gemeten 0 draw calls. */}
            <Volumetrics world={world} />
            {/* Geheugen mag niet verdwijnen omdat de GPU traag is; Monuments
                regelt zijn eigen zuinige stand. */}
            <Monuments world={world} />
            {!perfLow && <Traffic world={world} />}
            {!perfLow && <Herd world={world} />}
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
      {/* Rondleiding staat uit tenzij ?tour=1; zonder Tour in de boom
          verandert er niets aan de camera. */}
      <Tour />
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
          {/* Was 0.12: dat vervaagde op een groot scherm de hele buitenrand tot
              pap — precies wat er als "wazig" uitziet. Een diorama heeft een
              vleugje scherptediepte nodig, geen waas. */}
          <TiltShift2 blur={0.035} />
          <ChromaticAberration offset={CHROMATIC_OFFSET} radialModulation={false} modulationOffset={0} />
          <Vignette eskil={false} offset={0.22} darkness={0.5} />
          <Noise premultiply opacity={0.06} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
