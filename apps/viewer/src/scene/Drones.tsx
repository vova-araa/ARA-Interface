import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';

/**
 * Bezorgdrones tussen de districten.
 *
 * Twee soorten, en het onderscheid is het punt:
 *
 * 1. **Vaste routes.** Hoeveel er vliegen volgt het aantal draaiende sessies,
 *    net als het wegverkeer. Een stille wereld heeft een lege lucht.
 * 2. **Bezorgingen.** Een afgeronde taak stuurt één drone van dat district
 *    naar de hub — het werk komt binnen, en je ziet het aankomen. Dat is geen
 *    versiering: het is dezelfde gebeurtenis die ook de vlag en het vuurwerk
 *    geeft, alleen dan als iets dat een afstand aflegt.
 *
 * De vlucht is een echte boog, geen rechte lijn met een hoogteprofiel: het
 * middelpunt ligt opzij van de verbinding, zodat heen en terug niet over
 * dezelfde streep gaan.
 */

interface Route {
  from: THREE.Vector3;
  to: THREE.Vector3;
  speed: number;
  phase: number;
  /** Zijwaartse uitzwaai van de boog; het teken bepaalt links of rechts. */
  bow: number;
  /** Eenmalige bezorging: verdwijnt zodra hij aangekomen is. */
  once?: boolean;
  bornAt?: number;
}

// Buiten de componenten: deze worden per drone per frame gebruikt, en een
// nieuwe Vector3 per frame is precies het afval dat je pas merkt als het
// haperen begint.
const MID = new THREE.Vector3();
const SIDE = new THREE.Vector3();
const PERP = new THREE.Vector3();
const POS = new THREE.Vector3();
const TANGENT = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const D = new THREE.Vector3();
const E = new THREE.Vector3();

function Drone({ route }: { route: Route }): JSX.Element {
  const group = useRef<THREE.Group>(null);
  const rotors = useRef<(THREE.Mesh | null)[]>([]);
  const parcel = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime * route.speed + route.phase;
    // Een bezorging vliegt één keer; een vaste route pendelt heen en terug.
    const cycle = route.once ? Math.min(1, t) : t % 2;
    const f = cycle < 1 ? cycle : 2 - cycle;
    const eased = f * f * (3 - 2 * f); // smoothstep

    // Kwadratische bézier met een controlepunt opzij van de verbinding. Een
    // rechte lijn met alleen een hoogteprofiel laat heen en terug over exact
    // dezelfde streep gaan, en dan leest het als een lift, niet als een vlucht.
    const mid = MID.lerpVectors(route.from, route.to, 0.5);
    const side = SIDE.subVectors(route.to, route.from);
    PERP.set(-side.z, 0, side.x).normalize().multiplyScalar(route.bow);
    mid.add(PERP);
    const inv = 1 - eased;
    A.copy(route.from).multiplyScalar(inv * inv);
    B.copy(mid).multiplyScalar(2 * inv * eased);
    C.copy(route.to).multiplyScalar(eased * eased);
    const pos = POS.copy(A).add(B).add(C);
    pos.y = 2.6 + Math.sin(eased * Math.PI) * 1.4 + Math.sin(clock.elapsedTime * 3 + route.phase) * 0.06;

    // Richting uit de raaklijn van de curve zelf, niet uit de rechte
    // verbinding: anders wijst de neus de bocht uit.
    TANGENT.copy(route.from).multiplyScalar(-2 * inv)
      .add(D.copy(mid).multiplyScalar(2 - 4 * eased))
      .add(E.copy(route.to).multiplyScalar(2 * eased));
    const forward = route.once || cycle < 1 ? 1 : -1;
    g.position.copy(pos);
    g.rotation.y = Math.atan2(TANGENT.x * forward, TANGENT.z * forward);
    // Overhellen in de bocht, zoals iets dat echt stuurt: hoe scherper de
    // boog, hoe verder hij op zijn kant hangt.
    g.rotation.z = -route.bow * 0.12 * forward + Math.sin(clock.elapsedTime * 2 + route.phase) * 0.05;
    rotors.current.forEach((rotor) => {
      if (rotor) rotor.rotation.y = clock.elapsedTime * 40;
    });
    if (parcel.current) parcel.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.2;
  });

  return (
    <group ref={group} scale={0.7}>
      {/* romp — met gloeiend lint erachter (Trail volgt de wereldpositie) */}
      <Trail width={0.6} length={5} decay={1.4} color="#7ec8ff" attenuation={(w) => w * w}>
        <mesh castShadow>
          <boxGeometry args={[0.22, 0.08, 0.22]} />
          <meshStandardMaterial color="#e8eaf0" />
        </mesh>
      </Trail>
      {/* vier armen + rotors */}
      {[[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].map(([x, z], i) => (
        <group key={i} position={[x!, 0.03, z!]}>
          <mesh>
            <cylinderGeometry args={[0.015, 0.015, 0.04, 5]} />
            <meshStandardMaterial color="#8b95a5" />
          </mesh>
          <mesh ref={(m) => (rotors.current[i] = m)} position={[0, 0.035, 0]}>
            <boxGeometry args={[0.16, 0.008, 0.02]} />
            <meshStandardMaterial color="#2a2f3a" />
          </mesh>
        </group>
      ))}
      {/* pakketje aan een touwtje */}
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.12, 4]} />
        <meshStandardMaterial color="#5c5148" />
      </mesh>
      <mesh ref={parcel} position={[0, -0.24, 0]} castShadow>
        <boxGeometry args={[0.12, 0.11, 0.12]} />
        <meshStandardMaterial color="#c9a06a" />
      </mesh>
    </group>
  );
}

export function Drones({ world }: { world: WorldConfig }): JSX.Element | null {
  const snapshot = useAra((s) => s.snapshot);
  const effects = useAra((s) => s.effects);

  const centers = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const d of world.districts) {
      const { x, z } = axialToWorld(d.center);
      const point = new THREE.Vector3(x * HEX_SPACING, 0, z * HEX_SPACING);
      map.set(d.venture.id, point);
      for (const p of d.projects) map.set(`project:${p.name}`, point);
    }
    return map;
  }, [world]);

  // Vaste routes: het aantal volgt de drukte, net als het wegverkeer. Twee als
  // basis, meer zodra er wat draait, met een plafond — daarboven is het een
  // zwerm en zegt het verschil niets meer.
  const live = Object.values(snapshot.sessions).filter((s) => !s.endedAt).length;
  const routes = useMemo((): Route[] => {
    const points = world.districts.map((d) => centers.get(d.venture.id)!);
    if (points.length < 2) return [];
    const count = Math.min(6, 2 + Math.floor(live / 2));
    const out: Route[] = [];
    for (let i = 0; i < count; i += 1) {
      const from = points[stableHash(`drone-from-${i}`) % points.length]!;
      const to = points[(stableHash(`drone-to-${i}`) + 1 + i) % points.length]!;
      if (from === to) continue;
      out.push({
        from,
        to,
        speed: 0.055 + (i % 3) * 0.018,
        phase: i * 1.3,
        // Om en om links- en rechtsom, zodat twee drones op dezelfde
        // verbinding niet in elkaars spoor hangen.
        bow: (i % 2 === 0 ? 1 : -1) * (1.4 + (i % 3) * 0.7),
      });
    }
    return out;
  }, [world, centers, live]);

  // Bezorgingen: een afgeronde taak vliegt naar de hub. Dezelfde gebeurtenis
  // die de vlag geeft — hier als iets dat een afstand aflegt, zodat je ziet
  // dat er werk binnenkomt en niet alleen dát er iets af is.
  const deliveries = useMemo((): Route[] => {
    const now = Date.now();
    const hub = new THREE.Vector3(0, 0, 0);
    const out: Route[] = [];
    // Hooguit drie tegelijk: bij een reeks afrondingen wil je zien dát er werk
    // binnenkomt, niet een file boven de hub.
    for (const e of effects.filter((x) => x.type === 'flag' && now - x.ts < 9000).slice(-3)) {
      const project = snapshot.sessions[e.sessionId]?.project;
      const from = project ? centers.get(`project:${project}`) : undefined;
      if (!from) continue;
      out.push({ from, to: hub, speed: 0.22, phase: 0, bow: 1.1, once: true, bornAt: e.ts });
    }
    return out;
  }, [effects, snapshot, centers]);

  if (routes.length === 0 && deliveries.length === 0) return null;
  return (
    <group>
      {routes.map((route, i) => (
        <Drone key={`r${i}`} route={route} />
      ))}
      {deliveries.map((route) => (
        <Drone key={`d${route.bornAt}`} route={route} />
      ))}
    </group>
  );
}
