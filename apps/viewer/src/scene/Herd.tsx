import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialKey, axialToWorld, hexDisc, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';
import { buildRoads, groundTop, openGround, rand } from './roads.ts';
import { LAKE_CENTER, LAKE_RADIUS } from './terrain.ts';

/**
 * Een kudde op de lege grond tussen de districten.
 *
 * Die grond was leeg, en de verleiding is om er meer gebouwen neer te zetten.
 * Maar een wereld waarin álles bebouwd is leest net zo plat als een lege: het
 * is het contrast tussen bewoond en onbewoond dat de districten laat opvallen.
 * Dieren vullen de leegte zonder hem vol te bouwen.
 *
 * Ze grazen in groepjes en drentelen traag rond hun eigen plek. Ze rennen niet
 * ergens heen — dat zou betekenis suggereren die er niet is, en alles wat in
 * deze wereld beweegt hoort ergens voor te staan.
 */

const FLOCK_COUNT = 5;
const PER_FLOCK = 7;

interface Animal {
  key: string;
  home: [number, number];
  /** Grondhoogte van de hex waar dit dier op staat. */
  ground: number;
  /** Fase en straal van het gedrentel rond het eigen plekje. */
  phase: number;
  wander: number;
  scale: number;
  dark: boolean;
}

/**
 * De hele kudde in drie instanced meshes: romp, kop, poten. Elk dier beweegt
 * apart, dus de matrices worden per frame bijgewerkt — dat is nog altijd
 * goedkoper dan 35 dieren × 6 losse meshes, wat er eerst stond. Dezelfde regel
 * als bij de gebouwen: ruimte in het budget is er, maar niet als je 'm per
 * object weggooit.
 */
const BODY_GEO = new THREE.SphereGeometry(0.085, 8, 6);
const HEAD_GEO = new THREE.BoxGeometry(0.055, 0.045, 0.045);
const LEG_GEO = new THREE.BoxGeometry(0.018, 0.075, 0.018);
const DARK_MAT = new THREE.MeshStandardMaterial({ color: '#3b3228', roughness: 0.9 });
const WOOL_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });

const LEG_OFFSETS: [number, number][] = [
  [-0.04, -0.03],
  [0.04, -0.03],
  [-0.04, 0.03],
  [0.04, 0.03],
];

const PALE = new THREE.Color('#ece4d6');
const DARK = new THREE.Color('#5d5346');

function Flock({ animals }: { animals: Animal[] }): JSX.Element {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const legs = useRef<THREE.InstancedMesh>(null);

  // Buiten de frame-lus aangemaakt: deze draaien 35 keer per frame en een
  // nieuwe Matrix4 per dier per frame is precies het soort afval dat je pas
  // merkt als de hele wereld hapert.
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const legMatrix = useMemo(() => new THREE.Matrix4(), []);
  const legPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const body = bodies.current;
    const head = heads.current;
    const leg = legs.current;
    if (!body || !head || !leg) return;

    animals.forEach((animal, i) => {
      const t = clock.elapsedTime * 0.11 + animal.phase;
      const x = animal.home[0] + Math.cos(t) * animal.wander;
      const z = animal.home[1] + Math.sin(t * 1.3) * animal.wander;
      const facing = -Math.atan2(Math.cos(t * 1.3) * 1.3, -Math.sin(t)) + Math.PI / 2;

      euler.set(0, facing, 0);
      quat.setFromEuler(euler);
      scale.setScalar(animal.scale);
      pos.set(x, animal.ground + 0.09, z);
      matrix.compose(pos, quat, scale);
      body.setMatrixAt(i, matrix);

      // Kop: grazen is het enige wat ze doen — omlaag, omhoog, omlaag.
      euler.set(0, facing, 0.5 + Math.sin(t * 2.7) * 0.42);
      quat.setFromEuler(euler);
      pos.set(
        x + Math.cos(facing) * 0.075 * animal.scale,
        animal.ground + 0.11 * animal.scale,
        z - Math.sin(facing) * 0.075 * animal.scale,
      );
      matrix.compose(pos, quat, scale);
      head.setMatrixAt(i, matrix);

      euler.set(0, facing, 0);
      quat.setFromEuler(euler);
      LEG_OFFSETS.forEach(([lx, lz], k) => {
        const rx = lx * Math.cos(facing) - lz * Math.sin(facing);
        const rz = lx * Math.sin(facing) + lz * Math.cos(facing);
        legPos.set(x + rx * animal.scale, animal.ground + 0.09 - 0.07 * animal.scale, z + rz * animal.scale);
        legMatrix.compose(legPos, quat, scale);
        leg.setMatrixAt(i * 4 + k, legMatrix);
      });
    });

    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    leg.instanceMatrix.needsUpdate = true;
    // Zonder dit blijft de bounding sphere op de eerste frame staan en verdwijnt
    // de halve kudde zodra hij buiten die bol drentelt.
    body.computeBoundingSphere();
  });

  const count = Math.max(1, animals.length);
  return (
    <group>
      {/* key op het aantal: verandert de kudde van omvang, dan moet de
          instancedMesh opnieuw gemaakt worden — het aantal staat vast bij
          aanmaken. */}
      <instancedMesh
        key={`body-${count}`}
        ref={bodies}
        args={[BODY_GEO, WOOL_MAT, count]}
        castShadow
        onUpdate={(mesh) => {
          // Kleur per dier, één keer gezet: een paar donkere beesten per kudde,
          // want een uniforme kudde ziet eruit als één object dat per ongeluk
          // zeven keer staat.
          animals.forEach((animal, i) => mesh.setColorAt(i, animal.dark ? DARK : PALE));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }}
      />
      <instancedMesh key={`head-${count}`} ref={heads} args={[HEAD_GEO, DARK_MAT, count]} />
      <instancedMesh key={`leg-${count}`} ref={legs} args={[LEG_GEO, DARK_MAT, count * 4]} />
    </group>
  );
}

export function Herd({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const perfLow = useAra((s) => s.perfLow);

  const animals = useMemo((): Animal[] => {
    if (!world) return [];
    const claimed = new Set<string>();
    for (const d of world.districts) {
      for (const p of d.projects) for (const h of p.hexes) claimed.add(axialKey(h));
    }
    const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
    const roads = buildRoads(world, { claimed, lake }).tiles;
    const free = openGround({ claimed, lake, roads });
    if (free.length === 0) return [];

    const out: Animal[] = [];
    for (let f = 0; f < FLOCK_COUNT; f += 1) {
      // Vaste plekken uit de hash: een kudde die bij elke render verspringt
      // leest als ruis, niet als leven.
      const hex = free[Math.floor(rand(`flock:${f}`) * free.length) % free.length]!;
      const { x, z } = axialToWorld(hex);
      const cx = x * HEX_SPACING;
      const cz = z * HEX_SPACING;
      // Stond op een vaste 0,33 en zakte daarmee half in de heuvels sinds het
      // terrein reliëf kreeg.
      const ground = groundTop(hex);
      for (let i = 0; i < PER_FLOCK; i += 1) {
        const seed = `flock:${f}:${i}`;
        const angle = rand(seed) * Math.PI * 2;
        const radius = 0.12 + rand(`${seed}:r`) * 0.5;
        out.push({
          key: seed,
          home: [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius],
          ground,
          phase: rand(`${seed}:p`) * Math.PI * 2,
          wander: 0.05 + rand(`${seed}:w`) * 0.12,
          scale: 0.85 + rand(`${seed}:s`) * 0.45,
          // Een paar donkere beesten per kudde; een uniforme kudde ziet eruit
          // als één object dat per ongeluk zeven keer staat.
          dark: rand(`${seed}:d`) > 0.78,
        });
      }
    }
    return out;
  }, [world]);

  if (perfLow || animals.length === 0) return null;

  return <Flock animals={animals} />;
}
