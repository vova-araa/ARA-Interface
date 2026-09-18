import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Outlines } from '@react-three/drei';
import { stableHash, visibleInWorld, type SessionState, type WorldConfig } from '@ara/shared';
import { speedForLatency, useAra, useViewSnapshot } from '../store.ts';
import { projectPlacement, sessionPosition } from '../placements.ts';
import { toolColor } from '../util.ts';
import { useDaylight } from './daylight.ts';

const SHOW_WINDOW_MS = 24 * 60 * 60 * 1000; // pods linger for a day

/**
 * Een pod is geen sier: bijna elk onderdeel draagt sessiestatus (het
 * binnenlicht de tool, de koepel het model, de buis het geheugen, de ring dat
 * er een mens nodig is). Daarom staan de pods niet in instanced meshes — hun
 * materialen verschillen per sessie en dat is precies de informatie.
 *
 * Wat wél weg kon: de vijftien geometrieën die elke pod voor zichzelf
 * aanmaakte. Pods blijven een etmaal staan, dus na een drukke dag stonden er
 * honderden identieke buffers op de GPU. Die staan nu één keer op
 * moduleniveau, net als elk materiaal dat voor alle pods hetzelfde is.
 */

// --- gedeelde geometrie ------------------------------------------------
const BODY_GEO = new THREE.CylinderGeometry(0.3, 0.34, 0.42, 16);
const CORE_GEO = new THREE.SphereGeometry(0.17, 12, 10);
const DOME_GEO = new THREE.SphereGeometry(0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const ISLAND_GEO = new THREE.CylinderGeometry(0.28, 0.22, 0.14, 6);
const ISLAND_TREE_GEO = new THREE.ConeGeometry(0.12, 0.22, 6);
const BRIDGE_GEO = new THREE.BoxGeometry(0.34, 0.03, 0.1);
const TUBE_GLASS_GEO = new THREE.CylinderGeometry(0.055, 0.055, 0.56, 8, 1, true);
/** Hoogte 1, want de vulling schaalt mee met de context — geen geometrie per stand. */
const TUBE_FILL_GEO = new THREE.CylinderGeometry(0.04, 0.04, 1, 8);
const DONE_CAP_GEO = new THREE.SphereGeometry(0.09, 10, 8);
const RING_GEO = new THREE.TorusGeometry(0.45, 0.03, 8, 24);
const BEACON_GEO = new THREE.SphereGeometry(0.07, 8, 6);
const SPARK1_GEO = new THREE.SphereGeometry(0.045, 6, 5);
const SPARK2_GEO = new THREE.SphereGeometry(0.035, 6, 5);
const SELECT_RING_GEO = new THREE.RingGeometry(0.5, 0.6, 24);

// --- gedeelde materialen -----------------------------------------------
const BODY_MAT = new THREE.MeshStandardMaterial({ color: '#f7f5f2', roughness: 0.4 });
const ISLAND_MAT = new THREE.MeshStandardMaterial({ color: '#c98d84' });
const ISLAND_TREE_MAT = new THREE.MeshStandardMaterial({ color: '#3ecf6f' });
const BRIDGE_MAT = new THREE.MeshStandardMaterial({ color: '#d8d3cc' });
const TUBE_GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: '#dfe8f2',
  transparent: true,
  opacity: 0.25,
  roughness: 0.1,
  side: THREE.DoubleSide,
});
const DONE_CAP_MAT = new THREE.MeshStandardMaterial({
  color: '#3ecf6f',
  emissive: '#3ecf6f',
  emissiveIntensity: 0.6,
  toneMapped: false,
});
const AMBER_MAT = new THREE.MeshStandardMaterial({
  color: '#ffb020',
  emissive: '#ffb020',
  emissiveIntensity: 1.2,
  toneMapped: false,
});
const AMBER_BEACON_MAT = new THREE.MeshStandardMaterial({
  color: '#ffb020',
  emissive: '#ffb020',
  emissiveIntensity: 1.6,
  toneMapped: false,
});
const SELECT_MAT = new THREE.MeshBasicMaterial({
  color: '#ff6b57',
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
});

/** Koepelmateriaal per modelkleur: drie stuks voor de hele wereld. */
const domeMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
function domeMaterial(color: string): THREE.MeshPhysicalMaterial {
  let mat = domeMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      roughness: 0.05,
      metalness: 0.1,
    });
    domeMaterials.set(color, mat);
  }
  return mat;
}

/** Vulkleur van de contextbuis: groen, amber, rood — meer smaken zijn er niet. */
const tubeMaterials = new Map<string, THREE.MeshStandardMaterial>();
function tubeMaterial(color: string): THREE.MeshStandardMaterial {
  let mat = tubeMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.7,
      toneMapped: false,
    });
    tubeMaterials.set(color, mat);
  }
  return mat;
}

/**
 * Vonken in de tool-kleur. Eerst kreeg elke pod twee eigen materialen waarvan
 * de emissive elke frame werd overgeschreven; het palet is eindig, dus één
 * materiaal per kleur volstaat en het overschrijven kan weg.
 */
const sparkMaterials = new Map<string, THREE.MeshStandardMaterial>();
function sparkMaterial(color: string): THREE.MeshStandardMaterial {
  let mat = sparkMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: '#fff',
      emissive: color,
      emissiveIntensity: 2,
      toneMapped: false,
    });
    sparkMaterials.set(color, mat);
  }
  return mat;
}

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

  const toolHex = toolColor(session.activeTool ?? session.lastTool);
  const lightColor = useMemo(() => new THREE.Color(toolHex), [toolHex]);
  const style = useMemo(() => modelStyle(session.model ?? live?.model), [session.model, live?.model]);
  // Context-buis: vulling 0..1 uit de live statusline-feed.
  const contextFill = live ? Math.min(1, Math.max(0, live.contextPct / 100)) : null;
  const tubeColor = contextFill === null ? '#3ecf6f' : contextFill > 0.85 ? '#ff5252' : contextFill > 0.6 ? '#ffb020' : '#3ecf6f';

  /**
   * Alleen een pod in storing heeft een eigen rompmateriaal nodig: die
   * flikkert rood. Alle andere pods delen één wit materiaal.
   */
  const errorMat = useMemo(
    () =>
      session.status === 'error'
        ? new THREE.MeshStandardMaterial({ color: '#f7f5f2', roughness: 0.4 })
        : null,
    [session.status],
  );
  useEffect(() => () => errorMat?.dispose(), [errorMat]);
  // Deterministische flikkerfase: Math.random gaf elke viewer een ander beeld
  // van dezelfde storing, en dat is geen sier maar een meetbaar feit.
  const flickerPhase = useMemo(() => (stableHash(session.sessionId) % 628) / 100, [session.sessionId]);

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
    if (errorMat) {
      // Twee onharmonische sinussen: onregelmatig zoals ruis, maar herhaalbaar.
      const on = Math.sin(t * 17 + flickerPhase) * Math.sin(t * 6.3 + flickerPhase * 2) > 0;
      errorMat.emissive.set('#ff5252');
      errorMat.emissiveIntensity = on ? 0.65 : 0.15;
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
    }
    if (spark2.current) {
      spark2.current.visible = working;
      const ts2 = t * speed;
      spark2.current.position.set(Math.cos(ts2 * 2.3 + Math.PI) * 0.55, 0.4 + Math.cos(ts2 * 4) * 0.1, Math.sin(ts2 * 2.3 + Math.PI) * 0.55);
    }

    // Worktree-eiland dobbert naast de pod zolang er een worktree actief is.
    if (island.current) {
      island.current.visible = (session.worktrees ?? 0) > 0;
      island.current.position.y = 0.55 + Math.sin(t * 1.8) * 0.06;
      island.current.rotation.y = Math.sin(t * 0.6) * 0.15;
    }
  });

  const sparkMat = sparkMaterial(toolHex);

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
        {/* white capsule body — met ink-outline (diorama-contour) */}
        <mesh position={[0, 0.22, 0]} castShadow geometry={BODY_GEO} material={errorMat ?? BODY_MAT}>
          <Outlines thickness={0.012} color="#2a1a2e" opacity={0.55} transparent />
        </mesh>
        {/* inner light core — emissive draagt de actieve tool, dus per pod */}
        <mesh position={[0, 0.4, 0]} geometry={CORE_GEO}>
          <meshStandardMaterial
            ref={innerLight}
            color="#dfe8f2"
            emissive="#4da3ff"
            emissiveIntensity={0.12}
            toneMapped={false}
          />
        </mesh>
        {/* glass dome — kleur verraadt het model (haiku ijsblauw, opus/fable goud) */}
        <mesh position={[0, 0.45, 0]} geometry={DOME_GEO} material={domeMaterial(style.dome)} />

        {/* worktree-eiland: mini-hex met boompje, dobbert naast de pod */}
        <group ref={island} visible={false} position={[0.85, 0.55, -0.45]} scale={0.8}>
          <mesh castShadow geometry={ISLAND_GEO} material={ISLAND_MAT} />
          <mesh position={[0, 0.16, 0]} geometry={ISLAND_TREE_GEO} material={ISLAND_TREE_MAT} />
          {/* loopbruggetje richting de pod */}
          <mesh
            position={[-0.38, -0.02, 0.22]}
            rotation={[0, 0.5, 0]}
            geometry={BRIDGE_GEO}
            material={BRIDGE_MAT}
          />
        </group>

        {/* context-buis: hoe vol zit het geheugen van deze sessie (statusline-feed) */}
        {contextFill !== null && (
          <group position={[-0.52, 0.28, 0.1]}>
            <mesh geometry={TUBE_GLASS_GEO} material={TUBE_GLASS_MAT} />
            <mesh
              position={[0, -0.28 + (contextFill * 0.56) / 2, 0]}
              scale={[1, Math.max(0.02, contextFill * 0.56), 1]}
              geometry={TUBE_FILL_GEO}
              material={tubeMaterial(tubeColor)}
            />
          </group>
        )}
        {/* done cap */}
        {session.status === 'done' && (
          <mesh position={[0, 0.78, 0]} geometry={DONE_CAP_GEO} material={DONE_CAP_MAT} />
        )}
        {/* needs-human amber beacon + rotating ring */}
        <group ref={ringRef} visible={false}>
          <mesh
            position={[0, 0.55, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            geometry={RING_GEO}
            material={AMBER_MAT}
          />
          <mesh position={[0, 0.86, 0]} geometry={BEACON_GEO} material={AMBER_BEACON_MAT} />
        </group>
        {/* orbit-vonken (alleen zichtbaar tijdens werken) */}
        <mesh ref={spark1} visible={false} geometry={SPARK1_GEO} material={sparkMat} />
        <mesh ref={spark2} visible={false} geometry={SPARK2_GEO} material={sparkMat} />
        {/* selection ring */}
        {selected && (
          <mesh
            position={[0, -0.28, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            geometry={SELECT_RING_GEO}
            material={SELECT_MAT}
          />
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
