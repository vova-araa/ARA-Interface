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

const PETAL_COLORS = [
  new THREE.Color('#ffd9e2'),
  new THREE.Color('#ffc4d6'),
  new THREE.Color('#fbe0c4'),
  new THREE.Color('#ffe9f0'),
];

const PETAL_GEO = new THREE.PlaneGeometry(0.22, 0.15);
/**
 * Géén `vertexColors`. Met die vlag aan verwacht de shader een
 * `color`-attribuut op de geometrie; dat is er niet, dus vColor begint op
 * (0,0,0) en de kleuren uit `setColorAt` worden met nul vermenigvuldigd.
 * instanceColor werkt juist zónder die vlag. Dit viel nooit op omdat de
 * emissive de blaadjes alsnog roze houdt — ze toonden dus één kleur in plaats
 * van de vier die hier gezet worden.
 */
const PETAL_MAT = new THREE.MeshStandardMaterial({
  side: THREE.DoubleSide,
  roughness: 0.6,
  emissive: new THREE.Color('#ffd0dd'),
  emissiveIntensity: 0.25,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});

// Rekenobjecten buiten de frame-lus: deze draaien 160 keer per frame, en een
// nieuwe Matrix4 per blaadje per frame is precies het afval dat je pas merkt
// als de hele wereld hapert.
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scale = new THREE.Vector3(1, 1, 1);

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

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < petals.length; i += 1) {
      const p = petals[i]!;
      const fallen = (t * p.fallSpeed + p.offset) % FALL;
      pos.set(
        p.x + Math.sin(t * 0.6 + p.offset) * p.swayAmp + p.drift * fallen * 0.3,
        TOP - fallen,
        p.z + Math.cos(t * 0.5 + p.offset) * p.swayAmp,
      );
      euler.set(t * p.spin, t * p.spin * 0.7 + p.offset, t * p.spin * 0.4);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[PETAL_GEO, PETAL_MAT, COUNT]}
      frustumCulled={false}
      onUpdate={(mesh) => {
        // Kleur per blaadje: één keer bij het opzetten, niet elke frame
        // opnieuw met een vlag in de hete lus.
        for (let i = 0; i < COUNT; i += 1) {
          mesh.setColorAt(i, PETAL_COLORS[i % PETAL_COLORS.length]!);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }}
    />
  );
}
