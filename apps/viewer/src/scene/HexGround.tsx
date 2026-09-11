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
const TUFF_DARK = new THREE.Color('#c98d84');
const SEVAN_BLUE = new THREE.Color('#2e9cc7');

const LAKE_CENTER = { q: -2, r: 10 };
const LAKE_RADIUS = 2;

interface Tiles {
  base: { pos: [number, number, number]; color: THREE.Color }[];
  district: { pos: [number, number, number]; color: THREE.Color; borderColor: THREE.Color }[];
  water: { pos: [number, number, number] }[];
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
      tiles.water.push({ pos: [x * HEX_SPACING, 0, z * HEX_SPACING] });
      continue;
    }
    if (claimed.has(key)) continue;
    const noise = (stableHash(key) % 100) / 100;
    tiles.base.push({
      pos: [x * HEX_SPACING, 0, z * HEX_SPACING],
      // Basisgrond iets donkerder zodat de verhoogde platforms poppen.
      color: TUFF_PINK.clone().lerp(TUFF_DARK, 0.35 + noise * 0.5),
    });
  }
  return tiles;
}

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
      matrix.setPosition(item.pos[0], y, item.pos[2]);
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
        ref={useInstances(tiles.base, -0.08)}
        receiveShadow
        material={BASE_MAT}
      >
        <cylinderGeometry args={[0.98, 0.98, 0.46, 6]} />
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
