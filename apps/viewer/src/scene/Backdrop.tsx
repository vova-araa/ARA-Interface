import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDaylight } from './daylight.ts';

/** De Ark van Noach op de berghelling, met een witte duif die rondjes vliegt. */
function NoahsArk(): JSX.Element {
  const dove = useRef<THREE.Group>(null);
  const wings = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.5;
    if (dove.current) {
      dove.current.position.set(
        Math.cos(t) * 1.5,
        2.6 + Math.sin(t * 1.7) * 0.3,
        Math.sin(t) * 1.5,
      );
      dove.current.rotation.y = -t - Math.PI / 2;
    }
    if (wings.current) wings.current.rotation.z = Math.sin(clock.elapsedTime * 9) * 0.6;
  });

  return (
    <group>
      {/* Ark op de sneeuwgrens: romp, dek en hut */}
      <group position={[0.25, 1.62, 0.55]} rotation={[0, 0.8, -0.12]} scale={0.62}>
        <mesh>
          <boxGeometry args={[2.3, 0.55, 0.95]} />
          <meshBasicMaterial color="#7a4a2b" fog={false} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <boxGeometry args={[2.42, 0.14, 1.06]} />
          <meshBasicMaterial color="#5c3820" fog={false} />
        </mesh>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[1.25, 0.5, 0.65]} />
          <meshBasicMaterial color="#8a5a35" fog={false} />
        </mesh>
        <mesh position={[0, 0.94, 0]}>
          <boxGeometry args={[1.4, 0.14, 0.8]} />
          <meshBasicMaterial color="#5c3820" fog={false} />
        </mesh>
        {/* raampje dat warm licht geeft */}
        <mesh position={[0, 0.62, 0.34]}>
          <boxGeometry args={[0.22, 0.22, 0.02]} />
          <meshBasicMaterial color="#ffd98a" fog={false} />
        </mesh>
      </group>
      {/* De duif */}
      <group ref={dove} scale={0.35}>
        <mesh>
          <sphereGeometry args={[0.16, 8, 6]} />
          <meshBasicMaterial color="#ffffff" fog={false} />
        </mesh>
        <mesh ref={wings}>
          <boxGeometry args={[0.85, 0.03, 0.2]} />
          <meshBasicMaterial color="#f2f2f2" fog={false} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Ararat silhouette (Masis + Sis), day/night sky dome and drifting clouds.
 * All procedural, cartoon-flat materials so the orthographic camera can't
 * catch them unlit.
 */
export function Backdrop(): JSX.Element {
  const cloudsRef = useRef<THREE.Group>(null);
  const daylight = useDaylight();

  const skyMaterial = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, daylight.stops[0]);
    gradient.addColorStop(0.55, daylight.stops[1]);
    gradient.addColorStop(0.82, daylight.stops[2]);
    gradient.addColorStop(1, daylight.stops[3]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
  }, [daylight.stops]);

  const clouds = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        angle: (i / 8) * Math.PI * 2,
        radius: 16 + (i % 4) * 4,
        y: 7 + (i % 5) * 1.2,
        scale: 0.9 + (i % 3) * 0.5,
        speed: 0.006 + (i % 3) * 0.004,
      })),
    [],
  );

  useFrame((_, delta) => {
    cloudsRef.current?.children.forEach((cloud, i) => {
      const c = clouds[i]!;
      c.angle += c.speed * delta * 10;
      cloud.position.set(Math.cos(c.angle) * c.radius, c.y, Math.sin(c.angle) * c.radius);
    });
  });

  return (
    <group>
      {/* Upper-hemisphere sky dome only; below horizon the scene bg shows. */}
      <mesh material={skyMaterial} renderOrder={-10}>
        <sphereGeometry args={[80, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* Ground plane far below the tiles, dusk-pink. */}
      <mesh position={[0, -1.2, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-9}>
        <circleGeometry args={[80, 32]} />
        <meshBasicMaterial color="#b98d84" fog={false} />
      </mesh>

      {/* Ararat: twee besneeuwde pieken, dichtbij genoeg om altijd de horizon
          van de wereld te vormen (iso-camera kijkt richting -x/-z). */}
      <group position={[-14, -0.6, -22]}>
        <mesh>
          <coneGeometry args={[10, 9.5, 24]} />
          <meshBasicMaterial color="#6b6288" fog={false} />
        </mesh>
        <mesh position={[0, 3.2, 0.2]}>
          <coneGeometry args={[3.6, 3.4, 24]} />
          <meshBasicMaterial color="#f4eeea" fog={false} />
        </mesh>
        <group position={[10, -1.2, 3]}>
          <mesh>
            <coneGeometry args={[6, 6.8, 20]} />
            <meshBasicMaterial color="#756b93" fog={false} />
          </mesh>
          <mesh position={[0, 2.4, 0.15]}>
            <coneGeometry args={[1.8, 2, 20]} />
            <meshBasicMaterial color="#f4eeea" fog={false} />
          </mesh>
        </group>
      </group>
      {/* A second, hazier ridge on the opposite side for depth */}
      <group position={[18, -1.8, -20]}>
        <mesh>
          <coneGeometry args={[8, 5.5, 18]} />
          <meshBasicMaterial color="#8a7fa3" fog={false} />
        </mesh>
      </group>

      {/* Klein-Ararat aan de zuidwestrand: altijd in beeld, met de Ark erop */}
      <group position={[-7.2, -0.2, 12]}>
        <mesh>
          <coneGeometry args={[3.4, 3.1, 18]} />
          <meshStandardMaterial color="#6b6288" flatShading />
        </mesh>
        <mesh position={[0, 1.15, 0]}>
          <coneGeometry args={[1.15, 0.95, 18]} />
          <meshStandardMaterial color="#f4eeea" flatShading />
        </mesh>
        <NoahsArk />
      </group>

      <group ref={cloudsRef}>
        {clouds.map((cloud, i) => (
          <group key={i} scale={[cloud.scale, cloud.scale * 0.5, cloud.scale]}>
            <mesh>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color="#fbeee6" transparent opacity={0.85} fog={false} depthWrite={false} />
            </mesh>
            <mesh position={[1.1, 0.1, 0.2]} scale={0.7}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color="#fbeee6" transparent opacity={0.8} fog={false} depthWrite={false} />
            </mesh>
            <mesh position={[-1, 0, -0.1]} scale={0.6}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color="#fff6ef" transparent opacity={0.8} fog={false} depthWrite={false} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
