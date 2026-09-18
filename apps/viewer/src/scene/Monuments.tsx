import { useMemo } from 'react';
import * as THREE from 'three';
import {
  axialKey,
  axialToWorld,
  hexDisc,
  stableHash,
  visibleInWorld,
  WORLD_HEX_RADIUS,
  type SessionState,
  type WorldConfig,
  type WorldSnapshot,
} from '@ara/shared';
import { HEX_SPACING, projectPlacement } from '../placements.ts';
import { buildRoads, hexLine } from './roads.ts';
import { useAra, useViewSnapshot } from '../store.ts';

/**
 * Het geheugen van de wereld: wat af is gekomen, en waar het sleet achterliet.
 *
 * De rest van de scene toont het nú — pods die draaien, verkeer dat rijdt. Zodra
 * een sessie eindigt verdwijnt ze en is er van een afgemaakte week niets meer te
 * zien. Deze laag legt daar een steen voor neer bij het district waar het gebeurde.
 *
 * EERLIJKHEIDSGRENS — de reden dat dit veld uit zeven dagplaten bestaat.
 * De collector is een ring buffer van zeven dagen (RETENTION_MS) en de
 * WorldState gooit stille sessies al na 48 uur weg. Wat ARA van vorige maand
 * weet is dus: niets. Een monumentenveld dat "ooit" suggereert zou daarom liegen
 * zodra de data verlopen is — een leeg veld leest dan als "hier is nooit iets
 * afgemaakt" in plaats van "dit weet ik niet meer".
 *
 * Daarom is de vórm zelf de voetnoot: exact zeven platen naast elkaar, één per
 * dag, altijd alle zeven aanwezig ook als er geen steen op ligt. Je kijkt naar
 * een week, dat zie je aan het veld. De platen verweren naar achteren (lager,
 * bleker, stenen die schever staan): de oudste plaat staat op de rand van wat de
 * db nog weet, en daarachter houdt het zichtbaar op. Nooit een steen tekenen voor
 * iets buiten dat venster, en nooit een steen verzinnen voor een gat erbinnen.
 */

// Het meer staat privé in HexGround; Traffic en Herd houden er om dezelfde reden
// een eigen kopie van. Zonder deze twee getallen legt dit veld zijn stenen in Sevan.
const LAKE_CENTER = { q: -2, r: 6 };
const LAKE_RADIUS = 2;

/** Zeven dagen: het venster van de ring buffer, niet een gekozen mooi getal. */
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const SLAB_GAP = 0.62; // hart-op-hart tussen twee dagplaten
const SLAB_WIDTH = 0.5;
const SLAB_MIN_DEPTH = 1.15;
const STONE_PITCH = 0.3;
// Bovenkant van een gewone terreintegel resp. een wegtegel in HexGround
// (prisma van 2,4 hoog, opgehangen op -1,05 / -1,03, plus de terreinhoogte).
const GROUND_TOP = 0.15;
const ROAD_TOP = 0.17;
// Een dag met meer dan dit aantal afrondingen is geen dag meer maar een storing;
// het veld krimpt eerst zijn onderlinge afstand voordat het hier stopt.
const MAX_STONES_PER_DAY = 60;

const TUFF = new THREE.Color('#c07a63'); // khachkar: rode tuf
const PALE = new THREE.Color('#e3d3bf'); // obelisk: gebleekte kalksteen
const BRONZE = new THREE.Color('#b08d57'); // plaquette
const WEATHERED = new THREE.Color('#9a9188'); // waar de tijd aan getrokken heeft
const SLAB = new THREE.Color('#cabaa7');
const ROAD = new THREE.Color('#d8cdbd'); // zelfde grind als HexGround: sleet = 0 valt weg
const WORN = new THREE.Color('#6d5c49');

/** Eén geïnstanceerd onderdeel; rot in Euler-volgorde YXZ (draai eerst, leun daarna). */
interface Piece {
  x: number;
  y: number;
  z: number;
  rot: [number, number, number];
  scale: [number, number, number];
  color: THREE.Color;
}

interface Field {
  khachkars: Piece[];
  obelisks: Piece[];
  plaques: Piece[];
  slabs: Piece[];
  wear: Piece[];
}

const EMPTY_FIELD: Field = { khachkars: [], obelisks: [], plaques: [], slabs: [], wear: [] };

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * De terreinhoogte staat privé in HexGround (valueNoise/terrainAt) en wordt
 * nergens gedeeld. Toch moet dit veld hem kennen: de wegtegels liggen in de
 * praktijk op y≈0,44–0,58 en niet op de ~0,2 waar de rest van de scene van
 * uitgaat, dus sleet op een vaste hoogte verdwijnt onzichtbaar ín de weg en
 * stenen zakken in de heuvel. Deze twee functies zijn met opzet een letterlijke
 * kopie van de formule daar — wijzigt het terrein, dan moet dit mee.
 */
function valueNoise(q: number, r: number, scale: number): number {
  const at = (cq: number, cr: number): number => (stableHash(`terr:${cq}:${cr}`) % 1000) / 1000;
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const fq = q / scale;
  const fr = r / scale;
  const q0 = Math.floor(fq);
  const r0 = Math.floor(fr);
  const tq = ease(fq - q0);
  const tr = ease(fr - r0);
  return mix(
    mix(at(q0, r0), at(q0 + 1, r0), tq),
    mix(at(q0, r0 + 1), at(q0 + 1, r0 + 1), tq),
    tr,
  );
}

function terrainLift(hex: { q: number; r: number }): number {
  const height = valueNoise(hex.q, hex.r, 5) * 0.72 + valueNoise(hex.q, hex.r, 2) * 0.28;
  const distance = Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
  const rim = Math.pow(distance / WORLD_HEX_RADIUS, 2.4);
  return -0.04 + height * 0.5 + rim * 1.1;
}

/** Wereldcoördinaten terug naar de tegel eronder; kubusafronding, zoals hexLine. */
function hexAt(x: number, z: number): { q: number; r: number } {
  const rf = z / (HEX_SPACING * 1.5);
  const qf = x / (HEX_SPACING * Math.sqrt(3)) - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Deterministische afwijking in [-0.5, 0.5) — nooit Math.random, anders danst het veld. */
const jitter = (key: string): number => (stableHash(key) % 1000) / 1000 - 0.5;

/**
 * Een mijlpaal is een sessie die uit zichzelf klaar is: geëindigd, status `done`
 * (dus niet in een fout blijven hangen) en geen enkele tool-fout onderweg.
 * Afgebroken of foute sessies krijgen geen steen — een monument dat ook voor
 * mislukkingen staat zegt niets meer.
 */
const isMilestone = (s: SessionState): boolean =>
  s.endedAt !== undefined && s.status === 'done' && s.errorCount === 0;

/** Hoe zwaar het werk was bepaalt de steensoort; groot werk krijgt een obelisk. */
const kindOf = (s: SessionState): 0 | 1 | 2 => (s.toolCount >= 40 ? 2 : s.toolCount >= 12 ? 1 : 0);

export function buildField(world: WorldConfig | null, snapshot: WorldSnapshot, perfLow: boolean): Field {
  if (!world || world.districts.length === 0) return EMPTY_FIELD;
  const field: Field = { khachkars: [], obelisks: [], plaques: [], slabs: [], wear: [] };

  // De klok van de snapshot, niet die van de browser: tijdens terugspoelen hoort
  // het veld bij het moment dat je bekijkt, niet bij nu.
  const today = startOfDay(snapshot.now || Date.now());

  interface Bucket {
    days: SessionState[][];
    traffic: number;
  }
  const byVenture = new Map<string, Bucket>();
  for (const district of world.districts) {
    byVenture.set(district.venture.id, {
      days: Array.from({ length: WINDOW_DAYS }, () => []),
      traffic: 0,
    });
  }

  for (const session of Object.values(snapshot.sessions)) {
    if (!visibleInWorld(world, session.project)) continue;
    const bucket = byVenture.get(projectPlacement(world, session.project).venture);
    if (!bucket) continue;
    // Sleet komt van álles wat er liep, ook van wat nog draait of stukliep:
    // een pad slijt van de voeten, niet van het resultaat.
    bucket.traffic += session.toolCount;
    if (!isMilestone(session)) continue;
    const day = Math.floor((today - startOfDay(session.endedAt as number)) / DAY_MS);
    // Buiten het venster: niet tekenen. Ouder dan zeven dagen bestaat hier niet,
    // en een sessie uit de toekomst (klokverschil) hoort nergens.
    if (day < 0 || day >= WINDOW_DAYS) continue;
    bucket.days[day]?.push(session);
  }

  const lakeWorld = axialToWorld(LAKE_CENTER);
  const lakeX = lakeWorld.x * HEX_SPACING;
  const lakeZ = lakeWorld.z * HEX_SPACING;

  for (const district of world.districts) {
    const bucket = byVenture.get(district.venture.id);
    if (!bucket) continue;
    const ventureColor = new THREE.Color(district.venture.color);

    const centre = axialToWorld(district.center);
    const cx = centre.x * HEX_SPACING;
    const cz = centre.z * HEX_SPACING;
    // Hoe ver het district zelf reikt, gemeten aan zijn eigen hexen: het veld
    // hoort er nét buiten te liggen, ook als een district groeit.
    let reach = 0;
    for (const project of district.projects) {
      for (const hex of project.hexes) {
        const w = axialToWorld(hex);
        reach = Math.max(reach, Math.hypot(w.x * HEX_SPACING - cx, w.z * HEX_SPACING - cz));
      }
    }

    // Naar buiten = van de hub weg; daar is geen weg en geen verkeer, dus staat
    // het veld nooit in de rijbaan of tussen de pods.
    const len = Math.hypot(cx, cz) || 1;
    let dirX = cx / len;
    let dirZ = cz / len;
    let originX = cx + dirX * (reach + 0.95);
    let originZ = cz + dirZ * (reach + 0.95);
    if (Math.hypot(originX - lakeX, originZ - lakeZ) < (LAKE_RADIUS + 1.6) * 1.75) {
      // Liever scheef aan de rand dan onder water: een vaste draai, geen gok.
      const a = -0.95;
      const nx = dirX * Math.cos(a) - dirZ * Math.sin(a);
      const nz = dirX * Math.sin(a) + dirZ * Math.cos(a);
      dirX = nx;
      dirZ = nz;
      originX = cx + dirX * (reach + 0.95);
      originZ = cz + dirZ * (reach + 0.95);
    }
    // Het veld staat op het terrein buiten het district, en dat glooit. De
    // sokkel krijgt daarom een dikke voet die naar beneden doorsteekt: op een
    // helling graaft hij zich in plaats van te zweven.
    const fieldTop = GROUND_TOP + terrainLift(hexAt(originX, originZ)) + 0.06;
    const yaw = Math.atan2(dirX, dirZ);
    // Dwars op de kijkrichting: hierlangs staan de zeven dagen naast elkaar.
    const acrossX = dirZ;
    const acrossZ = -dirX;

    for (let day = 0; day < WINDOW_DAYS; day += 1) {
      const sessions = (bucket.days[day] ?? [])
        // Deterministisch: de volgorde van Object.values is die van binnenkomst,
        // en dan verspringt het veld bij elke herstart.
        .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || a.sessionId.localeCompare(b.sessionId))
        .slice(-MAX_STONES_PER_DAY);
      // 0 = vandaag, 6 = de rand van wat de db nog weet. Verweer loopt mee.
      const age = day / (WINDOW_DAYS - 1);
      const slabLat = (3 - day) * SLAB_GAP;

      const columns = sessions.length > 20 ? 3 : 2;
      const rows = Math.ceil(sessions.length / columns);
      // Eerst dichter op elkaar, pas daarna stoppen: een drukke dag hoort zwaarder
      // te lijken, niet afgekapt.
      const pitch = rows > 8 ? Math.min(STONE_PITCH, 2.6 / rows) : STONE_PITCH;
      const depth = Math.max(SLAB_MIN_DEPTH, 0.4 + rows * pitch);

      // Oudere dagen zakken weg: de plaat van zes dagen terug ligt lager dan die
      // van vandaag, en achter de laatste plaat houdt het zichtbaar op.
      const slabTop = fieldTop - age * 0.025;
      field.slabs.push({
        x: originX + dirX * (depth / 2) + acrossX * slabLat,
        y: slabTop - 0.25,
        z: originZ + dirZ * (depth / 2) + acrossZ * slabLat,
        rot: [0, yaw, 0],
        scale: [SLAB_WIDTH, 0.5, depth],
        color: SLAB.clone().lerp(WEATHERED, age * 0.55).lerp(ventureColor, 0.1),
      });

      sessions.forEach((session, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const lat = slabLat + (col - (columns - 1) / 2) * (SLAB_WIDTH / columns);
        const out = 0.26 + row * pitch;
        const x = originX + dirX * out + acrossX * lat;
        const z = originZ + dirZ * out + acrossZ * lat;
        // Ouder = schever en bleker; de wind heeft er langer aan getrokken.
        const lean = (0.05 + age * 0.13) * jitter(`${session.sessionId}:lean`) * 2;
        const height = 1 - age * 0.2;
        const kind = kindOf(session);
        const base = kind === 2 ? PALE : kind === 1 ? TUFF : BRONZE;
        const color = base
          .clone()
          .lerp(WEATHERED, age * 0.5)
          // Een vleugje districtskleur: het veld hoort zichtbaar bij dít district.
          .lerp(ventureColor, 0.12);
        const rot: [number, number, number] = [
          lean * 0.6,
          yaw + jitter(`${session.sessionId}:yaw`) * 0.35,
          lean,
        ];
        if (kind === 2) {
          field.obelisks.push({ x, y: slabTop + 0.3 * height, z, rot, scale: [1, height, 1], color });
        } else if (kind === 1) {
          field.khachkars.push({ x, y: slabTop + 0.21 * height, z, rot, scale: [1, height, 1], color });
        } else {
          // De plaquette ligt: een kleine afronding krijgt een steen in de grond,
          // geen paal in de lucht.
          field.plaques.push({
            x,
            y: slabTop + 0.025,
            z,
            rot: [0.32 + lean * 0.3, rot[1], lean * 0.4],
            scale: [1, 1, 1],
            color,
          });
        }
      });
    }
  }

  // Sleetse paden. De grondtegels zijn van HexGround, dus dit is een eigen dun
  // vlak dat er net boven ligt — de weg zelf blijft onaangeraakt.
  if (!perfLow) {
    const claimed = new Set<string>();
    for (const d of world.districts) {
      for (const p of d.projects) for (const h of p.hexes) claimed.add(axialKey(h));
    }
    const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
    const net = buildRoads(world, { claimed, lake });

    const load = new Map<string, { hex: { q: number; r: number }; total: number }>();
    for (const district of world.districts) {
      const traffic = byVenture.get(district.venture.id)?.traffic ?? 0;
      if (traffic <= 0) continue;
      const hexes = district.projects.flatMap((p) => p.hexes);
      if (hexes.length === 0) continue;
      // Exact het middelpunt dat buildRoads ook kiest: een eigen benadering legt
      // de sleet naast de weg in plaats van erop.
      const target = {
        q: Math.round(hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length),
        r: Math.round(hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length),
      };
      for (const hex of hexLine({ q: 0, r: 0 }, target)) {
        const key = axialKey(hex);
        // Alleen echte wegtegels: net.tiles is de baas, de lijn is enkel de route.
        if (!net.tiles.has(key)) continue;
        const seen = load.get(key);
        if (seen) seen.total += traffic;
        else load.set(key, { hex, total: traffic });
      }
    }

    for (const { hex, total } of load.values()) {
      // Logaritmisch: het verschil tussen 10 en 100 tool-calls moet je zien, dat
      // tussen 5000 en 5100 niet. Bij weinig verkeer blijft de kleur die van de
      // weg zelf — dan is er niets te zien, en dat klopt ook.
      const amount = Math.min(1, Math.log10(1 + total) / 3.2);
      if (amount < 0.05) continue;
      const w = axialToWorld(hex);
      field.wear.push({
        x: w.x * HEX_SPACING,
        // Op het wegdek zelf, dus mét de hoogte van die tegel: een vaste hoogte
        // ligt op de ene weg te zweven en in de andere begraven.
        y: ROAD_TOP + terrainLift(hex) + 0.012,
        z: w.z * HEX_SPACING,
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        color: ROAD.clone().lerp(WORN, amount),
      });
    }
  }

  return field;
}

/**
 * Matrices eenmalig wegschrijven. `count` gaat mee omdat de mesh op een minimum
 * van één instance staat: zonder dat staat er een losse steen op de oorsprong
 * zodra een veld leeg is.
 */
function place(items: Piece[]): (mesh: THREE.InstancedMesh | null) => void {
  return (mesh) => {
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    items.forEach((item, i) => {
      euler.set(item.rot[0], item.rot[1], item.rot[2], 'YXZ');
      quat.setFromEuler(euler);
      pos.set(item.x, item.y, item.z);
      scale.set(item.scale[0], item.scale[1], item.scale[2]);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
}

export function Monuments({ world }: { world: WorldConfig }): JSX.Element | null {
  const snapshot = useViewSnapshot();
  const perfLow = useAra((s) => s.perfLow);
  const field = useMemo(() => buildField(world, snapshot, perfLow), [world, snapshot, perfLow]);

  if (field.slabs.length === 0) return null;

  return (
    <group>
      {/* Zeven dagplaten per district — altijd alle zeven, ook leeg. Dit is wat
          het veld eerlijk houdt: je ziet dat je naar een week kijkt. */}
      <instancedMesh
        key={`slab-${field.slabs.length}`}
        args={[undefined, undefined, Math.max(1, field.slabs.length)]}
        ref={place(field.slabs)}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} />
      </instancedMesh>

      {/* Khachkar: rechtopstaande gedenksteen voor een gewone afronding. */}
      <instancedMesh
        key={`khachkar-${field.khachkars.length}`}
        args={[undefined, undefined, Math.max(1, field.khachkars.length)]}
        ref={place(field.khachkars)}
        castShadow={!perfLow}
        receiveShadow={!perfLow}
      >
        <boxGeometry args={[0.15, 0.42, 0.055]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </instancedMesh>

      {/* Obelisk: voor een sessie die echt lang doorwerkte. */}
      <instancedMesh
        key={`obelisk-${field.obelisks.length}`}
        args={[undefined, undefined, Math.max(1, field.obelisks.length)]}
        ref={place(field.obelisks)}
        castShadow={!perfLow}
        receiveShadow={!perfLow}
      >
        <cylinderGeometry args={[0.035, 0.1, 0.6, 4]} />
        <meshStandardMaterial color="#ffffff" roughness={0.65} />
      </instancedMesh>

      {/* Plaquette: een kort klusje krijgt een liggende steen. */}
      <instancedMesh
        key={`plaque-${field.plaques.length}`}
        args={[undefined, undefined, Math.max(1, field.plaques.length)]}
        ref={place(field.plaques)}
        receiveShadow={!perfLow}
      >
        <boxGeometry args={[0.2, 0.045, 0.15]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.25} />
      </instancedMesh>

      {/* Sleet over de wegtegels: doorzichtig vlak, schrijft geen diepte en duwt
          zichzelf met polygonOffset boven het wegdek — anders knippert het ertegen.
          Bij perfLow bestaat deze laag niet: doorzichtige vlakken zijn precies wat
          een zwakke GPU (of SwiftShader) laat inzakken. */}
      {field.wear.length > 0 && (
        <instancedMesh
          key={`wear-${field.wear.length}`}
          args={[undefined, undefined, Math.max(1, field.wear.length)]}
          ref={place(field.wear)}
        >
          <cylinderGeometry args={[0.74, 0.74, 0.02, 6]} />
          <meshStandardMaterial
            color="#ffffff"
            roughness={1}
            transparent
            opacity={0.62}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </instancedMesh>
      )}
    </group>
  );
}
