import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialKey, hexDisc, type WorldConfig } from '@ara/shared';
import { useAra } from '../store.ts';
import { buildRoads, rand } from './roads.ts';

/**
 * Verkeer over het wegennet.
 *
 * De districten stonden als losse eilanden in het landschap; de wegen kwamen
 * er in een eerdere ronde bij, maar een weg zonder iets erop is een streep.
 * Hier rijdt het: vrachtwagens van en naar de hub, en kleiner verkeer dat
 * rondgaat.
 *
 * **De dichtheid volgt de drukte.** Meer draaiende sessies is meer verkeer op
 * de weg van dat district. Daarmee is de map niet alleen mooier maar ook
 * afleesbaar: je ziet van ver waar het gebeurt, zonder een cijfer te lezen.
 * Nul sessies is een lege weg, en dat hoort ook zo — stilte moet zichtbaar
 * zijn, anders is drukte niets waard.
 *
 * Alles rijdt over de gedeelde routes uit roads.ts, dus er rijdt nooit iets
 * naast de weg die eronder ligt.
 */

const LAKE_CENTER = { q: -2, r: 6 };
const LAKE_RADIUS = 2;

interface Vehicle {
  key: string;
  path: { x: number; z: number }[];
  /** 0..1 over de route; rijdt heen en terug. */
  offset: number;
  speed: number;
  kind: 'truck' | 'van' | 'car';
  color: THREE.Color;
}

function Body({ kind, color }: { kind: Vehicle['kind']; color: THREE.Color }): JSX.Element {
  if (kind === 'truck') {
    return (
      <group>
        <mesh position={[0.16, 0.11, 0]} castShadow>
          <boxGeometry args={[0.2, 0.18, 0.17]} />
          <meshStandardMaterial color="#e9edf4" roughness={0.5} />
        </mesh>
        <mesh position={[-0.12, 0.12, 0]} castShadow>
          <boxGeometry args={[0.38, 0.2, 0.18]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
        {/* Remlicht achterop: klein, maar het geeft richting aan een blokje. */}
        <mesh position={[-0.31, 0.11, 0]}>
          <boxGeometry args={[0.02, 0.05, 0.14]} />
          <meshBasicMaterial color="#ff5a4a" toneMapped={false} />
        </mesh>
      </group>
    );
  }
  if (kind === 'van') {
    return (
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.32, 0.17, 0.16]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.26, 0.09, 0.14]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.15} />
      </mesh>
      <mesh position={[-0.01, 0.14, 0]}>
        <boxGeometry args={[0.13, 0.07, 0.12]} />
        <meshStandardMaterial color="#2b3242" roughness={0.3} />
      </mesh>
    </group>
  );
}

function Runner({ vehicle }: { vehicle: Vehicle }): JSX.Element {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const path = vehicle.path;
    if (path.length < 2) return;

    // Heen en terug over dezelfde route: een pingpong, geen rondje. Een rondje
    // zou een lus vereisen die er niet is, en dan rijdt de helft door het veld.
    const cycle = (clock.elapsedTime * vehicle.speed + vehicle.offset) % 2;
    const t = cycle < 1 ? cycle : 2 - cycle;
    const forward = cycle < 1;

    const pos = t * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(pos));
    const f = pos - i;
    const a = path[i]!;
    const b = path[i + 1]!;
    const x = a.x + (b.x - a.x) * f;
    const z = a.z + (b.z - a.z) * f;
    g.position.set(x, 0.2, z);
    // Kijkrichting uit het segment zelf; bij terugrijden een halve slag om.
    const angle = Math.atan2(b.z - a.z, b.x - a.x) + (forward ? 0 : Math.PI);
    g.rotation.y = -angle;
  });

  return (
    <group ref={group}>
      <Body kind={vehicle.kind} color={vehicle.color} />
    </group>
  );
}

export function Traffic({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const perfLow = useAra((s) => s.perfLow);
  const snapshot = useAra((s) => s.snapshot);

  // Hoeveel er draait per tak. Dit is de knop waar de dichtheid aan hangt.
  const busyByVenture = useMemo(() => {
    const out = new Map<string, number>();
    if (!world) return out;
    const ventureOf = new Map<string, string>();
    for (const d of world.districts) {
      for (const p of d.projects) ventureOf.set(p.name, d.venture.id);
    }
    for (const session of Object.values(snapshot.sessions)) {
      if (session.endedAt) continue;
      const venture = ventureOf.get(session.project);
      if (venture) out.set(venture, (out.get(venture) ?? 0) + 1);
    }
    return out;
  }, [world, snapshot]);

  const vehicles = useMemo((): Vehicle[] => {
    if (!world) return [];
    const claimed = new Set<string>();
    for (const d of world.districts) {
      for (const p of d.projects) for (const h of p.hexes) claimed.add(axialKey(h));
    }
    const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
    const net = buildRoads(world, { claimed, lake });

    const out: Vehicle[] = [];
    for (const path of net.paths) {
      if (path.points.length < 2) return out;
      const busy = busyByVenture.get(path.venture) ?? 0;
      // Eén vrachtwagen hoort bij de tak zelf; het kleine verkeer komt uit de
      // drukte. Vier is genoeg — daarboven wordt het een file en zegt het
      // verschil tussen vijf en acht sessies je niets meer.
      const extra = Math.min(4, busy);
      const color = new THREE.Color(path.color);
      out.push({
        key: `${path.venture}-truck`,
        path: path.points,
        offset: rand(`${path.venture}:truck`) * 2,
        speed: 0.055,
        kind: 'truck',
        color,
      });
      for (let i = 0; i < extra; i += 1) {
        const seed = `${path.venture}:v${i}`;
        out.push({
          key: seed,
          path: path.points,
          offset: rand(seed) * 2,
          speed: 0.09 + rand(`${seed}:s`) * 0.07,
          kind: i % 2 === 0 ? 'car' : 'van',
          color: color.clone().lerp(new THREE.Color('#f2efe8'), 0.35 + rand(`${seed}:c`) * 0.4),
        });
      }
    }
    return out;
  }, [world, busyByVenture]);

  // Sier-laag: bij zeer lage framerate gaat het verkeer eruit, net als de
  // crowd en het weer. De wegen zelf blijven liggen.
  if (perfLow || vehicles.length === 0) return null;

  return (
    <group>
      {vehicles.map((vehicle) => (
        <Runner key={vehicle.key} vehicle={vehicle} />
      ))}
    </group>
  );
}
