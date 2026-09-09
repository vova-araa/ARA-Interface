import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useAra } from '../store.ts';
import { sessionPosition } from '../placements.ts';

const ISO_OFFSET = new THREE.Vector3(14, 16, 14); // ~30° isometric tilt

export function CameraRig(): JSX.Element {
  const controlsRef = useRef<MapControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const flyTarget = useAra((s) => s.flyTarget);
  const goal = useRef<THREE.Vector3 | null>(null);
  const shake = useRef(0);

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
  }, [flyTarget]);

  // Camera nudge on needs-human effects.
  const effects = useAra((s) => s.effects);
  useEffect(() => {
    if (effects.some((e) => e.type === 'nudge' && Date.now() - e.ts < 300)) shake.current = 0.5;
  }, [effects]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    // LOD-schakelaar: ver uitgezoomd → icons/bubbles uit (goedkope frames).
    const far = (camera as THREE.OrthographicCamera).zoom < 26;
    if (far !== useAra.getState().lodFar) useAra.getState().setLodFar(far);
    if (goal.current) {
      // ~1s ease toward the pod.
      controls.target.lerp(goal.current, Math.min(1, delta * 4));
      const desired = goal.current.clone().add(ISO_OFFSET);
      camera.position.lerp(desired, Math.min(1, delta * 4));
      if (controls.target.distanceTo(goal.current) < 0.05) goal.current = null;
    }
    if (shake.current > 0.01) {
      shake.current *= 1 - Math.min(1, delta * 8);
      camera.position.x += (Math.random() - 0.5) * shake.current * 0.3;
      camera.position.z += (Math.random() - 0.5) * shake.current * 0.3;
    }
    controls.update();
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
      />
    </>
  );
}
