import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDaylight } from './daylight.ts';

/** Ambient leven: cirkelende adelaars, een bootje op het Sevan-meer en de
 *  eeuwige vlam bij de hub. Puur sfeer, alles goedkoop. */

function Eagle({ radius, height, speed, phase }: { radius: number; height: number; speed: number; phase: number }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Mesh>(null);
  const wingR = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed + phase;
    const g = group.current;
    if (!g) return;
    g.position.set(Math.cos(t) * radius, height + Math.sin(t * 2.3) * 0.4, Math.sin(t) * radius);
    g.rotation.y = -t - Math.PI / 2;
    const flap = Math.sin(clock.elapsedTime * 6 + phase) * 0.5;
    if (wingL.current) wingL.current.rotation.z = flap;
    if (wingR.current) wingR.current.rotation.z = -flap;
  });

  return (
    <group ref={group} scale={0.5}>
      <mesh>
        <coneGeometry args={[0.09, 0.5, 5]} />
        <meshStandardMaterial color="#4a4038" />
      </mesh>
      <mesh ref={wingL} position={[-0.28, 0, 0]}>
        <boxGeometry args={[0.55, 0.02, 0.18]} />
        <meshStandardMaterial color="#5c5148" />
      </mesh>
      <mesh ref={wingR} position={[0.28, 0, 0]}>
        <boxGeometry args={[0.55, 0.02, 0.18]} />
        <meshStandardMaterial color="#5c5148" />
      </mesh>
    </group>
  );
}

function SevanBoat(): JSX.Element {
  const group = useRef<THREE.Group>(null);
  // Meer ligt rond axial {q:-2, r:10} → wereld ≈ (x: 5.5, z: 15.9) — bootje dobbert daar.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = group.current;
    if (!g) return;
    g.position.set(5.5 + Math.sin(t * 0.12) * 1.1, 0.12 + Math.sin(t * 1.7) * 0.03, 15.9 + Math.cos(t * 0.12) * 0.9);
    g.rotation.y = t * 0.12 + Math.PI / 2;
    g.rotation.z = Math.sin(t * 1.3) * 0.05;
  });
  return (
    <group ref={group} scale={0.6}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.5, 0.12, 0.2]} />
        <meshStandardMaterial color="#8a5a3b" />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.42, 5]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <mesh position={[0.09, 0.34, 0]} rotation={[0, 0, -0.1]}>
        <planeGeometry args={[0.22, 0.3]} />
        <meshStandardMaterial color="#f4eeea" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function EternalFlame(): JSX.Element {
  const flame = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const daylight = useDaylight();
  const nightBoost = daylight.period === 'night' || daylight.period === 'dusk' ? 1.5 : 1;

  useFrame(({ clock }) => {
    const flicker = 0.85 + Math.sin(clock.elapsedTime * 11) * 0.1 + Math.sin(clock.elapsedTime * 23) * 0.05;
    if (flame.current) flame.current.scale.set(flicker, flicker * (1 + Math.sin(clock.elapsedTime * 7) * 0.15), flicker);
    if (light.current) light.current.intensity = 1.4 * flicker * nightBoost;
  });

  return (
    <group position={[1.1, 0.42, -1.1]}>
      <mesh>
        <cylinderGeometry args={[0.16, 0.2, 0.14, 8]} />
        <meshStandardMaterial color="#8f8578" />
      </mesh>
      <mesh ref={flame} position={[0, 0.2, 0]}>
        <coneGeometry args={[0.08, 0.26, 7]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff8c1a" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <pointLight ref={light} color="#ff9a3d" distance={5} decay={2} position={[0, 0.4, 0]} />
    </group>
  );
}

export function AmbientLife(): JSX.Element {
  const eagles = useMemo(
    () => [
      { radius: 9, height: 4.6, speed: 0.14, phase: 0 },
      { radius: 12.5, height: 5.8, speed: 0.1, phase: 2.4 },
    ],
    [],
  );
  return (
    <group>
      {eagles.map((eagle, i) => (
        <Eagle key={i} {...eagle} />
      ))}
      <SevanBoat />
      <EternalFlame />
    </group>
  );
}
