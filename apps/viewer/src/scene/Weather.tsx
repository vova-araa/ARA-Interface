import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, stableHash, type SessionState, type WorldConfig } from '@ara/shared';
import { HEX_SPACING, ventureOf } from '../placements.ts';
import { useAra, useViewSnapshot } from '../store.ts';
import { useDaylight, type Daylight } from './daylight.ts';

/**
 * Weer-laag. Twee dingen tegelijk:
 *
 *  1. Decor dat altijd klopt omdat het niets beweert: wolkschaduwen die over
 *     de grond glijden, eeuwige sneeuw op de verre Ararat, schuim op het meer.
 *  2. Een aflezing van de wereld zelf — per district. Onweer waar iets stuk is,
 *     mist waar werk vastzit, zon waar er écht gedraaid wordt zonder fouten.
 *
 * De harde regel van deze laag: het weer mag er nooit beter uitzien dan de
 * werkelijkheid. Een district zonder sessies krijgt daarom géén zon maar een
 * lege lucht — "ik meet niets" is iets anders dan "het gaat goed", en dat
 * verschil is precies waarom dit scherm bestaat (zelfde principe als de
 * Gemeten-tab: niet meetbaar ⇒ de regel ontbreekt).
 */

const SNOW_COUNT = 36;
const SNOW_CENTER = new THREE.Vector3(-14, 9.5, -22);
const SNOW_SPREAD = 9;

/** Zoveel wereld-eenheden rond het districthart telt als "boven dat district". */
const DISTRICT_RADIUS = 2.6;
const RAIN_COUNT = 44;
const MIST_COUNT = 22;

/**
 * Een sessie die zegt te werken maar al zo lang geen event stuurde, wérkt niet
 * meer — die hangt. Tussen VERS en VAST zit met opzet een grijze zone: daar
 * beweren we geen van beide.
 */
const FRESH_MS = 5 * 60_000;
const STUCK_MS = 10 * 60_000;

/** Overgangstijd in seconden. Weer dat per event omslaat is geen signaal maar ruis. */
const DAMP_TAU = 2.5;

export type DistrictSky = 'storm' | 'mist' | 'zon' | 'leeg';

export interface DistrictWeatherReading {
  sky: DistrictSky;
  /** 0..1 — hoeveel sessies dit beeld dragen; alleen de sterkte, niet het oordeel. */
  intensity: number;
}

/**
 * Pure aflezing: welke lucht hoort bij deze sessies? Bewust conservatief —
 * elke tak die niets zeker weet valt terug op 'leeg'.
 */
export function readDistrictWeather(sessions: SessionState[], now: number): DistrictWeatherReading {
  let broken = 0; // storing: sessie staat op error en is niet afgesloten
  let stuck = 0; // wacht op een mens, of beweert te werken en doet niets
  let running = 0; // draait nu echt
  let scarred = 0; // draait, maar had fouten — genoeg om de zon in te houden

  for (const session of sessions) {
    // Een afgesloten sessie zegt niets over hoe het nú staat.
    if (session.endedAt || session.status === 'done') continue;
    const silent = now - session.lastSeenAt;

    if (session.status === 'error') {
      broken++;
      continue;
    }
    if (session.status === 'needsHuman' || session.needsHuman) {
      stuck++;
      continue;
    }
    if (session.status === 'working') {
      if (silent > STUCK_MS) stuck++;
      else if (silent <= FRESH_MS) {
        running++;
        if (session.errorCount > 0) scarred++;
      }
      // Daartussenin: stil maar niet lang genoeg om vast te heten. Telt nergens mee.
    }
    // 'idle' is leven zonder werk — dat is geen goed nieuws en geen slecht nieuws.
  }

  if (broken > 0) return { sky: 'storm', intensity: Math.min(1, 0.45 + broken * 0.25) };
  if (stuck > 0) return { sky: 'mist', intensity: Math.min(1, 0.5 + stuck * 0.25) };
  // Zon is een uitspraak, geen achtergrond: alleen bij draaiend werk zónder
  // ook maar één fout in die sessies. Alles wat hierna komt blijft leeg.
  if (running > 0 && scarred === 0) return { sky: 'zon', intensity: Math.min(1, 0.5 + running * 0.2) };
  return { sky: 'leeg', intensity: 0 };
}

interface DistrictPlot extends DistrictWeatherReading {
  id: string;
  x: number;
  z: number;
}

/** Sessies over districten verdelen via dezelfde venture-toewijzing als de podplaatsing. */
function plotDistricts(world: WorldConfig, sessions: SessionState[], now: number): DistrictPlot[] {
  const byVenture = new Map<string, SessionState[]>();
  for (const session of sessions) {
    const id = ventureOf(world, session.project).id;
    const list = byVenture.get(id);
    if (list) list.push(session);
    else byVenture.set(id, [session]);
  }
  return world.districts.map((district) => {
    const { x, z } = axialToWorld(district.center);
    return {
      id: district.venture.id,
      x: x * HEX_SPACING,
      z: z * HEX_SPACING,
      ...readDistrictWeather(byVenture.get(district.venture.id) ?? [], now),
    };
  });
}

/** Deterministische strooiing binnen de districtschijf — nooit Math.random. */
function discSeeds(key: string, count: number, radius: number) {
  return Array.from({ length: count }, (_, i) => {
    const a = (stableHash(`${key}-a-${i}`) % 3600) / 3600;
    const r = (stableHash(`${key}-r-${i}`) % 1000) / 1000;
    const angle = a * Math.PI * 2;
    // sqrt: anders klit alles in het midden van de schijf.
    const dist = Math.sqrt(r) * radius;
    return {
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      speed: 0.55 + (stableHash(`${key}-s-${i}`) % 100) / 140,
      phase: (stableHash(`${key}-p-${i}`) % 1000) / 1000,
    };
  });
}

/**
 * Het weer van één district. De component blijft altijd gemonteerd; alleen de
 * gedempte gewichten veranderen. Zo kan een luchtbeeld niet knipperen doordat
 * React iets opnieuw opbouwt, en houdt een overgang zijn halve weg vast.
 */
const DistrictWeather = memo(function DistrictWeather({
  id,
  x,
  z,
  sky,
  intensity,
  daylight,
}: DistrictPlot & { daylight: Daylight }): JSX.Element {
  const rainRef = useRef<THREE.InstancedMesh>(null);
  const mistRef = useRef<THREE.InstancedMesh>(null);
  const cloudRef = useRef<THREE.Group>(null);
  const cloudMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const gloomRef = useRef<THREE.Mesh>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const sunRef = useRef<THREE.Group>(null);
  const shaftRef = useRef<THREE.Mesh>(null);
  const poolRef = useRef<THREE.Mesh>(null);

  const rainSeeds = useMemo(() => discSeeds(`${id}-rain`, RAIN_COUNT, DISTRICT_RADIUS), [id]);
  const mistSeeds = useMemo(() => discSeeds(`${id}-mist`, MIST_COUNT, DISTRICT_RADIUS * 0.95), [id]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // Eigen fase per district, anders flitst de hele wereld op hetzelfde moment.
  const strikePhase = useMemo(() => (stableHash(`${id}-bolt`) % 1000) / 1000, [id]);
  const clouds = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => ({
        x: ((stableHash(`${id}-c-${i}`) % 200) / 100 - 1) * 1.5,
        z: ((stableHash(`${id}-d-${i}`) % 200) / 100 - 1) * 1.2,
        s: 0.9 + (stableHash(`${id}-e-${i}`) % 100) / 160,
      })),
    [id],
  );

  // 's Nachts is "zonnig" een leugen; helder werk krijgt dan maanlicht.
  const clearColor = daylight.period === 'night' ? '#9dc0ff' : '#ffdb9b';
  const clearBoost = daylight.period === 'night' ? 0.55 : 1;

  const weights = useRef({ storm: 0, mist: 0, sun: 0 });

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    // Exponentiële demping: framerate-onafhankelijk, en clamp tegen een
    // tabblad dat net weer wakker wordt met een delta van seconden.
    const k = Math.min(1, 1 - Math.exp(-Math.min(delta, 0.5) / DAMP_TAU));
    const w = weights.current;
    w.storm += ((sky === 'storm' ? intensity : 0) - w.storm) * k;
    w.mist += ((sky === 'mist' ? intensity : 0) - w.mist) * k;
    w.sun += ((sky === 'zon' ? intensity : 0) - w.sun) * k;

    // --- onweer -------------------------------------------------------
    const storm = w.storm;
    const stormOn = storm > 0.01;
    if (cloudRef.current) {
      cloudRef.current.visible = stormOn;
      if (stormOn) {
        cloudRef.current.position.y = 3.25 + Math.sin(t * 0.3 + strikePhase * 6) * 0.12;
        cloudRef.current.scale.setScalar(0.55 + storm * 0.55);
      }
    }
    // Twee korte tikken kort na elkaar: een flits is nooit één nette puls.
    const cycle = (t * 0.33 + strikePhase) % 1;
    const flash = cycle < 0.05 ? Math.sin((cycle / 0.05) * Math.PI * 3) ** 2 * storm : 0;
    if (stormOn) {
      for (const mat of cloudMats.current) {
        if (!mat) continue;
        mat.opacity = 0.5 + storm * 0.4;
        mat.emissiveIntensity = flash * 2.2;
      }
    }
    if (gloomRef.current) {
      gloomRef.current.visible = stormOn;
      (gloomRef.current.material as THREE.MeshBasicMaterial).opacity = storm * 0.22;
    }
    if (flashRef.current) {
      flashRef.current.visible = flash > 0.01;
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = flash * 0.3;
    }
    const rain = rainRef.current;
    if (rain) {
      rain.visible = stormOn;
      if (stormOn) {
        // Minder regen bij zwakke storm: de bui groeit mee met het probleem.
        rain.count = Math.max(1, Math.round(RAIN_COUNT * Math.min(1, 0.35 + storm * 0.75)));
        (rain.material as THREE.MeshBasicMaterial).opacity = 0.18 + storm * 0.3;
        for (let i = 0; i < rain.count; i++) {
          const seed = rainSeeds[i]!;
          const fall = ((t * (1.7 + seed.speed) + seed.phase) % 1) * 3.4;
          dummy.position.set(seed.x + fall * 0.09, 3.2 - fall, seed.z);
          dummy.rotation.set(0, 0, 0.16);
          dummy.updateMatrix();
          rain.setMatrixAt(i, dummy.matrix);
        }
        rain.instanceMatrix.needsUpdate = true;
      }
    }

    // --- mist ---------------------------------------------------------
    const fog = w.mist;
    const fogOn = fog > 0.01;
    const mist = mistRef.current;
    if (mist) {
      mist.visible = fogOn;
      if (fogOn) {
        mist.count = Math.max(1, Math.round(MIST_COUNT * Math.min(1, 0.4 + fog * 0.7)));
        (mist.material as THREE.MeshBasicMaterial).opacity = 0.05 + fog * 0.1;
        for (let i = 0; i < mist.count; i++) {
          const seed = mistSeeds[i]!;
          const drift = t * 0.05 * seed.speed + seed.phase * Math.PI * 2;
          dummy.position.set(
            seed.x + Math.cos(drift) * 0.5,
            0.3 + seed.phase * 0.55 + Math.sin(t * 0.25 + seed.phase * 9) * 0.06,
            seed.z + Math.sin(drift) * 0.5,
          );
          dummy.rotation.set(-Math.PI / 2, 0, drift * 0.3);
          // Traag ademen: mist die stilstaat leest als een vlek, niet als mist.
          dummy.scale.setScalar(0.8 + Math.sin(t * 0.35 + seed.phase * 7) * 0.2 + fog * 0.35);
          dummy.updateMatrix();
          mist.setMatrixAt(i, dummy.matrix);
        }
        mist.instanceMatrix.needsUpdate = true;
      }
    }

    // --- helder -------------------------------------------------------
    const sun = w.sun;
    const sunOn = sun > 0.01;
    if (sunRef.current) sunRef.current.visible = sunOn;
    if (sunOn) {
      // Langzaam draaien geeft de bundel diepte zonder te flikkeren.
      if (shaftRef.current) {
        shaftRef.current.rotation.y = t * 0.06 + strikePhase * 6;
        (shaftRef.current.material as THREE.MeshBasicMaterial).opacity =
          (0.05 + sun * 0.06) * clearBoost;
      }
      if (poolRef.current) {
        (poolRef.current.material as THREE.MeshBasicMaterial).opacity =
          (0.06 + sun * 0.1 + Math.sin(t * 0.5 + strikePhase * 4) * 0.012) * clearBoost;
      }
    }
  });

  return (
    <group position={[x, 0, z]}>
      {/* onweer */}
      <group ref={cloudRef} position={[0, 3.25, 0]} visible={false}>
        {clouds.map((c, i) => (
          <mesh key={i} position={[c.x, (i % 2) * 0.16, c.z]} scale={[c.s, c.s * 0.5, c.s]}>
            <sphereGeometry args={[0.85, 8, 6]} />
            <meshStandardMaterial
              ref={(m) => {
                if (m) cloudMats.current[i] = m;
              }}
              color="#1d2136"
              emissive="#cfe0ff"
              emissiveIntensity={0}
              transparent
              opacity={0.85}
              depthWrite={false}
              flatShading
            />
          </mesh>
        ))}
      </group>
      <mesh ref={gloomRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.34, 0]} visible={false}>
        <circleGeometry args={[DISTRICT_RADIUS, 20]} />
        <meshBasicMaterial color="#10132a" transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={flashRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.35, 0]} visible={false}>
        <circleGeometry args={[DISTRICT_RADIUS * 1.1, 20]} />
        <meshBasicMaterial
          color="#dce8ff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <instancedMesh ref={rainRef} args={[undefined, undefined, RAIN_COUNT]} visible={false}>
        <boxGeometry args={[0.016, 0.3, 0.016]} />
        <meshBasicMaterial color="#b6c9e4" transparent opacity={0.3} depthWrite={false} />
      </instancedMesh>

      {/* mist */}
      <instancedMesh ref={mistRef} args={[undefined, undefined, MIST_COUNT]} visible={false}>
        <circleGeometry args={[0.6, 12]} />
        <meshBasicMaterial color="#dfe6ef" transparent opacity={0.1} depthWrite={false} />
      </instancedMesh>

      {/* helder */}
      <group ref={sunRef} visible={false}>
        <mesh ref={shaftRef} position={[0, 1.8, 0]}>
          <cylinderGeometry args={[0.55, DISTRICT_RADIUS * 0.85, 3.4, 14, 1, true]} />
          <meshBasicMaterial
            color={clearColor}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            fog={false}
          />
        </mesh>
        <mesh ref={poolRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.34, 0]}>
          <circleGeometry args={[DISTRICT_RADIUS * 0.85, 22]} />
          <meshBasicMaterial
            color={clearColor}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  );
});

export function Weather(): JSX.Element | null {
  const daylight = useDaylight();
  const perfLow = useAra((s) => s.perfLow);
  const world = useAra((s) => s.world);
  const snapshot = useViewSnapshot();
  const shadowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const snowRef = useRef<THREE.InstancedMesh>(null);
  const foamRefs = useRef<(THREE.Mesh | null)[]>([]);

  const snowSeeds = useMemo(
    () =>
      Array.from({ length: SNOW_COUNT }, (_, i) => ({
        x: ((i * 7919) % 100) / 100 - 0.5,
        z: ((i * 104729) % 100) / 100 - 0.5,
        speed: 0.25 + ((i * 31) % 10) / 25,
        phase: i * 0.7,
      })),
    [],
  );

  const clouds = useMemo(
    () => [
      { radius: 9, speed: 0.011, scale: 4.5, phase: 0 },
      { radius: 13, speed: 0.008, scale: 6, phase: 2.1 },
      { radius: 6, speed: 0.014, scale: 3.5, phase: 4.4 },
    ],
    [],
  );

  const districts = useMemo(
    () => (world ? plotDistricts(world, Object.values(snapshot.sessions), snapshot.now) : []),
    [world, snapshot],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;

    // Wolkschaduwen: alleen overdag zichtbaar, traag drijvend.
    const shadowOpacity = daylight.period === 'night' ? 0 : 0.07;
    shadowRefs.current.forEach((mesh, i) => {
      const c = clouds[i]!;
      if (!mesh) return;
      const a = t * c.speed + c.phase;
      mesh.position.set(Math.cos(a) * c.radius, 0.36, Math.sin(a) * c.radius);
      (mesh.material as THREE.MeshBasicMaterial).opacity = shadowOpacity;
    });

    // Sneeuw boven de Ararat: vallen + respawn.
    const snow = snowRef.current;
    if (snow) {
      const matrix = new THREE.Matrix4();
      snowSeeds.forEach((seed, i) => {
        const fall = ((t * seed.speed + seed.phase) % 1) * 6;
        matrix.makeTranslation(
          SNOW_CENTER.x + seed.x * SNOW_SPREAD + Math.sin(t + seed.phase) * 0.3,
          SNOW_CENTER.y + 3 - fall,
          SNOW_CENTER.z + seed.z * SNOW_SPREAD,
        );
        snow.setMatrixAt(i, matrix);
      });
      snow.instanceMatrix.needsUpdate = true;
    }

    // Schuim op het meer: trage drift-cirkels.
    foamRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const a = t * 0.05 + i * 1.1;
      mesh.position.set(5.5 + Math.cos(a) * (0.8 + i * 0.25), 0.135, 15.9 + Math.sin(a) * (0.7 + i * 0.2));
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 1.5 + i) * 0.12;
    });
  });

  // Zwak toestel: het hele weer eruit. Een signaal dat op 3fps hakkelt liegt
  // over het tempo van de wereld; liever niets dan een verkeerd ritme.
  if (perfLow) return null;

  return (
    <group>
      {clouds.map((cloud, i) => (
        <mesh
          key={i}
          ref={(m) => {
            shadowRefs.current[i] = m;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={cloud.scale}
        >
          <circleGeometry args={[1, 18]} />
          <meshBasicMaterial color="#1a1428" transparent opacity={0.07} depthWrite={false} />
        </mesh>
      ))}

      <instancedMesh ref={snowRef} args={[undefined, undefined, SNOW_COUNT]}>
        <sphereGeometry args={[0.06, 5, 4]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} fog={false} />
      </instancedMesh>

      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            foamRefs.current[i] = m;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.07 + (i % 3) * 0.03, 8]} />
          <meshBasicMaterial color="#e8f4fa" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}

      {/* Districtweer. Een district zonder aflezing staat hier ook — met alles
          op onzichtbaar. Lege lucht is de eerlijke stand, niet zon. */}
      {districts.map((plot) => (
        <DistrictWeather key={plot.id} {...plot} daylight={daylight} />
      ))}
    </group>
  );
}
