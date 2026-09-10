import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING, projectPlacement } from '../placements.ts';
import { useAra, useViewSnapshot } from '../store.ts';

/**
 * Ambient bewoners: kleine werkers die door hun district scharrelen —
 * lopen naar een punt, pauzeren, weer verder (referentie-look: krioelende
 * platforms). Dichtheid schaalt eerlijk met echte activiteit: een stil
 * district heeft 2 bewoners, een district met draaiende sessies krioelt.
 */

const WORKER_COLORS = ['#ff8a3d', '#e8eaf0', '#4da3ff', '#ffd75e', '#c0392b', '#3ecf6f'];
const WALK_SPEED = 0.55; // world units per seconde

interface Wanderer {
  home: { x: number; z: number };
  radius: number;
  color: string;
  phase: number;
  // runtime-state (mutable, buiten React om):
  pos: THREE.Vector2;
  target: THREE.Vector2;
  pauseUntil: number;
}

function DistrictCrowd({ wanderers }: { wanderers: Wanderer[] }): JSX.Element {
  const groups = useRef<(THREE.Group | null)[]>([]);

  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime;
    wanderers.forEach((w, i) => {
      const g = groups.current[i];
      if (!g) return;
      const toTarget = new THREE.Vector2().subVectors(w.target, w.pos);
      const dist = toTarget.length();
      const walking = now > w.pauseUntil && dist > 0.05;
      if (walking) {
        toTarget.normalize().multiplyScalar(Math.min(dist, WALK_SPEED * delta));
        w.pos.add(toTarget);
        g.rotation.y = Math.atan2(toTarget.x, toTarget.y);
      } else if (dist <= 0.05) {
        // Aangekomen: even pauzeren, dan nieuw doel binnen het district.
        if (w.pauseUntil < now) w.pauseUntil = now + 1.5 + ((i * 37) % 40) / 10;
        if (now > w.pauseUntil - 0.05) {
          const angle = (stableHash(`${i}-${Math.floor(now)}`) % 628) / 100;
          const r = 0.4 + ((stableHash(`${i}r-${Math.floor(now)}`) % 60) / 100) * w.radius;
          w.target.set(w.home.x + Math.cos(angle) * r, w.home.z + Math.sin(angle) * r);
        }
      }
      const bob = walking ? Math.abs(Math.sin(now * 11 + w.phase)) * 0.05 : Math.sin(now * 2 + w.phase) * 0.015;
      g.position.set(w.pos.x, 0.31 + bob, w.pos.y);
    });
  });

  return (
    <group>
      {wanderers.map((w, i) => (
        <group key={i} ref={(g) => (groups.current[i] = g)} scale={1.15}>
          <mesh position={[0, 0.11, 0]} castShadow>
            <capsuleGeometry args={[0.075, 0.1, 4, 7]} />
            <meshStandardMaterial color={w.color} />
          </mesh>
          <mesh position={[0, 0.28, 0]}>
            <sphereGeometry args={[0.065, 8, 6]} />
            <meshStandardMaterial color="#ffdbb5" />
          </mesh>
          <mesh position={[0, 0.315, 0]}>
            <sphereGeometry args={[0.07, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#f7f5f2" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Crowd({ world }: { world: WorldConfig }): JSX.Element | null {
  const snapshot = useViewSnapshot();
  const lodFar = useAra((s) => s.lodFar);
  const demo = useAra((s) => s.demo);

  // Activiteit per venture: aantal actieve (niet-beëindigde) sessies.
  const activity = useMemo(() => {
    const byVenture = new Map<string, number>();
    for (const session of Object.values(snapshot.sessions)) {
      if (session.endedAt) continue;
      const venture = projectPlacement(world, session.project).venture;
      byVenture.set(venture, (byVenture.get(venture) ?? 0) + 1);
    }
    return byVenture;
  }, [snapshot, world]);

  const crowds = useMemo(() => {
    return world.districts.map((district) => {
      const { x, z } = axialToWorld(district.center);
      const base = demo ? 3 : 2;
      const bonus = Math.min(5, (activity.get(district.venture.id) ?? 0) * 2);
      const count = base + bonus;
      const seedBase = stableHash(district.venture.id);
      const wanderers: Wanderer[] = Array.from({ length: count }, (_, i) => {
        const angle = ((seedBase + i * 97) % 628) / 100;
        const home = { x: x * HEX_SPACING, z: z * HEX_SPACING };
        const start = new THREE.Vector2(
          home.x + Math.cos(angle) * 1.1,
          home.z + Math.sin(angle) * 1.1,
        );
        return {
          home,
          radius: 1.9,
          color: WORKER_COLORS[(seedBase + i) % WORKER_COLORS.length]!,
          phase: i * 1.7,
          pos: start.clone(),
          target: start.clone(),
          pauseUntil: 0,
        };
      });
      return { id: district.venture.id, wanderers };
    });
  }, [world, activity, demo]);

  if (lodFar) return null;

  return (
    <group>
      {crowds.map((crowd) => (
        <DistrictCrowd key={`${crowd.id}-${crowd.wanderers.length}`} wanderers={crowd.wanderers} />
      ))}
    </group>
  );
}
