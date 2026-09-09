import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentState, WorldConfig } from '@ara/shared';
import { useAra } from '../store.ts';
import { districtEdge } from '../placements.ts';
import { visiblePods, type PodInfo } from './Pods.tsx';
import { emojiTexture } from './icons.ts';
import { toolIcon } from '../util.ts';

const MAX_FIGURES = 200;
const FIGURE_SCALE = 1.6;
const WALK_DURATION_MS = 2500;
const AGENT_COLORS = ['#ff8a3d', '#4da3ff', '#3ecf6f', '#c07cff', '#ffd75e', '#ff6b9e'];

interface FigureInfo {
  agent: AgentState;
  pod: PodInfo;
  slot: number;
}

function Figure({ info, world }: { info: FigureInfo; world: WorldConfig }): JSX.Element {
  const { agent, pod, slot } = info;
  const groupRef = useRef<THREE.Group>(null);
  const bubble = useAra((s) =>
    s.bubbles.find((b) => b.sessionId === agent.sessionId && b.agentId === agent.agentId),
  );

  const color = AGENT_COLORS[slot % AGENT_COLORS.length]!;
  const start = useMemo(() => districtEdge(world, pod.session.project), [world, pod.session.project]);
  const target = useMemo(() => {
    const angle = (slot / 6) * Math.PI * 2;
    return {
      x: pod.position.x + Math.cos(angle) * 0.75,
      z: pod.position.z + Math.sin(angle) * 0.75,
    };
  }, [pod.position.x, pod.position.z, slot]);

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
    if (walk < 1) group.rotation.y = Math.atan2(target.x - start.x, target.z - start.z);
    if (agent.stopped) {
      // Fade out by sinking.
      const gone = Math.min(1, (Date.now() - agent.lastSeenAt) / 1500);
      group.position.y -= gone * 0.5;
      group.scale.setScalar(FIGURE_SCALE * (1 - gone * 0.7));
    } else {
      group.scale.setScalar(FIGURE_SCALE);
    }
  });

  const icon = toolIcon(agent.activeTool);

  return (
    <group ref={groupRef}>
      {/* body */}
      <mesh position={[0, 0.12, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.14, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* head */}
      <mesh position={[0, 0.34, 0]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color="#ffdbb5" />
      </mesh>
      {/* helmet */}
      <mesh position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f7f5f2" />
      </mesh>
      {/* tool icon sprite */}
      {agent.activeTool && !agent.stopped && (
        <sprite position={[0.14, 0.52, 0]} scale={[0.22, 0.22, 0.22]}>
          <spriteMaterial map={emojiTexture(icon)} transparent depthWrite={false} />
        </sprite>
      )}
      {/* speech bubble with toolSummary */}
      {bubble && !agent.stopped && (
        <Html position={[0, 0.72, 0]} center zIndexRange={[10, 0]}>
          <div className="bubble">{bubble.text}</div>
        </Html>
      )}
    </group>
  );
}

export function Figures({ world }: { world: WorldConfig }): JSX.Element {
  const snapshot = useAra((s) => s.snapshot);

  const figures = useMemo(() => {
    const pods = visiblePods(world, Object.values(snapshot.sessions));
    const out: FigureInfo[] = [];
    const now = Date.now();
    for (const pod of pods) {
      let slot = 0;
      for (const agent of Object.values(pod.session.agents)) {
        if (agent.stopped && now - agent.lastSeenAt > 2000) continue;
        out.push({ agent, pod, slot });
        slot += 1;
      }
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
