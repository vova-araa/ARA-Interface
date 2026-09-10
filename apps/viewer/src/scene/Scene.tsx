import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useAra } from '../store.ts';
import { CameraRig } from './CameraRig.tsx';
import { HexGround } from './HexGround.tsx';
import { Backdrop } from './Backdrop.tsx';
import { Landmarks } from './Landmarks.tsx';
import { Pods } from './Pods.tsx';
import { Figures } from './Figures.tsx';
import { EffectsLayer } from './EffectsLayer.tsx';
import { Labels } from './Labels.tsx';
import { useDaylight } from './daylight.ts';
import { TokenPillars } from './TokenPillars.tsx';
import { AmbientLife } from './AmbientLife.tsx';
import { DistrictLife } from './DistrictLife.tsx';

export function Scene(): JSX.Element {
  const world = useAra((s) => s.world);
  const select = useAra((s) => s.select);
  const daylight = useDaylight();

  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [14, 16, 14], zoom: 38, near: -100, far: 300 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[daylight.stops[0]]} />
      <fog attach="fog" args={[daylight.fogColor, 55, 120]} />
      <ambientLight intensity={daylight.ambient} color="#fff1e0" />
      <directionalLight
        position={[18, 26, 10]}
        intensity={daylight.directional}
        color={daylight.lightColor}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      <hemisphereLight args={['#9db8ff', '#e2a49a', 0.3]} />

      <Suspense fallback={null}>
        <Backdrop />
        <HexGround world={world} />
        <Landmarks world={world} />
        <AmbientLife />
        {world && (
          <>
            <DistrictLife world={world} />
            <Labels world={world} />
            <TokenPillars world={world} />
            <Pods world={world} />
            <Figures world={world} />
            <EffectsLayer world={world} />
          </>
        )}
      </Suspense>
      <CameraRig />
    </Canvas>
  );
}
