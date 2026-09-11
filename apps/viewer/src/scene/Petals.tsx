import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { stableHash } from '@ara/shared';

/**
 * Abrikozenbloesem die over de wereld dwarrelt (Armenië = abrikozenland).
 * Eén InstancedMesh, per-instance drift/tuimel; recyclet onderaan naar boven.
 * Één draw call; gegate achter perfLow/lodFar in Scene.
 */
const COUNT = 160;
const FIELD = 40; // spreiding in x/z
const TOP = 13;
const FALL = 15; // valhoogte voor de cyclus

interface Petal {
  x: number;
  z: number;
  drift: number;
  spin: number;
  fallSpeed: number;
  swayAmp: number;
  offset: number;
}

const PETAL_COLORS = ['#ffd9e2', '#ffc4d6', '#fbe0c4', '#ffe9f0'];

export function Petals(): JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);

  const petals = useMemo<Petal[]>(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const r = (s: string): number => (stableHash(`petal-${i}-${s}`) % 1000) / 1000;
        return {
          x: (r('x') - 0.5) * FIELD,
          z: (r('z') - 0.5) * FIELD,
          drift: (r('d') - 0.5) * 1.2,
          spin: (r('s') - 0.5) * 4,
          fallSpeed: 0.6 + r('f') * 0.9,
          swayAmp: 0.4 + r('a') * 0.9,
          offset: r('o') * FALL,
        };
      }),
    [],
  );

  // Kleur per instance één keer zetten.
  const colorInit = useRef(false);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    petals.forEach((p, i) => {
      const fallen = (t * p.fallSpeed + p.offset) % FALL;
      const y = TOP - fallen;
      pos.set(
        p.x + Math.sin(t * 0.6 + p.offset) * p.swayAmp + p.drift * fallen * 0.3,
        y,
        p.z + Math.cos(t * 0.5 + p.offset) * p.swayAmp,
      );
      e.set(t * p.spin, t * p.spin * 0.7 + p.offset, t * p.spin * 0.4);
      q.setFromEuler(e);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      if (!colorInit.current) {
        mesh.setColorAt(i, new THREE.Color(PETAL_COLORS[i % PETAL_COLORS.length]!));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (!colorInit.current && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
      colorInit.current = true;
    }
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      {/* klein plat blaadje — iets emissief zodat het ook in schaduw oplicht */}
      <planeGeometry args={[0.22, 0.15]} />
      <meshStandardMaterial
        side={THREE.DoubleSide}
        vertexColors
        roughness={0.6}
        emissive="#ffd0dd"
        emissiveIntensity={0.25}
        transparent
        opacity={0.95}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
