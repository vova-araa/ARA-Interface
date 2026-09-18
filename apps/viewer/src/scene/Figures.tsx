import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentState, WorldConfig } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { districtEdge, projectPlacement } from '../placements.ts';
import { visiblePods, type PodInfo } from './Pods.tsx';
import { emojiTexture } from './icons.ts';
import { toolIcon } from '../util.ts';

/**
 * De agents van een sessie, als figuurtjes die vanaf de rand van hun district
 * naar hun pod lopen.
 *
 * Elk figuurtje is opgebouwd uit dezelfde tien vormen, en er kunnen er
 * tweehonderd tegelijk staan. In de eerste versie was dat tweehonderd keer
 * tien losse meshes — mét tien eigen geometrieën per figuur, want de
 * geometrie stond inline in de component. Nu staat elke vorm één keer op
 * moduleniveau en gaan alle figuren door dezelfde instanced meshes: negen
 * draw calls voor het hele gezelschap in plaats van tien per agent.
 *
 * Het loopje zelf blijft per figuur berekend — dat draagt betekenis (een agent
 * die loopt is een agent die net begonnen is), dus dat hoort in de frame-lus.
 * De lichtdraad naar ouder of pod zit in één LineSegments, en de tekstballon
 * en het tool-icoon blijven losse React-elementen omdat ze DOM en tekst zijn.
 */

const MAX_FIGURES = 200;
const FIGURE_SCALE = 1.85;
const WALK_DURATION_MS = 2500;
const AGENT_COLORS = [
  new THREE.Color('#ff8a3d'),
  new THREE.Color('#4da3ff'),
  new THREE.Color('#3ecf6f'),
  new THREE.Color('#c07cff'),
  new THREE.Color('#ffd75e'),
  new THREE.Color('#ff6b9e'),
];

// --- gedeelde geometrie ------------------------------------------------
const BODY_GEO = new THREE.CapsuleGeometry(0.09, 0.12, 4, 8);
const LEG_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.1, 6);
const ARM_GEO = new THREE.CylinderGeometry(0.02, 0.022, 0.12, 6);
const HEAD_GEO = new THREE.SphereGeometry(0.08, 10, 8);
const HELMET_GEO = new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const TELESCOPE_GEO = new THREE.CylinderGeometry(0.018, 0.026, 0.14, 6);
const CLIPBOARD_GEO = new THREE.BoxGeometry(0.09, 0.12, 0.012);
const TOOLBELT_GEO = new THREE.TorusGeometry(0.095, 0.02, 5, 10);
const TIE_GEO = new THREE.BoxGeometry(0.03, 0.1, 0.012);
const DUST_GEO = new THREE.PlaneGeometry(1, 1);

// --- gedeelde materialen -----------------------------------------------
// Wit waar de kleur per figuur uit `setColorAt` komt. Géén `vertexColors`:
// met die vlag verwacht de shader een `color`-attribuut op de geometrie, dat
// er niet is, en dan is elke instance zwart.
const BODY_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const ARM_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const HELMET_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff' });
const LEG_MAT = new THREE.MeshStandardMaterial({ color: '#3b3347' });
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#ffdbb5' });
const TELESCOPE_MAT = new THREE.MeshStandardMaterial({ color: '#5b4a6b', metalness: 0.4 });
const CLIPBOARD_MAT = new THREE.MeshStandardMaterial({ color: '#e8dcc8' });
const TOOLBELT_MAT = new THREE.MeshStandardMaterial({ color: '#7a5230' });
const TIE_MAT = new THREE.MeshStandardMaterial({ color: '#d90012' });

/**
 * Tool-icoon: één materiaal én één instanced mesh per emoji, niet per figuur.
 * Honderdtwintig agents met een draaiende tool gaven anders honderdtwintig
 * sprite-draw-calls; nu zijn het er zoveel als er verschillende tools draaien,
 * en dat aantal is klein. Een plat vlakje dat naar de camera draait ziet er
 * onder de ortho-camera hetzelfde uit als een sprite.
 */
const ICON_GEO = new THREE.PlaneGeometry(1, 1);
const iconMaterials = new Map<string, THREE.MeshBasicMaterial>();
function iconMaterial(icon: string): THREE.MeshBasicMaterial {
  let mat = iconMaterials.get(icon);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      map: emojiTexture(icon),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    iconMaterials.set(icon, mat);
  }
  return mat;
}

/** Visuele stijl per agent-type: rol in één oogopslag herkenbaar. */
type Accessory = 'telescope' | 'clipboard' | 'toolbelt' | 'tie' | null;
interface AgentStyle {
  helmet: string;
  body?: string;
  accessory: Accessory;
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
  /** `sessionId-agentId`; ook de React-key en de sleutel van de tekstballon. */
  key: string;
  /** Emoji van de actieve tool, of null als er geen tool draait. */
  icon: string | null;
  agent: AgentState;
  pod: PodInfo;
  slot: number;
  /** Where the light thread anchors: parent figure's spot, or the pod. */
  linkTo: { x: number; z: number };
  linkIsParent: boolean;
  accessory: Accessory;
  bodyColor: THREE.Color;
  helmetColor: THREE.Color;
  start: { x: number; z: number };
  target: { x: number; z: number };
}

function slotTarget(pod: PodInfo, slot: number): { x: number; z: number } {
  const angle = (slot / 6) * Math.PI * 2;
  // Iets ruimere ring: pods én figuren zijn groter geworden.
  return {
    x: pod.position.x + Math.cos(angle) * 0.88,
    z: pod.position.z + Math.sin(angle) * 0.88,
  };
}

// Draadkleuren met hun doorzichtigheid er al in verrekend: de draden liggen in
// één additief gemengde LineSegments, en daar is "minder helder" hetzelfde als
// "doorzichtiger".
const THREAD_PARENT = new THREE.Color('#ffd75e').multiplyScalar(0.7);
const THREAD_POD = new THREE.Color('#9ecbff').multiplyScalar(0.45);

// Rekenobjecten buiten de lus; deze draaien tot 200 keer per frame.
const scratch = new THREE.Object3D();
const parentMatrix = new THREE.Matrix4();
const jointMatrix = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();

/** Eén gewricht (heup/schouder) met de mesh eronder, onder de figuur-transform. */
function limb(
  mesh: THREE.InstancedMesh,
  index: number,
  hx: number,
  hy: number,
  pitch: number,
  drop: number,
): void {
  scratch.position.set(hx, hy, 0);
  scratch.rotation.set(pitch, 0, 0);
  scratch.scale.set(1, 1, 1);
  scratch.updateMatrix();
  jointMatrix.multiplyMatrices(parentMatrix, scratch.matrix);
  scratch.position.set(0, drop, 0);
  scratch.rotation.set(0, 0, 0);
  scratch.updateMatrix();
  mesh.setMatrixAt(index, partMatrix.multiplyMatrices(jointMatrix, scratch.matrix));
}

function part(
  mesh: THREE.InstancedMesh,
  index: number,
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  scratch.position.set(px, py, pz);
  scratch.rotation.set(rx, ry, rz);
  scratch.scale.set(1, 1, 1);
  scratch.updateMatrix();
  mesh.setMatrixAt(index, partMatrix.multiplyMatrices(parentMatrix, scratch.matrix));
}

/** Kleur van het stofwolkje; buiten de lus, want hij verandert elke frame. */
const dustColor = new THREE.Color();
/** Eén Color per rolkleur, zodat een snapshot-update geen nieuwe objecten maakt. */
const colorCache = new Map<string, THREE.Color>();
function cachedColor(hex: string): THREE.Color {
  let color = colorCache.get(hex);
  if (!color) {
    color = new THREE.Color(hex);
    colorCache.set(hex, color);
  }
  return color;
}

function FigureCrowd({ figures }: { figures: FigureInfo[] }): JSX.Element {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const legs = useRef<THREE.InstancedMesh>(null);
  const arms = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const helmets = useRef<THREE.InstancedMesh>(null);
  const telescopes = useRef<THREE.InstancedMesh>(null);
  const clipboards = useRef<THREE.InstancedMesh>(null);
  const toolbelts = useRef<THREE.InstancedMesh>(null);
  const ties = useRef<THREE.InstancedMesh>(null);
  const dust = useRef<THREE.InstancedMesh>(null);
  const threads = useRef<THREE.LineSegments>(null);
  const icons = useRef(new Map<string, THREE.InstancedMesh>());
  // Alleen figuren mét een tekstballon krijgen een eigen groepje; de rest
  // hoeft geen Object3D meer.
  const bubbleAnchors = useRef(new Map<string, THREE.Group>());

  // Eén buffer voor alle lichtdraden samen.
  const threadGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FIGURES * 6), 3));
    // Een echt kleurattribuut, dus `vertexColors` mag hier wél aan.
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_FIGURES * 6), 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, []);
  const threadMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const dustMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: emojiTexture('💨'),
        transparent: true,
        depthWrite: false,
        // Additief, zodat het vervagen per exemplaar uit de instance-kleur kan
        // komen; sprites kennen geen per-instance doorzichtigheid.
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const bubbles = useAra((s) => s.bubbles);
  const lodFar = useAra((s) => s.lodFar);
  // Welke emoji's zijn er op dit moment nodig — meestal een handvol.
  const iconKinds = useMemo(() => {
    const set = new Set<string>();
    for (const f of figures) if (f.icon) set.add(f.icon);
    return [...set];
  }, [figures]);

  // Materiaalkleur per figuur ligt vast zolang de bezetting niet wijzigt.
  useLayoutEffect(() => {
    const body = bodies.current;
    const arm = arms.current;
    const helmet = helmets.current;
    if (!body || !arm || !helmet) return;
    figures.forEach((f, i) => {
      body.setColorAt(i, f.bodyColor);
      arm.setColorAt(2 * i, f.bodyColor);
      arm.setColorAt(2 * i + 1, f.bodyColor);
      helmet.setColorAt(i, f.helmetColor);
    });
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (arm.instanceColor) arm.instanceColor.needsUpdate = true;
    if (helmet.instanceColor) helmet.instanceColor.needsUpdate = true;
  }, [figures]);

  useFrame(({ clock, camera }) => {
    const body = bodies.current;
    const leg = legs.current;
    const arm = arms.current;
    const head = heads.current;
    const helmet = helmets.current;
    const dustMesh = dust.current;
    const line = threads.current;
    if (!body || !leg || !arm || !head || !helmet || !dustMesh || !line) return;

    const t = clock.elapsedTime;
    const now = Date.now();
    const accessoryMeshes: Record<Exclude<Accessory, null>, THREE.InstancedMesh | null> = {
      telescope: telescopes.current,
      clipboard: clipboards.current,
      toolbelt: toolbelts.current,
      tie: ties.current,
    };
    const accessoryCount = { telescope: 0, clipboard: 0, toolbelt: 0, tie: 0 };

    for (const mesh of icons.current.values()) mesh.count = 0;
    const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = line.geometry.getAttribute('color') as THREE.BufferAttribute;
    let threadCount = 0;
    let dustCount = 0;

    for (let i = 0; i < figures.length; i += 1) {
      const f = figures[i]!;
      const { agent, start, target } = f;
      const age = now - agent.startedAt;
      const walk = Math.min(1, age / WALK_DURATION_MS);
      const ease = 1 - Math.pow(1 - walk, 3);
      const x = start.x + (target.x - start.x) * ease;
      const z = start.z + (target.z - start.z) * ease;
      // Bob while walking, small idle sway after.
      const bob = walk < 1 ? Math.abs(Math.sin(age / 90)) * 0.08 : Math.sin(t * 2 + f.slot) * 0.02;
      let y = 0.32 + bob;
      let scale = FIGURE_SCALE;
      if (agent.stopped) {
        // Fade out by sinking.
        const gone = Math.min(1, (now - agent.lastSeenAt) / 1500);
        y -= gone * 0.5;
        scale = FIGURE_SCALE * (1 - gone * 0.7);
      }
      const yaw = Math.atan2(target.x - start.x, target.z - start.z);

      scratch.position.set(x, y, z);
      scratch.rotation.set(0, yaw, 0);
      scratch.scale.setScalar(scale);
      scratch.updateMatrix();
      parentMatrix.copy(scratch.matrix);

      // Walkcycle: benen en armen zwaaien tegengesteld tijdens het lopen.
      const stride = walk < 1 ? Math.sin(age / 90) * 0.7 : 0;
      part(body, i, 0, 0.14, 0);
      limb(leg, 2 * i, -0.04, 0.09, stride, -0.05);
      limb(leg, 2 * i + 1, 0.04, 0.09, -stride, -0.05);
      limb(arm, 2 * i, -0.11, 0.22, -stride * 0.8, -0.06);
      limb(arm, 2 * i + 1, 0.11, 0.22, stride * 0.8, -0.06);
      part(head, i, 0, 0.34, 0);
      part(helmet, i, 0, 0.38, 0);

      if (f.accessory) {
        const mesh = accessoryMeshes[f.accessory];
        if (mesh) {
          const index = accessoryCount[f.accessory]++;
          if (f.accessory === 'telescope') part(mesh, index, 0.1, 0.36, 0.06, 0.3, 0, 1.1);
          else if (f.accessory === 'clipboard') part(mesh, index, 0.1, 0.16, 0.05, 0.2, -0.4, 0);
          else if (f.accessory === 'toolbelt') part(mesh, index, 0, 0.08, 0, Math.PI / 2, 0, 0);
          else part(mesh, index, 0, 0.18, 0.085, 0.1, 0, 0);
        }
      }

      // Stofwolkje achter de voeten tijdens het lopen.
      if (walk < 1 && !agent.stopped) {
        const puff = (age % 380) / 380;
        const s = (0.1 + puff * 0.14) * scale;
        scratch.position.set(
          x - Math.sin(yaw) * 0.12 * scale,
          y + (0.02 + puff * 0.06) * scale,
          z - Math.cos(yaw) * 0.12 * scale,
        );
        scratch.quaternion.copy(camera.quaternion);
        scratch.scale.set(s, s, s);
        scratch.updateMatrix();
        dustMesh.setMatrixAt(dustCount, scratch.matrix);
        const fade = 0.5 * (1 - puff);
        dustColor.setRGB(fade, fade, fade);
        dustMesh.setColorAt(dustCount, dustColor);
        dustCount += 1;
      }

      // Lichtdraad: kop → anker (ouder of pod). Gestopte agents hebben er geen.
      if (!agent.stopped) {
        const v = threadCount * 2;
        positions.setXYZ(v, x, y + 0.42 * scale, z);
        positions.setXYZ(
          v + 1,
          f.linkTo.x,
          y + (f.linkIsParent ? 0.3 : 0.5) * scale,
          f.linkTo.z,
        );
        const c = f.linkIsParent ? THREAD_PARENT : THREAD_POD;
        colors.setXYZ(v, c.r, c.g, c.b);
        colors.setXYZ(v + 1, c.r, c.g, c.b);
        threadCount += 1;
      }

      // Tool-icoon: een naar de camera gedraaid vlakje boven de schouder.
      if (f.icon && !agent.stopped && !lodFar) {
        const mesh = icons.current.get(f.icon);
        if (mesh) {
          scratch.position.set(0.14, 0.52, 0);
          scratch.rotation.set(0, 0, 0);
          scratch.scale.set(1, 1, 1);
          scratch.updateMatrix();
          partMatrix.multiplyMatrices(parentMatrix, scratch.matrix);
          partMatrix.decompose(scratch.position, scratch.quaternion, scratch.scale);
          scratch.quaternion.copy(camera.quaternion);
          scratch.scale.setScalar(0.22 * scale);
          scratch.updateMatrix();
          mesh.setMatrixAt(mesh.count, scratch.matrix);
          mesh.count += 1;
        }
      }

      // De tekstballon hangt aan een leeg groepje op dezelfde plek.
      const anchor = bubbleAnchors.current.get(f.key);
      if (anchor) {
        anchor.position.set(x, y, z);
        anchor.rotation.y = yaw;
        anchor.scale.setScalar(scale);
      }
    }

    const n = figures.length;
    body.count = n;
    leg.count = 2 * n;
    arm.count = 2 * n;
    head.count = n;
    helmet.count = n;
    body.instanceMatrix.needsUpdate = true;
    leg.instanceMatrix.needsUpdate = true;
    arm.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    helmet.instanceMatrix.needsUpdate = true;
    // Zonder dit blijft de bounding sphere op de eerste frame staan en
    // verdwijnt het gezelschap zodra het buiten die bol loopt.
    body.computeBoundingSphere();
    leg.computeBoundingSphere();
    arm.computeBoundingSphere();
    head.computeBoundingSphere();
    helmet.computeBoundingSphere();

    for (const key of ['telescope', 'clipboard', 'toolbelt', 'tie'] as const) {
      const mesh = accessoryMeshes[key];
      if (!mesh) continue;
      mesh.count = accessoryCount[key];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.count > 0) mesh.computeBoundingSphere();
    }

    dustMesh.count = dustCount;
    dustMesh.instanceMatrix.needsUpdate = true;
    if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
    if (dustCount > 0) dustMesh.computeBoundingSphere();

    for (const mesh of icons.current.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.count > 0) mesh.computeBoundingSphere();
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    line.geometry.setDrawRange(0, threadCount * 2);
    line.visible = threadCount > 0;
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[BODY_GEO, BODY_MAT, MAX_FIGURES]} castShadow />
      <instancedMesh ref={legs} args={[LEG_GEO, LEG_MAT, MAX_FIGURES * 2]} />
      <instancedMesh ref={arms} args={[ARM_GEO, ARM_MAT, MAX_FIGURES * 2]} />
      <instancedMesh ref={heads} args={[HEAD_GEO, HEAD_MAT, MAX_FIGURES]} />
      <instancedMesh ref={helmets} args={[HELMET_GEO, HELMET_MAT, MAX_FIGURES]} />
      <instancedMesh ref={telescopes} args={[TELESCOPE_GEO, TELESCOPE_MAT, MAX_FIGURES]} />
      <instancedMesh ref={clipboards} args={[CLIPBOARD_GEO, CLIPBOARD_MAT, MAX_FIGURES]} />
      <instancedMesh ref={toolbelts} args={[TOOLBELT_GEO, TOOLBELT_MAT, MAX_FIGURES]} />
      <instancedMesh ref={ties} args={[TIE_GEO, TIE_MAT, MAX_FIGURES]} />
      <instancedMesh ref={dust} args={[DUST_GEO, dustMat, MAX_FIGURES]} frustumCulled={false} />
      <lineSegments ref={threads} args={[threadGeo, threadMat]} frustumCulled={false} />
      {/* tool-iconen (LOD: uit wanneer ver uitgezoomd), één mesh per emoji */}
      {!lodFar &&
        iconKinds.map((icon) => (
          <instancedMesh
            key={icon}
            ref={(mesh) => {
              if (mesh) icons.current.set(icon, mesh);
              else icons.current.delete(icon);
            }}
            args={[ICON_GEO, iconMaterial(icon), MAX_FIGURES]}
            frustumCulled={false}
            // Nieuw aangekoppeld begint een instanced mesh op zijn volle
            // capaciteit met eenheidsmatrices — tweehonderd iconen op de
            // oorsprong. De frame-lus zet het aantal goed, maar pas daarna.
            onUpdate={(mesh) => (mesh.count = 0)}
          />
        ))}
      {/* speech bubbles with toolSummary (LOD: uit wanneer ver uitgezoomd) */}
      {!lodFar &&
        figures.map((f) => {
          const bubble = bubbles.find(
            (b) => b.sessionId === f.agent.sessionId && b.agentId === f.agent.agentId,
          );
          if (!bubble || f.agent.stopped) return null;
          return (
            <group
              key={f.key}
              ref={(g) => {
                if (g) bubbleAnchors.current.set(f.key, g);
                else bubbleAnchors.current.delete(f.key);
              }}
            >
              <Html position={[0, 0.72, 0]} center zIndexRange={[10, 0]}>
                <div className="bubble">{bubble.text}</div>
              </Html>
            </group>
          );
        })}
    </group>
  );
}

export function Figures({ world }: { world: WorldConfig }): JSX.Element {
  const snapshot = useViewSnapshot();
  const filterVenture = useAra((s) => s.filterVenture);

  const figures = useMemo(() => {
    // Zelfde filter als Pods: geen wees-figuren rond een weggefilterde pod.
    let sessions = Object.values(snapshot.sessions);
    if (filterVenture) {
      sessions = sessions.filter(
        (s) => projectPlacement(world, s.project).venture === filterVenture,
      );
    }
    const pods = visiblePods(world, sessions, snapshot.now);
    const out: FigureInfo[] = [];
    const now = Date.now();
    for (const pod of pods) {
      const agents = Object.values(pod.session.agents).filter(
        (agent) => !(agent.stopped && now - agent.lastSeenAt > 2000),
      );
      // First pass: everyone gets a slot, so children can anchor to parents.
      const targets = new Map<string, { x: number; z: number }>();
      agents.forEach((agent, slot) => targets.set(agent.agentId, slotTarget(pod, slot)));
      const start = districtEdge(world, pod.session.project);
      agents.forEach((agent, slot) => {
        const parent = agent.parentAgentId ? targets.get(agent.parentAgentId) : undefined;
        const style = styleFor(agent.agentType);
        out.push({
          key: `${agent.sessionId}-${agent.agentId}`,
          icon: agent.activeTool ? toolIcon(agent.activeTool) : null,
          agent,
          pod,
          slot,
          linkTo: parent ?? { x: pod.position.x, z: pod.position.z },
          linkIsParent: parent !== undefined,
          accessory: style.accessory,
          bodyColor: style.body ? cachedColor(style.body) : AGENT_COLORS[slot % AGENT_COLORS.length]!,
          helmetColor: cachedColor(style.helmet),
          start,
          target: targets.get(agent.agentId) ?? slotTarget(pod, slot),
        });
      });
    }
    return out.slice(0, MAX_FIGURES);
  }, [snapshot, world, filterVenture]);

  return <FigureCrowd figures={figures} />;
}
