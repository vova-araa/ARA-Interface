import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Ararat silhouette (Masis + Sis), dawn-gradient sky dome and drifting clouds.
 * All procedural, cartoon-flat materials so the orthographic camera can't
 * catch them unlit.
 */
export function Backdrop(): JSX.Element {
  const cloudsRef = useRef<THREE.Group>(null);

  const skyMaterial = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#2b3a67'); // zenith night-blue
    gradient.addColorStop(0.55, '#7a6a9e');
    gradient.addColorStop(0.82, '#e8927c'); // dawn coral
    gradient.addColorStop(1, '#f6c89f'); // horizon apricot
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
  }, []);

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

      {/* Ararat: two snow-capped peaks, flat cartoon shading via two-tone cones */}
      <group position={[-14, -0.4, -26]}>
        <mesh>
          <coneGeometry args={[13, 11, 24]} />
          <meshBasicMaterial color="#6b6288" fog={false} />
        </mesh>
        <mesh position={[0, 3.6, 0.2]}>
          <coneGeometry args={[4.6, 4.2, 24]} />
          <meshBasicMaterial color="#f4eeea" fog={false} />
        </mesh>
        <group position={[13, -1.5, 3]}>
          <mesh>
            <coneGeometry args={[7.5, 8.5, 20]} />
            <meshBasicMaterial color="#756b93" fog={false} />
          </mesh>
          <mesh position={[0, 2.9, 0.15]}>
            <coneGeometry args={[2.3, 2.6, 20]} />
            <meshBasicMaterial color="#f4eeea" fog={false} />
          </mesh>
        </group>
      </group>
      {/* A second, hazier ridge on the opposite side for depth */}
      <group position={[20, -1.8, -24]}>
        <mesh>
          <coneGeometry args={[9, 6.5, 18]} />
          <meshBasicMaterial color="#8a7fa3" fog={false} />
        </mesh>
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
