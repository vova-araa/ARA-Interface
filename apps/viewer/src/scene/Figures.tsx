import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentState, WorldConfig } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { districtEdge } from '../placements.ts';
import { visiblePods, type PodInfo } from './Pods.tsx';
import { emojiTexture } from './icons.ts';
import { toolIcon } from '../util.ts';

const MAX_FIGURES = 200;
const FIGURE_SCALE = 1.6;
const WALK_DURATION_MS = 2500;
const AGENT_COLORS = ['#ff8a3d', '#4da3ff', '#3ecf6f', '#c07cff', '#ffd75e', '#ff6b9e'];

/** Visuele stijl per agent-type: rol in één oogopslag herkenbaar. */
interface AgentStyle {
  helmet: string;
  body?: string;
  accessory: 'telescope' | 'clipboard' | 'toolbelt' | 'tie' | null;
}

function styleFor(agentType: string | undefined): AgentStyle {
  const type = (agentType ?? '').toLowerCase();
  if (type.includes('scout') || type.includes('explore'))
    return { helmet: '#c07cff', accessory: 'telescope' };
  if (type.includes('plan')) return { helmet: '#4da3ff', accessory: 'clipboard' };
  if (type.includes('manager') || type.includes('supervisor') || type.includes('chief'))
    return { helmet: '#2a2f3a', body: '#3b3347', accessory: 'tie' };
  if (type.includes('worker')) return { helmet: '#ffd75e', accessory: 'toolbelt' };
  return { helmet: '#f7f5f2', accessory: null };
}

interface FigureInfo {
  agent: AgentState;
  pod: PodInfo;
  slot: number;
  /** Where the light thread anchors: parent figure's spot, or the pod. */
  linkTo: { x: number; z: number };
  linkIsParent: boolean;
}

function slotTarget(pod: PodInfo, slot: number): { x: number; z: number } {
  const angle = (slot / 6) * Math.PI * 2;
  return {
    x: pod.position.x + Math.cos(angle) * 0.75,
    z: pod.position.z + Math.sin(angle) * 0.75,
  };
}

function Figure({ info, world }: { info: FigureInfo; world: WorldConfig }): JSX.Element {
  const { agent, pod, slot, linkTo, linkIsParent } = info;
  const groupRef = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const dust = useRef<THREE.Sprite>(null);

  // Light thread: parent figure (gold) when spawned via SPAWN-REQUEST,
  // otherwise the session pod (blue).
  const thread = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      color: linkIsParent ? '#ffd75e' : '#9ecbff',
      transparent: true,
      opacity: linkIsParent ? 0.7 : 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.Line(geometry, material);
  }, [linkIsParent]);
  const bubble = useAra((s) =>
    s.bubbles.find((b) => b.sessionId === agent.sessionId && b.agentId === agent.agentId),
  );
  const lodFar = useAra((s) => s.lodFar);

  const style = useMemo(() => styleFor(agent.agentType), [agent.agentType]);
  const color = style.body ?? AGENT_COLORS[slot % AGENT_COLORS.length]!;
  const start = useMemo(() => districtEdge(world, pod.session.project), [world, pod.session.project]);
  const target = useMemo(() => slotTarget(pod, slot), [pod, slot]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const age = Date.now() - agent.startedAt;
    const walk = Math.min(1, age / WALK_DURATION_MS);
    const ease = 1 - Math.pow(1 - walk, 3);
    const x = start.x + (target.x - start.x) * ease;
    const z = start.z + (target.z - start.z) * ease;
    // Bob while walking, small idle sway after.
    const bob = walk < 1 ? Math.abs(Math.sin(age / 90)) * 0.08 : Math.sin(clock.elapsedTime * 2 + slot) * 0.02;
    group.position.set(x, 0.32 + bob, z);

    // Stofwolkje achter de voeten tijdens het lopen.
    if (dust.current) {
      const puff = (age % 380) / 380;
      dust.current.visible = walk < 1 && !agent.stopped;
      dust.current.position.set(-Math.sin(group.rotation.y) * 0.12, 0.02 + puff * 0.06, -Math.cos(group.rotation.y) * 0.12);
      const s = 0.1 + puff * 0.14;
      dust.current.scale.set(s, s, s);
      dust.current.material.opacity = 0.5 * (1 - puff);
    }

    // Walkcycle: benen en armen zwaaien tegengesteld tijdens het lopen.
    const stride = walk < 1 ? Math.sin(age / 90) * 0.7 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = stride;
    if (rightLeg.current) rightLeg.current.rotation.x = -stride;
    if (leftArm.current) leftArm.current.rotation.x = -stride * 0.8;
    if (rightArm.current) rightArm.current.rotation.x = stride * 0.8;
    if (walk < 1) group.rotation.y = Math.atan2(target.x - start.x, target.z - start.z);
    if (agent.stopped) {
      // Fade out by sinking.
      const gone = Math.min(1, (Date.now() - agent.lastSeenAt) / 1500);
      group.position.y -= gone * 0.5;
      group.scale.setScalar(FIGURE_SCALE * (1 - gone * 0.7));
    } else {
      group.scale.setScalar(FIGURE_SCALE);
    }

    // Thread endpoints in figure-local space: head → anchor (parent or pod).
    const positions = thread.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, 0, 0.42, 0);
    positions.setXYZ(
      1,
      (linkTo.x - x) / FIGURE_SCALE,
      linkIsParent ? 0.3 : 0.5,
      (linkTo.z - z) / FIGURE_SCALE,
    );
    positions.needsUpdate = true;
    thread.visible = !agent.stopped;
  });

  const icon = toolIcon(agent.activeTool);

  return (
    <group ref={groupRef}>
      <primitive object={thread} />
      {/* stofwolkje bij het lopen */}
      <sprite ref={dust} visible={false}>
        <spriteMaterial map={emojiTexture('💨')} transparent depthWrite={false} opacity={0.5} />
      </sprite>
      {/* body */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.12, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* legs — scharnier-groep bij de heup, mesh hangt eronder */}
      <group ref={leftLeg} position={[-0.04, 0.09, 0]}>
        <mesh position={[0, -0.05, 0]}>
          <cylinderGeometry args={[0.025, 0.03, 0.1, 6]} />
          <meshStandardMaterial color="#3b3347" />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.04, 0.09, 0]}>
        <mesh position={[0, -0.05, 0]}>
          <cylinderGeometry args={[0.025, 0.03, 0.1, 6]} />
          <meshStandardMaterial color="#3b3347" />
        </mesh>
      </group>
      {/* arms — scharnier bij de schouder */}
      <group ref={leftArm} position={[-0.11, 0.22, 0]}>
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.02, 0.022, 0.12, 6]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.11, 0.22, 0]}>
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.02, 0.022, 0.12, 6]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
      {/* head */}
      <mesh position={[0, 0.34, 0]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color="#ffdbb5" />
      </mesh>
      {/* helmet — kleur per rol */}
      <mesh position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={style.helmet} />
      </mesh>
      {/* rol-accessoire */}
      {style.accessory === 'telescope' && (
        <mesh position={[0.1, 0.36, 0.06]} rotation={[0.3, 0, 1.1]}>
          <cylinderGeometry args={[0.018, 0.026, 0.14, 6]} />
          <meshStandardMaterial color="#5b4a6b" metalness={0.4} />
        </mesh>
      )}
      {style.accessory === 'clipboard' && (
        <mesh position={[0.1, 0.16, 0.05]} rotation={[0.2, -0.4, 0]}>
          <boxGeometry args={[0.09, 0.12, 0.012]} />
          <meshStandardMaterial color="#e8dcc8" />
        </mesh>
      )}
      {style.accessory === 'toolbelt' && (
        <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.095, 0.02, 5, 10]} />
          <meshStandardMaterial color="#7a5230" />
        </mesh>
      )}
      {style.accessory === 'tie' && (
        <mesh position={[0, 0.18, 0.085]} rotation={[0.1, 0, 0]}>
          <boxGeometry args={[0.03, 0.1, 0.012]} />
          <meshStandardMaterial color="#d90012" />
        </mesh>
      )}
      {/* tool icon sprite (LOD: uit wanneer ver uitgezoomd) */}
      {agent.activeTool && !agent.stopped && !lodFar && (
        <sprite position={[0.14, 0.52, 0]} scale={[0.22, 0.22, 0.22]}>
          <spriteMaterial map={emojiTexture(icon)} transparent depthWrite={false} />
        </sprite>
      )}
      {/* speech bubble with toolSummary (LOD: uit wanneer ver uitgezoomd) */}
      {bubble && !agent.stopped && !lodFar && (
        <Html position={[0, 0.72, 0]} center zIndexRange={[10, 0]}>
          <div className="bubble">{bubble.text}</div>
        </Html>
      )}
    </group>
  );
}

export function Figures({ world }: { world: WorldConfig }): JSX.Element {
  const snapshot = useViewSnapshot();

  const figures = useMemo(() => {
    const pods = visiblePods(world, Object.values(snapshot.sessions));
    const out: FigureInfo[] = [];
    const now = Date.now();
    for (const pod of pods) {
      const agents = Object.values(pod.session.agents).filter(
        (agent) => !(agent.stopped && now - agent.lastSeenAt > 2000),
      );
      // First pass: everyone gets a slot, so children can anchor to parents.
      const targets = new Map<string, { x: number; z: number }>();
      agents.forEach((agent, slot) => targets.set(agent.agentId, slotTarget(pod, slot)));
      agents.forEach((agent, slot) => {
        const parent = agent.parentAgentId ? targets.get(agent.parentAgentId) : undefined;
        out.push({
          agent,
          pod,
          slot,
          linkTo: parent ?? { x: pod.position.x, z: pod.position.z },
          linkIsParent: parent !== undefined,
        });
      });
    }
    return out.slice(0, MAX_FIGURES);
  }, [snapshot, world]);

  return (
    <group>
      {figures.map((info) => (
        <Figure key={`${info.agent.sessionId}-${info.agent.agentId}`} info={info} world={world} />
      ))}
    </group>
  );
}
