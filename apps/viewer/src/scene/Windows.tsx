import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { damp } from 'maath/easing';
import * as THREE from 'three';
import { axialToWorld, stableHash, type WorldConfig, type WorldSnapshot } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { useAra, useViewSnapshot } from '../store.ts';
import { useDaylight } from './daylight.ts';
import {
  FLOOR_H,
  PLOTS_PER_HEX,
  SILENT,
  floorsFor,
  growthByProject,
  plotThreshold,
  presenceOf,
  type Growth,
} from './growth.ts';

/**
 * Verlichte ramen: het dag- en nachtritme van het werk.
 *
 * De skyline vertelt hoevéél er de afgelopen dagen gebeurd is (Blocks +
 * growth.ts); dat is het weekbeeld. Dit is het uurbeeld: een raam gaat aan
 * waar op dít moment iemand zit, en uit als hij klaar is. 's Nachts lees je
 * daarmee van bovenaf af welk kantoor nog doorwerkt — een donker district is
 * een district dat naar huis is.
 *
 * Overdag is het nauwelijks te zien, en dat hoort zo: licht achter glas zegt
 * alleen iets als het donker is. De daglicht-winst zit daarom in de kleur en
 * niet in een `visible`-vlag — ramen die om negen uur 's ochtends ineens
 * verdwijnen trekken juist de aandacht.
 *
 * Eén InstancedMesh met een self-lit materiaal draagt de hele stad. Reden voor
 * MeshBasicMaterial en niet Standard+emissive: per-instance helderheid kan
 * alléén via `instanceColor`, en die vermenigvuldigt de *diffuse* kleur. Op
 * een standaard-materiaal is dat 's nachts bijna zwart — precies wanneer je
 * het raam wil zien. Basic + toneMapped=false straalt zelf en pakt de bloom.
 */

/**
 * LET OP — `plotsFor` hieronder is een kopie van dezelfde functie in
 * Blocks.tsx en moet daar gelijk aan blijven: ramen die op een andere hash
 * draaien dan de panden hangen naast het gebouw in de lucht. Bewust
 * gekopieerd en niet geïmporteerd — Blocks houdt er ook kleur, onkruid en
 * slijtage in bij, en dat hoort niet in een raam. Wat wél gedeeld wordt is de
 * rekenkunde van de groei (`growth.ts`), want die bepaalt de hoogte waarop een
 * raam past. Verandert de plaatsing daar, verander 'm hier in dezelfde commit.
 */
interface Plot {
  project: string;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  threshold: number;
  tower: number;
}

function plotsFor(world: WorldConfig | null): Plot[] {
  if (!world) return [];
  const out: Plot[] = [];
  for (const district of world.districts) {
    for (const project of district.projects) {
      for (const hex of project.hexes) {
        const { x, z } = axialToWorld(hex);
        const cx = x * HEX_SPACING;
        const cz = z * HEX_SPACING;
        for (let i = 0; i < PLOTS_PER_HEX; i += 1) {
          const seed = stableHash(`${project.name}:${hex.q},${hex.r}:${i}`);
          const angle = ((seed % 628) / 100) + i * 2.1;
          const radius = 0.16 + ((seed >> 3) % 40) / 100;
          const tower = ((seed >> 7) % 100) / 100;
          out.push({
            project: project.name,
            x: cx + Math.cos(angle) * radius,
            z: cz + Math.sin(angle) * radius,
            w: (0.3 + ((seed >> 11) % 22) / 100) * (1 - tower * 0.25),
            d: (0.28 + ((seed >> 13) % 20) / 100) * (1 - tower * 0.25),
            rot: ((seed >> 17) % 628) / 100,
            threshold: plotThreshold(i, (((seed >> 5) % 100) / 1000) - 0.05),
            tower,
          });
        }
      }
    }
  }
  return out;
}

/** Bovenkant van het districtplatform; daar begint verdieping 1 (zie Blocks). */
const GROUND = 0.31;
const WIN_W = 0.075;
const WIN_H = 0.085;
/** Een haar vóór de gevel, anders vecht het vlak met de muur om dezelfde pixel. */
const SKIN = 0.008;
/**
 * Midden van de raamstrook binnen een verdieping. Blocks tekent die strook in
 * de shader tussen 0.26 en 0.70 van de verdiepingshoogte; hiermee valt het
 * brandende raam precies in het donkere vlak dat daar toch al zit, in plaats
 * van als een losse sticker op de muur.
 */
const BAND_CENTRE = 0.48;
/** Pas licht als de hele strook onder het dak zit — anders zweeft hij erboven. */
const BAND_TOP = 0.75;

/**
 * Hoeveel verdiepingen ramen krijgen, en hoeveel gevels. Een toren van acht
 * lagen krijgt dus alleen licht in de onderste drie: hoger wordt het op deze
 * zoom een pixelrij, en het kost instances die per frame meebewegen. In de
 * zuinige stand blijft de begane grond over, op twee tegenover elkaar liggende
 * gevels — dan is er vanuit elke camerahoek altijd één te zien.
 */
const FLOORS_DENSE = 3;
const FLOORS_LOW = 1;
const FACES_DENSE = [0, 1, 2, 3];
const FACES_LOW = [0, 1];

/**
 * Een "kamer": één verdieping van één perceel. Alle gevels van dezelfde kamer
 * branden samen — een werkplek is een plek in een gebouw, geen los ruitje, en
 * zo zie je hem ook als je de camera een kwartslag draait.
 */
interface Room {
  plot: Plot;
  floor: number;
  /** Plaats in de rij van dit project: kamer 0 gaat als eerste aan. */
  order: number;
}

/** Eén raamvlak: een kamer op één gevel. */
interface Slot {
  room: number;
  plot: Plot;
  floor: number;
  face: number;
}

function layout(world: WorldConfig | null, dense: boolean): { rooms: Room[]; slots: Slot[] } {
  const floors = dense ? FLOORS_DENSE : FLOORS_LOW;
  const byProject = new Map<string, { room: Room; rank: number }[]>();

  for (const plot of plotsFor(world)) {
    const list = byProject.get(plot.project) ?? [];
    for (let floor = 0; floor < floors; floor += 1) {
      list.push({
        room: { plot, floor, order: 0 },
        // De volgorde is een loting die elke keer hetzelfde uitvalt; zonder
        // vaste volgorde springt het licht bij elke refresh naar een ander
        // pand. De hash breekt alleen de gelijkstand — leidend is welk perceel
        // er sowieso staat (lage drempel) en hoe laag de verdieping ligt: een
        // kantoor vult zich van onderen op, en een raam op een verdieping die
        // nog niet gebouwd is zou een lamp zijn die niemand ziet.
        rank: stableHash(`${plot.project}:room:${plot.x.toFixed(4)},${plot.z.toFixed(4)}:${floor}`),
      });
    }
    byProject.set(plot.project, list);
  }

  const rooms: Room[] = [];
  for (const list of byProject.values()) {
    list.sort(
      (a, b) =>
        a.room.plot.threshold - b.room.plot.threshold ||
        a.room.floor - b.room.floor ||
        a.rank - b.rank,
    );
    list.forEach((entry, i) => {
      entry.room.order = i;
      rooms.push(entry.room);
    });
  }

  const faces = dense ? FACES_DENSE : FACES_LOW;
  const slots: Slot[] = [];
  rooms.forEach((room, index) => {
    for (const face of faces) {
      slots.push({ room: index, plot: room.plot, floor: room.floor, face });
    }
  });
  return { rooms, slots };
}

/**
 * Hoeveel kamers er per project branden.
 *
 * "Bezig" is hier ruimer dan `status === 'working'`, met opzet: tussen twee
 * tool-calls staat een sessie een paar seconden op `idle`, en een raam dat
 * daarop uitgaat knippert de hele dag. Een openstaande sessie houdt dus haar
 * bureaulamp; alleen wat écht draait telt zijn subagents mee — die zitten aan
 * hun eigen bureau. Afgelopen (`endedAt`) of `done` is uit: daar zit niemand
 * meer, en dat is precies wat je 's nachts wil kunnen zien.
 */
function litByProject(snapshot: WorldSnapshot): Map<string, number> {
  const out = new Map<string, number>();
  for (const session of Object.values(snapshot.sessions)) {
    if (session.endedAt || session.status === 'done') continue;
    let workers = 1;
    if (session.status !== 'idle') {
      workers += Object.values(session.agents).filter((a) => !a.stopped).length;
    }
    out.set(session.project, (out.get(session.project) ?? 0) + workers);
  }
  return out;
}

/**
 * Hoe hard het licht doorkomt per dagdeel. Overdag niet nul maar bijna: glas
 * dat in de zon staat geeft nog steeds een vlekje, en dat is eerlijker dan het
 * raam laten verdwijnen.
 */
const PERIOD_GAIN = { night: 1, dusk: 0.8, dawn: 0.5, day: 0.14 } as const;

const GLASS = new THREE.Color('#1b2233');
const WARM = new THREE.Color('#ffc46b');

/** Tijdconstante van het dempen; 3τ ≈ 1s van donker naar vol. Knipperen is een bug. */
const TAU = 0.33;
/** Zelfde traagheid en peilfrequentie als Blocks: de gevel en het raam moeten samen bewegen. */
const GROW_SMOOTH = 2.2;
const SAMPLE_S = 0.5;

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scale = new THREE.Vector3();
const tint = new THREE.Color();

export function Windows({ world }: { world: WorldConfig | null }): JSX.Element | null {
  const perfLow = useAra((s) => s.perfLow);
  const snapshot = useViewSnapshot();
  const daylight = useDaylight();

  const { rooms, slots } = useMemo(() => layout(world, !perfLow), [world, perfLow]);
  const lit = useMemo(() => litByProject(snapshot), [snapshot]);

  const mesh = useRef<THREE.InstancedMesh>(null);
  /** Helderheid per kámer; alle gevels van één kamer delen hem. */
  const levels = useRef(new Float32Array(0));
  const gain = useRef(PERIOD_GAIN[daylight.period]);

  // Groei: dezelfde som als Blocks, maar apart bijgehouden. Importeren van de
  // gedempte stand daar zou een tweede reden zijn om die component aan te
  // raken; de functies in growth.ts zijn puur, dus twee lezers komen op
  // hetzelfde uit.
  const target = useRef(new Map<string, Growth>());
  const shown = useRef(new Map<string, Growth>());
  const sinceSample = useRef(SAMPLE_S);
  const replace = useRef(true);

  const projects = useMemo(
    () => (world ? world.districts.flatMap((d) => d.projects.map((p) => p.name)) : []),
    [world],
  );

  useEffect(() => {
    levels.current = new Float32Array(rooms.length);
    const m = mesh.current;
    if (m) {
      // Een verse buffer staat op de eenheidsmatrix: zonder deze ronde zou er
      // één frame lang een veld ruiten ter grootte van een huis op de hub
      // staan, vóór useFrame ze op hun plek zet.
      matrix.makeScale(0, 0, 0);
      for (let i = 0; i < slots.length; i += 1) {
        m.setMatrixAt(i, matrix);
        m.setColorAt(i, GLASS);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // Verse buffers staan leeg; zonder deze vlag blijft er een onzichtbare
    // ruit hangen tot de groei toevallig weer beweegt.
    replace.current = true;
    sinceSample.current = SAMPLE_S;
  }, [rooms, slots]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m || levels.current.length !== rooms.length) return;
    const step = Math.min(delta, 0.25);

    // 1. De trage kant: waar staat de stad, en dus waar past een raam.
    sinceSample.current += step;
    if (sinceSample.current >= SAMPLE_S) {
      sinceSample.current = 0;
      const store = useAra.getState();
      const snap = store.replaySnapshot ?? store.snapshot;
      const growth = growthByProject(snap.sessions, snap.now);
      for (const project of projects) target.current.set(project, growth.get(project) ?? SILENT);
    }
    let growing = false;
    for (const [project, want] of target.current) {
      const now = shown.current.get(project);
      if (!now) {
        shown.current.set(project, { score: want.score, idle: want.idle });
        growing = true;
        continue;
      }
      const a = damp(now, 'score', want.score, GROW_SMOOTH, step);
      const b = damp(now, 'idle', want.idle, GROW_SMOOTH, step);
      if (a || b) growing = true;
    }

    // 2. De snelle kant: wie zit er nú achter dat raam.
    const k = 1 - Math.exp(-step / TAU);
    const gTarget = PERIOD_GAIN[daylight.period];
    let dimming = Math.abs(gTarget - gain.current) > 0.001;
    if (dimming) gain.current += (gTarget - gain.current) * k;

    for (let i = 0; i < rooms.length; i += 1) {
      const room = rooms[i]!;
      const want = room.order < (lit.get(room.plot.project) ?? 0) ? 1 : 0;
      const level = levels.current[i] ?? 0;
      const diff = want - level;
      if (Math.abs(diff) < 0.002) {
        if (level === want) continue;
        levels.current[i] = want;
      } else {
        levels.current[i] = level + diff * k;
      }
      dimming = true;
    }

    if (!growing && !dimming && !replace.current) return;
    const rebuild = growing || replace.current;
    replace.current = false;
    const g = gain.current;

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]!;
      const v = (levels.current[slot.room] ?? 0) * g;
      // Boven de 1 uitschieten is het punt: de bloom-pass pakt alleen wat
      // helderder is dan zijn omgeving, en dat is wat een raam 's nachts laat
      // gloeien in plaats van oplichten als een gele stip.
      m.setColorAt(i, tint.copy(GLASS).lerp(WARM, v).multiplyScalar(1 + v * 0.9));

      if (!rebuild) continue;
      const plot = slot.plot;
      const growth = shown.current.get(plot.project) ?? SILENT;
      const presence = presenceOf(growth.score, plot.threshold);
      const h = floorsFor(growth.score, plot.tower) * FLOOR_H * presence;
      // Het raam bestaat pas als de hele strook onder het dak past, en groeit
      // er dan in mee omhoog. Hard aan/uit zou betekenen dat een ruit
      // verschijnt terwijl het pand nog aan het groeien is.
      const emerged = Math.min(1, Math.max(0, (h - (slot.floor + BAND_TOP) * FLOOR_H) / (FLOOR_H * 0.4)));
      const open = presence * emerged;
      // De romp is in X en Z geschaald met `presence`; de gevel schuift dus
      // mee naar binnen zolang een pand nog uit de grond komt.
      const depth = ((slot.face < 2 ? plot.d : plot.w) * presence) / 2 + SKIN;
      const lx = slot.face === 2 ? depth : slot.face === 3 ? -depth : 0;
      const lz = slot.face === 0 ? depth : slot.face === 1 ? -depth : 0;
      const cos = Math.cos(plot.rot);
      const sin = Math.sin(plot.rot);
      euler.set(
        0,
        plot.rot +
          (slot.face === 0 ? 0 : slot.face === 1 ? Math.PI : slot.face === 2 ? Math.PI / 2 : -Math.PI / 2),
        0,
      );
      quat.setFromEuler(euler);
      pos.set(
        plot.x + lx * cos + lz * sin,
        GROUND + (slot.floor + BAND_CENTRE) * FLOOR_H,
        plot.z - lx * sin + lz * cos,
      );
      scale.set(WIN_W * open, WIN_H * open, 1);
      matrix.compose(pos, quat, scale);
      m.setMatrixAt(i, matrix);
    }

    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (rebuild) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  });

  if (slots.length === 0) return null;

  return (
    // De key hangt aan het aantal vlakken: alleen een andere wereld (of een
    // andere kwaliteitstrap) mag de buffers opnieuw laten aanmaken.
    <instancedMesh key={`win-${slots.length}`} ref={mesh} args={[undefined, undefined, slots.length]}>
      <planeGeometry args={[1, 1]} />
      {/* toneMapped uit: anders trekt de ACES-curve de warme piek terug naar
          grijs en is het verschil tussen aan en uit weg. */}
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
