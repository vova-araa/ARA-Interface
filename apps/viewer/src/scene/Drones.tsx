import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';

/** Bezorgdrones die pakketjes tussen districten vliegen (heen-en-weer boog). */

interface Route {
  from: THREE.Vector3;
  to: THREE.Vector3;
  speed: number;
  phase: number;
}

function Drone({ route }: { route: Route }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  const rotors = useRef<(THREE.Mesh | null)[]>([]);
  const parcel = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime * route.speed + route.phase;
    const cycle = t % 2; // 0..1 heen, 1..2 terug
    const f = cycle < 1 ? cycle : 2 - cycle;
    const eased = f * f * (3 - 2 * f); // smoothstep
    const pos = new THREE.Vector3().lerpVectors(route.from, route.to, eased);
    pos.y = 2.6 + Math.sin(eased * Math.PI) * 1.4 + Math.sin(clock.elapsedTime * 3 + route.phase) * 0.06;
    g.position.copy(pos);
    const dir = cycle < 1 ? 1 : -1;
    g.rotation.y = Math.atan2((route.to.x - route.from.x) * dir, (route.to.z - route.from.z) * dir);
    g.rotation.z = Math.sin(clock.elapsedTime * 2 + route.phase) * 0.08;
    rotors.current.forEach((rotor) => {
      if (rotor) rotor.rotation.y = clock.elapsedTime * 40;
    });
    if (parcel.current) parcel.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.2;
  });

  return (
    <group ref={group} scale={0.7}>
      {/* romp — met gloeiend lint erachter (Trail volgt de wereldpositie) */}
      <Trail width={0.6} length={5} decay={1.4} color="#7ec8ff" attenuation={(w) => w * w}>
        <mesh castShadow>
          <boxGeometry args={[0.22, 0.08, 0.22]} />
          <meshStandardMaterial color="#e8eaf0" />
        </mesh>
      </Trail>
      {/* vier armen + rotors */}
      {[[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].map(([x, z], i) => (
        <group key={i} position={[x!, 0.03, z!]}>
          <mesh>
            <cylinderGeometry args={[0.015, 0.015, 0.04, 5]} />
            <meshStandardMaterial color="#8b95a5" />
          </mesh>
          <mesh ref={(m) => (rotors.current[i] = m)} position={[0, 0.035, 0]}>
            <boxGeometry args={[0.16, 0.008, 0.02]} />
            <meshStandardMaterial color="#2a2f3a" />
          </mesh>
        </group>
      ))}
      {/* pakketje aan een touwtje */}
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.12, 4]} />
        <meshStandardMaterial color="#5c5148" />
      </mesh>
      <mesh ref={parcel} position={[0, -0.24, 0]} castShadow>
        <boxGeometry args={[0.12, 0.11, 0.12]} />
        <meshStandardMaterial color="#c9a06a" />
      </mesh>
    </group>
  );
}

export function Drones({ world }: { world: WorldConfig }): JSX.Element | null {
  const routes = useMemo((): Route[] => {
    const centers = world.districts.map((d) => {
      const { x, z } = axialToWorld(d.center);
      return new THREE.Vector3(x * HEX_SPACING, 0, z * HEX_SPACING);
    });
    if (centers.length < 2) return [];
    const pick = (seed: number): THREE.Vector3 => centers[seed % centers.length]!;
    return [0, 1].map((i) => ({
      from: pick(stableHash(`drone-from-${i}`)),
      to: pick(stableHash(`drone-to-${i}`) + 1 + i),
      speed: 0.06 + i * 0.02,
      phase: i * 1.3,
    })).filter((r) => r.from !== r.to);
  }, [world]);

  if (routes.length === 0) return null;
  return (
    <group>
      {routes.map((route, i) => (
        <Drone key={i} route={route} />
      ))}
    </group>
  );
}
