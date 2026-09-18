import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToWorld, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { emojiTexture } from './icons.ts';
import { useAra } from '../store.ts';

/**
 * District-leven: elke venture heeft zijn eigen werkende scène —
 * traders die traden, designers die tekenen, trucks die rijden,
 * planners die ritten uitzetten, muziek bij de studio's.
 *
 * Elk tafereel is een unicum, dus hier valt niets over districten heen te
 * instancen. Wat wél kon: de geometrieën en materialen staan op moduleniveau
 * in plaats van als inline JSX binnen een component die per district opnieuw
 * rendert — dat scheelde net zoveel GPU-buffers als er taferelen zijn. En waar
 * één vorm zich binnen een tafereel herhaalt (de vijf candlesticks, de drie
 * routestippen) staat er nu één instanced mesh.
 */

// --- gedeelde geometrie ------------------------------------------------
const BAR_GEO = new THREE.BoxGeometry(0.07, 0.35, 0.07);
const DESK_GEO = new THREE.BoxGeometry(0.72, 0.05, 0.3);
const EASEL_LEG_GEO = new THREE.CylinderGeometry(0.02, 0.02, 0.62, 5);
const CANVAS_GEO = new THREE.PlaneGeometry(0.42, 0.34);
const BRUSH_GEO = new THREE.CylinderGeometry(0.012, 0.02, 0.2, 5);
const TRUCK_BODY_GEO = new THREE.BoxGeometry(0.5, 0.26, 0.24);
const TRUCK_CAB_GEO = new THREE.BoxGeometry(0.24, 0.3, 0.24);
const BOARD_GEO = new THREE.PlaneGeometry(0.56, 0.4);
const BOARD_POLE_GEO = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5);
const DOT_GEO = new THREE.SphereGeometry(0.025, 6, 5);
const CRANE_FOOT_GEO = new THREE.CylinderGeometry(0.16, 0.2, 0.16, 8);
const CRANE_MAST_GEO = new THREE.BoxGeometry(0.09, 1.1, 0.09);
const CRANE_ARM_GEO = new THREE.BoxGeometry(1.0, 0.07, 0.07);
const CRANE_WEIGHT_GEO = new THREE.BoxGeometry(0.16, 0.14, 0.14);
const CRANE_CABLE_GEO = new THREE.CylinderGeometry(0.008, 0.008, 1, 4);
const CONTAINER_GEO = new THREE.BoxGeometry(0.22, 0.14, 0.13);
const TRAILER_GEO = new THREE.BoxGeometry(0.5, 0.22, 0.2);

// --- gedeelde materialen -----------------------------------------------
const DESK_MAT = new THREE.MeshStandardMaterial({ color: '#2a2f3a' });
/**
 * Twee kant-en-klare candlestick-materialen in plaats van vijf die per frame
 * van kleur worden gezet: een bar wisselt van materiaal, niet van kleur. Zo
 * blijven het twee draw calls (groen en rood) voor vijf bars.
 */
const BAR_UP_MAT = new THREE.MeshStandardMaterial({
  color: '#3ecf6f',
  emissive: '#1d6b3a',
  emissiveIntensity: 0.5,
});
const BAR_DOWN_MAT = new THREE.MeshStandardMaterial({
  color: '#ff5252',
  emissive: '#7a2727',
  emissiveIntensity: 0.5,
});
const WOOD_MAT = new THREE.MeshStandardMaterial({ color: '#7a5230' });
const BRUSH_MAT = new THREE.MeshStandardMaterial({ color: '#ff3fa4' });
const TRUCK_BODY_MAT = new THREE.MeshStandardMaterial({ color: '#dfe8f2' });
const BOARD_MAT = new THREE.MeshStandardMaterial({ color: '#1e2b3a', side: THREE.DoubleSide });
const BOARD_POLE_MAT = new THREE.MeshStandardMaterial({ color: '#666' });
const DOT_MAT = new THREE.MeshStandardMaterial({
  color: '#ffd75e',
  emissive: '#ffd75e',
  emissiveIntensity: 0.8,
  toneMapped: false,
});
const CRANE_FOOT_MAT = new THREE.MeshStandardMaterial({ color: '#8f8578' });
const CRANE_STEEL_MAT = new THREE.MeshStandardMaterial({ color: '#f2a800' });
const CRANE_WEIGHT_MAT = new THREE.MeshStandardMaterial({ color: '#5c5148' });
const CABLE_MAT = new THREE.MeshStandardMaterial({ color: '#2a2f3a' });
const CONTAINER_MAT = new THREE.MeshStandardMaterial({ color: '#c0392b' });
const TRAILER_MAT = new THREE.MeshStandardMaterial({ color: '#c9d4e0' });

/** Cabinekleur verschilt per tak; één materiaal per kleur, niet per truck. */
const cabMaterials = new Map<string, THREE.MeshStandardMaterial>();
function cabMaterial(color: string): THREE.MeshStandardMaterial {
  let mat = cabMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color });
    cabMaterials.set(color, mat);
  }
  return mat;
}

const BAR_COUNT = 5;
const BAR_HEIGHTS = [0.3, 0.5, 0.25, 0.6, 0.4];
const DOT_COUNT = 3;

const scratch = new THREE.Object3D();

/** Trading: candlestick-chart waarvan de bars live bewegen + flitsend groen/rood. */
function TradingFloor(): JSX.Element {
  const up = useRef<THREE.InstancedMesh>(null);
  const down = useRef<THREE.InstancedMesh>(null);

  useFrame(({ clock }) => {
    const upMesh = up.current;
    const downMesh = down.current;
    if (!upMesh || !downMesh) return;
    let upCount = 0;
    let downCount = 0;
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const t = clock.elapsedTime * 0.9 + i * 1.3;
      const h = BAR_HEIGHTS[i]! * (0.7 + Math.abs(Math.sin(t)) * 0.7);
      scratch.position.set(-0.26 + i * 0.13, (h * 0.35) / 2 + 0.02, 0);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, h, 1);
      scratch.updateMatrix();
      if (Math.sin(t) > 0) upMesh.setMatrixAt(upCount++, scratch.matrix);
      else downMesh.setMatrixAt(downCount++, scratch.matrix);
    }
    upMesh.count = upCount;
    downMesh.count = downCount;
    upMesh.instanceMatrix.needsUpdate = true;
    downMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[0.85, 0.3, 0.55]} rotation={[0, -0.5, 0]}>
      <mesh position={[0, -0.02, 0]} geometry={DESK_GEO} material={DESK_MAT} />
      <instancedMesh ref={up} args={[BAR_GEO, BAR_UP_MAT, BAR_COUNT]} frustumCulled={false} />
      <instancedMesh ref={down} args={[BAR_GEO, BAR_DOWN_MAT, BAR_COUNT]} frustumCulled={false} />
    </group>
  );
}

/** Elevate: schildersezel met doek dat van kleur verschuift + zwevende kwast. */
function DesignStudio(): JSX.Element {
  const brush = useRef<THREE.Mesh>(null);
  // Het doek verschuift van kleur, dus dit materiaal is per definitie van
  // deze ene ezel — daarom als enige niet gedeeld.
  const canvasMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#f0e2d8', side: THREE.DoubleSide }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (brush.current) {
      brush.current.position.set(Math.sin(t * 1.8) * 0.14, 0.62 + Math.cos(t * 2.6) * 0.1, 0.1);
      brush.current.rotation.z = Math.sin(t * 1.8) * 0.4 - 0.4;
    }
    canvasMat.color.setHSL((t * 0.03) % 1, 0.45, 0.75);
  });
  return (
    <group position={[-0.8, 0.3, 0.6]} rotation={[0, 0.6, 0]}>
      {/* ezelpoten */}
      <mesh
        position={[-0.14, 0.3, -0.05]}
        rotation={[0.15, 0, 0.12]}
        geometry={EASEL_LEG_GEO}
        material={WOOD_MAT}
      />
      <mesh
        position={[0.14, 0.3, -0.05]}
        rotation={[0.15, 0, -0.12]}
        geometry={EASEL_LEG_GEO}
        material={WOOD_MAT}
      />
      {/* doek */}
      <mesh position={[0, 0.55, 0]} rotation={[-0.15, 0, 0]} geometry={CANVAS_GEO} material={canvasMat} />
      {/* kwast */}
      <mesh ref={brush} geometry={BRUSH_GEO} material={BRUSH_MAT} />
    </group>
  );
}

/** Vrachtwagen die een rondje rijdt (TMS: ritten; Blex: wagenpark-shunten). */
function Truck({
  radius,
  speed,
  color,
  pingPong,
}: {
  radius: number;
  speed: number;
  color: string;
  pingPong?: boolean;
}): JSX.Element {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    if (pingPong) {
      // Shunten: heen en weer op een rechte baan.
      const t = Math.sin(clock.elapsedTime * speed);
      g.position.set(t * radius, 0.08, 0.9);
      g.rotation.y = t >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const t = clock.elapsedTime * speed;
      g.position.set(Math.cos(t) * radius, 0.08, Math.sin(t) * radius);
      g.rotation.y = -t;
    }
  });
  return (
    <group ref={group} scale={0.55}>
      <mesh
        position={[0.12, 0.14, 0]}
        castShadow
        geometry={TRUCK_BODY_GEO}
        material={TRUCK_BODY_MAT}
      />
      <mesh position={[-0.28, 0.16, 0]} geometry={TRUCK_CAB_GEO} material={cabMaterial(color)} />
    </group>
  );
}

/** TMS-planbord: route-stippen die over een kaartbord lopen. */
function PlanningBoard(): JSX.Element {
  const dots = useRef<THREE.InstancedMesh>(null);
  useFrame(({ clock }) => {
    const mesh = dots.current;
    if (!mesh) return;
    for (let i = 0; i < DOT_COUNT; i += 1) {
      const t = (clock.elapsedTime * 0.25 + i / 3) % 1;
      // Route: zigzag over het bord.
      scratch.position.set(-0.22 + t * 0.44, 0.52 + Math.sin(t * Math.PI * 3) * 0.09, 0.03);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <group position={[0.9, 0.3, -0.6]} rotation={[0, -2.2, 0]}>
      <mesh position={[0, 0.5, 0]} geometry={BOARD_GEO} material={BOARD_MAT} />
      <mesh position={[0, 0.27, -0.02]} geometry={BOARD_POLE_GEO} material={BOARD_POLE_MAT} />
      <instancedMesh ref={dots} args={[DOT_GEO, DOT_MAT, DOT_COUNT]} frustumCulled={false} />
    </group>
  );
}

/** Hijskraan (Truck & Trailers): arm draait, container zakt en heft. */
function Crane(): JSX.Element {
  const arm = useRef<THREE.Group>(null);
  const hook = useRef<THREE.Group>(null);
  const cable = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (arm.current) arm.current.rotation.y = Math.sin(t * 0.28) * 1.15;
    const drop = 0.28 + ((Math.sin(t * 0.55) + 1) / 2) * 0.5; // kabellengte
    if (hook.current) hook.current.position.y = -drop;
    if (cable.current) {
      cable.current.scale.y = drop;
      cable.current.position.y = -drop / 2;
    }
  });
  return (
    <group position={[-0.95, 0, -0.75]}>
      <mesh position={[0, 0.08, 0]} castShadow geometry={CRANE_FOOT_GEO} material={CRANE_FOOT_MAT} />
      <mesh position={[0, 0.65, 0]} castShadow geometry={CRANE_MAST_GEO} material={CRANE_STEEL_MAT} />
      <group ref={arm} position={[0, 1.18, 0]}>
        <mesh position={[0.42, 0, 0]} castShadow geometry={CRANE_ARM_GEO} material={CRANE_STEEL_MAT} />
        {/* contragewicht */}
        <mesh position={[-0.28, -0.06, 0]} geometry={CRANE_WEIGHT_GEO} material={CRANE_WEIGHT_MAT} />
        {/* kabel + container aan de armtip */}
        <group position={[0.82, 0, 0]}>
          <mesh ref={cable} position={[0, -0.25, 0]} geometry={CRANE_CABLE_GEO} material={CABLE_MAT} />
          <group ref={hook} position={[0, -0.5, 0]}>
            <mesh castShadow geometry={CONTAINER_GEO} material={CONTAINER_MAT} />
          </group>
        </group>
      </group>
    </group>
  );
}

/** Muzieknoten die opstijgen en vervagen (Uprising stage, Vovara mic). */
function MusicNotes({ color, rate }: { color: string; rate: number }): JSX.Element {
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  // De textuur komt uit de emoji-cache, dus beide studio's delen er één.
  const texture = emojiTexture('🎵');
  useFrame(({ clock }) => {
    sprites.current.forEach((sprite, i) => {
      if (!sprite) return;
      const t = (clock.elapsedTime * rate + i / 3) % 1;
      sprite.position.set(Math.sin(t * 6 + i) * 0.15, 0.9 + t * 1.1, 0);
      sprite.material.opacity = t < 0.15 ? t / 0.15 : 1 - t;
      const s = 0.2 + t * 0.1;
      sprite.scale.set(s, s, s);
    });
  });
  return (
    <group>
      {[0, 1, 2].map((i) => (
        // Elke noot vervaagt op zijn eigen moment, dus elke noot heeft echt een
        // eigen materiaal nodig — sprites kennen geen per-instance opacity.
        <sprite key={i} ref={(s) => (sprites.current[i] = s)}>
          <spriteMaterial map={texture} transparent depthWrite={false} color={color} />
        </sprite>
      ))}
    </group>
  );
}

const LIFE: Record<string, () => JSX.Element> = {
  trading: () => <TradingFloor />,
  elevate: () => <DesignStudio />,
  traject: () => (
    <>
      <PlanningBoard />
      <Truck radius={1.7} speed={0.35} color="#f5c518" />
    </>
  ),
  blex: () => (
    <>
      <Crane />
      <Truck radius={1.1} speed={0.5} color="#ffd75e" pingPong />
      {/* extra geparkeerde trailer */}
      <mesh
        position={[-0.9, 0.16, 0.85]}
        rotation={[0, 0.4, 0]}
        castShadow
        geometry={TRAILER_GEO}
        material={TRAILER_MAT}
      />
    </>
  ),
  uprising: () => <MusicNotes color="#ff8a3d" rate={0.35} />,
  vovara: () => <MusicNotes color="#c9a2ff" rate={0.25} />,
};

export function DistrictLife({ world }: { world: WorldConfig }): JSX.Element | null {
  const lodFar = useAra((s) => s.lodFar);
  const placements = useMemo(
    () =>
      world.districts
        .filter((district) => LIFE[district.venture.id])
        .map((district) => {
          const { x, z } = axialToWorld(district.center);
          return {
            id: district.venture.id,
            position: [x * HEX_SPACING, 0.3, z * HEX_SPACING] as [number, number, number],
          };
        }),
    [world],
  );

  if (lodFar) return null; // ver uitgezoomd: district-details overslaan

  return (
    <group>
      {placements.map(({ id, position }) => {
        const Life = LIFE[id]!;
        return (
          <group key={id} position={position}>
            <Life />
          </group>
        );
      })}
    </group>
  );
}
