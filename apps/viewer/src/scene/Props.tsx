import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';

/**
 * Props-clutter per district (referentie-look): rode kratstapels,
 * zonnepanelen, knipperende antennes, vaten. Deterministisch geplaatst
 * (stableHash) zodat de wereld nooit verspringt.
 */

function CrateStack({ seed }: { seed: number }): JSX.Element {
  const layers = 1 + (seed % 3);
  return (
    <group rotation={[0, (seed % 6) * 0.5, 0]}>
      {Array.from({ length: layers }, (_, layer) =>
        Array.from({ length: Math.max(1, 3 - layer) }, (_, i) => (
          <mesh
            key={`${layer}-${i}`}
            position={[(i - (2 - layer) / 2) * 0.17, 0.08 + layer * 0.16, (layer % 2) * 0.04]}
            castShadow
          >
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color={(seed + layer + i) % 4 === 0 ? '#d94f4f' : '#c0392b'} />
          </mesh>
        )),
      )}
    </group>
  );
}

function SolarPanel({ seed }: { seed: number }): JSX.Element {
  return (
    <group rotation={[0, (seed % 7) * 0.9, 0]}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 0.2, 5]} />
        <meshStandardMaterial color="#8b95a5" />
      </mesh>
      <mesh position={[0, 0.24, 0]} rotation={[-0.6, 0, 0]}>
        <boxGeometry args={[0.42, 0.02, 0.28]} />
        <meshStandardMaterial color="#1d3a6e" metalness={0.6} roughness={0.25} emissive="#274b8f" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function Antenna({ seed }: { seed: number }): JSX.Element {
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (beacon.current) {
      beacon.current.emissiveIntensity = Math.sin(clock.elapsedTime * 3 + seed) > 0.2 ? 2.2 : 0.15;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.012, 0.035, 0.56, 5]} />
        <meshStandardMaterial color="#aab4c0" metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <torusGeometry args={[0.07, 0.008, 5, 10]} />
        <meshStandardMaterial color="#aab4c0" metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial ref={beacon} color="#ff5252" emissive="#ff5252" emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Barrels({ seed }: { seed: number }): JSX.Element {
  const colors = ['#2e86c1', '#e67e22', '#8b95a5'];
  return (
    <group rotation={[0, seed, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[(i - 1) * 0.14, 0.09, (i % 2) * 0.1]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 0.18, 8]} />
          <meshStandardMaterial color={colors[(seed + i) % 3]} />
        </mesh>
      ))}
    </group>
  );
}

function MiniDome({ seed }: { seed: number }): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.1, 0]} castShadow>
        <sphereGeometry args={[0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={seed % 2 ? '#c9a06a' : '#e8eaf0'} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.24, 0.26, 0.06, 10]} />
        <meshStandardMaterial color="#8f8578" />
      </mesh>
    </group>
  );
}

const PROP_SET = [CrateStack, SolarPanel, Antenna, Barrels, MiniDome];

interface PropPlacement {
  key: string;
  kind: number;
  seed: number;
  position: [number, number, number];
}

export function Props({ world }: { world: WorldConfig }): JSX.Element {
  const placements = useMemo((): PropPlacement[] => {
    const out: PropPlacement[] = [];
    for (const district of world.districts) {
      for (const project of district.projects) {
        // Ring-hexes van elk cluster krijgen ~60% kans op een prop.
        for (const hex of project.hexes.slice(1)) {
          const seed = stableHash(`${project.name}:${hex.q},${hex.r}`);
          if (seed % 10 >= 6) continue;
          const { x, z } = axialToWorld(hex);
          const offsetAngle = (seed % 628) / 100;
          out.push({
            key: `${project.name}-${hex.q}-${hex.r}`,
            kind: seed % PROP_SET.length,
            seed,
            position: [
              x * HEX_SPACING + Math.cos(offsetAngle) * 0.45,
              0.31,
              z * HEX_SPACING + Math.sin(offsetAngle) * 0.45,
            ],
          });
        }
      }
    }
    return out;
  }, [world]);

  return (
    <group>
      {placements.map((prop) => {
        const Prop = PROP_SET[prop.kind]!;
        return (
          <group key={prop.key} position={prop.position} scale={1.25}>
            <Prop seed={prop.seed % 97} />
          </group>
        );
      })}
    </group>
  );
}
