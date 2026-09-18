import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';

/**
 * Props-clutter per district (referentie-look): rode kratstapels,
 * zonnepanelen, knipperende antennes, vaten, koepeltjes. Deterministisch
 * geplaatst (stableHash) zodat de wereld nooit verspringt.
 *
 * Alles staat stil. Dat is precies waarom het in instanced meshes hoort en
 * niet in React-componenten: de vorige versie bouwde per prop een eigen
 * boompje van `<mesh>`-en met inline geometrie, dus ~150 losse geometrieën en
 * evenveel draw calls voor clutter die nooit beweegt. Nu is het negen
 * instanced meshes — één per onderdeelsoort — met de matrices één keer gezet.
 * De enige uitzondering is het bakenlampje van de antenne; dat knippert, en
 * dat gebeurt via de instance-kleur zodat elke antenne zijn eigen fase houdt
 * (allemaal tegelijk knipperen leest als één machine in plaats van als een
 * wereld).
 */

// --- gedeelde geometrie ------------------------------------------------
const CRATE_GEO = new THREE.BoxGeometry(0.15, 0.15, 0.15);
const SOLAR_POLE_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.2, 5);
const SOLAR_PANEL_GEO = new THREE.BoxGeometry(0.42, 0.02, 0.28);
const MAST_GEO = new THREE.CylinderGeometry(0.012, 0.035, 0.56, 5);
const RING_GEO = new THREE.TorusGeometry(0.07, 0.008, 5, 10);
const BEACON_GEO = new THREE.SphereGeometry(0.035, 8, 6);
const BARREL_GEO = new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8);
const DOME_TOP_GEO = new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const DOME_BASE_GEO = new THREE.CylinderGeometry(0.24, 0.26, 0.06, 10);

// --- gedeelde materialen -----------------------------------------------
// Wit waar de kleur per exemplaar uit `setColorAt` komt. Let op: géén
// `vertexColors` — met die vlag aan verwacht de shader een `color`-attribuut
// op de geometrie, dat er niet is, en dan begint vColor op (0,0,0) en is elk
// exemplaar zwart. instanceColor werkt juist zónder die vlag.
const CRATE_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const BARREL_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const DOME_TOP_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
const DOME_BASE_MAT = new THREE.MeshStandardMaterial({ color: '#8f8578' });
const SOLAR_POLE_MAT = new THREE.MeshStandardMaterial({ color: '#8b95a5' });
const SOLAR_PANEL_MAT = new THREE.MeshStandardMaterial({
  color: '#1d3a6e',
  metalness: 0.6,
  roughness: 0.25,
  emissive: '#274b8f',
  emissiveIntensity: 0.25,
});
const STEEL_MAT = new THREE.MeshStandardMaterial({ color: '#aab4c0', metalness: 0.5 });
/**
 * Het baken is onbelicht en buiten tone mapping gehouden — net als eerst, waar
 * emissiveIntensity 2.2/0.15 het beeld bepaalde. Onbelicht kan de helderheid
 * wél per exemplaar uit de instance-kleur komen; met `emissive` kan dat niet.
 */
const BEACON_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const BEACON_ON = new THREE.Color('#ff5252').multiplyScalar(2.4);
const BEACON_OFF = new THREE.Color('#ff5252').multiplyScalar(0.45);

const CRATE_COLORS = [new THREE.Color('#c0392b'), new THREE.Color('#d94f4f')];
const BARREL_COLORS = [
  new THREE.Color('#2e86c1'),
  new THREE.Color('#e67e22'),
  new THREE.Color('#8b95a5'),
];
const DOME_COLORS = [new THREE.Color('#e8eaf0'), new THREE.Color('#c9a06a')];

type BucketName =
  | 'crate'
  | 'solarPole'
  | 'solarPanel'
  | 'mast'
  | 'ring'
  | 'beacon'
  | 'barrel'
  | 'domeTop'
  | 'domeBase';

interface PropParts {
  matrices: Record<BucketName, THREE.Matrix4[]>;
  crateColors: THREE.Color[];
  barrelColors: THREE.Color[];
  domeColors: THREE.Color[];
  /** Knipperfase per antenne, zodat de bakens niet in de pas lopen. */
  beaconPhases: number[];
}

/** Hulpje om een onderdeel onder de prop-transform te hangen. Alleen bij opbouw. */
const scratch = new THREE.Object3D();
function place(
  into: THREE.Matrix4[],
  parent: THREE.Matrix4,
  pos: [number, number, number],
  rot?: [number, number, number],
): void {
  scratch.position.set(pos[0], pos[1], pos[2]);
  scratch.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  scratch.scale.set(1, 1, 1);
  scratch.updateMatrix();
  into.push(new THREE.Matrix4().multiplyMatrices(parent, scratch.matrix));
}

/** Kratstapel: onderste laag breed, elke laag erboven één krat smaller. */
function buildCrateStack(parts: PropParts, parent: THREE.Matrix4, seed: number): void {
  const layers = 1 + (seed % 3);
  for (let layer = 0; layer < layers; layer += 1) {
    const perLayer = Math.max(1, 3 - layer);
    for (let i = 0; i < perLayer; i += 1) {
      place(parts.matrices.crate, parent, [
        (i - (2 - layer) / 2) * 0.17,
        0.08 + layer * 0.16,
        (layer % 2) * 0.04,
      ]);
      parts.crateColors.push(CRATE_COLORS[(seed + layer + i) % 4 === 0 ? 1 : 0]!);
    }
  }
}

function buildSolarPanel(parts: PropParts, parent: THREE.Matrix4): void {
  place(parts.matrices.solarPole, parent, [0, 0.1, 0]);
  place(parts.matrices.solarPanel, parent, [0, 0.24, 0], [-0.6, 0, 0]);
}

function buildAntenna(parts: PropParts, parent: THREE.Matrix4, seed: number): void {
  place(parts.matrices.mast, parent, [0, 0.28, 0]);
  place(parts.matrices.ring, parent, [0, 0.42, 0]);
  place(parts.matrices.beacon, parent, [0, 0.58, 0]);
  parts.beaconPhases.push(seed);
}

function buildBarrels(parts: PropParts, parent: THREE.Matrix4, seed: number): void {
  for (let i = 0; i < 3; i += 1) {
    place(parts.matrices.barrel, parent, [(i - 1) * 0.14, 0.09, (i % 2) * 0.1]);
    parts.barrelColors.push(BARREL_COLORS[(seed + i) % 3]!);
  }
}

function buildMiniDome(parts: PropParts, parent: THREE.Matrix4, seed: number): void {
  place(parts.matrices.domeTop, parent, [0, 0.1, 0]);
  parts.domeColors.push(DOME_COLORS[seed % 2 ? 1 : 0]!);
  place(parts.matrices.domeBase, parent, [0, 0.02, 0]);
}

/** Aantal prop-soorten; de keuze blijft `seed % PROP_KINDS` zoals hij was. */
const PROP_KINDS = 5;

function emptyParts(): PropParts {
  return {
    matrices: {
      crate: [],
      solarPole: [],
      solarPanel: [],
      mast: [],
      ring: [],
      beacon: [],
      barrel: [],
      domeTop: [],
      domeBase: [],
    },
    crateColors: [],
    barrelColors: [],
    domeColors: [],
    beaconPhases: [],
  };
}

/** Eén instanced mesh met vaste matrices; alleen bij opbouw geschreven. */
function StaticInstances({
  geometry,
  material,
  matrices,
  colors,
  castShadow,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  colors?: THREE.Color[];
  castShadow?: boolean;
}): JSX.Element | null {
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      castShadow={castShadow}
      onUpdate={(mesh) => {
        for (let i = 0; i < matrices.length; i += 1) mesh.setMatrixAt(i, matrices[i]!);
        mesh.instanceMatrix.needsUpdate = true;
        if (colors) {
          for (let i = 0; i < colors.length; i += 1) mesh.setColorAt(i, colors[i]!);
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        mesh.computeBoundingSphere();
      }}
    />
  );
}

/**
 * De bakens van de antennes. Het knipperen is binair (aan/uit), dus de
 * kleurbuffer gaat alleen naar de GPU op het moment dat er daadwerkelijk een
 * baken omslaat — niet elke frame.
 */
function Beacons({
  matrices,
  phases,
}: {
  matrices: THREE.Matrix4[];
  phases: number[];
}): JSX.Element | null {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lit = useRef<Uint8Array>(new Uint8Array(phases.length));

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    let changed = false;
    for (let i = 0; i < phases.length; i += 1) {
      const on = Math.sin(t * 3 + phases[i]!) > 0.2 ? 1 : 0;
      if (lit.current[i] !== on) {
        lit.current[i] = on;
        mesh.setColorAt(i, on ? BEACON_ON : BEACON_OFF);
        changed = true;
      }
    }
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      key={matrices.length}
      ref={ref}
      args={[BEACON_GEO, BEACON_MAT, matrices.length]}
      onUpdate={(mesh) => {
        lit.current = new Uint8Array(matrices.length);
        for (let i = 0; i < matrices.length; i += 1) {
          mesh.setMatrixAt(i, matrices[i]!);
          // Altijd één keer zetten: zonder setColorAt bestaat instanceColor
          // niet en valt het baken terug op het witte basismateriaal.
          mesh.setColorAt(i, BEACON_OFF);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }}
    />
  );
}

export function Props({ world }: { world: WorldConfig }): JSX.Element {
  const parts = useMemo((): PropParts => {
    const out = emptyParts();
    const parent = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1.25, 1.25, 1.25);

    for (const district of world.districts) {
      for (const project of district.projects) {
        // Ring-hexes van elk cluster krijgen ~60% kans op een prop.
        for (const hex of project.hexes.slice(1)) {
          const hashed = stableHash(`${project.name}:${hex.q},${hex.r}`);
          if (hashed % 10 >= 6) continue;
          const { x, z } = axialToWorld(hex);
          const offsetAngle = (hashed % 628) / 100;
          const seed = hashed % 97;
          // De groepsrotatie die elke prop-soort zelf had, hoort nu in de
          // transform van de prop zelf.
          const spin =
            hashed % PROP_KINDS === 0
              ? (seed % 6) * 0.5 // kratten
              : hashed % PROP_KINDS === 1
                ? (seed % 7) * 0.9 // zonnepaneel
                : hashed % PROP_KINDS === 3
                  ? seed // vaten
                  : 0;
          euler.set(0, spin, 0);
          quat.setFromEuler(euler);
          pos.set(
            x * HEX_SPACING + Math.cos(offsetAngle) * 0.45,
            0.31,
            z * HEX_SPACING + Math.sin(offsetAngle) * 0.45,
          );
          parent.compose(pos, quat, scale);

          switch (hashed % PROP_KINDS) {
            case 0:
              buildCrateStack(out, parent, seed);
              break;
            case 1:
              buildSolarPanel(out, parent);
              break;
            case 2:
              buildAntenna(out, parent, seed);
              break;
            case 3:
              buildBarrels(out, parent, seed);
              break;
            default:
              buildMiniDome(out, parent, seed);
              break;
          }
        }
      }
    }
    return out;
  }, [world]);

  return (
    <group>
      <StaticInstances
        geometry={CRATE_GEO}
        material={CRATE_MAT}
        matrices={parts.matrices.crate}
        colors={parts.crateColors}
        castShadow
      />
      <StaticInstances
        geometry={SOLAR_POLE_GEO}
        material={SOLAR_POLE_MAT}
        matrices={parts.matrices.solarPole}
      />
      <StaticInstances
        geometry={SOLAR_PANEL_GEO}
        material={SOLAR_PANEL_MAT}
        matrices={parts.matrices.solarPanel}
      />
      <StaticInstances geometry={MAST_GEO} material={STEEL_MAT} matrices={parts.matrices.mast} />
      <StaticInstances geometry={RING_GEO} material={STEEL_MAT} matrices={parts.matrices.ring} />
      <Beacons matrices={parts.matrices.beacon} phases={parts.beaconPhases} />
      <StaticInstances
        geometry={BARREL_GEO}
        material={BARREL_MAT}
        matrices={parts.matrices.barrel}
        colors={parts.barrelColors}
        castShadow
      />
      <StaticInstances
        geometry={DOME_TOP_GEO}
        material={DOME_TOP_MAT}
        matrices={parts.matrices.domeTop}
        colors={parts.domeColors}
        castShadow
      />
      <StaticInstances
        geometry={DOME_BASE_GEO}
        material={DOME_BASE_MAT}
        matrices={parts.matrices.domeBase}
      />
    </group>
  );
}
