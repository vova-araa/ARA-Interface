import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { axialKey, axialToWorld, hexDisc, stableHash, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra } from '../store.ts';
import { useDaylight } from './daylight.ts';
import { buildRoads } from './roads.ts';
import { LAKE_CENTER, LAKE_RADIUS } from './terrain.ts';

/**
 * Lantaarns langs de wegen en op de districtpleinen.
 *
 * De wereld had wel een dag-nachtcyclus maar geen straatverlichting, en
 * daardoor viel 's avonds alles tussen de districten in het niets: je zag de
 * platforms nog gloeien en verder zwart. Een rij lampen doet twee dingen
 * tegelijk — hij tekent het wegennet ook in het donker, en hij geeft de
 * schemer een moment. Om acht uur gaan ze aan, bij dageraad uit; dat is het
 * enige stukje van deze wereld dat niets met sessies te maken heeft en puur
 * de klok volgt.
 *
 * De lampen staan op het net uit `buildRoads`, niet op een eigen lijst: de
 * grond, het verkeer en de verlichting moeten dezelfde wegen gebruiken, anders
 * staat er een lantaarnpaal in het gras naast een weg die er ook ligt.
 */

// Zelfde meer als in HexGround/Traffic — die drie moeten hetzelfde blokkeren,
// anders legt buildRoads hier een weg waar daar water ligt.

/** Bovenkant van een districtplatform; zie Blocks.tsx. */
const PLATFORM_TOP = 0.31;
/**
 * Geschatte bovenkant van een wegtegel. Het terrein golft (de weg volgt de
 * hoogte van de grond eronder) en die hoogte staat in HexGround, niet hier.
 * In plaats van die formule te kopiëren loopt de paal ver ónder zijn voet
 * door: hij steekt dan hooguit dieper in de berm, maar hij zweeft nooit.
 */
const ROAD_TOP = 0.2;
const SINK = 0.8;
const LAMP_HEIGHT = 1.12;

interface Lamp {
  key: string;
  x: number;
  z: number;
  /** Hoogte van de voet; de paal loopt vanaf hier SINK naar beneden. */
  base: number;
  /** Deterministische vertraging (s) bij het aangaan — zie `STAGGER`. */
  delay: number;
}

/**
 * Niet alle lampen springen tegelijk aan. Eén schakelaar voor de hele wereld
 * ziet eruit als een bug in de render; een golf van een seconde over de straat
 * leest als een schemerschakelaar per paal.
 */
const STAGGER = 0.9;

function lampsFor(world: WorldConfig | null, dense: boolean): Lamp[] {
  if (!world) return [];
  const out: Lamp[] = [];

  const claimed = new Set<string>();
  for (const district of world.districts) {
    for (const project of district.projects) {
      for (const hex of project.hexes) claimed.add(axialKey(hex));
    }
  }
  const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
  const net = buildRoads(world, { claimed, lake });

  // Gesorteerd, want een Set-volgorde is een belofte die niemand doet: zonder
  // sortering hangt de vertraging van een lamp af van de invoegvolgorde.
  for (const key of [...net.tiles].sort()) {
    const [qs, rs] = key.split(',');
    const q = Number(qs);
    const r = Number(rs);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    const { x, z } = axialToWorld({ q, r });
    const cx = x * HEX_SPACING;
    const cz = z * HEX_SPACING;
    const len = Math.hypot(cx, cz);
    // De hub zelf slaan we over: daar staat het monument.
    if (len < 0.5) continue;
    // Elke weg loopt radiaal vanaf de hub, dus de looprichting van de weg is
    // de richting van de tegel zelf. De berm ligt dus haaks daarop — geen
    // padanalyse nodig, en het klopt per definitie met het net eronder.
    const px = -cz / len;
    const pz = cx / len;
    const seed = stableHash(`lamp:${key}`);
    // Zuinige stand: één kant van de weg. De rij blijft leesbaar, hij is
    // alleen enkelzijdig — half zoveel palen voor hetzelfde lint licht.
    const sides = dense ? [-1, 1] : [seed % 2 === 0 ? 1 : -1];
    for (const side of sides) {
      out.push({
        key: `${key}:${side}`,
        x: cx + px * 0.62 * side,
        z: cz + pz * 0.62 * side,
        base: ROAD_TOP,
        delay: ((stableHash(`lamp:${key}:${side}`) % 100) / 100) * STAGGER,
      });
    }
  }

  // Het plein: een kring om het hart van elk district. Hetzelfde middelpunt
  // als buildRoads gebruikt (afgerond gemiddelde van de hexen), zodat de weg
  // precies tussen de lantaarns uitkomt in plaats van er langs.
  for (const district of world.districts) {
    const hexes = district.projects.flatMap((project) => project.hexes);
    if (hexes.length === 0) continue;
    const centre = {
      q: Math.round(hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length),
      r: Math.round(hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length),
    };
    const { x, z } = axialToWorld(centre);
    const count = dense ? 4 : 2;
    for (let i = 0; i < count; i += 1) {
      // Op 0.72 van het midden: buiten de panden (die staan tot ~0.56 uit het
      // hart) en binnen de tegelrand, dus de paal valt niet van het platform.
      const angle = (i / count) * Math.PI * 2 + 0.4;
      out.push({
        key: `${district.venture.id}:plein:${i}`,
        x: x * HEX_SPACING + Math.cos(angle) * 0.72,
        z: z * HEX_SPACING + Math.sin(angle) * 0.72,
        base: PLATFORM_TOP,
        delay: ((stableHash(`plein:${district.venture.id}:${i}`) % 100) / 100) * STAGGER,
      });
    }
  }

  return out;
}

const POLE = new THREE.MeshStandardMaterial({ color: '#3b4152', roughness: 0.6, metalness: 0.3 });
const HEAD_OFF = new THREE.Color('#454b5e');
const HEAD_ON = new THREE.Color('#ffdca4');

/** Zelfde demping als de ramen: 3τ ≈ 1s van donker naar vol. */
const TAU = 0.33;

/**
 * Kleur van de lampekop bij helderheid `v`. Ruim boven 1 uit: de kop is klein
 * op het scherm, en alleen wat de bloom-drempel haalt leest van een afstand
 * nog als licht in plaats van als een lichte stip.
 */
function headColor(out: THREE.Color, v: number): THREE.Color {
  return out.copy(HEAD_OFF).lerp(HEAD_ON, v).multiplyScalar(1 + v * 1.3);
}

export function StreetLights({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const perfLow = useAra((s) => s.perfLow);
  const daylight = useDaylight();

  const lamps = useMemo(() => lampsFor(world, !perfLow), [world, perfLow]);
  // Schemer en nacht branden; bij dageraad gaan ze uit en overdag blijven ze
  // uit. Dat is de hele schakelaar — hij kent geen sessies.
  const on = daylight.period === 'night' || daylight.period === 'dusk';

  // Eén Color die telkens wordt hergebruikt; per frame een nieuwe aanmaken is
  // afval voor de GC in de warmste lus die er is.
  const tint = useMemo(() => new THREE.Color(), []);
  const heads = useRef<THREE.InstancedMesh | null>(null);
  const levels = useRef(new Float32Array(0));
  /** Seconden sinds de schakelaar omging; draagt de per-lamp vertraging. */
  const since = useRef(Number.POSITIVE_INFINITY);
  const wasOn = useRef(on);

  useEffect(() => {
    if (wasOn.current === on) return;
    wasOn.current = on;
    since.current = 0;
  }, [on]);

  const setPoles = (mesh: THREE.InstancedMesh | null): void => {
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    lamps.forEach((lamp, i) => {
      // De paal loopt van base-SINK tot base+LAMP_HEIGHT: dat overbrugt het
      // reliëf van het terrein zonder dat we de hoogte ervan hoeven kennen.
      matrix.makeScale(1, SINK + LAMP_HEIGHT, 1);
      matrix.setPosition(lamp.x, lamp.base + (LAMP_HEIGHT - SINK) / 2, lamp.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  useEffect(() => {
    const mesh = heads.current;
    if (!mesh) return;
    levels.current = new Float32Array(lamps.length);
    // Bij een herbouw (of een wisseling van kwaliteitstrap) staat de wereld
    // misschien al lang in het donker; dan moet het licht er meteen zijn en
    // niet nog een keer aanfloepen.
    if (on) levels.current.fill(1);
    const matrix = new THREE.Matrix4();
    lamps.forEach((lamp, i) => {
      matrix.makeScale(1, 1, 1);
      matrix.setPosition(lamp.x, lamp.base + LAMP_HEIGHT + 0.03, lamp.z);
      mesh.setMatrixAt(i, matrix);
      // Eén setColorAt maakt het instanceColor-attribuut aan; zonder dat mist
      // de shader USE_COLOR en is de lamp niet te dimmen. Exact dezelfde
      // formule als in useFrame — een tweede formule hier zou betekenen dat een
      // lamp die niet beweegt er anders uitziet dan een die net aanging.
      mesh.setColorAt(i, headColor(tint, on ? 1 : 0));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // `on` staat er bewust niet bij als dependency: dit is de opbouw, de
    // overgang doet useFrame. Zou hij er wel staan, dan sprong het licht bij
    // elke dagdeelwissel hard om in plaats van te dempen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lamps]);

  useFrame((_, delta) => {
    const mesh = heads.current;
    if (!mesh || levels.current.length !== lamps.length) return;
    const step = Math.min(delta, 0.25);
    since.current += step;
    const k = 1 - Math.exp(-step / TAU);
    const target = on ? 1 : 0;

    let moved = false;
    for (let i = 0; i < lamps.length; i += 1) {
      const lamp = lamps[i]!;
      if (since.current < lamp.delay) continue;
      const level = levels.current[i] ?? 0;
      const diff = target - level;
      if (Math.abs(diff) < 0.002) {
        if (level === target) continue;
        levels.current[i] = target;
      } else {
        levels.current[i] = level + diff * k;
      }
      mesh.setColorAt(i, headColor(tint, levels.current[i] ?? 0));
      moved = true;
    }
    if (moved && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (lamps.length === 0) return null;

  return (
    <group>
      {/* Paal. Geen instanceColor nodig — een paal verandert nooit van kleur,
          en één materiaal scheelt het attribuut. */}
      <instancedMesh
        key={`pole-${lamps.length}`}
        args={[undefined, undefined, lamps.length]}
        ref={setPoles}
        castShadow
        material={POLE}
      >
        <cylinderGeometry args={[0.022, 0.034, 1, 6]} />
      </instancedMesh>

      {/* Kop. Een achtvlak in plaats van een bol: op deze schaal is het
          verschil onzichtbaar en het scheelt driekwart van de driehoeken. */}
      <instancedMesh key={`head-${lamps.length}`} ref={heads} args={[undefined, undefined, lamps.length]}>
        <octahedronGeometry args={[0.075, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
