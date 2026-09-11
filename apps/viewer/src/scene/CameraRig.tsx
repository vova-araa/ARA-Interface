import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import { damp, damp3 } from 'maath/easing';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useAra } from '../store.ts';
import { sessionPosition } from '../placements.ts';

const ISO_OFFSET = new THREE.Vector3(14, 16, 14); // ~30° isometric tilt
const IDLE_DRIFT_AFTER_MS = 8000;

export function CameraRig(): JSX.Element {
  const controlsRef = useRef<MapControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const flyTarget = useAra((s) => s.flyTarget);
  const goal = useRef<THREE.Vector3 | null>(null);
  const focusZoom = useRef<number | null>(null);
  // Trauma-based shake: amount = trauma², offset uit gladde sin-ruis — leest
  // als een klap i.p.v. de tril van per-frame Math.random().
  const trauma = useRef(0);
  const shakeOffset = useRef(new THREE.Vector3());
  // Idle-drift: na 8s zonder input zweeft de camera een traag achtje.
  const lastInteraction = useRef(Date.now());
  const driftOffset = useRef(new THREE.Vector3());
  const driftAmp = useRef(0);
  const intro = useRef(0); // 0..1 fly-in bij laden

  useEffect(() => {
    const { world, snapshot } = useAra.getState();
    if (!flyTarget || !world) return;
    const session = snapshot.sessions[flyTarget.sessionId];
    if (!session) return;
    const siblings = Object.values(snapshot.sessions)
      .filter((s) => s.project === session.project)
      .sort((a, b) => a.startedAt - b.startedAt);
    const index = Math.max(0, siblings.findIndex((s) => s.sessionId === session.sessionId));
    const { x, z } = sessionPosition(world, session, index);
    goal.current = new THREE.Vector3(x, 0, z);
    lastInteraction.current = Date.now();
    // Focus-pull: onder ortho is "scherpstellen" een zoom-duw richting de pod.
    const zoom = (camera as THREE.OrthographicCamera).zoom;
    if (zoom < 44) focusZoom.current = 48;
  }, [flyTarget, camera]);

  // Camera nudge on needs-human effects.
  const effects = useAra((s) => s.effects);
  useEffect(() => {
    const now = Date.now();
    if (effects.some((e) => e.type === 'nudge' && now - e.ts < 300))
      trauma.current = Math.min(1, trauma.current + 0.55);
    // Taak af = kleine vreugde-schok; subtieler dan een needs-human nudge.
    if (effects.some((e) => e.type === 'flag' && now - e.ts < 300))
      trauma.current = Math.min(1, trauma.current + 0.3);
  }, [effects]);

  useFrame(({ clock }, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cam = camera as THREE.OrthographicCamera;

    // Vorige frame-offsets terugdraaien zodat controls een schone basis ziet
    // (anders accumuleert de shake/drift en vecht hij met gebruikersinput).
    camera.position.sub(shakeOffset.current);
    controls.target.sub(driftOffset.current);

    // Intro: van ver uitgezoomd zachtjes de wereld in (~2s).
    if (intro.current < 1) {
      intro.current = Math.min(1, intro.current + delta / 2);
      const ease = 1 - Math.pow(1 - intro.current, 3);
      cam.zoom = 14 + (38 - 14) * ease;
      cam.updateProjectionMatrix();
    } else if (focusZoom.current !== null) {
      const settled = !damp(cam, 'zoom', focusZoom.current, 0.4, delta);
      cam.updateProjectionMatrix();
      if (settled) focusZoom.current = null;
    }

    // LOD-schakelaar: ver uitgezoomd → icons/bubbles uit (goedkope frames).
    const far = cam.zoom < 26;
    if (far !== useAra.getState().lodFar) useAra.getState().setLodFar(far);

    if (goal.current) {
      // maath-damping: echte traagheid i.p.v. framerate-afhankelijke lerp.
      const moving = damp3(controls.target, goal.current, 0.35, delta);
      damp3(camera.position, goal.current.clone().add(ISO_OFFSET), 0.35, delta);
      if (!moving) goal.current = null;
    }

    // Idle-drift (alleen zonder fly-goal): traag achtje over het doelpunt.
    const idle = Date.now() - lastInteraction.current > IDLE_DRIFT_AFTER_MS && !goal.current;
    damp(driftAmp, 'current', idle ? 1 : 0, 0.8, delta);
    if (driftAmp.current > 0.001) {
      const t = clock.elapsedTime;
      driftOffset.current.set(
        Math.sin(t * 0.13) * 0.55 * driftAmp.current,
        0,
        Math.sin(t * 0.09 * 2) * 0.35 * driftAmp.current,
      );
    } else {
      driftOffset.current.set(0, 0, 0);
    }

    controls.update();

    // Shake ná controls.update() als additieve offset.
    if (trauma.current > 0.005) {
      trauma.current = Math.max(0, trauma.current - delta * 1.4);
      const amount = trauma.current * trauma.current * 0.45;
      const t = clock.elapsedTime;
      shakeOffset.current.set(
        (Math.sin(t * 31.7) + Math.sin(t * 17.3)) * 0.5 * amount,
        0,
        (Math.sin(t * 27.1) + Math.sin(t * 13.9)) * 0.5 * amount,
      );
    } else {
      shakeOffset.current.set(0, 0, 0);
    }
    camera.position.add(shakeOffset.current);
    controls.target.add(driftOffset.current);
  });

  return (
    <>
      <orthographicCamera />
      <MapControls
        ref={controlsRef}
        makeDefault={false}
        enableRotate
        enableDamping
        dampingFactor={0.08}
        minZoom={12}
        maxZoom={140}
        maxPolarAngle={Math.PI / 2.6}
        minPolarAngle={Math.PI / 5}
        screenSpacePanning={false}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        onStart={() => {
          lastInteraction.current = Date.now();
          focusZoom.current = null;
        }}
        onEnd={() => {
          lastInteraction.current = Date.now();
        }}
      />
    </>
  );
}

