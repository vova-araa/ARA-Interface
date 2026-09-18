import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, axialKey, hexDisc, stableHash, WORLD_HEX_RADIUS, type WorldConfig } from '@ara/shared';
import { useAra } from '../store.ts';
import { HEX_SPACING } from '../placements.ts';
import { buildRoads } from './roads.ts';
import { stylize, tickSurface } from './stylize.ts';
import { LAKE_CENTER, LAKE_RADIUS, terrainLift, valueNoise } from './terrain.ts';

// Gedeelde gestileerde materialen voor de platforms (rim + koele schaduw).
// De korrel zit in de shader en niet in een texture: er zijn hier duizenden
// instances van één materiaal, dus een texture zou de hele wereld hetzelfde
// patroon geven én een bind per frame kosten. Een hash van de wereldpositie
// herhaalt zich niet en kost geen enkele draw call.
const BASE_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), {
  rimStrength: 0.35,
  shadowStrength: 0.3,
  // Tuff is poreus vulkanisch steen; de vlekken lopen over tegelgrenzen heen
  // zodat het terrein één gesteente lijkt en geen verzameling losse plaatjes.
  grain: 0.26,
  mottle: 0.1,
  roughVary: 0.18,
});
const DISTRICT_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), {
  rimStrength: 0.5,
  shadowStrength: 0.28,
  // Bewerkt oppervlak: minder korrel dan de ruwe grond, anders leest een
  // district niet meer als iets wat iemand heeft aangelegd.
  grain: 0.11,
  roughVary: 0.1,
});
// De sokkel is het gesteente waar de wereld op staat — grof, gevlekt en
// gelaagd. Eén vlakke kleur maakte er een geverfd blok van.
const ROCK_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#6d5850', roughness: 1 }), {
  rimStrength: 0.22,
  shadowStrength: 0.34,
  grain: 0.3,
  mottle: 0.22,
  strata: 0.18,
  roughVary: 0.14,
});
// Sevan: glans plus een lopende golfnormaal. Het water beweegt dus in het
// licht en niet in de geometrie — de tegels blijven exact waar ze staan.
const WATER_MAT = stylize(
  new THREE.MeshStandardMaterial({ color: '#2e9cc7', roughness: 0.15, metalness: 0.1 }),
  { rim: '#cdefff', rimStrength: 0.4, shadowStrength: 0.12, waves: 1, waveSpeed: 0.85 },
);

const TUFF_PINK = new THREE.Color('#e2a49a'); // Yerevan tuff
const TUFF_DARK = new THREE.Color('#b87c73');
const TUFF_PALE = new THREE.Color('#f0c4b4'); // uitgebleekt, waar de zon staat
const STEPPE = new THREE.Color('#a8a06a'); // droog gras op de hoogvlakte
const BASALT = new THREE.Color('#8a7268'); // kale rots
const SEVAN_BLUE = new THREE.Color('#2e9cc7');
const SEVAN_SHALLOW = new THREE.Color('#57c6d8');
const ROAD = new THREE.Color('#d8cdbd'); // aangestampt grind
const HOVER = new THREE.Color('#fff6e8'); // waar de tegel naartoe kleurt onder de muis

// Hoe hard een aangewezen platform oplicht en hoeveel het uitzet. Het zwelt in
// het vlak en niet omhoog: pods en figuren staan op een vaste hoogte op deze
// tegel, dus een tegel die omhoog komt slokt ze half op.
const HOVER_TINT = 0.42;
const HOVER_RIM_TINT = 0.6;
const HOVER_SWELL = 1.035;
const DISTRICT_Y = -0.11; // basishoogte van het districtplatform
const RIM_Y = 0.315; // de gloeiende rand ligt net op de bovenkant


interface Tiles {
  /** `lift` is de hoogte van deze tegel; zonder dat is de grond een badmat. */
  base: { pos: [number, number, number]; color: THREE.Color; lift: number }[];
  /** `project` maakt de tegel een knop: hij weet welk kantoor hij opent. */
  district: {
    pos: [number, number, number];
    color: THREE.Color;
    borderColor: THREE.Color;
    project: string;
  }[];
  water: { pos: [number, number, number]; color: THREE.Color }[];
  /** Hoe ver de buitenste tegel van het midden ligt, in wereldeenheden. */
  extent: number;
  /** Wegen van de hub naar elk district; zonder die zweven ze los rond. */
  road: { pos: [number, number, number] }[];
}

/**
 * Hoogte uit samenhangende ruis, gesteente uit een eigen hash. Die twee apart
 * houden is met opzet: één bron voor beide koppelt kleur aan hoogte en dan
 * krijg je banden in plaats van vlekken.
 */
function terrainAt(hex: { q: number; r: number }, key: string, distance: number): {
  lift: number;
  color: THREE.Color;
} {
  const rock = (stableHash(`${key}:rock`) % 1000) / 1000;
  // Hoogte komt uit terrain.ts, want het verkeer, de kudde, de monumenten en
  // de sneeuw moeten op exact dezelfde hoogte terechtkomen als deze tegel.
  const lift = terrainLift(hex);
  // De kleur wil nog wel weten hoe hoog hij zit; terugrekenen uit de lift zou
  // de randophoging meenemen en dan kleurt de hele buitenring als bergtop.
  const height = valueNoise(hex.q, hex.r, 5) * 0.72 + valueNoise(hex.q, hex.r, 2) * 0.28;

  // Naar de rand toe loopt het op: de hoogvlakte rond Yerevan. Dat houdt het
  // oog ook binnen de wereld in plaats van er overheen te laten glijden.
  const rim = Math.pow(distance / WORLD_HEX_RADIUS, 2.4);

  // Hoger is kaler. Geen regel, maar zo leest het: bleke tuff in de laagte,
  // steppe halverwege, basalt op de hoogten.
  const color = TUFF_PINK.clone().lerp(TUFF_DARK, 0.15 + height * 0.55);
  if (rock > 0.86) color.lerp(BASALT, 0.45);
  else if (rock > 0.64) color.lerp(STEPPE, 0.22 + rock * 0.18);
  else if (rock < 0.16) color.lerp(TUFF_PALE, 0.45);
  color.lerp(BASALT, Math.min(0.45, rim * 0.6));
  return { lift, color };
}

function computeTiles(world: WorldConfig | null): Tiles {
  const tiles: Tiles = { base: [], district: [], water: [], road: [], extent: 0 };
  const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
  const claimed = new Set<string>();
  const roadKeys = new Set<string>();

  if (world) {
    for (const district of world.districts) {
      const color = new THREE.Color(district.venture.color);
      const tileColor = TUFF_PINK.clone().lerp(color, 0.18);
      for (const project of district.projects) {
        for (const hex of project.hexes) {
          if (lake.has(axialKey(hex))) continue;
          // Eén tegel hoort bij één project. De layout garandeert dat, maar een
          // world.config.json van vóór die garantie ligt nog op schijf tot er
          // opnieuw gemapt is — en twee tegels op dezelfde plek betekent hier:
          // twee kantoren achter dezelfde klik.
          if (claimed.has(axialKey(hex))) continue;
          claimed.add(axialKey(hex));
          const { x, z } = axialToWorld(hex);
          tiles.district.push({
            pos: [x * HEX_SPACING, 0, z * HEX_SPACING],
            color: tileColor,
            borderColor: color,
            project: project.name,
          });
        }
      }
    }

    // Wegen vanaf de hub naar het hart van elk district; het net zelf staat in
    // roads.ts omdat het verkeer erover rijdt en die twee hetzelfde net moeten
    // gebruiken.
    for (const key of buildRoads(world, { claimed, lake }).tiles) roadKeys.add(key);
  }

  // Continuous terrain under everything.
  for (const hex of hexDisc({ q: 0, r: 0 }, WORLD_HEX_RADIUS)) {
    const key = axialKey(hex);
    const { x, z } = axialToWorld(hex);
    // Vóór elke `continue`: ook meer- en districttegels horen bij de omvang
    // van de wereld, en de sokkel moet ze allemaal dragen.
    tiles.extent = Math.max(tiles.extent, Math.hypot(x * HEX_SPACING, z * HEX_SPACING));
    if (lake.has(key)) {
      // Ondiep bij de oever, diep in het midden: één vlakke kleur leest als
      // een sticker, een verloop leest als water.
      const toEdge = Math.max(
        Math.abs(hex.q - LAKE_CENTER.q),
        Math.abs(hex.r - LAKE_CENTER.r),
        Math.abs(hex.q + hex.r - LAKE_CENTER.q - LAKE_CENTER.r),
      );
      tiles.water.push({
        pos: [x * HEX_SPACING, 0, z * HEX_SPACING],
        color: SEVAN_BLUE.clone().lerp(SEVAN_SHALLOW, toEdge / Math.max(1, LAKE_RADIUS)),
      });
      continue;
    }
    if (claimed.has(key)) continue;
    const distance = Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
    const { lift, color } = terrainAt(hex, key, distance);
    if (roadKeys.has(key)) {
      // De weg is de grond zelf, geplaveid: hij volgt dus dezelfde hoogte.
      // Een vlak lint op y=0 zou door de heuvels heen snijden.
      tiles.road.push({ pos: [x * HEX_SPACING, lift, z * HEX_SPACING] });
      continue;
    }
    tiles.base.push({ pos: [x * HEX_SPACING, lift, z * HEX_SPACING], color, lift });
  }
  return tiles;
}

/**
 * `y` is de basishoogte; een tegel die zelf een hoogte meebrengt (pos[1]) telt
 * die erbij op. Zo blijven de platte lagen platte lagen en krijgt alleen het
 * terrein zijn reliëf.
 */
function useInstances(
  items: { pos: [number, number, number]; color?: THREE.Color }[],
  y: number,
  scaleY = 1,
): (mesh: THREE.InstancedMesh | null) => void {
  return (mesh) => {
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    items.forEach((item, i) => {
      matrix.makeScale(1, scaleY, 1);
      matrix.setPosition(item.pos[0], y + item.pos[1], item.pos[2]);
      mesh.setMatrixAt(i, matrix);
      if (item.color) mesh.setColorAt(i, item.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
}

export function HexGround({ world }: { world: WorldConfig | null }): JSX.Element {
  const tiles = useMemo(() => computeTiles(world), [world]);
  const openOffice = useAra((s) => s.openOffice);
  const districtRef = useRef<THREE.InstancedMesh>(null);
  const rimRef = useRef<THREE.InstancedMesh>(null);
  // Het aangewezen project staat in een ref en niet in state: een hover die
  // door de React-boom loopt hertekent de hele wereld bij elke muisbeweging,
  // terwijl er maar twee instance-buffers hoeven te veranderen.
  const hovered = useRef<string | null>(null);

  /** Zet matrices en kleuren van platform + rand; `hover` licht dat project op. */
  const paint = useCallback(
    (hover: string | null) => {
      const platform = districtRef.current;
      const rim = rimRef.current;
      const matrix = new THREE.Matrix4();
      // De rand ligt plat en met zijn punten in lijn met de tegel eronder.
      const rimRotation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.PI / 2, 0, Math.PI / 6, 'YXZ'),
      );
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const color = new THREE.Color();
      tiles.district.forEach((tile, i) => {
        const lit = hover !== null && tile.project === hover;
        const swell = lit ? HOVER_SWELL : 1;
        if (platform) {
          matrix.makeScale(swell, 1, swell);
          matrix.setPosition(tile.pos[0], DISTRICT_Y + tile.pos[1], tile.pos[2]);
          platform.setMatrixAt(i, matrix);
          platform.setColorAt(i, color.copy(tile.color).lerp(HOVER, lit ? HOVER_TINT : 0));
        }
        if (rim) {
          position.set(tile.pos[0], RIM_Y, tile.pos[2]);
          scale.set(swell, swell, 1);
          matrix.compose(position, rimRotation, scale);
          rim.setMatrixAt(i, matrix);
          rim.setColorAt(i, color.copy(tile.borderColor).lerp(HOVER, lit ? HOVER_RIM_TINT : 0));
        }
      });
      for (const mesh of [platform, rim]) {
        if (!mesh) continue;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
    [tiles],
  );

  // Eerste opbouw én elke keer dat de wereld verandert: dezelfde functie, zodat
  // er geen tweede plek is waar de stand van deze tegels wordt bepaald.
  useEffect(() => paint(hovered.current), [paint]);

  const projectAt = (event: ThreeEvent<PointerEvent | MouseEvent>): string | null =>
    event.instanceId === undefined ? null : (tiles.district[event.instanceId]?.project ?? null);

  const setHover = (project: string | null): void => {
    if (hovered.current === project) return;
    hovered.current = project;
    // De cursor is de helft van de terugkoppeling: hij zegt "hier kun je op
    // drukken" vóórdat je drukt. De kleur zegt waarop precies.
    document.body.style.cursor = project ? 'pointer' : 'default';
    paint(project);
  };

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    WATER_MAT.color.copy(SEVAN_BLUE).offsetHSL(0, 0, Math.sin(t * 1.4) * 0.03);
    // Eén uniform per frame voor het hele meer; de golven zelf kosten niets
    // extra's, ze rekenen mee in fragmenten die toch al getekend worden.
    tickSurface(WATER_MAT, t);
  });

  // Hexagonal prism: cylinder with 6 radial segments; rotate 30° so flat side faces camera nicely.
  return (
    <group>
      {/* Dikkere look: hogere prisma's, naar beneden verdikt zodat de
          bovenkanten (waar pods/figuren op staan) op dezelfde hoogte blijven. */}
      <instancedMesh
        key={`base-${tiles.base.length}`}
        args={[undefined, undefined, Math.max(1, tiles.base.length)]}
        // Het prisma is bewust veel te hoog (2.4) en hangt ver onder de wereld.
        // Een tegel die omhoog komt mag geen gat onder zich laten zien, en een
        // hoge zuil kost niets extra: het is dezelfde instance.
        ref={useInstances(tiles.base, -1.05)}
        receiveShadow
        castShadow
        material={BASE_MAT}
      >
        <cylinderGeometry args={[0.98, 0.98, 2.4, 6]} />
      </instancedMesh>

      {/* Districten als dikke verhoogde platforms (referentie-look).

          Het platform is óók de knop naar het kantoor. Het projectlabel erboven
          is 20 pixels hoog en op een telefoon niet te raken; de tegel eronder
          is het doel dat je met een duim haalt. Pods en figuren staan hier
          bovenop en stoppen hun eigen klik (Pods.tsx), dus een pod selecteert
          nog steeds zijn sessie en bereikt deze tegel nooit. */}
      <instancedMesh
        key={`district-${tiles.district.length}`}
        args={[undefined, undefined, Math.max(1, tiles.district.length)]}
        ref={districtRef}
        receiveShadow
        material={DISTRICT_MAT}
        onPointerMove={(e) => setHover(projectAt(e))}
        onPointerOut={() => setHover(null)}
        onClick={(e) => {
          const project = projectAt(e);
          if (!project) return;
          // Verder naar achteren ligt alleen nog grond; wie wél een tegel raakt
          // heeft niets gemist (en `onPointerMissed` mag niet deselecteren).
          e.stopPropagation();
          setHover(null); // het kantoor dekt de wereld af: laat geen gloed achter
          openOffice(project);
        }}
      >
        <cylinderGeometry args={[0.99, 0.9, 0.84, 6]} />
      </instancedMesh>

      {/* Glowing district borders: thin emissive rims. Geen eigen muisafhandeling:
          de rand hoort bij het platform en zou als los doel alleen maar de klik
          van de tegel eronder afvangen. */}
      <instancedMesh
        key={`rim-${tiles.district.length}`}
        args={[undefined, undefined, Math.max(1, tiles.district.length)]}
        ref={rimRef}
      >
        <torusGeometry args={[0.92, 0.085, 6, 6]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.72}
          toneMapped={false}
        />
      </instancedMesh>

      {/* Het sokkelblok. De tegelprisma's hangen 1,2 onder de wereld zodat een
          verhoogde tegel geen gat laat zien — maar van opzij werd dat een
          pilarenwoud dat in de lucht zweeft. Dit blok vangt dat op: de tegels
          zijn de korst, dit is het gesteente eronder. Iets kleiner dan de
          tegelschijf, zodat de rand overhangt in plaats van als een taartrand
          uit te steken. */}
      <mesh position={[0, -6.5, 0]} receiveShadow>
        {/* De tegelprisma's zíjn de klif — die zagen er goed uit, ze hingen
            alleen in de lucht. Dit blok zit er precies onder (de laagste
            tegelbodem ligt op ~-2,3) en loopt taps toe, zodat de wereld op
            gesteente staat in plaats van op een dienblad. Twaalf zijden, want
            een zeshoek reikt op zijn vlakke kanten maar tot r·cos30° en daar
            steken de buitenste tegels (~24) doorheen. */}
        {/* Straal uit de gemeten uiterste tegel, niet uit een getal dat iemand
            ooit heeft ingetikt: toen de wereld kromp stak de sokkel er als een
            dienblad onderuit, en dat merk je pas op een screenshot. */}
        <cylinderGeometry args={[tiles.extent + 1.1, (tiles.extent + 1.1) * 0.66, 8.4, 12]} />
        <primitive object={ROCK_MAT} attach="material" />
      </mesh>

      {/* Wegen: dezelfde prisma's, andere kleur, een haar hoger zodat de rand
          zichtbaar blijft tegen de grond eromheen. */}
      <instancedMesh
        key={`road-${tiles.road.length}`}
        args={[undefined, undefined, Math.max(1, tiles.road.length)]}
        ref={useInstances(tiles.road.map((t) => ({ ...t, color: ROAD })), -1.03)}
        receiveShadow
        material={BASE_MAT}
      >
        <cylinderGeometry args={[0.88, 0.88, 2.4, 6]} />
      </instancedMesh>

      {/* Sevan water */}
      <instancedMesh
        key={`water-${tiles.water.length}`}
        args={[undefined, undefined, Math.max(1, tiles.water.length)]}
        ref={useInstances(tiles.water, -0.06)}
        material={WATER_MAT}
      >
        <cylinderGeometry args={[0.98, 0.98, 0.22, 6]} />
      </instancedMesh>
    </group>
  );
}
