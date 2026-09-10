import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDaylight } from './daylight.ts';

/**
 * Weer-laag: wolkschaduwen die traag over de grond glijden, eeuwige sneeuw
 * boven de verre Ararat-piek en schuimstipjes op het Sevan-meer.
 */

const SNOW_COUNT = 36;
const SNOW_CENTER = new THREE.Vector3(-14, 9.5, -22);
const SNOW_SPREAD = 9;

export function Weather(): JSX.Element {
  const daylight = useDaylight();
  const shadowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const snowRef = useRef<THREE.InstancedMesh>(null);
  const foamRefs = useRef<(THREE.Mesh | null)[]>([]);

  const snowSeeds = useMemo(
    () =>
      Array.from({ length: SNOW_COUNT }, (_, i) => ({
        x: ((i * 7919) % 100) / 100 - 0.5,
        z: ((i * 104729) % 100) / 100 - 0.5,
        speed: 0.25 + ((i * 31) % 10) / 25,
        phase: i * 0.7,
      })),
    [],
  );

  const clouds = useMemo(
    () => [
      { radius: 9, speed: 0.011, scale: 4.5, phase: 0 },
      { radius: 13, speed: 0.008, scale: 6, phase: 2.1 },
      { radius: 6, speed: 0.014, scale: 3.5, phase: 4.4 },
    ],
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;

    // Wolkschaduwen: alleen overdag zichtbaar, traag drijvend.
    const shadowOpacity = daylight.period === 'night' ? 0 : 0.07;
    shadowRefs.current.forEach((mesh, i) => {
      const c = clouds[i]!;
      if (!mesh) return;
      const a = t * c.speed + c.phase;
      mesh.position.set(Math.cos(a) * c.radius, 0.36, Math.sin(a) * c.radius);
      (mesh.material as THREE.MeshBasicMaterial).opacity = shadowOpacity;
    });

    // Sneeuw boven de Ararat: vallen + respawn.
    const snow = snowRef.current;
    if (snow) {
      const matrix = new THREE.Matrix4();
      snowSeeds.forEach((seed, i) => {
        const fall = ((t * seed.speed + seed.phase) % 1) * 6;
        matrix.makeTranslation(
          SNOW_CENTER.x + seed.x * SNOW_SPREAD + Math.sin(t + seed.phase) * 0.3,
          SNOW_CENTER.y + 3 - fall,
          SNOW_CENTER.z + seed.z * SNOW_SPREAD,
        );
        snow.setMatrixAt(i, matrix);
      });
      snow.instanceMatrix.needsUpdate = true;
    }

    // Schuim op het meer: trage drift-cirkels.
    foamRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const a = t * 0.05 + i * 1.1;
      mesh.position.set(5.5 + Math.cos(a) * (0.8 + i * 0.25), 0.135, 15.9 + Math.sin(a) * (0.7 + i * 0.2));
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 1.5 + i) * 0.12;
    });
  });

  return (
    <group>
      {clouds.map((cloud, i) => (
        <mesh
          key={i}
          ref={(m) => (shadowRefs.current[i] = m)}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={cloud.scale}
        >
          <circleGeometry args={[1, 18]} />
          <meshBasicMaterial color="#1a1428" transparent opacity={0.07} depthWrite={false} />
        </mesh>
      ))}

      <instancedMesh ref={snowRef} args={[undefined, undefined, SNOW_COUNT]}>
        <sphereGeometry args={[0.06, 5, 4]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} fog={false} />
      </instancedMesh>

      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} ref={(m) => (foamRefs.current[i] = m)} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.07 + (i % 3) * 0.03, 8]} />
          <meshBasicMaterial color="#e8f4fa" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
