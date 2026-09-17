import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, axialKey, hexDisc, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { stylize } from './stylize.ts';

// Gedeelde gestileerde materialen voor de platforms (rim + koele schaduw).
const BASE_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), {
  rimStrength: 0.35,
  shadowStrength: 0.3,
});
const DISTRICT_MAT = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), {
  rimStrength: 0.5,
  shadowStrength: 0.28,
});

const TUFF_PINK = new THREE.Color('#e2a49a'); // Yerevan tuff
const TUFF_DARK = new THREE.Color('#b87c73');
const TUFF_PALE = new THREE.Color('#f0c4b4'); // uitgebleekt, waar de zon staat
const STEPPE = new THREE.Color('#a8a06a'); // droog gras op de hoogvlakte
const BASALT = new THREE.Color('#8a7268'); // kale rots
const SEVAN_BLUE = new THREE.Color('#2e9cc7');
const SEVAN_SHALLOW = new THREE.Color('#57c6d8');

const LAKE_CENTER = { q: -2, r: 10 };
const LAKE_RADIUS = 2;

interface Tiles {
  /** `lift` is de hoogte van deze tegel; zonder dat is de grond een badmat. */
  base: { pos: [number, number, number]; color: THREE.Color; lift: number }[];
  district: { pos: [number, number, number]; color: THREE.Color; borderColor: THREE.Color }[];
  water: { pos: [number, number, number]; color: THREE.Color }[];
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
  const rim = Math.pow(distance / 13, 2.4);
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
  const tiles: Tiles = { base: [], district: [], water: [] };
  const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
  const claimed = new Set<string>();

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
  }

  // Continuous terrain under everything.
  for (const hex of hexDisc({ q: 0, r: 0 }, 13)) {
    const key = axialKey(hex);
    const { x, z } = axialToWorld(hex);
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
  const waterRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (waterRef.current) {
      const t = clock.elapsedTime;
      waterRef.current.color
        .copy(SEVAN_BLUE)
        .offsetHSL(0, 0, Math.sin(t * 1.4) * 0.03);
    }
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

      {/* Sevan water */}
      <instancedMesh
        key={`water-${tiles.water.length}`}
        args={[undefined, undefined, Math.max(1, tiles.water.length)]}
        ref={useInstances(tiles.water, -0.06)}
      >
        <cylinderGeometry args={[0.98, 0.98, 0.22, 6]} />
        <meshStandardMaterial ref={waterRef} color="#2e9cc7" roughness={0.15} metalness={0.1} />
      </instancedMesh>
    </group>
  );
}
