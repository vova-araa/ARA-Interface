import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING, projectPlacement } from '../placements.ts';
import { useAra, useViewSnapshot } from '../store.ts';

/**
 * Ambient bewoners: kleine werkers die door hun district scharrelen —
 * lopen naar een punt, pauzeren, weer verder (referentie-look: krioelende
 * platforms). Dichtheid schaalt eerlijk met echte activiteit: een stil
 * district heeft 2 bewoners, een district met draaiende sessies krioelt.
 *
 * Iedereen loopt apart, maar iedereen bestaat uit dezelfde drie vormen. Dat is
 * precies het geval waarvoor instancing bestaat: drie instanced meshes (romp,
 * kop, petje) voor de hele wereld in plaats van drie losse meshes — met drie
 * losse geometrieën — per bewoner. De matrices gaan wél elke frame mee, want
 * het lopen is de informatie.
 */

const WORKER_COLORS = [
  new THREE.Color('#ff8a3d'),
  new THREE.Color('#e8eaf0'),
  new THREE.Color('#4da3ff'),
  new THREE.Color('#ffd75e'),
  new THREE.Color('#c0392b'),
  new THREE.Color('#3ecf6f'),
];
const WALK_SPEED = 0.55; // world units per seconde
const BODY_SCALE = 1.15;
/**
 * Bovengrens per district (basis 3 in demo + maximaal 5 bonus). De capaciteit
 * van de instanced meshes hangt hieraan en niet aan de actuele drukte, zodat
 * een sessie die start of stopt geen nieuwe GPU-buffers afdwingt.
 */
const MAX_PER_DISTRICT = 8;

const BODY_GEO = new THREE.CapsuleGeometry(0.075, 0.1, 4, 7);
const HEAD_GEO = new THREE.SphereGeometry(0.065, 8, 6);
const CAP_GEO = new THREE.SphereGeometry(0.07, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);

// Wit basismateriaal: de kleur per bewoner komt uit `setColorAt`. Géén
// `vertexColors` — die vlag laat de shader een `color`-attribuut op de
// geometrie verwachten dat er niet is, en dan is elke instance zwart.
const BODY_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#ffdbb5' });
const CAP_MAT = new THREE.MeshStandardMaterial({ color: '#f7f5f2' });

interface Wanderer {
  homeX: number;
  homeZ: number;
  radius: number;
  color: THREE.Color;
  phase: number;
  /** Stabiele index voor de deterministische doelkeuze (was de array-index). */
  seat: number;
  // runtime-state (mutable, buiten React om):
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  yaw: number;
  headYaw: number;
  pauseUntil: number;
}

// Eén set rekenobjecten voor de hele lus; een nieuwe Matrix4 per bewoner per
// frame is precies het afval dat je pas merkt als de wereld hapert.
const scratch = new THREE.Object3D();
const parentMatrix = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();
const headMatrix = new THREE.Matrix4();

function CrowdInstances({
  wanderers,
  capacity,
}: {
  wanderers: Wanderer[];
  capacity: number;
}): JSX.Element {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);

  // Kleur staat vast per bewoner; alleen herschrijven als de bezetting wijzigt.
  useLayoutEffect(() => {
    const body = bodies.current;
    if (!body) return;
    wanderers.forEach((w, i) => body.setColorAt(i, w.color));
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
  }, [wanderers]);

  useFrame(({ clock }, delta) => {
    const body = bodies.current;
    const head = heads.current;
    const cap = caps.current;
    if (!body || !head || !cap) return;
    const now = clock.elapsedTime;

    for (let i = 0; i < wanderers.length; i += 1) {
      const w = wanderers[i]!;
      const dx = w.targetX - w.x;
      const dz = w.targetZ - w.z;
      const dist = Math.hypot(dx, dz);
      const walking = now > w.pauseUntil && dist > 0.05;

      // Secundaire beweging: kop kijkt tijdens pauze traag rond (leest als leven).
      const targetYaw = walking ? 0 : Math.sin(now * 0.6 + w.phase) * 0.7;
      w.headYaw += (targetYaw - w.headYaw) * Math.min(1, delta * 3);
      const headRoll = walking ? 0 : Math.sin(now * 1.3 + w.phase) * 0.08;

      if (walking) {
        const step = Math.min(dist, WALK_SPEED * delta) / dist;
        w.x += dx * step;
        w.z += dz * step;
        w.yaw = Math.atan2(dx, dz);
      } else if (dist <= 0.05) {
        // Aangekomen: even pauzeren, dan nieuw doel binnen het district.
        if (w.pauseUntil < now) w.pauseUntil = now + 1.5 + ((w.seat * 37) % 40) / 10;
        if (now > w.pauseUntil - 0.05) {
          const second = Math.floor(now);
          const angle = (stableHash(`${w.seat}-${second}`) % 628) / 100;
          const r = 0.4 + ((stableHash(`${w.seat}r-${second}`) % 60) / 100) * w.radius;
          w.targetX = w.homeX + Math.cos(angle) * r;
          w.targetZ = w.homeZ + Math.sin(angle) * r;
        }
      }

      const bob = walking
        ? Math.abs(Math.sin(now * 11 + w.phase)) * 0.05
        : Math.sin(now * 2 + w.phase) * 0.015;

      scratch.position.set(w.x, 0.31 + bob, w.z);
      scratch.rotation.set(0, w.yaw, 0);
      scratch.scale.setScalar(BODY_SCALE);
      scratch.updateMatrix();
      parentMatrix.copy(scratch.matrix);

      scratch.scale.set(1, 1, 1);
      scratch.position.set(0, 0.11, 0);
      scratch.rotation.set(0, 0, 0);
      scratch.updateMatrix();
      body.setMatrixAt(i, partMatrix.multiplyMatrices(parentMatrix, scratch.matrix));

      // kop + petje zitten in een eigen scharnier zodat ze los kunnen rondkijken
      scratch.position.set(0, 0.28, 0);
      scratch.rotation.set(0, w.headYaw, headRoll);
      scratch.updateMatrix();
      headMatrix.multiplyMatrices(parentMatrix, scratch.matrix);
      head.setMatrixAt(i, headMatrix);

      scratch.position.set(0, 0.035, 0);
      scratch.rotation.set(0, 0, 0);
      scratch.updateMatrix();
      cap.setMatrixAt(i, partMatrix.multiplyMatrices(headMatrix, scratch.matrix));
    }

    body.count = wanderers.length;
    head.count = wanderers.length;
    cap.count = wanderers.length;
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    cap.instanceMatrix.needsUpdate = true;
    // Zonder dit blijft de bounding sphere op de eerste frame staan en
    // verdwijnt de halve bevolking zodra ze buiten die bol scharrelt.
    body.computeBoundingSphere();
    head.computeBoundingSphere();
    cap.computeBoundingSphere();
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[BODY_GEO, BODY_MAT, capacity]} castShadow />
      <instancedMesh ref={heads} args={[HEAD_GEO, HEAD_MAT, capacity]} />
      <instancedMesh ref={caps} args={[CAP_GEO, CAP_MAT, capacity]} />
    </group>
  );
}

export function Crowd({ world }: { world: WorldConfig }): JSX.Element | null {
  const snapshot = useViewSnapshot();
  const lodFar = useAra((s) => s.lodFar);
  const demo = useAra((s) => s.demo);

  // Activiteit per venture: aantal actieve (niet-beëindigde) sessies.
  const activity = useMemo(() => {
    const byVenture = new Map<string, number>();
    for (const session of Object.values(snapshot.sessions)) {
      if (session.endedAt) continue;
      const venture = projectPlacement(world, session.project).venture;
      byVenture.set(venture, (byVenture.get(venture) ?? 0) + 1);
    }
    return byVenture;
  }, [snapshot, world]);

  const wanderers = useMemo(() => {
    const out: Wanderer[] = [];
    let seat = 0;
    for (const district of world.districts) {
      const { x, z } = axialToWorld(district.center);
      const base = demo ? 3 : 2;
      const bonus = Math.min(5, (activity.get(district.venture.id) ?? 0) * 2);
      const count = base + bonus;
      const seedBase = stableHash(district.venture.id);
      const homeX = x * HEX_SPACING;
      const homeZ = z * HEX_SPACING;
      for (let i = 0; i < count; i += 1) {
        const angle = ((seedBase + i * 97) % 628) / 100;
        const startX = homeX + Math.cos(angle) * 1.1;
        const startZ = homeZ + Math.sin(angle) * 1.1;
        out.push({
          homeX,
          homeZ,
          radius: 1.9,
          color: WORKER_COLORS[(seedBase + i) % WORKER_COLORS.length]!,
          phase: i * 1.7,
          seat: seat++,
          x: startX,
          z: startZ,
          targetX: startX,
          targetZ: startZ,
          yaw: 0,
          headYaw: 0,
          pauseUntil: 0,
        });
      }
    }
    return out;
  }, [world, activity, demo]);

  const capacity = Math.max(1, world.districts.length * MAX_PER_DISTRICT);

  if (lodFar) return null;

  return <CrowdInstances wanderers={wanderers} capacity={capacity} />;
}
