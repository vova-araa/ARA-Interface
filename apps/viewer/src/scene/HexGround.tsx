import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, axialKey, hexDisc, stableHash, WORLD_HEX_RADIUS, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { buildRoads } from './roads.ts';
import { stylize, tickSurface } from './stylize.ts';

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

// Het meer schoof mee naar binnen toen de wereld kromp: op r=10 lag het buiten
// de nieuwe schijf en was het simpelweg weg.
const LAKE_CENTER = { q: -2, r: 6 };
const LAKE_RADIUS = 2;

interface Tiles {
  /** `lift` is de hoogte van deze tegel; zonder dat is de grond een badmat. */
  base: { pos: [number, number, number]; color: THREE.Color; lift: number }[];
  district: { pos: [number, number, number]; color: THREE.Color; borderColor: THREE.Color }[];
  water: { pos: [number, number, number]; color: THREE.Color }[];
  /** Hoe ver de buitenste tegel van het midden ligt, in wereldeenheden. */
  extent: number;
  /** Wegen van de hub naar elk district; zonder die zweven ze los rond. */
  road: { pos: [number, number, number] }[];
}

/**
 * Waardenruis over een grover raster dan de tegels zelf, met smoothstep tussen
 * de roosterpunten. Dat is het hele verschil tussen landschap en puin: een
 * hash per tegel geeft buren die niets met elkaar te maken hebben, dus een
 * veld losse zuilen. Hier hangt een tegel samen met zijn omgeving, en dan
 * ontstaan er glooiingen.
 *
 * Deterministisch — dezelfde wereld ziet er op elke machine hetzelfde uit, en
 * een screenshot van gisteren blijft vergelijkbaar met die van vandaag.
 */
function valueNoise(q: number, r: number, scale: number): number {
  const at = (cq: number, cr: number): number => (stableHash(`terr:${cq}:${cr}`) % 1000) / 1000;
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const fq = q / scale;
  const fr = r / scale;
  const q0 = Math.floor(fq);
  const r0 = Math.floor(fr);
  const tq = ease(fq - q0);
  const tr = ease(fr - r0);
  return mix(
    mix(at(q0, r0), at(q0 + 1, r0), tq),
    mix(at(q0, r0 + 1), at(q0 + 1, r0 + 1), tq),
    tr,
  );
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
  // Twee octaven: de grove geeft de glooiing, de fijne haalt het vlakke eraf.
  const height = valueNoise(hex.q, hex.r, 5) * 0.72 + valueNoise(hex.q, hex.r, 2) * 0.28;
  const rock = (stableHash(`${key}:rock`) % 1000) / 1000;

  // Naar de rand toe loopt het op: de hoogvlakte rond Yerevan. Dat houdt het
  // oog ook binnen de wereld in plaats van er overheen te laten glijden.
  const rim = Math.pow(distance / WORLD_HEX_RADIUS, 2.4);
  const lift = -0.04 + height * 0.5 + rim * 1.1;

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
          claimed.add(axialKey(hex));
          const { x, z } = axialToWorld(hex);
          tiles.district.push({
            pos: [x * HEX_SPACING, 0, z * HEX_SPACING],
            color: tileColor,
            borderColor: color,
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

      {/* Districten als dikke verhoogde platforms (referentie-look) */}
      <instancedMesh
        key={`district-${tiles.district.length}`}
        args={[undefined, undefined, Math.max(1, tiles.district.length)]}
        ref={useInstances(tiles.district, -0.11)}
        receiveShadow
        material={DISTRICT_MAT}
      >
        <cylinderGeometry args={[0.99, 0.9, 0.84, 6]} />
      </instancedMesh>

      {/* Glowing district borders: thin emissive rims */}
      <instancedMesh
        key={`rim-${tiles.district.length}`}
        args={[undefined, undefined, Math.max(1, tiles.district.length)]}
        ref={(mesh) => {
          if (!mesh) return;
          const matrix = new THREE.Matrix4();
          // Lay the hex ring flat and align its vertices with the pointy-top tiles.
          const rotation = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(Math.PI / 2, 0, Math.PI / 6, 'YXZ'),
          );
          const scale = new THREE.Vector3(1, 1, 1);
          const position = new THREE.Vector3();
          tiles.district.forEach((tile, i) => {
            position.set(tile.pos[0], 0.315, tile.pos[2]);
            matrix.compose(position, rotation, scale);
            mesh.setMatrixAt(i, matrix);
            mesh.setColorAt(i, tile.borderColor);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
        }}
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
