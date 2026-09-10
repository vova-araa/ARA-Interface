import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { visibleInWorld, type SessionState, type WorldConfig } from '@ara/shared';
import { speedForLatency, useAra, useViewSnapshot } from '../store.ts';
import { projectPlacement, sessionPosition } from '../placements.ts';
import { toolColor } from '../util.ts';
import { useDaylight } from './daylight.ts';

const SHOW_WINDOW_MS = 24 * 60 * 60 * 1000; // pods linger for a day

/** Pod-gedaante per model: haiku klein en snel, opus/fable een gloeiende titaan. */
function modelStyle(model: string | undefined): { scale: number; dome: string; boost: number } {
  const m = (model ?? '').toLowerCase();
  if (m.includes('haiku')) return { scale: 0.82, dome: '#8fe3ff', boost: 0 };
  if (m.includes('opus') || m.includes('fable') || m.includes('mythos'))
    return { scale: 1.18, dome: '#ffd9a0', boost: 0.25 };
  return { scale: 1, dome: '#7db8ff', boost: 0 }; // sonnet / onbekend
}

export interface PodInfo {
  session: SessionState;
  position: { x: number; z: number };
}

export function visiblePods(
  world: WorldConfig,
  sessions: SessionState[],
  // Snapshot-tijd meegeven: bij een history-scrub is "nu" de replay-tijd.
  now = Date.now(),
): PodInfo[] {
  const byProject = new Map<string, SessionState[]>();
  for (const session of sessions) {
    if (now - session.lastSeenAt > SHOW_WINDOW_MS) continue;
    if (!visibleInWorld(world, session.project)) continue; // verborgen ventures (bv. Nor Kaghak)
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
  const spark1 = useRef<THREE.Mesh>(null);
  const spark2 = useRef<THREE.Mesh>(null);
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);
  const selected = useAra((s) => s.selectedSessionId === session.sessionId);
  const live = useAra((s) => s.liveStatus[session.sessionId]);
  const latency = useAra((s) => s.latency[session.sessionId]);
  const island = useRef<THREE.Group>(null);
  // Latency-physics: échte gemiddelde tool-duur (OTel) bepaalt het werktempo.
  const speed = speedForLatency(latency);

  const lightColor = useMemo(
    () => new THREE.Color(toolColor(session.activeTool ?? session.lastTool)),
    [session.activeTool, session.lastTool],
  );
  const style = useMemo(() => modelStyle(session.model ?? live?.model), [session.model, live?.model]);
  // Context-buis: vulling 0..1 uit de live statusline-feed.
  const contextFill = live ? Math.min(1, Math.max(0, live.contextPct / 100)) : null;
  const tubeColor = contextFill === null ? '#3ecf6f' : contextFill > 0.85 ? '#ff5252' : contextFill > 0.6 ? '#ffb020' : '#3ecf6f';

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const group = groupRef.current;
    if (!group) return;

    // Spawn met squash & stretch: uit de grond veren, uitrekken, neerploffen.
    const born = Math.min(1, (Date.now() - spawnedAt.current) / 700);
    const pop = born < 1 ? 1 - Math.pow(1 - born, 3) : 1;
    const overshoot = born < 1 ? Math.sin(born * Math.PI) * 0.35 * (1 - born) : 0;
    const sy = pop + overshoot; // rekt uit tijdens de sprong
    const sxz = sy > 0.01 ? 1 / Math.sqrt(sy) : 1; // volume-behoud → squash

    // Beëindigde sessies dommelen in: kleiner, geen ademhaling.
    const ended = session.endedAt !== undefined;
    const breathe = !ended && session.status === 'idle' ? 1 + Math.sin(t * 1.6) * 0.02 : 1;
    const base = 1.7 * style.scale * breathe * (ended ? 0.78 : 1);
    group.scale.set(base * sxz, base * sy, base * sxz);
    group.position.y = -(1 - born) * 0.5; // relatief: stijgt uit de grond op

    // 's Nachts gloeien de koepels — de stad leeft door.
    const nightGlow = daylight.period === 'night' ? 0.3 : daylight.period === 'dusk' ? 0.18 : 0;

    if (innerLight.current) {
      if (session.compacting) {
        // Context-storm: koel blauw pulserend terwijl herinneringen comprimeren.
        innerLight.current.emissive.set('#9ecbff');
        innerLight.current.emissiveIntensity = 0.9 + Math.sin(t * 10) * 0.5;
      } else if (session.status === 'working') {
        innerLight.current.emissive.copy(lightColor);
        innerLight.current.emissiveIntensity = 0.8 + style.boost + Math.sin(t * 6 * speed) * 0.5;
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

    // Werkende pods krijgen orbiterende vonken in de tool-kleur.
    const working = session.status === 'working';
    if (spark1.current) {
      spark1.current.visible = working;
      const ts1 = t * speed;
      spark1.current.position.set(Math.cos(ts1 * 3.1) * 0.5, 0.45 + Math.sin(ts1 * 5) * 0.12, Math.sin(ts1 * 3.1) * 0.5);
      (spark1.current.material as THREE.MeshStandardMaterial).emissive.copy(lightColor);
    }
    if (spark2.current) {
      spark2.current.visible = working;
      const ts2 = t * speed;
      spark2.current.position.set(Math.cos(ts2 * 2.3 + Math.PI) * 0.55, 0.4 + Math.cos(ts2 * 4) * 0.1, Math.sin(ts2 * 2.3 + Math.PI) * 0.55);
      (spark2.current.material as THREE.MeshStandardMaterial).emissive.copy(lightColor);
    }

    // Worktree-eiland dobbert naast de pod zolang er een worktree actief is.
    if (island.current) {
      island.current.visible = (session.worktrees ?? 0) > 0;
      island.current.position.y = 0.55 + Math.sin(t * 1.8) * 0.06;
      island.current.rotation.y = Math.sin(t * 0.6) * 0.15;
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
        {/* glass dome — kleur verraadt het model (haiku ijsblauw, opus/fable goud) */}
        <mesh position={[0, 0.45, 0]}>
          <sphereGeometry args={[0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial color={style.dome} transparent opacity={0.4} roughness={0.05} metalness={0.1} />
        </mesh>

        {/* worktree-eiland: mini-hex met boompje, dobbert naast de pod */}
        <group ref={island} visible={false} position={[0.85, 0.55, -0.45]} scale={0.8}>
          <mesh castShadow>
            <cylinderGeometry args={[0.28, 0.22, 0.14, 6]} />
            <meshStandardMaterial color="#c98d84" />
          </mesh>
          <mesh position={[0, 0.16, 0]}>
            <coneGeometry args={[0.12, 0.22, 6]} />
            <meshStandardMaterial color="#3ecf6f" />
          </mesh>
          {/* loopbruggetje richting de pod */}
          <mesh position={[-0.38, -0.02, 0.22]} rotation={[0, 0.5, 0]}>
            <boxGeometry args={[0.34, 0.03, 0.1]} />
            <meshStandardMaterial color="#d8d3cc" />
          </mesh>
        </group>

        {/* context-buis: hoe vol zit het geheugen van deze sessie (statusline-feed) */}
        {contextFill !== null && (
          <group position={[-0.52, 0.28, 0.1]}>
            <mesh>
              <cylinderGeometry args={[0.055, 0.055, 0.56, 8, 1, true]} />
              <meshPhysicalMaterial color="#dfe8f2" transparent opacity={0.25} roughness={0.1} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, -0.28 + (contextFill * 0.56) / 2, 0]}>
              <cylinderGeometry args={[0.04, 0.04, Math.max(0.02, contextFill * 0.56), 8]} />
              <meshStandardMaterial color={tubeColor} emissive={tubeColor} emissiveIntensity={0.7} toneMapped={false} />
            </mesh>
          </group>
        )}
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
        {/* orbit-vonken (alleen zichtbaar tijdens werken) */}
        <mesh ref={spark1} visible={false}>
          <sphereGeometry args={[0.045, 6, 5]} />
          <meshStandardMaterial color="#fff" emissive="#4da3ff" emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <mesh ref={spark2} visible={false}>
          <sphereGeometry args={[0.035, 6, 5]} />
          <meshStandardMaterial color="#fff" emissive="#4da3ff" emissiveIntensity={2} toneMapped={false} />
        </mesh>
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
    return visiblePods(world, sessions, snapshot.now);
  }, [snapshot, world, filterVenture]);

  return (
    <group>
      {pods.map((info) => (
        <Pod key={info.session.sessionId} info={info} />
      ))}
    </group>
  );
}
