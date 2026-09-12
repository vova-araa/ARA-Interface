import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OfficeSnapshot, Station, StaffMember } from '@ara/shared';
import { chipTexture, valueTexture, headlineTexture, factsTexture, roomTexture, TONE_COLORS } from './textures.ts';

/**
 * Het kantoor-interieur: rijen bureaus met schermen en werkende agents, de
 * muurschermen met live cijfers, een vergaderruimte en de leiding (manager +
 * supervisor). Eén isometrische blik, net als de wereldkaart buiten.
 */

const COLS = 6;
const DESK_X = 3.5;
const DESK_Z = 3.0;

const STATUS_COLOR: Record<Station['status'], string> = {
  working: '#6ee7ff',
  idle: '#6b6390',
  alert: '#ff6b6b',
  done: '#4ade80',
};

/** Afmetingen van de zaal, afgeleid van het aantal werkplekken. */
export function officeSize(total: number): { rows: number; width: number; depth: number } {
  const rows = Math.ceil(total / COLS);
  return {
    rows,
    width: COLS * DESK_X + 7,
    depth: Math.max(16, rows * DESK_Z + 11),
  };
}

function deskPosition(index: number, total: number): [number, number, number] {
  const rows = Math.ceil(total / COLS);
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return [(col - (COLS - 1) / 2) * DESK_X, 0, (row - (rows - 1) / 2) * DESK_Z];
}

/** Klein werkend poppetje: typt, wiebelt, kijkt rond. */
function Worker({ color, active, seed }: { color: string; active: boolean; seed: number }): JSX.Element {
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (active) {
      // Typen: armen tikken tegenfasig, romp veert mee.
      if (leftArm.current) leftArm.current.rotation.x = -0.9 + Math.sin(t * 9) * 0.22;
      if (rightArm.current) rightArm.current.rotation.x = -0.9 + Math.sin(t * 9 + Math.PI) * 0.22;
      if (body.current) body.current.position.y = Math.sin(t * 4.5) * 0.012;
      if (head.current) head.current.rotation.y = Math.sin(t * 0.7) * 0.18;
    } else {
      if (leftArm.current) leftArm.current.rotation.x = -0.35;
      if (rightArm.current) rightArm.current.rotation.x = -0.35;
      if (head.current) head.current.rotation.y = Math.sin(t * 0.45) * 0.5;
      if (body.current) body.current.position.y = Math.sin(t * 1.6) * 0.02;
    }
  });

  return (
    <group ref={body}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.17, 0.3, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      <group ref={leftArm} position={[-0.2, 0.6, 0]}>
        <mesh position={[0, -0.12, 0.1]}>
          <capsuleGeometry args={[0.05, 0.2, 3, 6]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.2, 0.6, 0]}>
        <mesh position={[0, -0.12, 0.1]}>
          <capsuleGeometry args={[0.05, 0.2, 3, 6]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      </group>
      <group ref={head} position={[0, 0.82, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.16, 12, 10]} />
          <meshStandardMaterial color="#ffd9b8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.07, 0]}>
          <sphereGeometry args={[0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#2a2340" roughness={0.75} />
        </mesh>
      </group>
      {/* stoel */}
      <mesh position={[0, 0.26, -0.34]}>
        <boxGeometry args={[0.42, 0.5, 0.08]} />
        <meshStandardMaterial color="#2f2750" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Eén werkplek: bureau, scherm, naamplaatje, resultaat en de agent erachter. */
function Desk({
  station,
  index,
  total,
  accent,
  selected,
  valueKind,
  onSelect,
}: {
  station: Station;
  index: number;
  total: number;
  accent: string;
  selected: boolean;
  valueKind: OfficeSnapshot['valueKind'];
  onSelect: (id: string) => void;
}): JSX.Element {
  const [x, , z] = deskPosition(index, total);
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const valueSprite = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  // Elk bureau heeft iemand zitten; alleen de werkenden typen echt.
  const manned = station.status !== 'idle' || index % 5 !== 4;

  const chip = useMemo(
    () => chipTexture(station.label, station.sub, accent),
    [station.label, station.sub, accent],
  );
  const valueText =
    valueKind === 'money'
      ? `${station.value >= 0 ? '+' : '-'}$${Math.abs(station.value).toFixed(2)}`
      : `${station.value >= 0 ? '+' : ''}${Math.round(station.value)}`;
  const tone = station.value >= 0 ? 'good' : 'bad';
  const value = useMemo(() => valueTexture(valueText, tone), [valueText, tone]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + index * 0.7;
    if (screen.current) {
      const base = station.status === 'working' ? 1.1 : station.status === 'alert' ? 0.9 : 0.35;
      screen.current.emissiveIntensity = base + Math.sin(t * (station.status === 'working' ? 6 : 1.5)) * 0.18;
    }
    if (valueSprite.current) {
      valueSprite.current.position.y = 2.45 + Math.sin(t * 1.3) * 0.07;
    }
    if (ring.current) ring.current.rotation.z = t * 0.9;
  });

  return (
    <group position={[x, 0, z]} onClick={(e) => { e.stopPropagation(); onSelect(station.id); }}>
      {/* blad + poten */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.09, 1.25]} />
        <meshStandardMaterial color="#ded7f5" roughness={0.55} />
      </mesh>
      {[[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx!, 0.37, lz!]}>
          <cylinderGeometry args={[0.05, 0.05, 0.74, 6]} />
          <meshStandardMaterial color="#6a5fa0" roughness={0.8} />
        </mesh>
      ))}
      {/* scherm */}
      <group position={[0, 1.18, -0.3]} rotation={[-0.16, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.35, 0.8, 0.06]} />
          <meshStandardMaterial color="#15102c" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <planeGeometry args={[1.22, 0.68]} />
          <meshStandardMaterial
            ref={screen}
            color="#0d0a1e"
            emissive={STATUS_COLOR[station.status]}
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh position={[0, 0.87, -0.3]}>
        <cylinderGeometry args={[0.16, 0.2, 0.16, 8]} />
        <meshStandardMaterial color="#15102c" roughness={0.5} />
      </mesh>
      {/* toetsenbord */}
      <mesh position={[0, 0.8, 0.25]} rotation={[-0.05, 0, 0]}>
        <boxGeometry args={[0.8, 0.03, 0.28]} />
        <meshStandardMaterial color="#2a2350" roughness={0.7} />
      </mesh>

      {/* tussenschot rechts van het bureau — de cubicle-rij uit de referentie */}
      <mesh position={[1.42, 1.05, -0.05]}>
        <boxGeometry args={[0.07, 0.62, 1.3]} />
        <meshStandardMaterial color="#5a4d94" roughness={0.85} transparent opacity={0.85} />
      </mesh>

      {manned && (
        <group position={[0, 0, -1.05]} scale={1.15}>
          <Worker color={accent} active={station.status === 'working'} seed={index * 1.7} />
        </group>
      )}

      {/* naamplaatje boven het bureau */}
      <sprite position={[0, 1.95, 0]} scale={[1.45 * chip.aspect * 0.62, 0.62, 1]}>
        <spriteMaterial map={chip.texture} transparent depthWrite={false} />
      </sprite>
      {/* zwevend resultaat */}
      <sprite ref={valueSprite} position={[1.2, 2.45, 0]} scale={[0.95, 0.28, 1]}>
        <spriteMaterial map={value.texture} transparent depthWrite={false} />
      </sprite>

      {/* selectie- en alarmring op de vloer */}
      {(selected || station.status === 'alert') && (
        <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.35, 1.55, 32]} />
          <meshBasicMaterial
            color={selected ? '#ffd75e' : '#ff6b6b'}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/** Leidinggevende op een verhoging: manager per tak, chief boven alles. */
function Leader({
  member,
  position,
  color,
  onSelect,
  selected,
}: {
  member: StaffMember;
  position: [number, number, number];
  color: string;
  onSelect: (id: string) => void;
  selected: boolean;
}): JSX.Element {
  const chip = useMemo(() => chipTexture(member.name, member.status, color), [member.name, member.status, color]);
  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); onSelect(member.id); }}>
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <cylinderGeometry args={[1.1, 1.25, 0.32, 8]} />
        <meshStandardMaterial color={selected ? '#4b3c86' : '#3a2f6b'} roughness={0.8} />
      </mesh>
      <group position={[0, 0.32, 0]}>
        <Worker color={color} active={Boolean(member.busyWith)} seed={7} />
      </group>
      <sprite position={[0, 1.85, 0]} scale={[1.5 * chip.aspect * 0.6, 0.6, 1]}>
        <spriteMaterial map={chip.texture} transparent depthWrite={false} />
      </sprite>
      <pointLight position={[0, 2.2, 0]} color={color} intensity={6} distance={6} />
    </group>
  );
}

/** Ruimte: vloer, twee wanden en het glazen vergaderhok. */
function Room({ office, accent }: { office: OfficeSnapshot; accent: string }): JSX.Element {
  const { rows, width, depth } = officeSize(office.stations.length);
  const backZ = -depth / 2;
  const head = useMemo(() => headlineTexture(office), [office]);
  const facts = useMemo(() => factsTexture(office), [office]);
  const room = useMemo(() => roomTexture(office), [office]);
  const rowZ = (r: number): number => (r - (rows - 1) / 2) * DESK_Z;

  return (
    <group>
      {/* vloer */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#2b2050" roughness={0.9} />
      </mesh>
      {/* tapijtbaan per bureaurij + lichtstrip erboven */}
      {Array.from({ length: rows }, (_, r) => (
        <group key={r} position={[0, 0, rowZ(r)]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
            <planeGeometry args={[COLS * DESK_X + 1.2, 2.5]} />
            <meshStandardMaterial color="#3c2e6e" roughness={0.88} emissive="#2a1f52" emissiveIntensity={0.4} />
          </mesh>
        </group>
      ))}
      {/* achterwand + linkerwand */}
      <mesh position={[0, 5, backZ]} receiveShadow>
        <planeGeometry args={[width, 10]} />
        <meshStandardMaterial color="#241a45" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-width / 2, 5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, 10]} />
        <meshStandardMaterial color="#1f1740" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* muurschermen: groot hoofdscherm + feitenpaneel */}
      <mesh position={[-0.6, 5.2, backZ + 0.1]}>
        <planeGeometry args={[14, 3.8]} />
        <meshBasicMaterial map={head.texture} transparent toneMapped={false} />
      </mesh>
      <mesh position={[width / 2 - 4.4, 4.9, backZ + 0.1]}>
        <planeGeometry args={[6.2, 3.6]} />
        <meshBasicMaterial map={facts.texture} transparent toneMapped={false} />
      </mesh>

      {/* glazen vergaderhok tegen de linkerwand, met het overlegscherm */}
      <group position={[-width / 2 + 3.6, 0, backZ + depth * 0.62]}>
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[6.4, 5.6]} />
          <meshStandardMaterial color="#3d2f6e" roughness={0.8} />
        </mesh>
        <mesh position={[3.2, 1.7, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[5.6, 3.4]} />
          <meshPhysicalMaterial color="#9fd8ff" transparent opacity={0.13} roughness={0.05} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.7, 2.8]}>
          <planeGeometry args={[6.4, 3.4]} />
          <meshPhysicalMaterial color="#9fd8ff" transparent opacity={0.11} roughness={0.05} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 2.4, -2.75]}>
          <planeGeometry args={[5.2, 3.2]} />
          <meshBasicMaterial map={room.texture} transparent toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.64, 0]} castShadow>
          <cylinderGeometry args={[1.15, 1.15, 0.1, 20]} />
          <meshStandardMaterial color="#ded7f5" roughness={0.6} />
        </mesh>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          return (
            <group key={i} position={[Math.cos(a) * 1.75, 0, Math.sin(a) * 1.75]} rotation={[0, -a, 0]}>
              <Worker color={i % 2 ? '#8ab4ff' : accent} active={i % 2 === 0} seed={i * 3.1} />
            </group>
          );
        })}
      </group>
    </group>
  );
}

export function OfficeScene({
  office,
  accent,
  selectedId,
  onSelect,
}: {
  office: OfficeSnapshot;
  accent: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { width, depth } = officeSize(office.stations.length);
  const manager = office.staff.find((s) => s.role === 'manager');
  const chief = office.staff.find((s) => s.role === 'supervisor');

  return (
    <group>
      <ambientLight intensity={0.75} color="#c9bdff" />
      <hemisphereLight args={['#b9a6ff', '#2a1f52', 0.7]} />
      <directionalLight
        position={[10, 16, 8]}
        intensity={1.5}
        color="#fff2e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <pointLight position={[0, 7, -depth / 2 + 3]} color={accent} intensity={26} distance={30} />

      <Room office={office} accent={accent} />

      {office.stations.map((station, i) => (
        <Desk
          key={station.id}
          station={station}
          index={i}
          total={office.stations.length}
          accent={accent}
          selected={selectedId === station.id}
          valueKind={office.valueKind}
          onSelect={onSelect}
        />
      ))}

      {manager && (
        <Leader
          member={manager}
          position={[width / 2 - 3.4, 0, depth / 2 - 3.2]}
          color={accent}
          onSelect={onSelect}
          selected={selectedId === manager.id}
        />
      )}
      {chief && (
        <Leader
          member={chief}
          position={[-width / 2 + 3.4, 0, depth / 2 - 3.2]}
          color="#ffd75e"
          onSelect={onSelect}
          selected={selectedId === chief.id}
        />
      )}
    </group>
  );
}
