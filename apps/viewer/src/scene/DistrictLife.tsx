import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { emojiTexture } from './icons.ts';
import { useAra } from '../store.ts';

/**
 * District-leven: elke venture heeft zijn eigen werkende scène —
 * traders die traden, designers die tekenen, trucks die rijden,
 * planners die ritten uitzetten, muziek bij de studio's.
 * Alles goedkoop (weinig meshes, geen per-frame allocaties).
 */

/** Trading: candlestick-chart waarvan de bars live bewegen + flitsend groen/rood. */
function TradingFloor(): JSX.Element {
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  const heights = useMemo(() => [0.3, 0.5, 0.25, 0.6, 0.4], []);
  useFrame(({ clock }) => {
    bars.current.forEach((bar, i) => {
      if (!bar) return;
      const t = clock.elapsedTime * 0.9 + i * 1.3;
      const h = heights[i]! * (0.7 + Math.abs(Math.sin(t)) * 0.7);
      bar.scale.y = h;
      bar.position.y = h * 0.35 / 2 + 0.02;
      const up = Math.sin(t) > 0;
      (bar.material as THREE.MeshStandardMaterial).color.set(up ? '#3ecf6f' : '#ff5252');
      (bar.material as THREE.MeshStandardMaterial).emissive.set(up ? '#1d6b3a' : '#7a2727');
    });
  });
  return (
    <group position={[0.85, 0.3, 0.55]} rotation={[0, -0.5, 0]}>
      <mesh position={[0, -0.02, 0]}>
        <boxGeometry args={[0.72, 0.05, 0.3]} />
        <meshStandardMaterial color="#2a2f3a" />
      </mesh>
      {heights.map((_, i) => (
        <mesh key={i} ref={(m) => (bars.current[i] = m)} position={[-0.26 + i * 0.13, 0.1, 0]}>
          <boxGeometry args={[0.07, 0.35, 0.07]} />
          <meshStandardMaterial color="#3ecf6f" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Elevate: schildersezel met doek dat van kleur verschuift + zwevende kwast. */
function DesignStudio(): JSX.Element {
  const brush = useRef<THREE.Mesh>(null);
  const canvas = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (brush.current) {
      brush.current.position.set(Math.sin(t * 1.8) * 0.14, 0.62 + Math.cos(t * 2.6) * 0.1, 0.1);
      brush.current.rotation.z = Math.sin(t * 1.8) * 0.4 - 0.4;
    }
    canvas.current?.color.setHSL((t * 0.03) % 1, 0.45, 0.75);
  });
  return (
    <group position={[-0.8, 0.3, 0.6]} rotation={[0, 0.6, 0]}>
      {/* ezelpoten */}
      <mesh position={[-0.14, 0.3, -0.05]} rotation={[0.15, 0, 0.12]}>
        <cylinderGeometry args={[0.02, 0.02, 0.62, 5]} />
        <meshStandardMaterial color="#7a5230" />
      </mesh>
      <mesh position={[0.14, 0.3, -0.05]} rotation={[0.15, 0, -0.12]}>
        <cylinderGeometry args={[0.02, 0.02, 0.62, 5]} />
        <meshStandardMaterial color="#7a5230" />
      </mesh>
      {/* doek */}
      <mesh position={[0, 0.55, 0]} rotation={[-0.15, 0, 0]}>
        <planeGeometry args={[0.42, 0.34]} />
        <meshStandardMaterial ref={canvas} color="#f0e2d8" side={THREE.DoubleSide} />
      </mesh>
      {/* kwast */}
      <mesh ref={brush}>
        <cylinderGeometry args={[0.012, 0.02, 0.2, 5]} />
        <meshStandardMaterial color="#ff3fa4" />
      </mesh>
    </group>
  );
}

/** Vrachtwagen die een rondje rijdt (TMS: ritten; Blex: wagenpark-shunten). */
function Truck({ radius, speed, color, pingPong }: { radius: number; speed: number; color: string; pingPong?: boolean }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    if (pingPong) {
      // Shunten: heen en weer op een rechte baan.
      const t = Math.sin(clock.elapsedTime * speed);
      g.position.set(t * radius, 0.08, 0.9);
      g.rotation.y = t >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const t = clock.elapsedTime * speed;
      g.position.set(Math.cos(t) * radius, 0.08, Math.sin(t) * radius);
      g.rotation.y = -t;
    }
  });
  return (
    <group ref={group} scale={0.55}>
      <mesh position={[0.12, 0.14, 0]} castShadow>
        <boxGeometry args={[0.5, 0.26, 0.24]} />
        <meshStandardMaterial color="#dfe8f2" />
      </mesh>
      <mesh position={[-0.28, 0.16, 0]}>
        <boxGeometry args={[0.24, 0.3, 0.24]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

/** TMS-planbord: route-stippen die over een kaartbord lopen. */
function PlanningBoard(): JSX.Element {
  const dots = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    dots.current.forEach((dot, i) => {
      if (!dot) return;
      const t = (clock.elapsedTime * 0.25 + i / 3) % 1;
      // Route: zigzag over het bord.
      const x = -0.22 + t * 0.44;
      const y = 0.52 + Math.sin(t * Math.PI * 3) * 0.09;
      dot.position.set(x, y, 0.03);
    });
  });
  return (
    <group position={[0.9, 0.3, -0.6]} rotation={[0, -2.2, 0]}>
      <mesh position={[0, 0.5, 0]}>
        <planeGeometry args={[0.56, 0.4]} />
        <meshStandardMaterial color="#1e2b3a" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.27, -0.02]}>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 5]} />
        <meshStandardMaterial color="#666" />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => (dots.current[i] = m)}>
          <sphereGeometry args={[0.025, 6, 5]} />
          <meshStandardMaterial color="#ffd75e" emissive="#ffd75e" emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Muzieknoten die opstijgen en vervagen (Uprising stage, Vovara mic). */
function MusicNotes({ color, rate }: { color: string; rate: number }): JSX.Element {
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const texture = useMemo(() => emojiTexture('🎵'), []);
  useFrame(({ clock }) => {
    sprites.current.forEach((sprite, i) => {
      if (!sprite) return;
      const t = (clock.elapsedTime * rate + i / 3) % 1;
      sprite.position.set(Math.sin(t * 6 + i) * 0.15, 0.9 + t * 1.1, 0);
      sprite.material.opacity = t < 0.15 ? t / 0.15 : 1 - t;
      const s = 0.2 + t * 0.1;
      sprite.scale.set(s, s, s);
    });
  });
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <sprite key={i} ref={(s) => (sprites.current[i] = s)}>
          <spriteMaterial map={texture} transparent depthWrite={false} color={color} />
        </sprite>
      ))}
    </group>
  );
}

const LIFE: Record<string, () => JSX.Element> = {
  trading: () => <TradingFloor />,
  elevate: () => <DesignStudio />,
  traject: () => (
    <>
      <PlanningBoard />
      <Truck radius={1.7} speed={0.35} color="#f5c518" />
    </>
  ),
  blex: () => (
    <>
      <Truck radius={1.1} speed={0.5} color="#ffd75e" pingPong />
      {/* extra geparkeerde trailer */}
      <mesh position={[-0.9, 0.16, 0.85]} rotation={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.5, 0.22, 0.2]} />
        <meshStandardMaterial color="#c9d4e0" />
      </mesh>
    </>
  ),
  uprising: () => <MusicNotes color="#ff8a3d" rate={0.35} />,
  vovara: () => <MusicNotes color="#c9a2ff" rate={0.25} />,
};

export function DistrictLife({ world }: { world: WorldConfig }): JSX.Element | null {
  const lodFar = useAra((s) => s.lodFar);
  const placements = useMemo(
    () =>
      world.districts
        .filter((district) => LIFE[district.venture.id])
        .map((district) => {
          const { x, z } = axialToWorld(district.center);
          return {
            id: district.venture.id,
            position: [x * HEX_SPACING, 0.3, z * HEX_SPACING] as [number, number, number],
          };
        }),
    [world],
  );

  if (lodFar) return null; // ver uitgezoomd: district-details overslaan

  return (
    <group>
      {placements.map(({ id, position }) => {
        const Life = LIFE[id]!;
        return (
          <group key={id} position={position}>
            <Life />
          </group>
        );
      })}
    </group>
  );
}
