import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  axialKey,
  axialToWorld,
  hexDisc,
  stableHash,
  WORLD_HEX_RADIUS,
  type WorldConfig,
} from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';
import { buildRoads, groundTop, openGround } from './roads.ts';
import { useDaylight, type Daylight } from './daylight.ts';
import { windTime } from './wind.ts';

/**
 * Seizoenen — de achtergrond van de wereld, niet zijn toestand.
 *
 * Deze laag beweert niets over sessies, agents of storingen. Ze zegt alleen
 * welke tijd van het jaar het is: sneeuw die blijft liggen, kale of bloeiende
 * bomen, vallend blad, een bui die over de héle wereld trekt en grond die
 * daarna nog natglimt.
 *
 * Verhouding tot Weather.tsx (het toestandsweer), want die twee mogen elkaar
 * niet tegenspreken:
 *
 *   - schaal    — seizoensweer ligt over de hele schijf, gelijk verdeeld;
 *                 toestandsweer zit in een schijf van 2,6 eenheden bóven één
 *                 district. Een verschijnsel dat maar op één plek hangt is dus
 *                 altijd een uitspraak over dat district.
 *   - woordenschat — bliksem, mist en zonnebundel horen uitsluitend bij de
 *                 toestand; sneeuwdek, blad, bloesem en natte grond horen
 *                 uitsluitend bij het seizoen. Geen enkel element komt in
 *                 beide lagen voor.
 *   - tempo     — het seizoen verschuift per dag, de bui per uur; het
 *                 toestandsweer klapt binnen enkele seconden om.
 *   - hoogte    — seizoensneerslag valt van ~10 hoog over alles heen; de
 *                 districtbui valt van 3,2 onder een eigen donkere wolk.
 *
 * Kortom: regen zonder wolk erboven en zonder grens eromheen is het weer;
 * een wolk die boven één district hangt is een melding.
 */

/**
 * Het meer staat ook in HexGround.tsx — dezelfde schuld als `groundTop` in
 * roads.ts, en om dezelfde reden: zonder deze twee getallen legt de winter
 * sneeuw ónder het wateroppervlak. Verschuift het meer daar, dan moet dit mee.
 */
const LAKE_CENTER = { q: -2, r: 6 };
const LAKE_RADIUS = 2;
/** Bovenkant van een watertegel (prisma van 0,22 op y=-0,06). */
const LAKE_TOP = 0.05;

const TREE_MAX = 56;
const LEAF_MAX = 120;
const PRECIP_MAX = 180;

interface Tile {
  x: number;
  z: number;
  y: number;
  /** Straal van de tegel eronder: wegen zijn smaller dan gewone grond. */
  radius: number;
  /** Vanaf welk sneeuwdek deze tegel wit wordt — anders valt alles tegelijk om. */
  threshold: number;
  water: boolean;
}

interface Tree {
  x: number;
  z: number;
  y: number;
  scale: number;
  phase: number;
}

interface Terrain {
  tiles: Tile[];
  /** Tegels die glans kunnen vangen; het meer glimt uit zichzelf al. */
  dry: Tile[];
  trees: Tree[];
  /** Straal van de wereld in wereldeenheden — de regen moet hem net dekken. */
  extent: number;
}

const rand01 = (key: string): number => (stableHash(key) % 1000) / 1000;

function buildTerrain(world: WorldConfig | null): Terrain {
  const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
  const claimed = new Set<string>();
  for (const district of world?.districts ?? []) {
    for (const project of district.projects) {
      for (const hex of project.hexes) claimed.add(axialKey(hex));
    }
  }
  const roads = buildRoads(world, { claimed, lake }).tiles;

  const tiles: Tile[] = [];
  let extent = 0;
  for (const hex of hexDisc({ q: 0, r: 0 }, WORLD_HEX_RADIUS)) {
    const key = axialKey(hex);
    // Districtplatforms blijven sneeuwvrij. Niet uit luiheid: daar staat het
    // werk, en een district moet afleesbaar blijven onder elk seizoen.
    if (claimed.has(key)) continue;
    const { x, z } = axialToWorld(hex);
    const at = { x: x * HEX_SPACING, z: z * HEX_SPACING };
    extent = Math.max(extent, Math.hypot(at.x, at.z));
    const water = lake.has(key);
    tiles.push({
      ...at,
      y: water ? LAKE_TOP : groundTop(hex),
      radius: water || !roads.has(key) ? 0.98 : 0.88,
      // Het meer bevriest als laatste; de rand van de wereld als eerste.
      threshold: water ? 0.62 + rand01(`ijs:${key}`) * 0.3 : rand01(`sneeuw:${key}`) * 0.5,
      water,
    });
  }

  // Boomgaard op de vrije grond: de bomen zijn van deze laag, want zij dragen
  // het seizoen (kaal, bloesem, groen, verkleurd). Ze staan nergens anders.
  const trees: Tree[] = [];
  for (const hex of openGround({ claimed, lake, roads })) {
    const key = axialKey(hex);
    if (rand01(`boom:${key}`) > 0.28) continue;
    if (trees.length >= TREE_MAX) break;
    const { x, z } = axialToWorld(hex);
    trees.push({
      x: x * HEX_SPACING + (rand01(`bx:${key}`) - 0.5) * 0.55,
      z: z * HEX_SPACING + (rand01(`bz:${key}`) - 0.5) * 0.55,
      y: groundTop(hex),
      scale: 0.8 + rand01(`bs:${key}`) * 0.55,
      phase: rand01(`bf:${key}`) * Math.PI * 2,
    });
  }

  return { tiles, dry: tiles.filter((t) => !t.water), trees, extent };
}

/** Deterministische strooiing over de hele wereldschijf — nooit Math.random. */
function fieldSeeds(key: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    a: rand01(`${key}-a-${i}`) * Math.PI * 2,
    // sqrt, anders klit alles in het midden van de schijf.
    r: Math.sqrt(rand01(`${key}-r-${i}`)),
    speed: 0.7 + rand01(`${key}-s-${i}`) * 0.6,
    spin: (rand01(`${key}-w-${i}`) - 0.5) * 3,
    offset: rand01(`${key}-o-${i}`),
    tint: 0.75 + rand01(`${key}-t-${i}`) * 0.45,
  }));
}

export interface SeasonsProps {
  /** Valt terug op de store; zo werkt zowel `<Seasons />` als `<Seasons world={world} />`. */
  world?: WorldConfig | null;
  /** Meegeven scheelt een tweede klok-hook, maar is niet verplicht. */
  daylight?: Daylight;
}

export function Seasons({ world: worldProp, daylight: daylightProp }: SeasonsProps): JSX.Element | null {
  const storeWorld = useAra((s) => s.world);
  const perfLow = useAra((s) => s.perfLow);
  const ownDaylight = useDaylight();
  const daylight = daylightProp ?? ownDaylight;
  const world = worldProp === undefined ? storeWorld : worldProp;

  const terrain = useMemo(() => buildTerrain(world), [world]);
  const leafSeeds = useMemo(() => fieldSeeds('blad', LEAF_MAX), []);
  const precipSeeds = useMemo(() => fieldSeeds('neerslag', PRECIP_MAX), []);

  // Geometrieën met hun voet op y=0: dan is de instance-positie de bovenkant
  // van de tegel en hoeft de hoogte alleen nog geschaald te worden.
  const capGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
    geo.translate(0, 0.5, 0);
    return geo;
  }, []);
  const sheenGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(1, 1, 0.02, 6);
    geo.translate(0, 0.012, 0);
    return geo;
  }, []);
  const trunkGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.055, 0.085, 0.62, 5);
    geo.translate(0, 0.31, 0);
    return geo;
  }, []);
  const twigGeo = useMemo(() => {
    const geo = new THREE.ConeGeometry(0.2, 0.46, 5);
    geo.translate(0, 0.23, 0);
    return geo;
  }, []);
  const crownGeo = useMemo(() => new THREE.IcosahedronGeometry(0.42, 0), []);

  const snowRef = useRef<THREE.InstancedMesh>(null);
  const sheenRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const twigRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const leafRef = useRef<THREE.InstancedMesh>(null);
  const precipRef = useRef<THREE.InstancedMesh>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tint = useMemo(() => new THREE.Color(), []);
  // Laatst getekende sneeuwstand: het dek verandert per dag, dus honderden
  // matrices per frame herschrijven is werk voor niets.
  const lastCover = useRef(-1);
  const lastWet = useRef(-1);
  const colored = useRef(false);

  useFrame(() => {
    const wind = windTime.value;
    const { snowCover, wetGround, precip, windScale, leafTint, bareness, seasonMix } = daylight;

    // --- sneeuwdek ------------------------------------------------------
    const snow = snowRef.current;
    if (snow) {
      snow.visible = snowCover > 0.01;
      if (snow.visible && Math.abs(snowCover - lastCover.current) > 0.004) {
        lastCover.current = snowCover;
        let n = 0;
        for (const tile of terrain.tiles) {
          // Onder zijn drempel krijgt een tegel niets: zo kruipt de sneeuw de
          // wereld in en smelt hij er ook weer uit, in plaats van te knipperen.
          const local = (snowCover - tile.threshold) / Math.max(0.05, 1 - tile.threshold);
          if (local <= 0) continue;
          const depth = Math.min(1, local) * 0.16;
          dummy.position.set(tile.x, tile.y, tile.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(tile.radius * 0.995, depth, tile.radius * 0.995);
          dummy.updateMatrix();
          snow.setMatrixAt(n, dummy.matrix);
          n += 1;
        }
        snow.count = n;
        snow.instanceMatrix.needsUpdate = true;
      }
    }

    // --- natte grond ----------------------------------------------------
    // Nat gesteente is donkerder én spiegelt: het vangt de lucht en het
    // zonlicht terug. Daarom een glanzende laag over dezelfde tegels en niet
    // een plas die ergens los ligt.
    const sheen = sheenRef.current;
    if (sheen) {
      sheen.visible = wetGround > 0.02;
      const mat = sheen.material as THREE.MeshStandardMaterial;
      mat.opacity = wetGround * 0.5;
      mat.roughness = 0.16 - wetGround * 0.1;
      if (sheen.visible && Math.abs(wetGround - lastWet.current) > 0.05) {
        lastWet.current = wetGround;
        terrain.dry.forEach((tile, i) => {
          dummy.position.set(tile.x, tile.y, tile.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(tile.radius * 0.99, 1, tile.radius * 0.99);
          dummy.updateMatrix();
          sheen.setMatrixAt(i, dummy.matrix);
        });
        sheen.count = terrain.dry.length;
        sheen.instanceMatrix.needsUpdate = true;
      }
    }

    // --- bomen ----------------------------------------------------------
    const crown = crownRef.current;
    const twig = twigRef.current;
    const trunk = trunkRef.current;
    if (crown && twig && trunk) {
      const leafy = 1 - bareness;
      const sway = 0.045 * windScale;
      terrain.trees.forEach((tree, i) => {
        const bend = Math.sin(wind * 1.6 + tree.phase) * sway;
        dummy.position.set(tree.x, tree.y, tree.z);
        dummy.rotation.set(0, tree.phase, 0);
        dummy.scale.setScalar(tree.scale);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);

        // De takken staan er altijd; ze zijn de boom zodra het blad weg is.
        dummy.position.set(tree.x, tree.y + 0.55 * tree.scale, tree.z);
        dummy.rotation.set(bend * 0.6, tree.phase, bend);
        dummy.scale.setScalar(tree.scale);
        dummy.updateMatrix();
        twig.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + (0.72 + leafy * 0.06) * tree.scale, tree.z);
        dummy.rotation.set(bend, tree.phase * 1.7, bend * 0.7);
        dummy.scale.setScalar(tree.scale * (0.18 + leafy * 0.92));
        dummy.updateMatrix();
        crown.setMatrixAt(i, dummy.matrix);
      });
      trunk.instanceMatrix.needsUpdate = true;
      twig.instanceMatrix.needsUpdate = true;
      crown.instanceMatrix.needsUpdate = true;
      crown.visible = leafy > 0.06;
      (crown.material as THREE.MeshStandardMaterial).color.set(leafTint);
    }

    // --- vallend blad ---------------------------------------------------
    // Alleen in de herfst, en dan met de wind mee: de bladeren waaien verder
    // opzij dan ze vallen. Dat is het verschil tussen herfst en confetti.
    const leaves = leafRef.current;
    if (leaves) {
      const amount = Math.max(0, (seasonMix.herfst - 0.22) / 0.78);
      leaves.visible = amount > 0.02;
      if (leaves.visible) {
        leaves.count = Math.max(1, Math.round(LEAF_MAX * amount));
        const mat = leaves.material as THREE.MeshStandardMaterial;
        mat.color.set(leafTint);
        mat.opacity = 0.65 + amount * 0.3;
        const drift = 1.4 * windScale;
        for (let i = 0; i < leaves.count; i += 1) {
          const seed = precipLeaf(leafSeeds, i);
          const cycle = (wind * 0.09 * seed.speed + seed.offset) % 1;
          const fall = cycle * 6.2;
          const radius = seed.r * terrain.extent;
          dummy.position.set(
            Math.cos(seed.a) * radius + Math.sin(wind * 0.8 + seed.offset * 9) * drift,
            6.2 - fall,
            Math.sin(seed.a) * radius + Math.cos(wind * 0.6 + seed.offset * 7) * drift * 0.7,
          );
          dummy.rotation.set(wind * seed.spin, wind * seed.spin * 0.7, wind * seed.spin * 0.5);
          dummy.scale.setScalar(seed.tint);
          dummy.updateMatrix();
          leaves.setMatrixAt(i, dummy.matrix);
        }
        leaves.instanceMatrix.needsUpdate = true;
      }
    }

    // --- neerslag -------------------------------------------------------
    const fall = precipRef.current;
    if (fall) {
      const snowing = precip.kind === 'sneeuw';
      fall.visible = precip.intensity > 0.02;
      if (fall.visible) {
        fall.count = Math.max(1, Math.round(PRECIP_MAX * Math.min(1, 0.3 + precip.intensity)));
        const mat = fall.material as THREE.MeshBasicMaterial;
        mat.color.set(snowing ? '#ffffff' : '#c3d6ea');
        mat.opacity = snowing ? 0.5 + precip.intensity * 0.3 : 0.16 + precip.intensity * 0.28;
        const speed = snowing ? 0.9 : 6.4;
        const top = 10;
        const height = top - 0.3;
        for (let i = 0; i < fall.count; i += 1) {
          const seed = precipLeaf(precipSeeds, i);
          const cycle = (wind * (speed / height) * seed.speed + seed.offset) % 1;
          const y = top - cycle * height;
          const radius = seed.r * (terrain.extent + 2);
          const sideways = snowing
            ? Math.sin(wind * 0.7 + seed.offset * 11) * 0.9 * windScale
            : (1 - cycle) * 0.5 * windScale;
          dummy.position.set(
            Math.cos(seed.a) * radius + sideways,
            y,
            Math.sin(seed.a) * radius + sideways * 0.4,
          );
          // Regen hangt schuin in de wind, sneeuw tuimelt plat rond.
          dummy.rotation.set(0, 0, snowing ? wind * seed.spin * 0.4 : 0.1 * windScale);
          if (snowing) dummy.scale.set(2.4, 0.16, 2.4);
          else dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          fall.setMatrixAt(i, dummy.matrix);
        }
        fall.instanceMatrix.needsUpdate = true;
      }
    }

    // Kleurvariatie per blad één keer zetten; daarna vermenigvuldigt de
    // instance-kleur alleen nog met de seizoenskleur van het materiaal.
    if (!colored.current && leaves) {
      for (let i = 0; i < LEAF_MAX; i += 1) {
        const v = leafSeeds[i]!.tint;
        leaves.setColorAt(i, tint.setRGB(v, v * 0.94, v * 0.88));
      }
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
      colored.current = true;
    }
  });

  // Zwak toestel: sier gaat eruit. Het seizoen draagt geen informatie over het
  // werk, dus het is het eerste dat mag sneuvelen — in tegenstelling tot de
  // ramen en de lantaarns, die iets betekenen.
  if (perfLow) return null;

  return (
    <group>
      {/* sneeuw die blijft liggen */}
      <instancedMesh
        ref={snowRef}
        args={[undefined, undefined, Math.max(1, terrain.tiles.length)]}
        frustumCulled={false}
        receiveShadow
        visible={false}
      >
        <primitive object={capGeo} attach="geometry" />
        <meshStandardMaterial color="#f4f8ff" roughness={0.78} metalness={0} flatShading />
      </instancedMesh>

      {/* natte grond: donkerder én spiegelend */}
      <instancedMesh
        ref={sheenRef}
        args={[undefined, undefined, Math.max(1, terrain.dry.length)]}
        frustumCulled={false}
        visible={false}
      >
        <primitive object={sheenGeo} attach="geometry" />
        <meshStandardMaterial
          color="#1d2430"
          roughness={0.1}
          metalness={0.5}
          envMapIntensity={1.6}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </instancedMesh>

      {/* boomgaard */}
      <instancedMesh
        ref={trunkRef}
        args={[undefined, undefined, Math.max(1, terrain.trees.length)]}
        frustumCulled={false}
        castShadow
      >
        <primitive object={trunkGeo} attach="geometry" />
        <meshStandardMaterial color="#6b4f3a" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh
        ref={twigRef}
        args={[undefined, undefined, Math.max(1, terrain.trees.length)]}
        frustumCulled={false}
        castShadow
      >
        <primitive object={twigGeo} attach="geometry" />
        <meshStandardMaterial color="#5b4534" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh
        ref={crownRef}
        args={[undefined, undefined, Math.max(1, terrain.trees.length)]}
        frustumCulled={false}
        castShadow
      >
        <primitive object={crownGeo} attach="geometry" />
        <meshStandardMaterial color="#4f8f3d" roughness={0.85} flatShading />
      </instancedMesh>

      {/* vallend blad */}
      <instancedMesh
        ref={leafRef}
        args={[undefined, undefined, LEAF_MAX]}
        frustumCulled={false}
        visible={false}
      >
        <planeGeometry args={[0.2, 0.14]} />
        <meshStandardMaterial
          side={THREE.DoubleSide}
          vertexColors
          color="#d98b2b"
          roughness={0.7}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </instancedMesh>

      {/* regen of sneeuwval over de hele wereld */}
      <instancedMesh
        ref={precipRef}
        args={[undefined, undefined, PRECIP_MAX]}
        frustumCulled={false}
        visible={false}
      >
        <boxGeometry args={[0.02, 0.3, 0.02]} />
        <meshBasicMaterial color="#c3d6ea" transparent opacity={0.25} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

/** Zaadje ophalen zonder non-null-assertion op elke aanroepplek. */
function precipLeaf(
  seeds: { a: number; r: number; speed: number; spin: number; offset: number; tint: number }[],
  i: number,
) {
  return seeds[i] ?? { a: 0, r: 0, speed: 1, spin: 0, offset: 0, tint: 1 };
}
