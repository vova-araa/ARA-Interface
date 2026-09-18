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
 * Het geheugen van de wereld: wat er afkwam, en waar het sleet achterliet.
 *
 * De rest van de scene toont het nú — pods die draaien, verkeer dat rijdt. Zodra
 * een sessie eindigt verdwijnt ze, en van een week hard werken is daarna niets
 * meer te zien. Deze laag zet daar een steen voor neer, bij het district waar
 * het gebeurde.
 *
 * EERLIJKHEIDSGRENS — de reden dat het veld uit precies zeven platen bestaat.
 * De collector is een ring buffer van zeven dagen (RETENTION_MS) en de
 * WorldState vergeet stille sessies al na 48 uur. Wat ARA van vorige maand weet
 * is dus: niets. Een monumentenveld dat "ooit" suggereert liegt daarom zodra de
 * data verlopen is: een leeg veld zou lezen als "hier is nooit iets afgemaakt"
 * in plaats van "verder terug kijk ik niet".
 *
 * Daarom is de vórm de voetnoot. Zeven dagplaten naast elkaar, altijd alle
 * zeven, ook als er geen steen op ligt — je ziet dat je naar een week kijkt.
 * Naar achteren verweert het veld zichtbaar (de plaat zakt, de kleur verbleekt,
 * de stenen gaan schever staan): de laatste plaat is de rand van wat de db nog
 * weet, en daarachter houdt het op. Nooit een steen buiten dat venster, en nooit
 * een verzonnen steen voor een gat erbinnen.
 */

// Het meer staat privé in HexGround; Traffic en Herd houden er om dezelfde reden
// een eigen kopie van. Zonder deze twee getallen legt dit veld zijn stenen in Sevan.
const LAKE_CENTER = { q: -2, r: 6 };
const LAKE_RADIUS = 2;
/** Zeven dagen: het venster van de ring buffer, geen gekozen mooi getal. */
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const SLAB_GAP = 0.8; // hart-op-hart tussen twee dagplaten
const SLAB_WIDTH = 0.66;
const SLAB_MIN_DEPTH = 1.1;
const STONE_PITCH = 0.22;
// Bovenkant van een gewone terreintegel resp. een wegtegel in HexGround: prisma
// van 2,4 hoog, opgehangen op -1,05 / -1,03, plus de terreinhoogte van die tegel.
const GROUND_TOP = 0.15;
const ROAD_TOP = 0.17;
// Een dag met meer afrondingen dan dit is geen dag meer maar een storing; het
// veld kruipt eerst dichter op elkaar voordat het hier ophoudt.
const MAX_STONES_PER_DAY = 60;
/** Stenen per rij; een drukke dag wordt breder voordat hij dieper wordt. */
const columnsFor = (n: number): number => (n <= 12 ? 2 : n <= 30 ? 3 : 4);
/** Buitenste tegelring van de wereld; daarbuiten zweeft een steen in de lucht. */
const FIELD_LIMIT = axialToWorld({ q: WORLD_HEX_RADIUS, r: 0 }).x * HEX_SPACING - 1.3;

const TUFF = new THREE.Color('#c07a63'); // khachkar: rode tuf
const PALE = new THREE.Color('#e3d3bf'); // obelisk: gebleekte kalksteen
const BRONZE = new THREE.Color('#b08d57'); // plaquette
const WEATHERED = new THREE.Color('#9a9188'); // waar de tijd aan getrokken heeft
const SLAB = new THREE.Color('#cabaa7');
const ROAD = new THREE.Color('#d8cdbd'); // zelfde grind als HexGround: geen sleet = niets te zien
const WORN = new THREE.Color('#6d5c49');

/** Eén geïnstanceerd onderdeel; rot in Euler-volgorde YXZ (eerst draaien, dan leunen). */
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
 * praktijk op y≈0,45–0,60 en niet op de ~0,2 waar de rest van de scene vanuit
 * gaat, dus sleet op een vaste hoogte verdwijnt ónder het wegdek en stenen
 * zakken in de heuvel. Deze drie functies zijn met opzet een letterlijke kopie
 * van de formule daar — verandert het terrein, dan moet dit mee.
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
 * Een mijlpaal is een sessie die uit zichzelf klaar kwam: geëindigd, status
 * `done` (dus niet in een fout blijven hangen) en geen enkele tool-fout
 * onderweg. Een monument dat ook voor mislukkingen staat zegt niets meer.
 */
const isMilestone = (s: SessionState): boolean =>
  s.endedAt !== undefined && s.status === 'done' && s.errorCount === 0;

/** Hoe zwaar het werk was bepaalt de steensoort; lang doorwerken krijgt een obelisk. */
const kindOf = (s: SessionState): 0 | 1 | 2 => (s.toolCount >= 40 ? 2 : s.toolCount >= 12 ? 1 : 0);

function buildField(world: WorldConfig | null, snapshot: WorldSnapshot, perfLow: boolean): Field {
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

  // Project → tak, één keer opgezocht. visibleInWorld loopt élk district langs en
  // dat pad wordt per binnenkomend event opnieuw gelopen voor elke sessie.
  const ventureOf = new Map<string, string | null>();
  for (const district of world.districts) {
    for (const project of district.projects) ventureOf.set(project.name, district.venture.id);
  }
  const ventureFor = (project: string): string | null => {
    let venture = ventureOf.get(project);
    if (venture === undefined) {
      // Onbekend project: het staat wél in de wereld (placementForProject vindt
      // een plek bij Nor Kaghak) tenzij zijn tak bewust verborgen is.
      venture = visibleInWorld(world, project) ? projectPlacement(world, project).venture : null;
      ventureOf.set(project, venture);
    }
    return venture;
  };

  for (const session of Object.values(snapshot.sessions)) {
    const venture = ventureFor(session.project);
    if (venture === null) continue;
    const bucket = byVenture.get(venture);
    if (!bucket) continue;
    // Sleet komt van álles wat er liep, ook van wat nog draait of stukliep: een
    // pad slijt van de voeten, niet van het resultaat.
    bucket.traffic += session.toolCount;
    if (!isMilestone(session)) continue;
    const day = Math.floor((today - startOfDay(session.endedAt as number)) / DAY_MS);
    // Buiten het venster: niet tekenen. Ouder dan zeven dagen bestaat hier niet,
    // en een sessie uit de toekomst (klokverschil) hoort nergens.
    if (day < 0 || day >= WINDOW_DAYS) continue;
    bucket.days[day]?.push(session);
  }

  // Bezette grond: districten, meer en wegen. Het veld moet ergens staan waar
  // niets anders staat, en dezelfde verzameling voedt straks de sleetlaag.
  const claimed = new Set<string>();
  for (const d of world.districts) {
    for (const p of d.projects) for (const h of p.hexes) claimed.add(axialKey(h));
  }
  const lake = new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
  const net = buildRoads(world, { claimed, lake });
  const occupied = (hex: { q: number; r: number }): boolean => {
    const key = axialKey(hex);
    if (claimed.has(key) || lake.has(key) || net.tiles.has(key)) return true;
    // Buiten de schijf is er geen grond meer om een steen op te zetten.
    return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) > WORLD_HEX_RADIUS;
  };

  for (const district of world.districts) {
    const bucket = byVenture.get(district.venture.id);
    if (!bucket) continue;
    const ventureColor = new THREE.Color(district.venture.color);

    const centre = axialToWorld(district.center);
    const cx = centre.x * HEX_SPACING;
    const cz = centre.z * HEX_SPACING;
    // Naar buiten = van de hub weg. Daar loopt geen weg en staan geen pods, dus
    // komt het veld niet in de rijbaan of boven op het district te staan.
    const len = Math.hypot(cx, cz) || 1;
    const outX = cx / len;
    const outZ = cz / len;

    /** Hoe ver het district in déze richting uitsteekt — niet zijn grootste
     * straal: een langgerekt cluster zou het veld anders de wereld uit duwen. */
    const extentAlong = (ux: number, uz: number): number => {
      let out = 0;
      for (const project of district.projects) {
        for (const hex of project.hexes) {
          const w = axialToWorld(hex);
          out = Math.max(out, (w.x * HEX_SPACING - cx) * ux + (w.z * HEX_SPACING - cz) * uz);
        }
      }
      return out;
    };

    // De vrije strook tussen de rand van het district en de rand van de wereld.
    // Dat is een harde grens: liever stenen dicht op elkaar dan een veld dat de
    // wereld af loopt of op het district klimt.
    const room = Math.max(SLAB_MIN_DEPTH, FIELD_LIMIT - len - extentAlong(outX, outZ) - 0.9);

    interface Day {
      sessions: SessionState[];
      columns: number;
      pitch: number;
      depth: number;
    }
    interface Plan {
      slabGap: number;
      slabWidth: number;
      halfWidth: number;
      fieldDepth: number;
      days: Day[];
    }

    /** `squeeze` < 1 = hetzelfde veld, compacter; zo past het ook in een drukke wereld. */
    const planFor = (squeeze: number): Plan => {
      const slabGap = SLAB_GAP * squeeze;
      const slabWidth = SLAB_WIDTH * squeeze;
      const depthRoom = room * squeeze;
      const days = bucket.days.map((raw): Day => {
        const sessions = raw
          // Deterministisch: Object.values geeft de volgorde van binnenkomst, en
          // dan verspringt het hele veld na een herstart.
          .sort(
            (a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || a.sessionId.localeCompare(b.sessionId),
          )
          .slice(-MAX_STONES_PER_DAY);
        const columns = columnsFor(sessions.length);
        const rows = Math.max(1, Math.ceil(sessions.length / columns));
        // Een drukke dag kruipt dichter op elkaar in plaats van door te groeien:
        // stenen die elkaar raken lezen als een muur werk, een veld dat buiten de
        // wereld steekt leest als een fout.
        const pitch = Math.max(0.05, Math.min(STONE_PITCH * squeeze, (depthRoom - 0.3) / rows));
        return {
          sessions,
          columns,
          pitch,
          depth: Math.min(depthRoom, Math.max(SLAB_MIN_DEPTH * squeeze, 0.3 + rows * pitch)),
        };
      });
      return {
        slabGap,
        slabWidth,
        halfWidth: 3 * slabGap + slabWidth / 2,
        fieldDepth: Math.max(...days.map((d) => d.depth)),
        days,
      };
    };

    const anchorFor = (plan: Plan, ux: number, uz: number): { x: number; z: number } => {
      let gap = extentAlong(ux, uz) + 0.9;
      // De wereld is een schijf: voorbij de buitenste tegelring is er geen grond
      // meer om een steen op te zetten, dus schuift het veld terug naar binnen.
      const far = Math.hypot(cx + ux * (gap + plan.fieldDepth), cz + uz * (gap + plan.fieldDepth));
      if (far > FIELD_LIMIT) gap = Math.max(0.3, gap - (far - FIELD_LIMIT));
      return { x: cx + ux * gap, z: cz + uz * gap };
    };

    /**
     * Hoeveel van het veld op bezette grond zou vallen. Alleen het ankerpunt
     * toetsen is niet genoeg: de zeven platen staan náást elkaar, en juist de
     * buitenste plaat belandt anders in het meer, op de weg of op de buurman.
     */
    const blockedFor = (
      plan: Plan,
      a: { x: number; z: number },
      ux: number,
      uz: number,
    ): number => {
      let bad = 0;
      for (let i = 0; i <= 8; i += 1) {
        const lat = -plan.halfWidth + (i / 8) * plan.halfWidth * 2;
        for (const out of [0, plan.fieldDepth / 2, plan.fieldDepth]) {
          const px = a.x + uz * lat + ux * out;
          const pz = a.z - ux * lat + uz * out;
          if (occupied(hexAt(px, pz))) bad += 1;
        }
      }
      return bad;
    };

    // Recht naar buiten is de eerste keuze; past dat niet, dan draait het veld in
    // vaste stapjes mee langs de rand en wordt het daarna compacter. Vaste hoeken
    // en vaste stappen, geen zoektocht met toeval: hetzelfde district komt altijd
    // op dezelfde plek terecht.
    let chosen: { plan: Plan; x: number; z: number; ux: number; uz: number; bad: number } | null =
      null;
    for (const squeeze of [1, 0.72, 0.5]) {
      const plan = planFor(squeeze);
      for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75]) {
        const ux = outX * Math.cos(turn) - outZ * Math.sin(turn);
        const uz = outX * Math.sin(turn) + outZ * Math.cos(turn);
        const a = anchorFor(plan, ux, uz);
        const bad = blockedFor(plan, a, ux, uz);
        if (!chosen || bad < chosen.bad) chosen = { plan, x: a.x, z: a.z, ux, uz, bad };
        if (bad === 0) break;
      }
      if (chosen && chosen.bad === 0) break;
    }
    if (!chosen) continue;

    const { plan } = chosen;
    const dirX = chosen.ux;
    const dirZ = chosen.uz;
    const yaw = Math.atan2(dirX, dirZ);
    // Dwars op de kijkrichting: hierlangs staan de zeven dagen naast elkaar.
    const acrossX = dirZ;
    const acrossZ = -dirX;

    /**
     * Het terrein glooit en loopt naar de rand toe op. Elke dagplaat pakt de
     * hoogte van zijn eigen strook — zo trappen de zeven platen mee met de
     * helling in plaats van als één vlonder te zweven. Het hoogste punt van de
     * strook wint en de plaat heeft een dikke voet die doorsteekt: liever
     * ingegraven dan zwevend boven de grond.
     */
    const topOf = (lat: number, depth: number): number => {
      let lift = -Infinity;
      for (const out of [0, depth / 2, depth]) {
        const px = chosen.x + acrossX * lat + dirX * out;
        const pz = chosen.z + acrossZ * lat + dirZ * out;
        lift = Math.max(lift, terrainLift(hexAt(px, pz)));
      }
      return GROUND_TOP + lift + 0.06;
    };

    plan.days.forEach((day, index) => {
      // 0 = vandaag, 6 = de rand van wat de db nog weet.
      const age = index / (WINDOW_DAYS - 1);
      const slabLat = (3 - index) * plan.slabGap;
      // Oudere dagen zakken weg; achter de laatste plaat houdt het zichtbaar op.
      const slabTop = topOf(slabLat, day.depth) - age * 0.025;

      field.slabs.push({
        x: chosen.x + dirX * (day.depth / 2) + acrossX * slabLat,
        y: slabTop - 0.25,
        z: chosen.z + dirZ * (day.depth / 2) + acrossZ * slabLat,
        rot: [0, yaw, 0],
        scale: [plan.slabWidth, 0.5, day.depth],
        color: SLAB.clone().lerp(WEATHERED, age * 0.55).lerp(ventureColor, 0.1),
      });

      day.sessions.forEach((session, i) => {
        const col = i % day.columns;
        const row = Math.floor(i / day.columns);
        const lat =
          slabLat + (col - (day.columns - 1) / 2) * (plan.slabWidth / (day.columns + 0.4));
        const out = 0.22 + row * day.pitch;
        const x = chosen.x + dirX * out + acrossX * lat;
        const z = chosen.z + dirZ * out + acrossZ * lat;
        // Ouder = schever en bleker: de wind heeft er langer aan getrokken.
        const lean = (0.05 + age * 0.13) * jitter(`${session.sessionId}:lean`) * 2;
        const height = (1 - age * 0.2) * Math.min(1, plan.slabWidth / SLAB_WIDTH + 0.25);
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
          field.obelisks.push({
            x,
            y: slabTop + 0.3 * height,
            z,
            rot,
            scale: [height, height, height],
            color,
          });
        } else if (kind === 1) {
          field.khachkars.push({
            x,
            y: slabTop + 0.21 * height,
            z,
            rot,
            scale: [height, height, height],
            color,
          });
        } else {
          // Het kleinste werk krijgt een liggende steen, geen paal in de lucht.
          field.plaques.push({
            x,
            y: slabTop + 0.04,
            z,
            rot: [0.3 + lean * 0.3, rot[1], lean * 0.4],
            scale: [height, 1, height],
            color,
          });
        }
      });
    });
  }

  // Sleetse paden. De grondtegels zijn van HexGround, dus dit is een eigen dun
  // vlak dat er net bovenop ligt — de weg zelf blijft onaangeraakt.
  if (!perfLow) {
    const load = new Map<string, { hex: { q: number; r: number }; total: number }>();
    for (const district of world.districts) {
      const traffic = byVenture.get(district.venture.id)?.traffic ?? 0;
      if (traffic <= 0) continue;
      const hexes = district.projects.flatMap((p) => p.hexes);
      if (hexes.length === 0) continue;
      // Exact het middelpunt dat buildRoads ook kiest; een eigen benadering legt
      // de sleet náást de weg in plaats van erop.
      const target = {
        q: Math.round(hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length),
        r: Math.round(hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length),
      };
      for (const hex of hexLine({ q: 0, r: 0 }, target)) {
        const key = axialKey(hex);
        // net.tiles is de baas over wat weg is; de lijn geeft alleen de route.
        if (!net.tiles.has(key)) continue;
        const seen = load.get(key);
        // Het stuk bij de hub draagt het verkeer van álle districten, en dat is
        // precies waar een pad in het echt het eerst kaal is.
        if (seen) seen.total += traffic;
        else load.set(key, { hex, total: traffic });
      }
    }

    for (const { hex, total } of load.values()) {
      // Logaritmisch: het verschil tussen 10 en 100 tool-calls moet je zien, dat
      // tussen 5000 en 5100 niet. Weinig verkeer houdt de kleur van de weg zelf —
      // dan is er niets te zien, en dat klopt ook.
      const amount = Math.min(1, Math.log10(1 + total) / 3.2);
      if (amount < 0.05) continue;
      const w = axialToWorld(hex);
      field.wear.push({
        x: w.x * HEX_SPACING,
        // Op het wegdek van díe tegel: een vaste hoogte zweeft boven de ene weg
        // en ligt begraven onder de andere.
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
 * Matrices eenmalig wegschrijven. `count` gaat mee omdat elke mesh op minstens
 * één instance staat: zonder dat staat er een losse steen op de oorsprong zodra
 * een soort nog niet voorkomt.
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
          het veld eerlijk houdt: je ziet dat je naar één week kijkt. */}
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

      {/* Plaquette: het kleinste werk krijgt een liggende steen. */}
      <instancedMesh
        key={`plaque-${field.plaques.length}`}
        args={[undefined, undefined, Math.max(1, field.plaques.length)]}
        ref={place(field.plaques)}
        receiveShadow={!perfLow}
      >
        <boxGeometry args={[0.2, 0.045, 0.15]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.25} />
      </instancedMesh>

      {/* Sleet over de wegtegels: doorzichtig vlak dat geen diepte schrijft en
          zich met polygonOffset boven het wegdek duwt, anders knippert het
          ertegenaan. Bij perfLow bestaat deze laag niet — doorzichtige vlakken
          zijn precies wat een zwakke GPU (of SwiftShader) laat inzakken. */}
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
