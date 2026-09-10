import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldConfig } from '@ara/shared';
import { useAra, type Effect } from '../store.ts';
import { visiblePods } from './Pods.tsx';
import { stableHash } from '@ara/shared';
import { useDaylight } from './daylight.ts';
import { emojiTexture } from './icons.ts';

/** Event feedback: sparkles (tool ok), smoke (tool error), confetti + flag (completed). */

function Sparkle({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const life = (Date.now() - ts) / 800; // 0..1
    if (!ref.current) return;
    ref.current.visible = life < 1;
    const s = 0.1 + life * 0.5;
    ref.current.scale.setScalar(s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - life);
    ref.current.position.y = position.y + life * 0.4;
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.5, 8, 6]} />
      <meshBasicMaterial color="#ffe27a" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}

function Smoke({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const life = (Date.now() - ts) / 1600;
    if (!group.current) return;
    group.current.visible = life < 1;
    group.current.children.forEach((puff, i) => {
      puff.position.y = life * (0.6 + i * 0.25);
      puff.scale.setScalar(0.12 + life * (0.3 + i * 0.1));
      ((puff as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - life * 0.7);
    });
  });
  return (
    <group ref={group} position={position}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[(i - 1) * 0.12, 0, (i % 2) * 0.1]}>
          <sphereGeometry args={[1, 7, 5]} />
          <meshBasicMaterial color="#5a5a5a" transparent opacity={0.7} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const CONFETTI_COUNT = 40;
const CONFETTI_COLORS = ['#ff6b57', '#ffd75e', '#3ecf6f', '#4da3ff', '#c07cff'];

function Confetti({ position, ts, seed }: { position: THREE.Vector3; ts: number; seed: number }): JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);
  const velocities = useMemo(() => {
    const rand = (i: number, salt: number): number =>
      ((stableHash(`${seed}-${i}-${salt}`) % 1000) / 1000) * 2 - 1;
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      vx: rand(i, 1) * 1.4,
      vy: 2 + Math.abs(rand(i, 2)) * 2,
      vz: rand(i, 3) * 1.4,
      spin: rand(i, 4) * 6,
    }));
  }, [seed]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = (Date.now() - ts) / 1000;
    mesh.visible = t < 1.8;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    velocities.forEach((v, i) => {
      const x = position.x + v.vx * t;
      const y = Math.max(0.1, position.y + v.vy * t - 4.9 * t * t * 0.5);
      const z = position.z + v.vz * t;
      rotation.setFromEuler(new THREE.Euler(v.spin * t, v.spin * t * 0.7, 0));
      matrix.compose(new THREE.Vector3(x, y, z), rotation, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, CONFETTI_COUNT]}>
      <planeGeometry args={[0.07, 0.07]} />
      <meshBasicMaterial
        color={CONFETTI_COLORS[seed % CONFETTI_COLORS.length]}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

const FIREWORK_SPARKS = 22;
const FIREWORK_COLORS = ['#ffd75e', '#ff6b57', '#4dd7ff', '#c07cff'];

/** Vuurwerk: raket stijgt (0.6s), dan een bolvormige burst van vonken (1.2s). */
function Firework({ position, ts, seed }: { position: THREE.Vector3; ts: number; seed: number }): JSX.Element {
  const rocket = useRef<THREE.Mesh>(null);
  const burst = useRef<THREE.InstancedMesh>(null);
  const directions = useMemo(
    () =>
      Array.from({ length: FIREWORK_SPARKS }, (_, i) => {
        const theta = ((stableHash(`${seed}-t${i}`) % 628) / 100);
        const phi = ((stableHash(`${seed}-p${i}`) % 314) / 100);
        return new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi) * 0.8 + 0.3,
          Math.sin(phi) * Math.sin(theta),
        );
      }),
    [seed],
  );

  useFrame(() => {
    const t = (Date.now() - ts) / 1000;
    const apex = new THREE.Vector3(position.x, position.y + 2.6, position.z);
    if (rocket.current) {
      rocket.current.visible = t < 0.6;
      const rise = Math.min(1, t / 0.6);
      rocket.current.position.set(position.x, position.y + rise * 2.6, position.z);
    }
    const mesh = burst.current;
    if (mesh) {
      const bt = t - 0.6;
      mesh.visible = bt > 0 && bt < 1.2;
      if (mesh.visible) {
        const matrix = new THREE.Matrix4();
        const spread = 0.2 + bt * 1.6;
        directions.forEach((dir, i) => {
          matrix.makeTranslation(
            apex.x + dir.x * spread,
            apex.y + dir.y * spread - bt * bt * 1.2,
            apex.z + dir.z * spread,
          );
          mesh.setMatrixAt(i, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - bt / 1.2);
      }
    }
  });

  return (
    <group>
      <mesh ref={rocket} visible={false}>
        <sphereGeometry args={[0.05, 6, 5]} />
        <meshBasicMaterial color="#fff3d6" toneMapped={false} />
      </mesh>
      <instancedMesh ref={burst} args={[undefined, undefined, FIREWORK_SPARKS]} visible={false}>
        <sphereGeometry args={[0.05, 5, 4]} />
        <meshBasicMaterial
          color={FIREWORK_COLORS[seed % FIREWORK_COLORS.length]}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

/** Poortwachter: pulserende amber ring + rijzend schild — toestemming gevraagd. */
function Gate({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const ring = useRef<THREE.Mesh>(null);
  const shield = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const life = (Date.now() - ts) / 3500;
    const visible = life < 1;
    if (ring.current) {
      ring.current.visible = visible;
      const pulse = 1 + Math.sin(clock.elapsedTime * 5) * 0.08;
      ring.current.scale.setScalar(pulse);
      ring.current.rotation.z = clock.elapsedTime * 0.8;
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - life * 0.4);
    }
    if (shield.current) {
      shield.current.visible = visible;
      shield.current.scale.y = Math.min(1, life * 4);
    }
  });
  return (
    <group position={position}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
        <torusGeometry args={[0.75, 0.05, 6, 24]} />
        <meshBasicMaterial color="#ffb020" transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={shield} position={[0.7, -0.3, 0]}>
        <boxGeometry args={[0.06, 0.7, 0.5]} />
        <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={0.8} transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Rode slagboom die neerklapt: permissie geweigerd. */
function Deny({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const arm = useRef<THREE.Group>(null);
  useFrame(() => {
    const life = (Date.now() - ts) / 1600;
    if (!arm.current) return;
    arm.current.visible = life < 1;
    const drop = Math.min(1, life * 3);
    arm.current.rotation.z = -Math.PI / 2 + (drop * Math.PI) / 2; // klapt van verticaal naar horizontaal
    arm.current.children.forEach((child) => {
      const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 1 - Math.max(0, life - 0.6) * 2.5);
    });
  });
  return (
    <group position={[position.x, position.y - 0.5, position.z]}>
      <group ref={arm}>
        <mesh position={[0.45, 0, 0]}>
          <boxGeometry args={[0.9, 0.08, 0.08]} />
          <meshBasicMaterial color="#ff5252" transparent toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Reparatie: draaiende moersleutel + groene vonkjes na een herstelde error. */
function Repair({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const wrench = useRef<THREE.Sprite>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const life = (Date.now() - ts) / 1800;
    const t = (Date.now() - ts) / 1000;
    if (wrench.current) {
      wrench.current.visible = life < 1;
      wrench.current.position.set(Math.cos(t * 4) * 0.45, 0.2 + Math.sin(t * 4) * 0.15, Math.sin(t * 4) * 0.45);
      wrench.current.material.opacity = Math.max(0, 1 - life);
    }
    const mesh = sparks.current;
    if (mesh) {
      mesh.visible = life < 1;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + t;
        matrix.makeTranslation(Math.cos(a) * (0.3 + life * 0.5), 0.1 + life * 0.7, Math.sin(a) * (0.3 + life * 0.5));
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - life);
    }
  });
  return (
    <group position={position}>
      <sprite ref={wrench} scale={[0.34, 0.34, 0.34]}>
        <spriteMaterial map={emojiTexture('🔧')} transparent depthWrite={false} />
      </sprite>
      <instancedMesh ref={sparks} args={[undefined, undefined, 8]}>
        <sphereGeometry args={[0.035, 5, 4]} />
        <meshBasicMaterial color="#3ecf6f" transparent depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

const STORM_PARTICLES = 26;

/** Context-storm: herinneringen wervelen naar binnen tijdens compaction. */
function Storm({ position, ts, seed }: { position: THREE.Vector3; ts: number; seed: number }): JSX.Element {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const offsets = useMemo(
    () =>
      Array.from({ length: STORM_PARTICLES }, (_, i) => ({
        angle: ((stableHash(`${seed}-a${i}`) % 628) / 100),
        speed: 2.2 + ((stableHash(`${seed}-s${i}`) % 100) / 100) * 1.6,
        y: ((stableHash(`${seed}-y${i}`) % 100) / 100) * 0.8,
      })),
    [seed],
  );
  useFrame(() => {
    const life = (Date.now() - ts) / 2600;
    const m = mesh.current;
    if (!m) return;
    m.visible = life < 1;
    if (!m.visible) return;
    const t = (Date.now() - ts) / 1000;
    const matrix = new THREE.Matrix4();
    offsets.forEach((o, i) => {
      const radius = Math.max(0.08, 1.7 * (1 - life)); // spiraal naar binnen
      const a = o.angle + t * o.speed;
      matrix.makeTranslation(
        Math.cos(a) * radius,
        -0.2 + o.y + life * 0.9, // omhoog richting de koepel
        Math.sin(a) * radius,
      );
      m.setMatrixAt(i, matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    (m.material as THREE.MeshBasicMaterial).opacity = life < 0.15 ? life / 0.15 : Math.max(0, 1 - (life - 0.15) / 0.85);
  });
  return (
    <group position={position}>
      <instancedMesh ref={mesh} args={[undefined, undefined, STORM_PARTICLES]}>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshBasicMaterial color="#9ecbff" transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
    </group>
  );
}

/** Model-morph: uitdijende ring + lichtzuil bij een model-switch. */
function Morph({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const life = (Date.now() - ts) / 1300;
    if (ring.current) {
      ring.current.visible = life < 1;
      ring.current.scale.setScalar(0.2 + life * 1.8);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - life);
    }
    if (beam.current) {
      beam.current.visible = life < 0.6;
      beam.current.scale.y = 1 + life * 2;
      (beam.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - life * 1.2);
    }
  });
  return (
    <group position={position}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <torusGeometry args={[0.6, 0.06, 6, 28]} />
        <meshBasicMaterial color="#ffe9b0" transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={beam} position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.14, 0.2, 1.4, 8, 1, true]} />
        <meshBasicMaterial color="#fff3d6" transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const BOLT_BEAMS = 5;

/** Parallelle tool-batch: waaier van lichtstralen uit één pod. */
function Bolt({ position, ts, seed }: { position: THREE.Vector3; ts: number; seed: number }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const life = (Date.now() - ts) / 900;
    if (!group.current) return;
    group.current.visible = life < 1;
    group.current.children.forEach((beam, i) => {
      const stretch = Math.min(1, life * 3);
      beam.scale.y = 0.2 + stretch * 1.1;
      ((beam as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - life);
      beam.rotation.z = -0.9 + (i / (BOLT_BEAMS - 1)) * 1.8;
    });
  });
  return (
    <group ref={group} position={position}>
      {Array.from({ length: BOLT_BEAMS }, (_, i) => (
        <mesh key={i} position={[0, 0.3, ((stableHash(`${seed}-${i}`) % 40) - 20) / 200]}>
          <cylinderGeometry args={[0.02, 0.035, 1.1, 5]} />
          <meshBasicMaterial color="#4dd7ff" transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

/** Taak-papiertje: vliegt in een boog van de hub (Cascade) naar de pod. */
function Paper({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const sprite = useRef<THREE.Sprite>(null);
  useFrame(() => {
    const life = Math.min(1, (Date.now() - ts) / 1700);
    if (!sprite.current) return;
    sprite.current.visible = life < 1;
    const ease = 1 - Math.pow(1 - life, 2);
    // Wereldpositie: hub (0, 1.4, 0) → pod, met een boog erin.
    sprite.current.position.set(
      position.x * ease,
      1.4 + Math.sin(ease * Math.PI) * 1.6 - 0.3 * ease,
      position.z * ease,
    );
    sprite.current.material.opacity = life < 0.9 ? 1 : (1 - life) * 10;
  });
  return (
    <sprite ref={sprite} scale={[0.4, 0.4, 0.4]}>
      <spriteMaterial map={emojiTexture('📋')} transparent depthWrite={false} />
    </sprite>
  );
}

function Flag({ position, ts }: { position: THREE.Vector3; ts: number }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    const raise = Math.min(1, (Date.now() - ts) / 600);
    group.current.scale.y = 0.2 + raise * 0.8;
  });
  return (
    <group ref={group} position={position}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.9, 5]} />
        <meshStandardMaterial color="#d8d3cc" />
      </mesh>
      <mesh position={[0.14, 0.75, 0]}>
        <planeGeometry args={[0.26, 0.16]} />
        <meshBasicMaterial color="#3ecf6f" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function EffectsLayer({ world }: { world: WorldConfig }): JSX.Element | null {
  const effects = useAra((s) => s.effects);
  const snapshot = useAra((s) => s.snapshot);
  const replaying = useAra((s) => s.replayTs !== null);
  const daylight = useDaylight();
  const fireworksOn = daylight.period === 'night' || daylight.period === 'dusk';

  const located = useMemo(() => {
    const pods = visiblePods(world, Object.values(snapshot.sessions), snapshot.now);
    const byId = new Map(pods.map((p) => [p.session.sessionId, p]));
    return effects
      .map((effect: Effect) => {
        const pod = byId.get(effect.sessionId);
        if (!pod) return null;
        return {
          effect,
          position: new THREE.Vector3(pod.position.x, 1.1, pod.position.z),
        };
      })
      .filter((x): x is { effect: Effect; position: THREE.Vector3 } => x !== null);
  }, [effects, snapshot, world]);

  if (replaying) return null; // scrubbing history: no live feedback bursts

  return (
    <group>
      {located.map(({ effect, position }) => {
        switch (effect.type) {
          case 'sparkle':
            return <Sparkle key={effect.id} position={position} ts={effect.ts} />;
          case 'smoke':
            return <Smoke key={effect.id} position={position} ts={effect.ts} />;
          case 'confetti':
            return (
              <Confetti key={effect.id} position={position} ts={effect.ts} seed={stableHash(effect.id) % 97} />
            );
          case 'flag':
            return (
              <group key={effect.id}>
                <Flag position={new THREE.Vector3(position.x + 0.35, 0.3, position.z)} ts={effect.ts} />
                {fireworksOn && (
                  <Firework position={position} ts={effect.ts} seed={stableHash(effect.id) % 89} />
                )}
              </group>
            );
          case 'gate':
            return <Gate key={effect.id} position={position} ts={effect.ts} />;
          case 'deny':
            return <Deny key={effect.id} position={position} ts={effect.ts} />;
          case 'repair':
            return <Repair key={effect.id} position={position} ts={effect.ts} />;
          case 'storm':
            return <Storm key={effect.id} position={position} ts={effect.ts} seed={stableHash(effect.id) % 83} />;
          case 'morph':
            return <Morph key={effect.id} position={position} ts={effect.ts} />;
          case 'bolt':
            return <Bolt key={effect.id} position={position} ts={effect.ts} seed={stableHash(effect.id) % 79} />;
          case 'paper':
            return <Paper key={effect.id} position={position} ts={effect.ts} />;
          default:
            return null;
        }
      })}
    </group>
  );
}
