import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';

/** Low-poly procedural landmarks — no external assets. */

function Khachkar(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.55, 1, 0.16]} />
        <meshStandardMaterial color="#c9705d" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.62, 0.09]}>
        <boxGeometry args={[0.1, 0.55, 0.03]} />
        <meshStandardMaterial color="#8f4a3c" />
      </mesh>
      <mesh position={[0, 0.72, 0.09]}>
        <boxGeometry args={[0.32, 0.1, 0.03]} />
        <meshStandardMaterial color="#8f4a3c" />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[0.8, 0.12, 0.5]} />
        <meshStandardMaterial color="#a8837b" />
      </mesh>
    </group>
  );
}

function ApricotTree({ seed = 0 }: { seed?: number }): JSX.Element {
  const lean = ((seed % 7) - 3) * 0.04;
  return (
    <group rotation={[0, seed, lean]}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, 0.6, 6]} />
        <meshStandardMaterial color="#7a5230" />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <sphereGeometry args={[0.32, 8, 6]} />
        <meshStandardMaterial color="#6aa84f" flatShading />
      </mesh>
      <mesh position={[0.15, 0.78, 0.12]}>
        <sphereGeometry args={[0.06, 6, 5]} />
        <meshStandardMaterial color="#f4a259" />
      </mesh>
      <mesh position={[-0.14, 0.66, -0.05]}>
        <sphereGeometry args={[0.06, 6, 5]} />
        <meshStandardMaterial color="#f4a259" />
      </mesh>
    </group>
  );
}

function MotherArmenia(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color="#b98d7f" />
      </mesh>
      <mesh position={[0, 1.35, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.28, 1.1, 8]} />
        <meshStandardMaterial color="#8d7f75" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.02, 0]}>
        <sphereGeometry args={[0.14, 8, 6]} />
        <meshStandardMaterial color="#8d7f75" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* sword held horizontally */}
      <mesh position={[0, 1.75, 0.28]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.06, 1, 0.04]} />
        <meshStandardMaterial color="#d8d3cc" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Wapperende Armeense driekleur op de top van de Cascade. */
function ArmenianFlag(): JSX.Element {
  const flag = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (flag.current) {
      flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25;
      flag.current.scale.x = 1 + Math.sin(clock.elapsedTime * 4.5) * 0.06;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.022, 0.028, 1.1, 6]} />
        <meshStandardMaterial color="#d8d3cc" metalness={0.4} />
      </mesh>
      <group ref={flag} position={[0.26, 0.92, 0]}>
        {(['#d90012', '#0033a0', '#f2a800'] as const).map((color, i) => (
          <mesh key={color} position={[0, 0.1 - i * 0.1, 0]}>
            <planeGeometry args={[0.5, 0.1]} />
            <meshStandardMaterial color={color} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function CascadeStairs(): JSX.Element {
  return (
    <group>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, 0.12 + i * 0.24, -i * 0.34]} castShadow>
          <boxGeometry args={[2.2 - i * 0.3, 0.24, 0.5]} />
          <meshStandardMaterial color={i % 2 ? '#e8c9b0' : '#dcb9a2'} />
        </mesh>
      ))}
    </group>
  );
}

function Obelisk(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.2, 1.6, 4]} />
        <meshStandardMaterial color="#d4af37" metalness={0.75} roughness={0.25} />
      </mesh>
      <mesh position={[0, 1.72, 0]}>
        <coneGeometry args={[0.13, 0.24, 4]} />
        <meshStandardMaterial color="#ffd75e" emissive="#ffd75e" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function TruckDepot(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[1.1, 0.6, 0.8]} />
        <meshStandardMaterial color="#f0e9df" />
      </mesh>
      <mesh position={[0, 0.68, 0]}>
        <boxGeometry args={[1.2, 0.16, 0.9]} />
        <meshStandardMaterial color="#f5c518" />
      </mesh>
      <mesh position={[0.75, 0.22, 0.15]} castShadow>
        <boxGeometry args={[0.5, 0.34, 0.3]} />
        <meshStandardMaterial color="#4da3ff" />
      </mesh>
      <mesh position={[0.98, 0.22, 0.15]}>
        <boxGeometry args={[0.16, 0.26, 0.28]} />
        <meshStandardMaterial color="#dfe8f2" />
      </mesh>
    </group>
  );
}

function Warehouse(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[1.2, 0.7, 0.9]} />
        <meshStandardMaterial color="#e7ded2" />
      </mesh>
      <mesh position={[0, 0.82, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.68, 0.68, 0.95]} />
        <meshStandardMaterial color="#c9a86a" />
      </mesh>
      <mesh position={[0.85, 0.18, 0]} castShadow>
        <boxGeometry args={[0.42, 0.3, 0.26]} />
        <meshStandardMaterial color="#ffd75e" />
      </mesh>
    </group>
  );
}

function Billboard(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
        <meshStandardMaterial color="#666" />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[1.2, 0.66, 0.08]} />
        <meshStandardMaterial color="#ff3fa4" emissive="#ff3fa4" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0.4, 0.24, 0.3]} rotation={[0.4, 0.6, 0]}>
        <boxGeometry args={[0.16, 0.16, 0.3]} />
        <meshStandardMaterial color="#333" />
      </mesh>
    </group>
  );
}

function Stage(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.7, 0.75, 0.3, 12]} />
        <meshStandardMaterial color="#3b3347" />
      </mesh>
      <mesh position={[0, 0.75, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.55, 0.05, 8, 12, Math.PI]} />
        <meshStandardMaterial color="#ff8a3d" emissive="#ff8a3d" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0.25, 0.45, 0.1]} castShadow>
        <boxGeometry args={[0.28, 0.3, 0.28]} />
        <meshStandardMaterial color="#7c4dff" />
      </mesh>
    </group>
  );
}

function MicStatue(): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.14, 0.7, 8]} />
        <meshStandardMaterial color="#5b4a6b" />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.22, 10, 8]} />
        <meshStandardMaterial color="#9b5cff" metalness={0.4} roughness={0.35} emissive="#9b5cff" emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

const LANDMARKS: Record<string, () => JSX.Element> = {
  'truck-depot': TruckDepot,
  warehouse: Warehouse,
  billboard: Billboard,
  stage: Stage,
  obelisk: Obelisk,
  'mic-statue': MicStatue,
  khachkar: Khachkar,
};

export function Landmarks({ world }: { world: WorldConfig | null }): JSX.Element {
  const placements = useMemo(() => {
    if (!world) return [];
    return world.districts.map((district) => {
      const { x, z } = axialToWorld(district.center);
      return {
        key: district.venture.id,
        landmark: district.venture.landmark,
        position: new THREE.Vector3(x * HEX_SPACING, 0.3, z * HEX_SPACING),
        seed: district.venture.id.length,
      };
    });
  }, [world]);

  return (
    <group>
      {/* Hub: Cascade stairs + Mother Armenia + apricot trees */}
      <group position={[0, 0.15, 0]}>
        <CascadeStairs />
        <group position={[-0.8, 1.15, -1.4]}>
          <ArmenianFlag />
        </group>
        <group position={[0, 1.2, -1.5]} scale={0.8}>
          <MotherArmenia />
        </group>
        <group position={[1.7, 0, 1]}>
          <ApricotTree seed={1} />
        </group>
        <group position={[-1.7, 0, 1.2]}>
          <ApricotTree seed={4} />
        </group>
      </group>

      {placements.map(({ key, landmark, position, seed }) => {
        const Landmark = LANDMARKS[landmark] ?? Khachkar;
        return (
          <group key={key} position={position}>
            <Landmark />
            <group position={[0.9, 0, -0.6]} scale={0.8}>
              <ApricotTree seed={seed} />
            </group>
          </group>
        );
      })}
    </group>
  );
}
