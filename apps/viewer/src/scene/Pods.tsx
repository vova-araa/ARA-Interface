import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SessionState, WorldConfig } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { projectPlacement, sessionPosition } from '../placements.ts';
import { toolColor } from '../util.ts';
import { useDaylight } from './daylight.ts';

const SHOW_WINDOW_MS = 24 * 60 * 60 * 1000; // pods linger for a day

export interface PodInfo {
  session: SessionState;
  position: { x: number; z: number };
}

export function visiblePods(world: WorldConfig, sessions: SessionState[]): PodInfo[] {
  const now = Date.now();
  const byProject = new Map<string, SessionState[]>();
  for (const session of sessions) {
    if (now - session.lastSeenAt > SHOW_WINDOW_MS) continue;
    const list = byProject.get(session.project) ?? [];
    list.push(session);
    byProject.set(session.project, list);
  }
  const pods: PodInfo[] = [];
  for (const list of byProject.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt);
    list.forEach((session, index) => {
      pods.push({ session, position: sessionPosition(world, session, index) });
    });
  }
  return pods;
}

function Pod({ info }: { info: PodInfo }): JSX.Element {
  const { session, position } = info;
  const groupRef = useRef<THREE.Group>(null);
  const spawnedAt = useRef(Date.now());
  const daylight = useDaylight();
  const bodyMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const innerLight = useRef<THREE.MeshStandardMaterial>(null);
  const ringRef = useRef<THREE.Group>(null);
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);
  const selected = useAra((s) => s.selectedSessionId === session.sessionId);

  const lightColor = useMemo(
    () => new THREE.Color(toolColor(session.activeTool ?? session.lastTool)),
    [session.activeTool, session.lastTool],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const group = groupRef.current;
    if (!group) return;

    // Spawn: veerkrachtig opduiken uit de grond (~0.6s).
    const born = Math.min(1, (Date.now() - spawnedAt.current) / 600);
    const pop = born < 1 ? 1 - Math.pow(1 - born, 3) * Math.cos(born * Math.PI * 2) * 0.3 - Math.pow(1 - born, 3) : 1;

    // Beëindigde sessies dommelen in: kleiner, geen ademhaling.
    const ended = session.endedAt !== undefined;
    const breathe = !ended && session.status === 'idle' ? 1 + Math.sin(t * 1.6) * 0.02 : 1;
    group.scale.setScalar(1.5 * breathe * pop * (ended ? 0.78 : 1));
    group.position.y = -(1 - born) * 0.5; // relatief: stijgt uit de grond op

    // 's Nachts gloeien de koepels — de stad leeft door.
    const nightGlow = daylight.period === 'night' ? 0.3 : daylight.period === 'dusk' ? 0.18 : 0;

    if (innerLight.current) {
      if (session.status === 'working') {
        innerLight.current.emissive.copy(lightColor);
        innerLight.current.emissiveIntensity = 0.8 + Math.sin(t * 6) * 0.5;
      } else if (session.status === 'done') {
        innerLight.current.emissive.set('#3ecf6f');
        innerLight.current.emissiveIntensity = ended ? 0.35 + nightGlow : 0.7;
      } else {
        innerLight.current.emissiveIntensity = 0.12 + nightGlow;
      }
    }
    if (bodyMaterial.current) {
      if (session.status === 'error') {
        const flicker = Math.random() > 0.5 ? 0.65 : 0.15;
        bodyMaterial.current.emissive.set('#ff5252');
        bodyMaterial.current.emissiveIntensity = flicker;
      } else {
        bodyMaterial.current.emissive.set('#000000');
        bodyMaterial.current.emissiveIntensity = 0;
      }
    }
    if (ringRef.current) {
      ringRef.current.visible = session.status === 'needsHuman';
      ringRef.current.rotation.y = t * 1.2;
    }
  });

  return (
    <group
      position={[position.x, 0.32, position.z]}
      onClick={(e) => {
        e.stopPropagation();
        select(session.sessionId);
        flyTo(session.sessionId);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'default')}
    >
      <group ref={groupRef}>
        {/* white capsule body */}
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.34, 0.42, 16]} />
          <meshStandardMaterial ref={bodyMaterial} color="#f7f5f2" roughness={0.4} />
        </mesh>
        {/* inner light core */}
        <mesh position={[0, 0.4, 0]}>
          <sphereGeometry args={[0.17, 12, 10]} />
          <meshStandardMaterial ref={innerLight} color="#dfe8f2" emissive="#4da3ff" emissiveIntensity={0.12} toneMapped={false} />
        </mesh>
        {/* blue glass dome */}
        <mesh position={[0, 0.45, 0]}>
          <sphereGeometry args={[0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial color="#7db8ff" transparent opacity={0.4} roughness={0.05} metalness={0.1} />
        </mesh>
        {/* done cap */}
        {session.status === 'done' && (
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color="#3ecf6f" emissive="#3ecf6f" emissiveIntensity={0.6} toneMapped={false} />
          </mesh>
        )}
        {/* needs-human amber beacon + rotating ring */}
        <group ref={ringRef} visible={false}>
          <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.45, 0.03, 8, 24]} />
            <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={1.2} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.86, 0]}>
            <sphereGeometry args={[0.07, 8, 6]} />
            <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={1.6} toneMapped={false} />
          </mesh>
        </group>
        {/* selection ring */}
        {selected && (
          <mesh position={[0, -0.28, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.5, 0.6, 24]} />
            <meshBasicMaterial color="#ff6b57" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    </group>
  );
}

export function Pods({ world }: { world: WorldConfig }): JSX.Element {
  const snapshot = useViewSnapshot();
  const filterVenture = useAra((s) => s.filterVenture);

  const pods = useMemo(() => {
    let sessions = Object.values(snapshot.sessions);
    if (filterVenture) {
      sessions = sessions.filter(
        (s) => projectPlacement(world, s.project).venture === filterVenture,
      );
    }
    return visiblePods(world, sessions);
  }, [snapshot, world, filterVenture]);

  return (
    <group>
      {pods.map((info) => (
        <Pod key={info.session.sessionId} info={info} />
      ))}
    </group>
  );
}
