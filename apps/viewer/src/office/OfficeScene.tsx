import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Dressing } from './Dressing.tsx';
import { officeSpec, stableHash } from '@ara/shared';
import type { OfficeKind, OfficeSnapshot, Station, StaffMember, StaffTier } from '@ara/shared';
import { chipTexture, valueTexture, headlineTexture, factsTexture, roomTexture } from './textures.ts';

/**
 * Het kantoor-interieur: werkplekken met schermen en werkende agents, de
 * muurschermen met de cijfers, een overlegruimte en de keten die deze vloer
 * aanstuurt.
 *
 * De inhoud (wélke werkplekken, wélke cijfers, wélke staf) komt uit
 * `buildOffice` in @ara/shared en wordt hier niet aangeraakt — collector en
 * viewer moeten daar exact hetzelfde uit halen. Wat hier gebeurt is het gebouw
 * eromheen.
 *
 * Drie dingen maken dat gebouw leesbaar:
 *
 * 1. **Het vloerplan vertelt het vak.** Elke tak heeft zijn eigen ruimte. Een
 *    werkplaats met een hefbrug in een kantoortuin is geen werkplaats; die
 *    hoort een hoge hal te zijn met een rolpoort en een betonvloer. Een
 *    handelsvloer loopt trapsgewijs af naar de koersenwand, aandelen is een
 *    leeszaal met carrels tegen de researchwand, crypto draait dag en nacht om
 *    zijn eigen kluis heen, een atelier is licht en open, een opnamestudio laag
 *    en gedempt, ritplanning is een controlekamer.
 * 2. **De keten staat er ook echt.** `staff` draagt sinds kort `tier`,
 *    `reportsTo` en `depth`: chief → supervisor → manager → de vloer, met ops
 *    ernaast. Die keten wordt hier getekend als een commandostrook aan de
 *    camerarand, met de lijnen van `reportsTo` erover. Een vaste rol zonder
 *    iemand erachter (`live: false`) blijft een lége stoel — dat is het
 *    eerlijke beeld en geen gat in de tekening.
 * 3. **Zones.** Een vloer die één ongedeeld raster bureaus is leest als een
 *    screensaver. Elke ruimte valt uiteen in gebieden met hun eigen werk, en
 *    die gebieden komen uit gegevens die er al zijn: de bureaus zelf, hun
 *    status, de bezetting van de keten en de woordenschat van de tak
 *    (`officeSpec`). Er wordt geen versiering bijverzonnen.
 *
 * Tekenwerk: alles wat vaker dan een paar keer voorkomt gaat door een
 * `InstancedMesh` (bureaus, poppetjes, pads, lijnen, planken). Geometrie en
 * materialen staan op moduleniveau; in `useFrame` wordt niets aangemaakt. De
 * kleuren per exemplaar lopen via `setColorAt` — en dan blijft `vertexColors`
 * uit, anders rendert three r170 alles zwart.
 */

const STATUS_COLOR: Record<Station['status'], string> = {
  working: '#6ee7ff',
  idle: '#6b6390',
  alert: '#ff6b6b',
  done: '#4ade80',
};

/* ========================= het recept van een ruimte ========================= */

/** Hoe de schil gebouwd is: wanden, dak en vloerwerk hangen hieraan. */
export type OfficeShell =
  | 'open'
  | 'hal'
  | 'controlroom'
  | 'floor'
  | 'atelier'
  | 'booth'
  | 'venue'
  /** Leeszaal: carrels tegen de researchwand, boekenwanden, hoog. */
  | 'research'
  /** Kluisvloer: een ring om de custody-kern, 24 uur per dag. */
  | 'vault';

/**
 * De waardenladder van een ruimte. De vloer is altijd lichter dan de wanden en
 * de plint ligt daar tussenin: het kantoor stond ooit op bijna-zwarte paarsen
 * en las als niets. Vorm komt uit contrast, niet uit belichting.
 */
export interface OfficePalette {
  floor: string;
  /** Baan, belijning, trede, lichtvlek — het tweede vloerniveau. */
  mark: string;
  wall: string;
  wallSide: string;
  plint: string;
  /** Constructie: spanten, kozijnen, kolommen, tredeneuzen. */
  trim: string;
  lamp: string;
  desk: string;
  deskLeg: string;
  /** Hoeveel algemeen licht deze ruimte heeft. */
  ambient: number;
}

/** Eén werkplek: waar hij staat, hoe hoog en waar de agent naar kijkt. */
export interface DeskSlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /**
   * true = de agent zit met zijn rug naar je toe en kijkt naar de wand
   * (koersenwand, kaartwand). Het scherm draait dan mee naar de camera, anders
   * kijk je tegen een zwarte achterkant aan en zie je niet meer wie werkt.
   */
  wall: boolean;
}

export interface Lamp {
  x: number;
  y: number;
  z: number;
  len: number;
  axis: 'x' | 'z';
  power: number;
}

/**
 * Een gebied op de vloer dat ander werk doet dan het gebied ernaast. Het
 * rechthoekje komt uit de bureaus die er staan (zie `zoneOfSlots`), niet uit
 * een losse tekening — zo kan een zone nooit los komen te staan van waar de
 * bureaus werkelijk terechtkomen.
 */
export interface Zone {
  id: string;
  /** Woord uit de tak zelf. */
  label: string;
  /** Waar de tweede regel van het bordje vandaan komt. */
  reads: 'stations' | 'chain' | 'room';
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  tone: string;
}

/**
 * De commandostrook aan de camerarand: waar de keten staat. Drie treden diep
 * (chief hoogst en vooraan, dan supervisor, dan manager) en daarnaast het veld
 * met de vaste rollen. De strook hoort aan de open zijde van de ruimte, want
 * daar kijkt de camera overheen zonder dat er een wand tussen staat.
 */
export interface LeadBand {
  /** Linkerrand van de strook (vrij van het overleghok). */
  x0: number;
  /** Rechterrand. */
  x1: number;
  /** Midden van de strook in de diepte. */
  z: number;
  /** Diepte van de strook. */
  d: number;
  /** Vloerhoogte waar de strook op ligt (tribune-top, podium, of 0). */
  y: number;
}

export interface OfficeLayout {
  kind: OfficeKind;
  shell: OfficeShell;
  width: number;
  depth: number;
  wallH: number;
  palette: OfficePalette;
  desks: DeskSlot[];
  lamps: Lamp[];
  /** Traptreden: elke trede loopt van z tot de voorrand van de zaal. */
  steps: { z: number; h: number }[];
  /** Verhoogd achtervlak waar de leiding op staat (controlekamer). */
  podium: { z: number; h: number } | null;
  /** Tussenschotten tussen de bureaus — hoort bij een kantoortuin, niet in een atelier. */
  dividers: boolean;
  /** Rolpoort in de achterwand (x, breedte, hoogte). */
  door: { x: number; w: number; h: number } | null;
  /** Ankerpunt voor het vakmeubilair uit Dressing. */
  dress: { x: number; z: number };
  /**
   * Het punt waar de ruimte om heen staat: de kluiskern, de kaartpit. De
   * bureaus kijken ernaar en het vloerwerk ligt eromheen, dus het hoort in het
   * vloerplan te staan en niet nog eens los in de tekening.
   */
  focus: { x: number; z: number; r: number } | null;
  meeting: { x: number; y: number; z: number; w: number; d: number; h: number };
  /** Waar de keten staat. */
  lead: LeadBand;
  /**
   * Blijft staan voor wie het vloerplan van buitenaf leest (Dressing); de
   * keten zelf plaatst zijn mensen via `lead`.
   */
  manager: [number, number, number];
  chief: [number, number, number];
  /** Gebieden met eigen werk. */
  zones: Zone[];
  /** Muurschermen: positie en maat hangen af van de wandhoogte. */
  screen: { x: number; y: number; w: number; factsX: number; factsY: number; factsW: number };
}

/** Eén regel op een plaatje; `does` is een zin en een chip is geen alinea. */
function capLine(text: string, max = 46): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Verhouding van de canvas-textures; hardcoded maten zouden ze uitrekken. */
const HEAD_RATIO = 3.8 / 14;
const FACTS_RATIO = 3.6 / 6.2;

/** Diepte van de commandostrook. Elk vloerplan reserveert dit aan de camerakant. */
const LEAD_D = 5.6;

/** Kleuren van de zonemarkering — zonesoort, niet tak. */
const ZONE_TONE = {
  work: '#8ab4ff',
  focus: '#ffd75e',
  chain: '#c9a7ff',
  meet: '#6fd3a0',
};

/** Rijen even vol maken; een halve rij hoort gecentreerd te staan, niet linksaf. */
function splitRows(total: number, cols: number): number[] {
  const rows = Math.max(1, Math.ceil(total / cols));
  const base = Math.floor(total / rows);
  const extra = total % rows;
  return Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0));
}

function rowSlots(
  counts: number[],
  dx: number,
  dz: number,
  z0: number,
  x0 = 0,
  rise = 0,
  wall = false,
): DeskSlot[] {
  const rows = counts.length;
  const out: DeskSlot[] = [];
  counts.forEach((n, r) => {
    for (let i = 0; i < n; i += 1) {
      out.push({
        x: x0 + (i - (n - 1) / 2) * dx,
        y: r * rise,
        z: z0 + (r - (rows - 1) / 2) * dz,
        yaw: 0,
        wall,
      });
    }
  });
  return out;
}

/** Bogen rond een brandpunt: elke werkplek kijkt naar hetzelfde punt. */
function arcSlots(
  total: number,
  fz: number,
  rings: { r: number; cap: number }[],
  pitch: number,
  fx = 0,
): DeskSlot[] {
  const out: DeskSlot[] = [];
  let left = total;
  rings.forEach((ring, idx) => {
    if (left <= 0) return;
    const n = idx === rings.length - 1 ? left : Math.min(ring.cap, left);
    left -= n;
    const step = pitch / ring.r;
    for (let i = 0; i < n; i += 1) {
      // Positie op de boog én de draaiing zijn dezelfde hoek: zo staat elk
      // bureau vanzelf haaks op de lijn naar het brandpunt.
      const a = (i - (n - 1) / 2) * step;
      out.push({
        x: fx + Math.sin(a) * ring.r,
        y: 0,
        z: fz + Math.cos(a) * ring.r,
        yaw: a,
        wall: true,
      });
    }
  });
  return out;
}

/** Twee kolommen diep de hal in: de kantoorstrook naast de werkvloer. */
function stripSlots(total: number, x0: number, dx: number, dz: number, z0: number): DeskSlot[] {
  const rows = Math.max(1, Math.ceil(total / 2));
  return Array.from({ length: total }, (_, i) => ({
    x: x0 - (i % 2) * dx,
    y: 0,
    z: z0 + (Math.floor(i / 2) - (rows - 1) / 2) * dz,
    yaw: 0,
    wall: false,
  }));
}

/** Losse eilanden van drie: een atelier heeft geen rijen. */
const ISLANDS: [number, number, number][] = [
  [-7.6, -3.6, 0.16],
  [1.2, -5.0, -0.2],
  [-3.6, 3.2, -0.12],
  [6.2, 1.2, 0.22],
];

function islandSlots(total: number): DeskSlot[] {
  return Array.from({ length: total }, (_, i) => {
    const round = Math.floor(i / (ISLANDS.length * 3));
    const [cx, cz, yaw] = ISLANDS[Math.floor(i / 3) % ISLANDS.length]!;
    // Drie bureaus als molenwiek om één punt: op een rij worden het alsnog
    // rijen, en dan heb je een kantoortuin met een ander behang.
    const a = yaw + ((i % 3) * Math.PI * 2) / 3;
    return {
      x: cx + Math.sin(a) * 1.95,
      y: 0,
      z: cz + Math.cos(a) * 1.95 + round * 3.4,
      yaw: a,
      wall: false,
    };
  });
}

/** Regiekamer: een console-rij naar de cabine toe, de rest erachter. */
function consoleSlots(total: number): DeskSlot[] {
  const front = Math.min(total, 6);
  const back = total - front;
  const out: DeskSlot[] = [];
  for (let i = 0; i < front; i += 1) {
    out.push({ x: (i - (front - 1) / 2) * 3.2, y: 0, z: -1.2, yaw: 0, wall: true });
  }
  for (let i = 0; i < back; i += 1) {
    out.push({ x: -3 + (i - (back - 1) / 2) * 3.2, y: 0, z: 2.1, yaw: 0, wall: true });
  }
  return out;
}

/** Twee blokken links en rechts van het podium; het midden blijft vrij. */
function flankSlots(total: number, x0: number, dx: number, dz: number, z0: number): DeskSlot[] {
  const leftN = Math.ceil(total / 2);
  return Array.from({ length: total }, (_, i) => {
    const side = i < leftN ? -1 : 1;
    const k = i < leftN ? i : i - leftN;
    const rows = Math.max(1, Math.ceil((side < 0 ? leftN : total - leftN) / 2));
    return {
      x: side * (x0 - (k % 2) * dx),
      y: 0,
      z: z0 + (Math.floor(k / 2) - (rows - 1) / 2) * dz,
      yaw: 0,
      wall: false,
    };
  });
}

/* ------------------------------ gereedschap ------------------------------ */

/**
 * Het overleghok in de achterhoek links: glas naar de vloer, dichte panelen
 * tegen de twee wanden. Daar stond het vroeger midden in de loop van de zaal;
 * in de hoek laat het de hele camerarand vrij voor de keten.
 */
function cornerMeeting(
  width: number,
  depth: number,
  w = 6.2,
  d = 5.4,
  h = 3.4,
): OfficeLayout['meeting'] {
  return { x: -width / 2 + w / 2 + 1.0, y: 0, z: -depth / 2 + d / 2 + 0.9, w, d, h };
}

/** De commandostrook: aan de camerarand, rechts van het overleghok. */
function leadBand(width: number, depth: number, y = 0, meetingRight = -Infinity): LeadBand {
  return {
    x0: Math.max(-width / 2 + 1.6, meetingRight + 1.2),
    x1: width / 2 - 1.6,
    z: depth / 2 - LEAD_D / 2 - 0.5,
    d: LEAD_D,
    y,
  };
}

/** Zone om een groep bureaus heen — de rechthoek komt uit de bureaus zelf. */
function zoneOfSlots(
  id: string,
  label: string,
  tone: string,
  slots: DeskSlot[],
  pad = 1.7,
  padZ = 1.25,
): Zone | null {
  if (slots.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let y = 0;
  for (const s of slots) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
    y = Math.min(y === 0 ? s.y : y, s.y);
  }
  return {
    id,
    label,
    reads: 'stations',
    x: (minX + maxX) / 2,
    y,
    z: (minZ + maxZ) / 2,
    w: maxX - minX + pad * 2,
    d: maxZ - minZ + padZ * 2,
    tone,
  };
}

/**
 * De zone die élke ruimte heeft en niet uit de bureaus komt: het overleghok.
 * De ketenzone wordt niet hier gemaakt maar uit de stoelen die er werkelijk
 * staan — een strook die de volle breedte beslaat terwijl er acht mensen op
 * staan liegt over hoe groot die club is.
 */
function frameZones(layout: Omit<OfficeLayout, 'zones'>): Zone[] {
  const { meeting } = layout;
  return [
    {
      id: 'meet',
      label: 'OVERLEG',
      reads: 'room',
      x: meeting.x,
      y: meeting.y,
      z: meeting.z,
      w: meeting.w + 0.8,
      d: meeting.d + 0.8,
      tone: ZONE_TONE.meet,
    },
  ];
}

/** Zones samenstellen: eerst de werkgebieden van de tak, dan keten en overleg. */
function withZones(base: Omit<OfficeLayout, 'zones'>, work: (Zone | null)[]): OfficeLayout {
  return { ...base, zones: [...work.filter((z): z is Zone => z !== null), ...frameZones(base)] };
}

/* -------------------------------- paletten -------------------------------- */

const OPEN_PALETTE: OfficePalette = {
  floor: '#4a4570',
  mark: '#5d5793',
  wall: '#3a3564',
  wallSide: '#332e59',
  plint: '#6b659b',
  trim: '#5a4d94',
  lamp: '#fff4de',
  desk: '#ded7f5',
  deskLeg: '#6a5fa0',
  ambient: 0.95,
};

const TRADE_PALETTE: OfficePalette = {
  floor: '#6a6590',
  mark: '#7d78a6',
  wall: '#332e59',
  wallSide: '#2c2750',
  plint: '#837cb4',
  trim: '#4b447e',
  lamp: '#dce9ff',
  desk: '#ded7f5',
  deskLeg: '#5f5695',
  ambient: 0.9,
};

/**
 * Leeszaal. Eiken bladen en warm licht tegen koele wanden: dat is het verschil
 * met de handelsvloer dat je ziet vóór je één label gelezen hebt.
 */
const RESEARCH_PALETTE: OfficePalette = {
  floor: '#6d6690',
  mark: '#a3936e',
  wall: '#2f2b50',
  wallSide: '#292547',
  plint: '#8079ad',
  trim: '#7c6a4c',
  lamp: '#ffe6b8',
  desk: '#c2a97f',
  deskLeg: '#6b5a3f',
  ambient: 0.86,
};

/** Kluisvloer: koel licht, oranje belijning, donkere wanden — nachtdienst. */
const CRYPTO_PALETTE: OfficePalette = {
  floor: '#5a5484',
  mark: '#e08a2c',
  wall: '#26224a',
  wallSide: '#211d41',
  plint: '#7b73b6',
  trim: '#3e3773',
  lamp: '#bfe6ff',
  desk: '#cdc6ea',
  deskLeg: '#554d8d',
  ambient: 0.8,
};

const TMS_PALETTE: OfficePalette = {
  floor: '#6e7790',
  mark: '#828ca6',
  wall: '#363c55',
  wallSide: '#30354c',
  plint: '#8a93ad',
  trim: '#565f7a',
  lamp: '#d8e4ff',
  desk: '#cfd6ea',
  deskLeg: '#5b647f',
  ambient: 0.82,
};

const FLEET_PALETTE: OfficePalette = {
  floor: '#8b8794',
  mark: '#c9a227',
  wall: '#4a4757',
  wallSide: '#403d4d',
  plint: '#6e6a7d',
  trim: '#5d5a6d',
  lamp: '#fff0cf',
  desk: '#d7d2e4',
  deskLeg: '#63607a',
  ambient: 1.0,
};

const DESIGN_PALETTE: OfficePalette = {
  floor: '#c2b3a3',
  mark: '#d5c9bb',
  wall: '#7b7598',
  wallSide: '#6f6a8c',
  plint: '#a49dbd',
  trim: '#e7e1f2',
  lamp: '#fff6e8',
  desk: '#7a6752',
  deskLeg: '#5e4f3f',
  ambient: 1.15,
};

const STUDIO_PALETTE: OfficePalette = {
  floor: '#756991',
  mark: '#85799f',
  wall: '#453c5e',
  wallSide: '#3d3554',
  plint: '#7b6f9e',
  trim: '#544878',
  lamp: '#ffd9a8',
  desk: '#cdc4e4',
  deskLeg: '#5b5080',
  ambient: 0.88,
};

const MUSIC_PALETTE: OfficePalette = {
  floor: '#514c76',
  mark: '#6a6497',
  wall: '#2f2b4f',
  wallSide: '#292545',
  plint: '#6d6aa2',
  trim: '#3b3663',
  lamp: '#ffd9f0',
  desk: '#d3ccec',
  deskLeg: '#5b5390',
  ambient: 0.78,
};

/* ------------------------------ de vloerplannen ------------------------------ */

/** Kantoortuin: het vertrouwde rijenplan voor takken zonder eigen ruimte. */
function openPlan(total: number): OfficeLayout {
  const counts = splitRows(total, 6);
  const rows = counts.length;
  const width = 28;
  const depth = Math.max(21, rows * 3 + 16);
  const z0 = -1.2;
  const rowZ = (r: number): number => z0 + (r - (rows - 1) / 2) * 3;
  const desks = rowSlots(counts, 3.5, 3, z0, 1.4);
  const meeting = cornerMeeting(width, depth);
  const base = {
    kind: 'generic' as const,
    shell: 'open' as const,
    width,
    depth,
    wallH: 10,
    palette: OPEN_PALETTE,
    desks,
    lamps: counts.map((_, r) => ({ x: 1.4, y: 4.6, z: rowZ(r), len: 19.4, axis: 'x' as const, power: 7 })),
    steps: [],
    podium: null,
    dividers: true,
    door: null,
    dress: { x: width / 2 - 7.8, z: -depth / 2 + 5.6 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [width / 2 - 3.4, 0, depth / 2 - 3.2] as [number, number, number],
    chief: [-width / 2 + 3.4, 0, depth / 2 - 3.2] as [number, number, number],
    screen: { x: 1.4, y: 5.2, w: 14, factsX: -width / 2 + 4.6, factsY: 5.0, factsW: 6.2 },
  };
  // Eén werkgebied: een kantoortuin is per definitie niet opgedeeld, en een
  // scheiding verzinnen die er niet is zou het plan iets laten beweren.
  return withZones(base, [zoneOfSlots('work', 'WERKVLOER', ZONE_TONE.work, desks)]);
}

/**
 * Handelsvloer: een tribune die naar de koersenwand afloopt. De rijen lopen
 * omhoog richting de camera — dat is niet alleen hoe een zaal werkt, het is ook
 * de enige richting die van bovenaf leesbaar blijft: in isometrie tekent verder
 * weg zich hoger, dus de lage rijen vooraan verdwijnen niet achter de hoge.
 *
 * De onderste treden liggen tegen de wand: daar wordt uitgevoerd. De bovenste
 * kijken over de zaal heen: daar wordt gekeken. Dat zijn de twee zones.
 */
function tradingFloor(total: number): OfficeLayout {
  const counts = splitRows(total, 6);
  const rows = counts.length;
  const dz = 3.3;
  const rise = 0.62;
  const z0 = -2.6;
  const width = 28;
  const depth = rows * dz + 15.5;
  const top = (rows - 1) * rise;
  const rowZ = (r: number): number => z0 + (r - (rows - 1) / 2) * dz;
  const desks = rowSlots(counts, 3.4, dz, z0, 2.6, rise, true);
  const split = counts.slice(0, Math.max(1, Math.ceil(rows / 2))).reduce((a, b) => a + b, 0);
  const meeting = cornerMeeting(width, depth);
  const base = {
    kind: 'trading' as const,
    shell: 'floor' as const,
    width,
    depth,
    wallH: 11.5,
    palette: TRADE_PALETTE,
    desks,
    // Eén balk per twee rijen: boven een tribune met neuzen werden vier
    // evenwijdige strepen één streepjespatroon in plaats van verlichting.
    lamps: counts
      .map((_, r) => r)
      .filter((r) => r % 2 === 0)
      .map((r) => ({ x: 2.6, y: 7.2 + r * rise, z: rowZ(r) - 1.1, len: 17, axis: 'x' as const, power: 9 })),
    steps: counts.slice(1).map((_, i) => ({ z: rowZ(i + 1) - dz / 2 - 0.2, h: (i + 1) * rise })),
    podium: null,
    dividers: false,
    door: null,
    dress: { x: 2.6, z: -depth / 2 + 0.9 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, top, meeting.x + meeting.w / 2),
    manager: [width / 2 - 3.6, top, depth / 2 - 2.6] as [number, number, number],
    chief: [width / 2 - 8.2, top, depth / 2 - 2.6] as [number, number, number],
    // Het feitenpaneel hangt links van de koersenwand in plaats van erboven:
    // rechts sneed het door de bovenrand van het bord heen.
    screen: { x: 2.6, y: 9.0, w: 13, factsX: -width / 2 + 4.4, factsY: 6.6, factsW: 5.4 },
  };
  return withZones(base, [
    zoneOfSlots('exec', 'UITVOERING', ZONE_TONE.focus, desks.slice(0, split)),
    zoneOfSlots('research', 'ANALYSE', ZONE_TONE.work, desks.slice(split)),
  ]);
}

/**
 * Aandelen: een leeszaal, geen tribune.
 *
 * Aandelen zijn bezit dat je aanhoudt — `entityWord` is "posities", de kolommen
 * gaan over de these en de kostprijs, en `stationSub` telt járen in bezit. Dat
 * hoort geen bank live-tickers te zijn maar carrels tegen een researchwand:
 * lange rijen leesplekken die allemaal dezelfde kant op kijken, met de theses
 * aan de muur ervoor, boekenwanden opzij en leeslampen laag boven het blad.
 * Vlakke vloer, geen treden: hier verandert er niets binnen een minuut.
 */
function researchFloor(total: number): OfficeLayout {
  const counts = splitRows(total, 6);
  const rows = counts.length;
  const dz = 3.4;
  const width = 28;
  const depth = Math.max(22, 14.2 + (rows - 1) * dz + LEAD_D);
  const z0 = -depth / 2 + 4.6 + ((rows - 1) / 2) * dz;
  const desks = rowSlots(counts, 3.4, dz, z0, 3.0, 0, true);
  const meeting = cornerMeeting(width, depth, 6.0, 5.2);
  const base = {
    kind: 'equities' as const,
    shell: 'research' as const,
    width,
    depth,
    wallH: 11.5,
    palette: RESEARCH_PALETTE,
    desks,
    // Eén leeslamp-rij per carrelrij, laag: een leeszaal wordt verlicht op het
    // blad en niet over de hele hoogte.
    lamps: counts.map((_, r) => ({
      x: 3.0,
      y: 5.4,
      z: z0 + (r - (rows - 1) / 2) * dz - 1.0,
      len: 18,
      axis: 'x' as const,
      power: 6,
    })),
    steps: [],
    podium: null,
    // Carrels: het schot hoort bij de leesplek, het is geen kantoortuinrestant.
    dividers: true,
    door: null,
    dress: { x: 3.0, z: -depth / 2 + 0.9 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [width / 2 - 3.4, 0, depth / 2 - 3.0] as [number, number, number],
    chief: [width / 2 - 8.4, 0, depth / 2 - 3.0] as [number, number, number],
    screen: { x: 3.0, y: 9.0, w: 13, factsX: -width / 2 + 4.4, factsY: 6.6, factsW: 5.2 },
  };
  // Vooraan tegen de wand wordt gelezen, daarachter wordt de portefeuille
  // bijgehouden — de woorden komen uit KIND_SPECS van deze tak.
  const front = counts[0] ?? 0;
  return withZones(base, [
    zoneOfSlots('research', 'RESEARCH', ZONE_TONE.work, desks.slice(0, front)),
    zoneOfSlots('book', 'POSITIES', ZONE_TONE.focus, desks.slice(front)),
  ]);
}

/**
 * Crypto: een kluisvloer die nooit dichtgaat.
 *
 * Niet de tribune van de handelsvloer en niet de leeszaal van aandelen. Een
 * crypto-desk draait om twee dingen die de andere twee niet hebben: bewaring
 * (de sleutels staan hier, niet bij een broker) en de klok (er is geen
 * slotbel). Dus: een hoefijzer van werkplekken rondom een custody-kern midden
 * in de vloer, oranje belijning eromheen, en een urenband van 24 blokken langs
 * de achterwand waarvan er precies één brandt — het huidige uur, uit de
 * snapshot, niet uit een animatie.
 */
function cryptoFloor(total: number): OfficeLayout {
  const width = 27;
  const depth = 24;
  const core = { x: 1.0, z: -6.4, r: 3.1 };
  const desks = arcSlots(
    total,
    core.z,
    [
      { r: 5.2, cap: 5 },
      { r: 7.6, cap: 7 },
      { r: 10.0, cap: 9 },
    ],
    4.0,
    core.x,
  );
  const meeting = cornerMeeting(width, depth, 6.0, 5.2);
  const base = {
    kind: 'crypto' as const,
    shell: 'vault' as const,
    width,
    depth,
    wallH: 11,
    palette: CRYPTO_PALETTE,
    desks,
    lamps: [
      { x: core.x, y: 7.2, z: core.z - 4.0, len: 15, axis: 'x' as const, power: 7 },
      { x: core.x, y: 7.2, z: core.z + 4.8, len: 19, axis: 'x' as const, power: 8 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: core.x, z: -depth / 2 + 0.9 },
    focus: core,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [width / 2 - 3.6, 0, depth / 2 - 3.0] as [number, number, number],
    chief: [width / 2 - 8.4, 0, depth / 2 - 3.0] as [number, number, number],
    screen: { x: core.x, y: 8.6, w: 13, factsX: -width / 2 + 4.4, factsY: 6.4, factsW: 5.4 },
  };
  // De binnenring kijkt op de kluis, de buitenring op de markt.
  const inner = Math.min(desks.length, 5);
  return withZones(
    base,
    [
      zoneOfSlots('custody', 'CUSTODY', ZONE_TONE.focus, desks.slice(0, inner), 1.6),
      zoneOfSlots('setups', 'SETUPS', ZONE_TONE.work, desks.slice(inner), 1.6),
    ],
  );
}

/** Controlekamer: twee bogen om de kaarttafel, leiding op een verhoging erachter. */
function controlRoom(total: number): OfficeLayout {
  const width = 26;
  const depth = 23;
  const desks = arcSlots(total, -9.4, [
    { r: 7.6, cap: 5 },
    { r: 11, cap: 7 },
    { r: 14.2, cap: 9 },
  ], 3.6);
  const meeting = cornerMeeting(width, depth, 5.8, 4.8);
  const base = {
    kind: 'tms' as const,
    shell: 'controlroom' as const,
    width,
    depth,
    wallH: 7.5,
    palette: TMS_PALETTE,
    desks,
    lamps: [
      { x: 0, y: 5.2, z: -6.2, len: 12, axis: 'x' as const, power: 5 },
      { x: 0, y: 5.2, z: -1.6, len: 16, axis: 'x' as const, power: 6 },
      { x: 0, y: 5.2, z: 3.6, len: 10, axis: 'x' as const, power: 4 },
    ],
    steps: [],
    podium: { z: depth / 2 - LEAD_D - 1.2, h: 0.5 },
    dividers: false,
    door: null,
    dress: { x: 0, z: -depth / 2 + 3.6 },
    focus: { x: 0, z: -2.8, r: 8.2 },
    meeting,
    lead: leadBand(width, depth, 0.5, meeting.x + meeting.w / 2),
    manager: [width / 2 - 4.5, 0.5, depth / 2 - 2.6] as [number, number, number],
    chief: [width / 2 - 9, 0.5, depth / 2 - 2.6] as [number, number, number],
    screen: { x: 0, y: 5.4, w: 12, factsX: -width / 2 + 4.2, factsY: 4.6, factsW: 5 },
  };
  const inner = Math.min(desks.length, 5);
  return withZones(base, [
    zoneOfSlots('plan', 'PLANNING', ZONE_TONE.focus, desks.slice(0, inner), 1.6),
    zoneOfSlots('dispatch', 'DISPATCH', ZONE_TONE.work, desks.slice(inner), 1.6),
  ]);
}

/** Werkplaats: een hoge hal met rolpoort en betonvloer, kantoorstrook opzij. */
function workshop(total: number): OfficeLayout {
  const width = 29;
  const depth = 23;
  const desks = stripSlots(total, width / 2 - 4.6, 3.5, 3, -2.2);
  const meeting = cornerMeeting(width, depth, 5.8, 4.8);
  const base = {
    kind: 'fleet' as const,
    shell: 'hal' as const,
    width,
    depth,
    wallH: 11,
    palette: FLEET_PALETTE,
    desks,
    lamps: [
      { x: -6, y: 8.4, z: -7, len: 11, axis: 'x' as const, power: 9 },
      { x: -6, y: 8.4, z: 0, len: 11, axis: 'x' as const, power: 9 },
      { x: 10.2, y: 5.2, z: -2.2, len: 14, axis: 'z' as const, power: 7 },
    ],
    steps: [],
    podium: null,
    dividers: true,
    door: { x: -5.5, w: 8.5, h: 5.6 },
    dress: { x: -5.5, z: -4.4 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [1.6, 0, depth / 2 - 2.8] as [number, number, number],
    chief: [-2.8, 0, depth / 2 - 2.8] as [number, number, number],
    screen: { x: 5.4, y: 8.2, w: 11, factsX: -5.5, factsY: 8.2, factsW: 5 },
  };
  return withZones(base, [
    {
      id: 'bay',
      label: 'WERKVAK',
      reads: 'stations',
      x: -5.5,
      y: 0,
      z: -4.4,
      w: 8.6,
      d: 7.2,
      tone: ZONE_TONE.focus,
    },
    zoneOfSlots('office', 'KANTOOR', ZONE_TONE.work, desks, 1.7),
  ]);
}

/** Atelier: lage borstwering, brede raamstroken, eilanden in plaats van rijen. */
function atelier(total: number): OfficeLayout {
  const width = 28;
  const depth = 23;
  const desks = islandSlots(total);
  const meeting = cornerMeeting(width, depth, 5.8, 4.8);
  const base = {
    kind: 'design' as const,
    shell: 'atelier' as const,
    width,
    depth,
    wallH: 8.6,
    palette: DESIGN_PALETTE,
    desks,
    lamps: [
      { x: -4, y: 6.4, z: -3.4, len: 9, axis: 'x' as const, power: 4 },
      { x: 4, y: 6.4, z: 2.2, len: 9, axis: 'x' as const, power: 4 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: 9, z: -depth / 2 + 4.4 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [width / 2 - 3.4, 0, depth / 2 - 2.6] as [number, number, number],
    chief: [width / 2 - 8.6, 0, depth / 2 - 2.6] as [number, number, number],
    screen: { x: -1, y: 6.9, w: 11, factsX: -width / 2 + 4.2, factsY: 6.6, factsW: 5 },
  };
  const half = Math.min(desks.length, 6);
  return withZones(base, [
    zoneOfSlots('concept', 'CONCEPT', ZONE_TONE.work, desks.slice(0, half), 1.5),
    zoneOfSlots('uitwerking', 'UITWERKING', ZONE_TONE.focus, desks.slice(half), 1.5),
  ]);
}

/** Opnamestudio: lage zaal, akoestische wanden, baffles vlak boven je hoofd. */
function studio(total: number): OfficeLayout {
  const width = 24;
  const depth = 22;
  const desks = consoleSlots(total);
  const meeting = cornerMeeting(width, depth, 5.4, 4.4, 2.6);
  const base = {
    kind: 'studio' as const,
    shell: 'booth' as const,
    width,
    depth,
    wallH: 5.4,
    palette: STUDIO_PALETTE,
    desks,
    lamps: [
      { x: -4, y: 4.6, z: -3.6, len: 7, axis: 'x' as const, power: 4 },
      { x: 4, y: 4.6, z: 0.6, len: 7, axis: 'x' as const, power: 4 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: -6.4, z: -depth / 2 + 4.4 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [2.6, 0, depth / 2 - 2.6] as [number, number, number],
    chief: [-2.6, 0, depth / 2 - 2.6] as [number, number, number],
    screen: { x: 3.4, y: 3.6, w: 9.5, factsX: -width / 2 + 3.6, factsY: 3.5, factsW: 4.4 },
  };
  const front = Math.min(desks.length, 6);
  return withZones(base, [
    {
      id: 'cabine',
      label: 'CABINE',
      reads: 'stations',
      x: -6.4,
      y: 0,
      z: -depth / 2 + 4.4,
      w: 5.4,
      d: 5.0,
      tone: ZONE_TONE.focus,
    },
    zoneOfSlots('regie', 'REGIE', ZONE_TONE.work, desks.slice(0, front), 1.7),
    zoneOfSlots('montage', 'MONTAGE', ZONE_TONE.work, desks.slice(front), 1.7),
  ]);
}

/** Zaal: podium vooraan, twee werkblokken opzij, het midden blijft loopruimte. */
function venue(total: number): OfficeLayout {
  const width = 28;
  const depth = 23;
  const desks = flankSlots(total, 10.2, 3.3, 3, -1.2);
  const meeting = cornerMeeting(width, depth, 5.8, 4.6);
  const base = {
    kind: 'music' as const,
    shell: 'venue' as const,
    width,
    depth,
    wallH: 11,
    palette: MUSIC_PALETTE,
    desks,
    // De zaal hangt aan het podiumlicht; boven de werkblokken alleen genoeg om
    // een toetsenbord te zien.
    lamps: [
      { x: -8.6, y: 5.6, z: -1.2, len: 7, axis: 'z' as const, power: 6 },
      { x: 8.6, y: 5.6, z: -1.2, len: 7, axis: 'z' as const, power: 6 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: 0, z: -depth / 2 + 5.4 },
    focus: null,
    meeting,
    lead: leadBand(width, depth, 0, meeting.x + meeting.w / 2),
    manager: [2.6, 0, depth / 2 - 2.6] as [number, number, number],
    chief: [-2.6, 0, depth / 2 - 2.6] as [number, number, number],
    screen: { x: 0, y: 8.2, w: 12, factsX: -width / 2 + 4.2, factsY: 7.6, factsW: 5 },
  };
  const half = Math.ceil(desks.length / 2);
  return withZones(base, [
    {
      id: 'podium',
      label: 'PODIUM',
      reads: 'stations',
      x: 0,
      y: 0,
      z: -depth / 2 + 5.4,
      w: 7.4,
      d: 5.0,
      tone: ZONE_TONE.focus,
    },
    zoneOfSlots('productie', 'PRODUCTIE', ZONE_TONE.work, desks.slice(0, half), 1.7),
    zoneOfSlots('promo', 'PROMO', ZONE_TONE.work, desks.slice(half), 1.7),
  ]);
}

/** Het vloerplan van deze tak. */
export function officeLayout(kind: OfficeKind, total: number): OfficeLayout {
  switch (kind) {
    case 'trading':
      return tradingFloor(total);
    case 'crypto':
      return cryptoFloor(total);
    case 'equities':
      return researchFloor(total);
    case 'tms':
      return controlRoom(total);
    case 'fleet':
      return workshop(total);
    case 'design':
      return atelier(total);
    case 'studio':
      return studio(total);
    case 'music':
      return venue(total);
    default:
      return openPlan(total);
  }
}

/* ===================== gedeelde geometrie en materialen ===================== */
/* Alles hieronder staat één keer in het geheugen en wordt per exemplaar
   geschaald en gekleurd. Zonder dit stond het kantoor op honderden losse
   meshes met elk hun eigen tekenoproep. */

const G_BOX = new THREE.BoxGeometry(1, 1, 1);
const G_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const G_HEX = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const G_PLANE = new THREE.PlaneGeometry(1, 1);
const G_RING = new THREE.RingGeometry(0.86, 1, 36);
const G_BODY = new THREE.CapsuleGeometry(0.17, 0.3, 4, 8);
const G_ARM = new THREE.CapsuleGeometry(0.05, 0.2, 3, 6);
const G_HEAD = new THREE.SphereGeometry(0.16, 12, 10);
const G_HAIR = new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);

/**
 * Wit als basiskleur: de kleur per exemplaar komt uit `setColorAt`. Daarom
 * staat `vertexColors` hier nadrukkelijk uit — met vertexColors aan én geen
 * color-attribuut op de geometrie rendert three r170 alles zwart.
 */
const MAT_SOLID = new THREE.MeshStandardMaterial({ roughness: 0.8 });
const MAT_SMOOTH = new THREE.MeshStandardMaterial({ roughness: 0.5 });
const MAT_FADE = new THREE.MeshStandardMaterial({ roughness: 0.85, transparent: true, opacity: 0.8 });
const MAT_GLOW = new THREE.MeshBasicMaterial({ toneMapped: false });
const MAT_GLOW_FLAT = new THREE.MeshBasicMaterial({
  toneMapped: false,
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const MAT_SKIN = new THREE.MeshStandardMaterial({ color: '#ffd9b8', roughness: 0.8 });
const MAT_HAIR = new THREE.MeshStandardMaterial({ color: '#2a2340', roughness: 0.75 });

/** Kladblokken: nooit iets aanmaken binnen een useFrame. */
const _g = new THREE.Object3D();
const _l = new THREE.Object3D();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();
const _col2 = new THREE.Color();

const FLAT = -Math.PI / 2;

/** Een blok in de instancing-lijst. */
interface Brick {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  ry?: number;
  rx?: number;
  color: string;
}

/** Alle blokjes van één soort in één tekenoproep. */
function Bricks({
  bricks,
  geometry = G_BOX,
  material = MAT_SOLID,
  cast = false,
  receive = false,
}: {
  bricks: Brick[];
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material;
  cast?: boolean;
  receive?: boolean;
}): JSX.Element | null {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    bricks.forEach((b, i) => {
      _g.position.set(b.x, b.y, b.z);
      _g.rotation.set(b.rx ?? 0, b.ry ?? 0, 0);
      _g.scale.set(b.w, b.h, b.d);
      _g.updateMatrix();
      im.setMatrixAt(i, _g.matrix);
      im.setColorAt(i, _col.set(b.color));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [bricks, geometry, material]);
  if (bricks.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, bricks.length]}
      castShadow={cast}
      receiveShadow={receive}
      frustumCulled={false}
    />
  );
}

/* ============================== de mensen =============================== */

/**
 * Eén poppetje in de instancing-lijst. Alle poppetjes van het kantoor —
 * achter de bureaus, in het overleghok en op de commandostrook — zitten in
 * dezelfde vijf InstancedMeshes. Voorheen was elk poppetje zes losse meshes en
 * groeide het kantoor met de bezetting mee in tekenoproepen; nu kost de
 * hele bezetting er vijf, hoeveel mensen er ook staan.
 */
interface Figure {
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: string;
  /** typt (werkt) of kijkt rond */
  active: boolean;
  /** false = de stoel staat er, de persoon niet. Een lege vaste rol. */
  present: boolean;
  seat: boolean;
  scale: number;
  seed: number;
}

function People({ figures }: { figures: Figure[] }): JSX.Element | null {
  const body = useRef<THREE.InstancedMesh>(null);
  const arms = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const hair = useRef<THREE.InstancedMesh>(null);
  const chair = useRef<THREE.InstancedMesh>(null);
  const n = figures.length;

  useLayoutEffect(() => {
    const b = body.current;
    const a = arms.current;
    const c = chair.current;
    if (!b || !a || !c) return;
    figures.forEach((f, i) => {
      _col.set(f.color);
      b.setColorAt(i, _col);
      a.setColorAt(2 * i, _col);
      a.setColorAt(2 * i + 1, _col);
      // Een lege stoel is donkerder dan een bezette: hij hoort te lezen als
      // "hier zit nu niemand", niet als een stoel die je over het hoofd ziet.
      c.setColorAt(i, _col2.set(f.present ? '#2f2750' : '#221d3c'));
    });
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (a.instanceColor) a.instanceColor.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
  }, [figures]);

  useFrame(({ clock }) => {
    const b = body.current;
    const a = arms.current;
    const h = head.current;
    const r = hair.current;
    const c = chair.current;
    if (!b || !a || !h || !r || !c) return;
    const now = clock.elapsedTime;
    for (let i = 0; i < figures.length; i += 1) {
      const f = figures[i]!;
      const t = now + f.seed;
      _g.position.set(f.x, f.y, f.z);
      _g.rotation.set(0, f.yaw, 0);
      _g.scale.setScalar(f.present ? f.scale : 0.0001);
      _g.updateMatrix();

      const bob = f.active ? Math.sin(t * 4.5) * 0.012 : Math.sin(t * 1.6) * 0.02;
      const swing = f.active ? -0.9 : -0.35;
      const tick = f.active ? Math.sin(t * 9) * 0.22 : 0;
      const look = f.active ? Math.sin(t * 0.7) * 0.18 : Math.sin(t * 0.45) * 0.5;

      _l.position.set(0, 0.42 + bob, 0);
      _l.rotation.set(0, 0, 0);
      _l.scale.setScalar(1);
      _l.updateMatrix();
      b.setMatrixAt(i, _m.multiplyMatrices(_g.matrix, _l.matrix));

      for (let s = 0; s < 2; s += 1) {
        _l.position.set(s === 0 ? -0.2 : 0.2, 0.6 + bob, 0);
        _l.rotation.set(swing + (s === 0 ? tick : -tick), 0, 0);
        _l.updateMatrix();
        _m.multiplyMatrices(_g.matrix, _l.matrix);
        _l.position.set(0, -0.12, 0.1);
        _l.rotation.set(0, 0, 0);
        _l.updateMatrix();
        arms.current!.setMatrixAt(2 * i + s, _m.multiply(_l.matrix));
      }

      _l.position.set(0, 0.82 + bob, 0);
      _l.rotation.set(0, look, 0);
      _l.updateMatrix();
      h.setMatrixAt(i, _m.multiplyMatrices(_g.matrix, _l.matrix));
      _l.position.set(0, 0.89 + bob, 0);
      _l.updateMatrix();
      r.setMatrixAt(i, _m.multiplyMatrices(_g.matrix, _l.matrix));

      // De stoel staat er ook als de rol leeg is: dat is precies het punt.
      _g.scale.setScalar(f.seat ? f.scale : 0.0001);
      _g.updateMatrix();
      _l.position.set(0, 0.26, -0.34);
      _l.rotation.set(0, 0, 0);
      _l.scale.set(0.42, 0.5, 0.08);
      _l.updateMatrix();
      c.setMatrixAt(i, _m.multiplyMatrices(_g.matrix, _l.matrix));
      _l.scale.setScalar(1);
    }
    b.instanceMatrix.needsUpdate = true;
    a.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
  });

  if (n === 0) return null;
  return (
    <>
      <instancedMesh ref={body} args={[G_BODY, MAT_SOLID, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={arms} args={[G_ARM, MAT_SOLID, n * 2]} frustumCulled={false} />
      <instancedMesh ref={head} args={[G_HEAD, MAT_SKIN, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={hair} args={[G_HAIR, MAT_HAIR, n]} frustumCulled={false} />
      <instancedMesh ref={chair} args={[G_BOX, MAT_SOLID, n]} frustumCulled={false} />
    </>
  );
}

/* ============================== de werkplekken =============================== */

/** Alle vaste onderdelen van alle bureaus, per soort in één tekenoproep. */
interface DeskParts {
  tops: Brick[];
  legs: Brick[];
  frames: Brick[];
  stands: Brick[];
  keys: Brick[];
  dividers: Brick[];
  screens: { x: number; y: number; z: number; yaw: number }[];
}

function buildDeskParts(layout: OfficeLayout, stations: Station[], zoneTone: (s: DeskSlot) => string): DeskParts {
  const p = layout.palette;
  const parts: DeskParts = { tops: [], legs: [], frames: [], stands: [], keys: [], dividers: [], screens: [] };
  const base = new THREE.Color(p.desk);
  stations.forEach((_, i) => {
    const slot = layout.desks[i] ?? { x: 0, y: 0, z: 0, yaw: 0, wall: false };
    const seatZ = slot.wall ? 1.15 : -1.05;
    const screenZ = slot.wall ? 0.3 : -0.3;
    const keyZ = slot.wall ? 0.72 : 0.25;
    const sin = Math.sin(slot.yaw);
    const cos = Math.cos(slot.yaw);
    const at = (lx: number, lz: number): [number, number] => [
      slot.x + lx * cos + lz * sin,
      slot.z - lx * sin + lz * cos,
    ];
    // Het blad draagt de kleur van zijn zone: zo zie je de indeling terug in
    // het meubilair en niet alleen in een streep op de vloer.
    const top = base.clone().lerp(new THREE.Color(zoneTone(slot)), 0.16).getStyle();
    const [tx, tz] = at(0, 0);
    parts.tops.push({ x: tx, y: slot.y + 0.74, z: tz, w: 2.5, h: 0.09, d: 1.25, ry: slot.yaw, color: top });
    for (const [lx, lz] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]] as [number, number][]) {
      const [px, pz] = at(lx, lz);
      parts.legs.push({ x: px, y: slot.y + 0.37, z: pz, w: 0.1, h: 0.74, d: 0.1, ry: slot.yaw, color: p.deskLeg });
    }
    const [fx, fz] = at(0, screenZ);
    parts.frames.push({
      x: fx,
      y: slot.y + 1.18,
      z: fz,
      w: 1.35,
      h: 0.8,
      d: 0.06,
      ry: slot.yaw,
      rx: -0.16,
      color: '#15102c',
    });
    parts.stands.push({ x: fx, y: slot.y + 0.87, z: fz, w: 0.36, h: 0.16, d: 0.36, ry: slot.yaw, color: '#15102c' });
    const [kx, kz] = at(0, keyZ);
    parts.keys.push({ x: kx, y: slot.y + 0.8, z: kz, w: 0.8, h: 0.03, d: 0.28, ry: slot.yaw, rx: -0.05, color: '#2a2350' });
    if (layout.dividers) {
      const [dx, dz] = at(1.42, -0.05);
      parts.dividers.push({ x: dx, y: slot.y + 1.05, z: dz, w: 0.07, h: 0.62, d: 1.3, ry: slot.yaw, color: p.trim });
    }
    // Het glas staat 4cm vóór het kader, in dezelfde kanteling.
    const [gx, gz] = at(0, screenZ + 0.04 * Math.cos(0.16));
    parts.screens.push({ x: gx, y: slot.y + 1.18 + 0.04 * Math.sin(0.16), z: gz, yaw: slot.yaw });
    void seatZ;
  });
  return parts;
}

/**
 * De schermen: één InstancedMesh met een basic-materiaal, dus de statuskleur
 * en de pols gaan per exemplaar door `setColorAt`. Boven 1 gaat de kleur de
 * bloom in — dat is wat "aan het werk" er van veraf uit laat zien.
 */
function DeskScreens({
  parts,
  stations,
}: {
  parts: DeskParts;
  stations: Station[];
}): JSX.Element | null {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const n = parts.screens.length;
  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    parts.screens.forEach((s, i) => {
      _g.position.set(s.x, s.y, s.z);
      _g.rotation.set(-0.16, s.yaw, 0);
      _g.scale.set(1.22, 0.68, 1);
      _g.updateMatrix();
      im.setMatrixAt(i, _g.matrix);
      im.setColorAt(i, _col.set('#0d0a1e'));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [parts]);

  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im) return;
    const now = clock.elapsedTime;
    for (let i = 0; i < n; i += 1) {
      const st = stations[i];
      if (!st) continue;
      const t = now + i * 0.7;
      const base = st.status === 'working' ? 1.1 : st.status === 'alert' ? 0.9 : 0.35;
      const k = base + Math.sin(t * (st.status === 'working' ? 6 : 1.5)) * 0.18;
      im.setColorAt(i, _col.set(STATUS_COLOR[st.status]).multiplyScalar(Math.max(0.12, k)));
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  if (n === 0) return null;
  return <instancedMesh ref={mesh} args={[G_PLANE, MAT_GLOW, n]} frustumCulled={false} />;
}

/**
 * Alarmringen op de vloer. Ze staan stil en pulseren van kleur; ze draaiden
 * eerst allemaal mee, en dan trekt een vloer met drie storingen meer aandacht
 * dan de storingen zelf.
 */
function AlertRings({ points }: { points: { x: number; y: number; z: number }[] }): JSX.Element | null {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const n = points.length;
  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    points.forEach((p, i) => {
      _g.position.set(p.x, p.y + 0.02, p.z);
      _g.rotation.set(FLAT, 0, 0);
      _g.scale.setScalar(1.55);
      _g.updateMatrix();
      im.setMatrixAt(i, _g.matrix);
      im.setColorAt(i, _col.set('#ff6b6b'));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [points]);
  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im || n === 0) return;
    const k = 0.7 + Math.sin(clock.elapsedTime * 3.2) * 0.45;
    _col.set('#ff6b6b').multiplyScalar(k);
    for (let i = 0; i < n; i += 1) im.setColorAt(i, _col);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  if (n === 0) return null;
  return <instancedMesh ref={mesh} args={[G_RING, MAT_GLOW_FLAT, n]} frustumCulled={false} />;
}

/* =========================== werk in beweging =========================== */

/**
 * Wat er in deze tak gebeurt, als beweging.
 *
 * Elk kantoor toonde dezelfde twaalf bureaus met dezelfde schermen; het vak
 * zat in één prop in de hoek en verder nergens. Hier loopt het werk zelf over
 * de vloer: per werkplek die aan het werk is gaat er iets van het bureau naar
 * het punt waar het vak samenkomt — de koersenwand, de kluis, de kaarttafel,
 * het werkvak, de cabine, het podium, de researchwand.
 *
 * Alles hangt aan echte status, niets speelt door:
 *   working → er gaat iets heen en weer
 *   alert   → het blijft halverwege steken en pulseert rood
 *   done    → het ligt stil op het eindpunt
 *   idle    → er is niets te zien
 * Een vloer waar niets beweegt is dus een vloer waar niets gebeurt, en dat is
 * precies wat je wil kunnen zien.
 */
interface CarrierSpec {
  geo: THREE.BufferGeometry;
  size: [number, number, number];
  color: string;
  /** Hoe hoog het werk boven de vloer komt: over de grond of door de lucht. */
  hop: number;
  spin: number;
  speed: number;
}

const CARRIERS: Record<OfficeKind, CarrierSpec> = {
  // Een order is een briefje dat naar het bord gaat.
  trading: { geo: G_BOX, size: [0.5, 0.03, 0.34], color: '#ffd75e', hop: 1.7, spin: 0.6, speed: 0.26 },
  // Een munt gaat de kluis in, en de kluis is het middelpunt van de vloer.
  crypto: { geo: G_HEX, size: [0.34, 0.07, 0.34], color: '#f7931a', hop: 2.1, spin: 3.4, speed: 0.22 },
  // Een these is papier: laag, traag, en het blijft liggen waar het aankomt.
  equities: { geo: G_BOX, size: [0.46, 0.04, 0.34], color: '#e8dfc4', hop: 0.8, spin: 0.2, speed: 0.12 },
  // Een rit rijdt over de vloer naar de kaarttafel; die vliegt niet.
  tms: { geo: G_BOX, size: [0.42, 0.2, 0.26], color: '#ff6b5e', hop: 0.12, spin: 0, speed: 0.2 },
  // Een onderdeel gaat over de hal naar het werkvak.
  fleet: { geo: G_BOX, size: [0.42, 0.28, 0.42], color: '#c9a227', hop: 0.14, spin: 0, speed: 0.17 },
  design: { geo: G_BOX, size: [0.6, 0.03, 0.44], color: '#ff9b7a', hop: 1.2, spin: 1.1, speed: 0.19 },
  studio: { geo: G_BOX, size: [0.32, 0.22, 0.32], color: '#ffd9a8', hop: 0.9, spin: 0.8, speed: 0.21 },
  music: { geo: G_CYL, size: [0.36, 0.05, 0.36], color: '#d7a7ff', hop: 1.5, spin: 2.6, speed: 0.24 },
  generic: { geo: G_BOX, size: [0.36, 0.24, 0.3], color: '#c9c0ef', hop: 0.7, spin: 0.5, speed: 0.18 },
};

function WorkFlow({
  layout,
  stations,
}: {
  layout: OfficeLayout;
  stations: Station[];
}): JSX.Element | null {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const spec = CARRIERS[layout.kind] ?? CARRIERS.generic;
  const flights = useMemo(() => {
    const target = layout.focus ?? { x: layout.dress.x, z: layout.dress.z };
    return stations
      .map((st, i) => ({ st, slot: layout.desks[i] }))
      .filter((e) => e.slot && e.st.status !== 'idle')
      .map((e) => {
        const slot = e.slot!;
        // Elke werkplek loopt op zijn eigen tempo, maar wel altijd hetzelfde
        // tempo: de fase komt uit het id van de werkplek.
        const h = stableHash(e.st.id);
        return {
          status: e.st.status,
          x0: slot.x,
          y0: slot.y + 0.9,
          z0: slot.z,
          x1: target.x,
          y1: 0.9,
          z1: target.z,
          phase: (h % 1000) / 1000,
          rate: spec.speed * (0.8 + ((h >> 10) % 100) / 250),
        };
      });
  }, [stations, layout, spec.speed]);

  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    flights.forEach((_, i) => im.setColorAt(i, _col.set(spec.color)));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [flights, spec.color]);

  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im) return;
    const now = clock.elapsedTime;
    for (let i = 0; i < flights.length; i += 1) {
      const f = flights[i]!;
      let t: number;
      if (f.status === 'done') t = 1;
      else if (f.status === 'alert') t = 0.45 + Math.sin(now * 4) * 0.015;
      else {
        const raw = (now * f.rate + f.phase) % 2;
        t = raw <= 1 ? raw : 2 - raw;
      }
      const arc = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      _g.position.set(
        f.x0 + (f.x1 - f.x0) * t,
        f.y0 + (f.y1 - f.y0) * t + arc * spec.hop,
        f.z0 + (f.z1 - f.z0) * t,
      );
      _g.rotation.set(0, now * spec.spin + f.phase * 6, f.status === 'alert' ? 0.4 : 0);
      _g.scale.set(spec.size[0], spec.size[1], spec.size[2]);
      _g.updateMatrix();
      im.setMatrixAt(i, _g.matrix);
      if (f.status === 'alert') {
        im.setColorAt(i, _col.set('#ff6b6b').multiplyScalar(0.7 + Math.sin(now * 5) * 0.5));
      }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  if (flights.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[spec.geo, MAT_GLOW, flights.length]}
      frustumCulled={false}
    />
  );
}

/* ============================== de keten =============================== */

/** Waar iemand van de staf staat en hoe hoog hij staat. */
interface Seat {
  member: StaffMember;
  tier: StaffTier;
  x: number;
  y: number;
  z: number;
  /** Hoogte van de sokkel onder deze plek; 0 = gewoon op de vloer. */
  rise: number;
  radius: number;
  scale: number;
  /** Vast naamplaatje (de keten zelf) of alleen bij aanwijzen (de rollen). */
  named: boolean;
  /** Rij in het rollenveld; bepaalt hoe hoog het naamplaatje hangt. */
  row: number;
}

const TIER_ORDER: Record<StaffTier, number> = {
  chief: 0,
  supervisor: 1,
  manager: 2,
  ops: 2,
  specialist: 3,
  floor: 3,
};

/** Terugval als de collector nog geen `tier` meestuurt. */
function tierOf(m: StaffMember): StaffTier {
  if (m.tier) return m.tier;
  if (m.id === 'chief') return 'chief';
  if (m.role === 'manager') return 'manager';
  if (m.role === 'ops') return 'ops';
  return m.agent ? 'specialist' : 'floor';
}

/**
 * De keten uitzetten op de commandostrook.
 *
 * Chief, supervisor en manager staan op één lijn langs de strook en zakken
 * daarbij trapsgewijs: het hoogste sokkeltje hoort bij het laagste `depth`.
 * Ops staat ernaast in plaats van eronder, en verschijnt alleen als hij er
 * echt is. De vaste rollen liggen in een veld rechts van de manager, in de
 * volgorde van het playbook — wie leeg is verhuist niet naar achteren, want
 * dan zou de bezetting de plattegrond verbouwen.
 */
function seatStaff(staff: StaffMember[], lead: LeadBand): Seat[] {
  const by = (t: StaffTier): StaffMember | undefined => staff.find((m) => tierOf(m) === t);
  const chief = by('chief');
  const supervisor = by('supervisor');
  const manager = by('manager');
  const ops = by('ops');
  const rest = staff.filter((m) => TIER_ORDER[tierOf(m)] === 3).slice(0, 24);

  // Eerst uitrekenen hoe breed de club werkelijk is, dan pas plaatsen: de
  // strook wordt om de keten heen gelegd in plaats van andersom.
  const rows = rest.length <= 5 ? 1 : rest.length <= 12 ? 2 : 3;
  const cols = Math.max(1, Math.ceil(rest.length / rows));
  const room = Math.max(6, lead.x1 - lead.x0);
  const headW = 8.2;
  const pitchX = Math.min(3.0, Math.max(2.0, (room - headW - 1.2) / cols));
  const pitchZ = Math.min(2.0, (lead.d - 1.4) / rows);
  const used = headW + (rest.length > 0 ? 1.2 + cols * pitchX : 0);
  const start = Math.min(
    Math.max(lead.x0, (lead.x0 + lead.x1) / 2 - used / 2),
    Math.max(lead.x0, lead.x1 - used),
  );

  const seats: Seat[] = [];
  const zMain = lead.z + 0.7;
  const chain: [StaffMember | undefined, number, number][] = [
    [chief, 1.4, 1.0],
    [supervisor, 4.1, 0.66],
    [manager, 6.8, 0.32],
  ];
  chain.forEach(([m, dx, rise]) => {
    if (!m) return;
    seats.push({
      member: m,
      tier: tierOf(m),
      x: start + dx,
      y: lead.y + rise,
      z: zMain,
      rise,
      radius: 1.05,
      scale: 1.15,
      named: true,
      row: 0,
    });
  });
  if (ops) {
    seats.push({
      member: ops,
      tier: 'ops',
      x: start + 4.1,
      y: lead.y + 0.32,
      z: lead.z - lead.d / 2 + 1.3,
      rise: 0.32,
      radius: 0.95,
      scale: 1.05,
      named: true,
      row: 0,
    });
  }

  const fieldX0 = start + headW + 1.2;
  rest.forEach((m, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    seats.push({
      member: m,
      tier: tierOf(m),
      x: fieldX0 + (c + 0.5) * pitchX,
      y: lead.y,
      z: lead.z + lead.d / 2 - 1.1 - r * pitchZ,
      rise: 0,
      radius: Math.min(0.66, pitchX / 2 - 0.25),
      scale: 0.85,
      named: false,
      row: r,
    });
  });
  return seats;
}

/** Het vlak dat de keten beslaat — uit de stoelen, niet uit de strook. */
function chainArea(seats: Seat[], lead: LeadBand): { x: number; z: number; w: number; d: number } {
  if (seats.length === 0) return { x: (lead.x0 + lead.x1) / 2, z: lead.z, w: 4, d: lead.d };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of seats) {
    minX = Math.min(minX, s.x - s.radius);
    maxX = Math.max(maxX, s.x + s.radius);
    minZ = Math.min(minZ, s.z - s.radius);
    maxZ = Math.max(maxZ, s.z + s.radius);
  }
  const pad = 1.0;
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    w: maxX - minX + pad * 2,
    d: maxZ - minZ + pad * 2,
  };
}

const TIER_COLOR: Record<StaffTier, string> = {
  chief: '#ffd75e',
  supervisor: '#8ab4ff',
  manager: '#c9a7ff',
  ops: '#ff9b7a',
  specialist: '#9ad6c0',
  floor: '#d6cdf5',
};

/**
 * De vloer onder de keten: sokkels, pads en de lijnen van `reportsTo`. De
 * lijnen worden gelopen via het id van de baas, niet via de volgorde van de
 * lijst — die volgorde is geen belofte en een verkeerde baas is erger dan geen.
 */
function ChainFloor({
  seats,
  area,
  y,
  floor,
  accent,
  selectedId,
  onSelect,
  onHover,
}: {
  seats: Seat[];
  area: { x: number; z: number; w: number; d: number };
  y: number;
  floor: string;
  accent: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (i: number | null) => void;
}): JSX.Element | null {
  const pads = useMemo<Brick[]>(
    () =>
      seats.map((s) => ({
        x: s.x,
        y: s.y + 0.14 - (s.rise > 0 ? s.rise / 2 : 0) + (s.rise > 0 ? 0 : 0.03),
        z: s.z,
        w: s.radius * 2,
        h: s.rise > 0 ? s.rise : 0.06,
        d: s.radius * 2,
        color:
          selectedId === s.member.id
            ? '#ffd75e'
            : s.member.live === false
              ? '#514a7e'
              : TIER_COLOR[s.tier],
      })),
    [seats, selectedId],
  );
  // Een vaste rol zonder bezetting krijgt een rand in plaats van een vlak:
  // een open cirkel leest als "gereserveerd", een dicht vlak als "bezet".
  const vacancies = useMemo(
    () => seats.filter((s) => s.member.live === false),
    [seats],
  );
  const lines = useMemo<Brick[]>(() => {
    const at = new Map(seats.map((s) => [s.member.id, s]));
    const out: Brick[] = [];
    for (const s of seats) {
      const bossId = s.member.reportsTo;
      const boss = bossId ? at.get(bossId) : undefined;
      if (!boss) continue;
      const dx = s.x - boss.x;
      const dz = s.z - boss.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      out.push({
        x: (s.x + boss.x) / 2,
        y: Math.min(s.y, boss.y) + 0.16,
        z: (s.z + boss.z) / 2,
        w: len,
        h: 0.02,
        d: TIER_ORDER[s.tier] <= 2 ? 0.16 : 0.07,
        ry: Math.atan2(-dz, dx),
        color: TIER_ORDER[s.tier] <= 2 ? accent : '#6f66a8',
      });
    }
    return out;
  }, [seats, accent]);

  // Een verhoging onder de hele keten. Zonder die tree staan er wat schijfjes
  // op een lege vloer; met de tree is het een plek waar iemand staat.
  const deck = useMemo(
    () => new THREE.Color(floor).lerp(new THREE.Color('#ffffff'), 0.12).getStyle(),
    [floor],
  );

  if (seats.length === 0) return null;
  return (
    <group>
      <mesh position={[area.x, y + 0.07, area.z]} receiveShadow castShadow>
        <boxGeometry args={[area.w, 0.14, area.d]} />
        <meshStandardMaterial color={deck} roughness={0.9} />
      </mesh>
      <Bricks bricks={lines} material={MAT_GLOW_FLAT} />
      <instancedMesh
        args={[G_CYL, MAT_SOLID, pads.length]}
        frustumCulled={false}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          const i = e.instanceId;
          if (i !== undefined && seats[i]) onSelect(seats[i]!.member.id);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          onHover(e.instanceId ?? null);
        }}
        onPointerOut={() => onHover(null)}
        ref={(im) => {
          if (!im) return;
          pads.forEach((b, i) => {
            _g.position.set(b.x, b.y, b.z);
            _g.rotation.set(0, 0, 0);
            _g.scale.set(b.w, b.h, b.d);
            _g.updateMatrix();
            im.setMatrixAt(i, _g.matrix);
            im.setColorAt(i, _col.set(b.color));
          });
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.computeBoundingSphere();
        }}
      />
      <Bricks
        bricks={vacancies.map((s) => ({
          x: s.x,
          y: s.y + 0.22 + (s.rise > 0 ? s.rise : 0),
          z: s.z,
          w: s.radius * 2.1,
          h: 0.02,
          d: s.radius * 2.1,
          color: '#b3a9ef',
        }))}
        geometry={G_RING}
        material={MAT_GLOW_FLAT}
      />
    </group>
  );
}

/* ================================ de zones ================================ */

/**
 * De zonemarkering: een rand op de vloer, een paaltje op de camerahoek en een
 * bordje met twee regels. De tweede regel wordt niet verzonnen — hij telt wat
 * er in dat gebied staat (werkplekken en hun alarmen), leest de bezetting van
 * de keten, of neemt de status van de overlegruimte over. Het woord voor de
 * werkplekken komt uit `officeSpec` van de tak zelf.
 */
function ZoneMarks({
  zones,
  subOf,
}: {
  zones: Zone[];
  subOf: (zone: Zone) => string;
}): JSX.Element {
  // De randen: vier dunne strepen per gebied. Een gevuld vlak zou het
  // vloerwerk van de tak (banen, belijning, de pit) overschilderen.
  const edges = useMemo<Brick[]>(() => {
    const out: Brick[] = [];
    for (const z of zones) {
      // Een gebied dat helemaal binnen een ander valt (de binnenring van een
      // hoefijzer) krijgt geen eigen rand: twee geneste rechthoeken lezen als
      // ruis in plaats van als twee gebieden. Het bordje blijft wél staan.
      const nested = zones.some(
        (o) =>
          o !== z &&
          o.w * o.d > z.w * z.d &&
          Math.abs(o.x - z.x) + z.w / 2 <= o.w / 2 + 0.01 &&
          Math.abs(o.z - z.z) + z.d / 2 <= o.d / 2 + 0.01,
      );
      if (nested) continue;
      const t = 0.13;
      out.push({ x: z.x, y: z.y + 0.016, z: z.z - z.d / 2, w: z.w, h: 0.02, d: t, color: z.tone });
      out.push({ x: z.x, y: z.y + 0.016, z: z.z + z.d / 2, w: z.w, h: 0.02, d: t, color: z.tone });
      out.push({ x: z.x - z.w / 2, y: z.y + 0.016, z: z.z, w: t, h: 0.02, d: z.d, color: z.tone });
      out.push({ x: z.x + z.w / 2, y: z.y + 0.016, z: z.z, w: t, h: 0.02, d: z.d, color: z.tone });
    }
    return out;
  }, [zones]);

  const posts = useMemo<Brick[]>(
    () =>
      zones.map((z) => ({
        x: z.x + z.w / 2 - 0.35,
        y: z.y + 0.85,
        z: z.z + z.d / 2 - 0.35,
        w: 0.07,
        h: 1.7,
        d: 0.07,
        color: z.tone,
      })),
    [zones],
  );

  return (
    <group>
      <Bricks bricks={edges} material={MAT_GLOW_FLAT} />
      <Bricks bricks={posts} />
      {zones.map((z) => {
        const chip = chipTexture(z.label, subOf(z), z.tone);
        return (
          <sprite
            key={z.id}
            position={[z.x + z.w / 2 - 0.35, z.y + 1.95, z.z + z.d / 2 - 0.35]}
            scale={[1.5 * chip.aspect * 0.54, 0.54, 1]}
            renderOrder={9}
          >
            <spriteMaterial map={chip.texture} transparent opacity={0.92} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}

/* ============================== de schil =============================== */

/**
 * Eén wandvlak, opgebouwd in eigen assenstelsel (lengte over x, binnenkant naar
 * +z). Beide wanden delen dezelfde opbouw; alleen de plaatsing verschilt. Een
 * wand is een doos en geen vlak, want een dikte geeft een bovenrand en die
 * rand is precies wat een hoge hal hoog laat lijken.
 */
function WallFace({
  len,
  layout,
  tone,
  windows,
  door,
  panels,
  shelves,
}: {
  len: number;
  layout: OfficeLayout;
  tone: 'back' | 'side';
  windows: boolean;
  door: OfficeLayout['door'];
  panels: boolean;
  shelves?: boolean;
}): JSX.Element {
  const p = layout.palette;
  const color = tone === 'back' ? p.wall : p.wallSide;
  const h = layout.wallH;
  const sill = 1.5;
  const head = Math.min(5.2, h - 1.6);
  const mullions = Math.max(1, Math.round(len / 3.2) - 1);
  const pads = Math.max(2, Math.round(len / 1.9));

  // Boekenwand: kasten met planken, in één tekenoproep. Dit is wat een
  // leeszaal een leeszaal maakt en niet een zaal met een ander behang.
  const shelfBricks = useMemo<Brick[]>(() => {
    if (!shelves) return [];
    const out: Brick[] = [];
    // Alleen langs het deel van de wand waar gelezen wordt; over de volle
    // lengte werd het één bruine muur die de halve zaal afdekte.
    const run = len * 0.62;
    const off = -len / 2 + run / 2;
    const bays = Math.max(2, Math.floor(run / 3.0));
    const bw = run / bays;
    for (let i = 0; i < bays; i += 1) {
      const cx = off - run / 2 + (i + 0.5) * bw;
      out.push({ x: cx, y: 1.85, z: 0.42, w: bw - 0.2, h: 3.7, d: 0.75, color: p.wallSide });
      // De ruggen steken vóór de kast uit, anders vallen ze samen met het
      // front en zie je van bovenaf één vlak in plaats van planken.
      for (let r = 0; r < 4; r += 1) {
        out.push({
          x: cx,
          y: 0.55 + r * 0.9,
          z: 0.95,
          w: bw - 0.44,
          h: 0.58,
          d: 0.3,
          color: r % 2 ? '#e3d6b4' : '#bda87f',
        });
      }
    }
    return out;
  }, [shelves, len, p.trim]);

  return (
    <group>
      {windows ? (
        // Raamstrook: borstwering, glas, latei. Het glas is een vlak in
        // daglichtkleur — je kijkt in een atelier naar buiten, niet in een doos.
        <>
          <mesh position={[0, sill / 2, 0]} receiveShadow>
            <boxGeometry args={[len, sill, 0.35]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
          <mesh position={[0, (sill + head) / 2, 0.02]}>
            <boxGeometry args={[len, head - sill, 0.22]} />
            <meshBasicMaterial color="#cfe0f7" toneMapped={false} />
          </mesh>
          {Array.from({ length: mullions }, (_, i) => (
            <mesh key={i} position={[(-len / 2) + ((i + 1) * len) / (mullions + 1), (sill + head) / 2, 0.1]}>
              <boxGeometry args={[0.22, head - sill, 0.3]} />
              <meshStandardMaterial color={p.trim} roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, (sill + head) / 2, 0.1]}>
            <boxGeometry args={[len, 0.18, 0.3]} />
            <meshStandardMaterial color={p.trim} roughness={0.7} />
          </mesh>
          <mesh position={[0, (head + h) / 2, 0]} receiveShadow>
            <boxGeometry args={[len, h - head, 0.35]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, h / 2, 0]} receiveShadow>
          <boxGeometry args={[len, h, 0.35]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      )}

      {shelfBricks.length > 0 && <Bricks bricks={shelfBricks} cast />}

      {/* Rolpoort: het gat waar de trucks doorheen komen. Lamellen tot halve
          hoogte, want een dichte poort vertelt niets over wat erachter gebeurt. */}
      {door && (
        <group position={[door.x, 0, 0.2]}>
          {/* De opening zelf is donker (daarachter is buiten), de lamellen van
              de half opgerolde poort vangen het hallicht — zonder die lamellen
              is het een zwart gat in plaats van een deur. */}
          <mesh position={[0, door.h / 2, 0]}>
            <boxGeometry args={[door.w, door.h, 0.16]} />
            <meshStandardMaterial color="#232130" roughness={0.9} />
          </mesh>
          <Bricks
            bricks={Array.from({ length: 7 }, (_, i) => ({
              x: 0,
              y: door.h * (0.5 + i * 0.075),
              z: 0.1,
              w: door.w - 0.2,
              h: door.h * 0.06,
              d: 0.16,
              color: i % 2 ? p.plint : p.floor,
            }))}
          />
          <mesh position={[0, door.h + 0.35, 0.12]}>
            <boxGeometry args={[door.w + 0.7, 0.5, 0.3]} />
            <meshStandardMaterial color={p.mark} roughness={0.6} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[(s * (door.w + 0.5)) / 2, door.h / 2, 0.12]}>
              <boxGeometry args={[0.4, door.h, 0.3]} />
              <meshStandardMaterial color={p.trim} roughness={0.8} />
            </mesh>
          ))}
        </group>
      )}

      {/* Akoestische panelen: de reden dat een opnamestudio er gedempt uitziet. */}
      {panels && (
        <Bricks
          bricks={Array.from({ length: pads }, (_, i) => ({
            x: (-len / 2) + (len / pads) * (i + 0.5),
            y: h * 0.55,
            z: 0.22,
            w: len / pads - 0.28,
            h: h * 0.62,
            d: 0.16,
            color: i % 2 ? p.trim : p.wallSide,
          }))}
        />
      )}

      {/* Plint: een wand die zo in de vloer overloopt heeft geen bodem, en dan
          zweeft de hele ruimte. */}
      <mesh position={[0, 0.22, 0.24]}>
        <boxGeometry args={[len, 0.44, 0.14]} />
        <meshStandardMaterial color={p.plint} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Ruimte: vloer, vloerwerk, twee wanden, dak, licht en het overleghok. */
function Room({
  office,
  layout,
  accent,
  openBoard,
  onBoard,
}: {
  office: OfficeSnapshot;
  layout: OfficeLayout;
  accent: string;
  openBoard: 'head' | 'facts' | null;
  onBoard: (b: 'head' | 'facts' | null) => void;
}): JSX.Element {
  const { width, depth, wallH, palette: p } = layout;
  const backZ = -depth / 2;
  const head = useMemo(() => headlineTexture(office), [office]);
  const facts = useMemo(() => factsTexture(office), [office]);
  const room = useMemo(() => roomTexture(office), [office]);
  const closeChip = useMemo(() => chipTexture('Klik om te sluiten', '', accent), [accent]);

  // Elke trede iets lichter dan de vorige: zo lees je de tribune van bovenaf
  // als treden en niet als één blok.
  const stepColor = (i: number): string =>
    new THREE.Color(p.floor).lerp(new THREE.Color('#ffffff'), 0.085 * (i + 1)).getStyle();
  // De vloer van het overleghok: een lichtere vloer. De markeerkleur van een
  // tak kan knalgeel of oranje zijn — dat is belijning, geen tapijt.
  const meetingFloor = useMemo(
    () => new THREE.Color(p.floor).lerp(new THREE.Color('#ffffff'), 0.18).getStyle(),
    [p.floor],
  );

  /**
   * De urenband van de kluisvloer: 24 blokken, het blok van dit uur licht op.
   * Het uur komt uit de snapshot (`office.now`) — de klok van het kantoor, niet
   * die van de bezoeker, zodat twee mensen hetzelfde uur zien branden.
   */
  const hours = useMemo<Brick[]>(() => {
    if (layout.shell !== 'vault') return [];
    const hour = new Date(office.now).getHours();
    const span = width - 5;
    return Array.from({ length: 24 }, (_, i) => ({
      x: -span / 2 + ((i + 0.5) * span) / 24,
      y: wallH - 1.5,
      z: backZ + 0.45,
      w: span / 24 - 0.14,
      h: i === hour ? 0.62 : 0.34,
      d: 0.12,
      color: i === hour ? '#ffb020' : i % 6 === 0 ? '#6f66a8' : '#3c3569',
    }));
  }, [layout.shell, office.now, width, wallH, backZ]);

  /** Bollards rond de kern: je loopt er niet zomaar tegenaan. */
  const bollards = useMemo<Brick[]>(() => {
    if (layout.shell !== 'vault' || !layout.focus) return [];
    const out: Brick[] = [];
    const cx = layout.focus.x;
    const cz = layout.focus.z;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      out.push({
        x: cx + Math.cos(a) * 4.3,
        y: 0.45,
        z: cz + Math.sin(a) * 4.3,
        w: 0.22,
        h: 0.9,
        d: 0.22,
        color: p.mark,
      });
    }
    return out;
  }, [layout.shell, layout.focus, p.mark]);

  /** Theses aan de researchwand: vellen boven de carrels. */
  const sheets = useMemo<Brick[]>(() => {
    if (layout.shell !== 'research') return [];
    const out: Brick[] = [];
    const span = width - 8;
    const cols = 9;
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const seed = stableHash(`${office.project}|thesis|${r}|${c}`);
        out.push({
          x: layout.dress.x - span / 2 + ((c + 0.5) * span) / cols,
          y: 6.0 + r * 1.5,
          z: backZ + 0.42,
          w: span / cols - 0.5,
          h: 1.15,
          d: 0.05,
          color: seed % 5 === 0 ? '#e8dfc4' : seed % 3 === 0 ? '#cfc3a4' : '#ddd2b6',
        });
      }
    }
    return out;
  }, [layout.shell, layout.dress.x, width, backZ, office.project]);

  return (
    <group>
      {/* Vloer — altijd de lichtste waarde van de ruimte. */}
      <mesh rotation={[FLAT, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={p.floor} roughness={0.9} />
      </mesh>

      {/* Vloerwerk per tak: tapijtbanen, belijning, een pit of lichtvlekken. */}
      {layout.shell === 'open' &&
        layout.lamps.map((l, i) => (
          <mesh key={i} rotation={[FLAT, 0, 0]} position={[l.x, 0.012, l.z]} receiveShadow>
            <planeGeometry args={[l.len + 1.8, 2.5]} />
            <meshStandardMaterial color={p.mark} roughness={0.88} emissive={p.wall} emissiveIntensity={0.35} />
          </mesh>
        ))}

      {layout.shell === 'hal' && (
        <>
          {/* Werkvakbelijning: een werkplaats heeft vakken op de vloer staan. */}
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              rotation={[FLAT, 0, 0]}
              position={[layout.dress.x + s * 4, 0.014, layout.dress.z]}
            >
              <planeGeometry args={[0.22, 6.4]} />
              <meshStandardMaterial color={p.mark} roughness={0.7} emissive={p.mark} emissiveIntensity={0.25} />
            </mesh>
          ))}
          {/* Looppad langs de kantoorstrook — gele lijnen, zoals in elke hal. */}
          {[0, 1].map((i) => (
            <mesh
              key={i}
              rotation={[FLAT, 0, 0]}
              position={[width / 2 - 10.4 + i * 0.7, 0.014, -1]}
            >
              <planeGeometry args={[0.16, depth - 8]} />
              <meshStandardMaterial color={p.mark} roughness={0.7} emissive={p.mark} emissiveIntensity={0.25} />
            </mesh>
          ))}
        </>
      )}

      {/* De pit: het lichte vlak waar de bogen omheen staan. Hij blijft binnen
          de wanden — een vloervlak dat door een wand heen loopt verraadt dat de
          ruimte geen ruimte is. */}
      {layout.shell === 'controlroom' && layout.focus && (
        <mesh rotation={[FLAT, 0, 0]} position={[layout.focus.x, 0.012, layout.focus.z]} receiveShadow>
          <circleGeometry args={[layout.focus.r, 40]} />
          <meshStandardMaterial color={p.mark} roughness={0.9} />
        </mesh>
      )}

      {/* Leeszaal: één lange loper onder de carrels. */}
      {layout.shell === 'research' && (
        <mesh rotation={[FLAT, 0, 0]} position={[layout.dress.x, 0.012, backZ + 6.5]} receiveShadow>
          <planeGeometry args={[width - 7, 11]} />
          <meshStandardMaterial color={p.mark} roughness={0.98} />
        </mesh>
      )}

      {/* Kluisvloer: concentrische ringen om de kern, plus de kern zelf. */}
      {layout.shell === 'vault' && layout.focus && (
        <group position={[layout.focus.x, 0, layout.focus.z]}>
          <mesh rotation={[FLAT, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
            <circleGeometry args={[4.9, 44]} />
            <meshStandardMaterial color={p.floor} roughness={0.95} emissive={p.wall} emissiveIntensity={0.4} />
          </mesh>
          {[5.0, 6.6].map((r, i) => (
            <mesh key={r} rotation={[FLAT, 0, 0]} position={[0, 0.014, 0]} scale={r}>
              <primitive object={G_RING} attach="geometry" />
              <meshBasicMaterial color={p.mark} toneMapped={false} transparent opacity={i === 0 ? 0.8 : 0.4} />
            </mesh>
          ))}
          {/* De kluis: een zware zeshoek met een oplichtende naad. Laag genoeg
              om over de hoefijzerring heen te kijken. */}
          <mesh position={[0, 0.55, 0]} castShadow receiveShadow scale={[6.2, 1.1, 6.2]}>
            <primitive object={G_HEX} attach="geometry" />
            <meshStandardMaterial color={p.trim} roughness={0.7} metalness={0.25} />
          </mesh>
          <mesh position={[0, 1.15, 0]} scale={[5.4, 0.16, 5.4]}>
            <primitive object={G_HEX} attach="geometry" />
            <meshBasicMaterial color={p.mark} toneMapped={false} />
          </mesh>
          <mesh position={[0, 1.45, 0]} castShadow scale={[4.2, 0.5, 4.2]}>
            <primitive object={G_HEX} attach="geometry" />
            <meshStandardMaterial color={p.wallSide} roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, 1.78, 0]} scale={[1.5, 0.22, 1.5]}>
            <primitive object={G_CYL} attach="geometry" />
            <meshBasicMaterial color={accent} toneMapped={false} />
          </mesh>
          <pointLight position={[0, 2.6, 0]} color={p.mark} intensity={14} distance={12} />
        </group>
      )}
      {bollards.length > 0 && <Bricks bricks={bollards} cast />}
      {hours.length > 0 && <Bricks bricks={hours} material={MAT_GLOW} />}
      {sheets.length > 0 && <Bricks bricks={sheets} />}

      {layout.shell === 'atelier' &&
        ISLANDS.map(([ix, iz], i) => (
          <mesh key={i} rotation={[FLAT, 0, 0]} position={[ix, 0.012, iz]} receiveShadow>
            <planeGeometry args={[9, 4.4]} />
            <meshStandardMaterial color={p.mark} roughness={0.95} />
          </mesh>
        ))}

      {layout.shell === 'booth' && (
        <mesh rotation={[FLAT, 0, 0]} position={[0, 0.012, 0.4]} receiveShadow>
          <planeGeometry args={[width - 5, 9]} />
          <meshStandardMaterial color={p.mark} roughness={0.98} />
        </mesh>
      )}

      {layout.shell === 'venue' &&
        [-8.6, 0, 8.6].map((lx, i) => (
          <mesh key={i} rotation={[FLAT, 0, 0]} position={[lx, 0.012, -1.6]} receiveShadow>
            <circleGeometry args={[5, 28]} />
            <meshStandardMaterial color={p.mark} roughness={0.95} emissive={p.mark} emissiveIntensity={0.18} />
          </mesh>
        ))}

      {/* Tribune: elke trede loopt van zijn voorrand tot het einde van de zaal,
          met een lichte neus op de rand zodat de hoogteverschillen leesbaar zijn. */}
      {layout.steps.map((s, i) => (
        <group key={i}>
          <mesh position={[0, s.h / 2, (s.z + depth / 2) / 2]} receiveShadow castShadow>
            <boxGeometry args={[width, s.h, depth / 2 - s.z]} />
            <meshStandardMaterial color={stepColor(i)} roughness={0.9} />
          </mesh>
          {/* Tredeneus: een randje, geen lichtbalk. Oplichtende neuzen werden
              zes witte strepen over de zaal en die trokken meer aandacht dan de
              handelaars erachter. */}
          <mesh position={[0, s.h - 0.02, s.z + 0.08]}>
            <boxGeometry args={[width, 0.06, 0.16]} />
            <meshStandardMaterial color={p.plint} roughness={0.7} />
          </mesh>
        </group>
      ))}

      {/* Verhoging achterin: van daaraf kijk je over de bogen heen. */}
      {layout.podium && (
        <group>
          <mesh
            position={[0, layout.podium.h / 2, (layout.podium.z + depth / 2) / 2]}
            receiveShadow
            castShadow
          >
            <boxGeometry args={[width, layout.podium.h, depth / 2 - layout.podium.z]} />
            <meshStandardMaterial color={stepColor(0)} roughness={0.9} />
          </mesh>
          <mesh position={[0, layout.podium.h - 0.02, layout.podium.z + 0.08]}>
            <boxGeometry args={[width, 0.06, 0.16]} />
            <meshStandardMaterial color={p.plint} roughness={0.7} />
          </mesh>
        </group>
      )}

      {/* Wanden. */}
      <group position={[0, 0, backZ - 0.175]}>
        <WallFace
          len={width}
          layout={layout}
          tone="back"
          windows={layout.shell === 'atelier'}
          door={layout.door}
          panels={layout.shell === 'booth'}
        />
      </group>
      <group position={[-width / 2 + 0.175, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WallFace
          len={depth}
          layout={layout}
          tone="side"
          windows={layout.shell === 'atelier'}
          door={null}
          panels={layout.shell === 'booth'}
          shelves={layout.shell === 'research'}
        />
      </group>

      {/* Spanten: een hal en een zaal zijn hoog omdat je de constructie ziet. */}
      {(layout.shell === 'hal' || layout.shell === 'venue') && (
        <Bricks
          bricks={[
            ...[-depth / 4, depth / 6].map((tz) => ({
              x: 0,
              y: wallH - 1.6,
              z: tz,
              w: width * 0.8,
              h: 0.14,
              d: 0.2,
              color: p.plint,
            })),
            ...(layout.shell === 'hal'
              ? [-width / 4, width / 4].map((tx) => ({
                  x: tx,
                  y: wallH - 1.85,
                  z: -depth / 8,
                  w: 0.16,
                  h: 0.12,
                  d: depth * 0.72,
                  color: p.plint,
                }))
              : []),
            ...(layout.shell === 'hal'
              ? [-width / 2 + 2, width / 2 - 2].map((cx) => ({
                  x: cx,
                  y: wallH / 2,
                  z: backZ + 0.6,
                  w: 0.55,
                  h: wallH,
                  d: 0.55,
                  color: p.trim,
                }))
              : []),
          ]}
          cast
        />
      )}

      {/* Baffles boven de regie — niet over de hele zaal. Een veld van bar na
          bar dekte onder deze camera de halve ruimte af; boven de console
          alleen zegt hetzelfde (laag, gedempt) zonder iets te verbergen. */}
      {layout.shell === 'booth' && (
        <Bricks
          bricks={Array.from({ length: 5 }, (_, i) => ({
            x: -1,
            y: wallH - 0.35,
            z: -3.6 + i * 2.2,
            w: width - 7,
            h: 0.22,
            d: 0.2,
            color: p.mark,
          }))}
        />
      )}

      {/* Armaturen. */}
      {layout.lamps.map((l, i) => (
        <group key={i} position={[l.x, l.y, l.z]}>
          <mesh>
            <boxGeometry args={l.axis === 'x' ? [l.len, 0.06, 0.13] : [0.13, 0.06, l.len]} />
            <meshBasicMaterial color={p.lamp} toneMapped={false} />
          </mesh>
          <pointLight
            position={[0, -0.25, 0]}
            color={p.lamp}
            intensity={l.power}
            distance={Math.max(12, l.len)}
          />
        </group>
      ))}

      {/* Muurschermen: het grote hoofdscherm en het feitenpaneel. Deze twee
          dragen de kop met ≈ als de cijfers ingevuld zijn; ze schalen mee met de
          wandhoogte maar worden nooit kleiner dan leesbaar. */}
      {/* Deze twee borden zijn de grootste vlakken in de ruimte en ze zien
          eruit als knoppen. Ze zijn het nu ook: aanklikken zet het bord groot
          en leesbaar midden in de zaal, nog een keer klikken vouwt het terug.
          Op de wand is de tekst bij deze camerastand niet te lezen — een bord
          dat je moet inzoomen om te lezen is geen bord. */}
      <group
        onClick={(e) => {
          e.stopPropagation();
          onBoard(openBoard === 'head' ? null : 'head');
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <mesh position={[layout.screen.x, layout.screen.y, backZ + 0.36]}>
          <planeGeometry args={[layout.screen.w + 0.4, layout.screen.w * HEAD_RATIO + 0.4]} />
          <meshBasicMaterial color={accent} toneMapped={false} transparent opacity={openBoard === 'head' ? 0.75 : 0.28} />
        </mesh>
        <mesh position={[layout.screen.x, layout.screen.y, backZ + 0.42]}>
          <planeGeometry args={[layout.screen.w, layout.screen.w * HEAD_RATIO]} />
          <meshBasicMaterial map={head.texture} transparent toneMapped={false} />
        </mesh>
      </group>
      <group
        onClick={(e) => {
          e.stopPropagation();
          onBoard(openBoard === 'facts' ? null : 'facts');
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <mesh position={[layout.screen.factsX, layout.screen.factsY, backZ + 0.36]}>
          <planeGeometry args={[layout.screen.factsW + 0.35, layout.screen.factsW * FACTS_RATIO + 0.35]} />
          <meshBasicMaterial color={accent} toneMapped={false} transparent opacity={openBoard === 'facts' ? 0.75 : 0.28} />
        </mesh>
        <mesh position={[layout.screen.factsX, layout.screen.factsY, backZ + 0.42]}>
          <planeGeometry args={[layout.screen.factsW, layout.screen.factsW * FACTS_RATIO]} />
          <meshBasicMaterial map={facts.texture} transparent toneMapped={false} />
        </mesh>
      </group>

      {/* Overleghok, in de achterhoek. Glas op de twee camerazijden, dichte
          panelen op de andere twee: zo staat het in elk vloerplan overeind. */}
      <group position={[layout.meeting.x, layout.meeting.y, layout.meeting.z]}>
        <mesh position={[0, 0.03, 0]} rotation={[FLAT, 0, 0]} receiveShadow>
          <planeGeometry args={[layout.meeting.w, layout.meeting.d]} />
          <meshStandardMaterial color={meetingFloor} roughness={0.8} />
        </mesh>
        <mesh position={[layout.meeting.w / 2, layout.meeting.h / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[layout.meeting.d, layout.meeting.h]} />
          <meshPhysicalMaterial color="#9fd8ff" transparent opacity={0.13} roughness={0.05} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, layout.meeting.h / 2, layout.meeting.d / 2]}>
          <planeGeometry args={[layout.meeting.w, layout.meeting.h]} />
          <meshPhysicalMaterial color="#9fd8ff" transparent opacity={0.11} roughness={0.05} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[-layout.meeting.w / 2, layout.meeting.h / 2 + 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[layout.meeting.d, layout.meeting.h + 0.1, 0.16]} />
          <meshStandardMaterial color={p.wallSide} roughness={0.95} />
        </mesh>
        <mesh position={[0, layout.meeting.h / 2 + 0.05, -layout.meeting.d / 2]}>
          <boxGeometry args={[layout.meeting.w, layout.meeting.h + 0.1, 0.16]} />
          <meshStandardMaterial color={p.wallSide} roughness={0.95} />
        </mesh>
        <mesh position={[0, layout.meeting.h * 0.66, -layout.meeting.d / 2 + 0.12]}>
          <planeGeometry args={[layout.meeting.w - 1.1, (layout.meeting.w - 1.1) * 0.62]} />
          <meshBasicMaterial map={room.texture} transparent toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.64, 0]} castShadow>
          <cylinderGeometry args={[1.05, 1.05, 0.1, 20]} />
          <meshStandardMaterial color={p.desk} roughness={0.6} />
        </mesh>
      </group>

      {openBoard && (
        <group
          position={[0, wallH * 0.78, -depth / 6]}
          onClick={(e) => {
            e.stopPropagation();
            onBoard(null);
          }}
        >
          <mesh position={[0, 0, -0.06]}>
            <planeGeometry
              args={
                openBoard === 'head'
                  ? [width * 0.82 + 0.6, width * 0.82 * HEAD_RATIO + 0.6]
                  : [width * 0.5 + 0.5, width * 0.5 * FACTS_RATIO + 0.5]
              }
            />
            <meshBasicMaterial color="#120c26" toneMapped={false} transparent opacity={0.94} />
          </mesh>
          <mesh>
            <planeGeometry
              args={
                openBoard === 'head'
                  ? [width * 0.82, width * 0.82 * HEAD_RATIO]
                  : [width * 0.5, width * 0.5 * FACTS_RATIO]
              }
            />
            <meshBasicMaterial
              map={openBoard === 'head' ? head.texture : facts.texture}
              transparent
              toneMapped={false}
            />
          </mesh>
          {/* Een paneel dat over de zaal heen valt moet zelf zeggen hoe je het
              weer weg krijgt; anders is de enige uitweg raden. */}
          <sprite
            position={[
              0,
              -(openBoard === 'head' ? width * 0.82 * HEAD_RATIO : width * 0.5 * FACTS_RATIO) / 2 - 0.7,
              0.1,
            ]}
            scale={[1.5 * closeChip.aspect * 0.42, 0.42, 1]}
            renderOrder={13}
          >
            <spriteMaterial map={closeChip.texture} transparent depthWrite={false} depthTest={false} />
          </sprite>
        </group>
      )}
    </group>
  );
}

/* ============================== het geheel =============================== */

/**
 * Hoe groot de ruimte getekend wordt.
 *
 * De camera in OfficeOverlay staat vast (orthografisch, zoom 30) en het doek
 * verschilt enorm: op een laptop is het ruim duizend pixels breed, op een
 * telefoon een strook van 390×355. Met een vaste schaal zag je op de telefoon
 * een achtste van het kantoor en moest je gaan slepen om te ontdekken dat er
 * een keten en een overleghok bestonden.
 *
 * Dus rekent het vloerplan zelf uit hoe groot het mag zijn. Onder deze
 * camerahoek (45° om, 36,6° omhoog) beslaat een vloer van w×d op het scherm
 * ongeveer 0,707·(w+d) breed en 0,421·(w+d) + 0,8·h hoog; daar past de schaal
 * zich op aan. Op een laptop levert dat vrijwel dezelfde uitsnede als eerst,
 * op een telefoon een heel kantoor in plaats van een hoek ervan.
 */
const FIT_SPREAD_X = 0.707;
const FIT_SPREAD_Z = 0.421;
const FIT_SPREAD_Y = 0.8;
/** De zoom waarmee OfficeOverlay zijn camera opzet. */
const CAMERA_ZOOM = 30;

function fitScale(size: { width: number; height: number }, w: number, d: number, h: number): number {
  const spanX = FIT_SPREAD_X * (w + d);
  const spanY = FIT_SPREAD_Z * (w + d) + FIT_SPREAD_Y * h;
  if (size.width < 1 || size.height < 1) return 1;
  const sx = size.width / CAMERA_ZOOM / spanX;
  const sy = size.height / CAMERA_ZOOM / spanY;
  // 0.94 marge: een kantoor dat exact het doek raakt ziet eruit alsof het
  // afgesneden is. Niet groter dan 1 — uitvergroten hoort de gebruiker te doen.
  return Math.max(0.3, Math.min(1, Math.min(sx, sy) * 0.94));
}

export function OfficeScene({
  office,
  accent,
  selectedId,
  onSelect,
}: {
  office: OfficeSnapshot;
  accent: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const layout = useMemo(
    () => officeLayout(office.kind, office.stations.length),
    [office.kind, office.stations.length],
  );
  const { width, depth, palette } = layout;
  const [hoveredDesk, setHoveredDesk] = useState<number | null>(null);
  const [openBoard, setOpenBoard] = useState<'head' | 'facts' | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<number | null>(null);
  const spec = useMemo(() => officeSpec(office.kind), [office.kind]);

  const size = useThree((st) => st.size);
  const fit = useMemo(
    () => fitScale(size, width, depth, layout.wallH),
    [size, width, depth, layout.wallH],
  );

  /** Welke zone hoort bij welk bureau — puur uit de plek van het bureau. */
  const zoneTone = useMemo(() => {
    const work = layout.zones.filter((z) => z.reads === 'stations');
    return (slot: DeskSlot): string => {
      for (const z of work) {
        if (
          Math.abs(slot.x - z.x) <= z.w / 2 &&
          Math.abs(slot.z - z.z) <= z.d / 2
        )
          return z.tone;
      }
      return palette.desk;
    };
  }, [layout.zones, palette.desk]);

  const parts = useMemo(
    () => buildDeskParts(layout, office.stations, zoneTone),
    [layout, office.stations, zoneTone],
  );

  const seats = useMemo(() => seatStaff(office.staff, layout.lead), [office.staff, layout.lead]);
  const chain = useMemo(() => chainArea(seats, layout.lead), [seats, layout.lead]);
  // De ketenzone komt uit de stoelen die er staan; een strook op maat van het
  // vloerplan zou net zo goed leeg kunnen zijn.
  const zones = useMemo<Zone[]>(
    () => [
      ...layout.zones,
      {
        id: 'chain',
        label: 'KETEN',
        reads: 'chain',
        x: chain.x,
        y: layout.lead.y + 0.14,
        z: chain.z,
        w: chain.w,
        d: chain.d,
        tone: ZONE_TONE.chain,
      },
    ],
    [layout.zones, layout.lead.y, chain],
  );

  /** Alle poppetjes van het kantoor in één lijst: bureaus, overleg, keten. */
  const figures = useMemo<Figure[]>(() => {
    const out: Figure[] = [];
    office.stations.forEach((station, i) => {
      const slot = layout.desks[i] ?? { x: 0, y: 0, z: 0, yaw: 0, wall: false };
      const seed = (stableHash(station.id) % 997) / 997;
      // Niet elk bureau heeft iemand zitten; welk bureau leeg is hangt aan het
      // id van de werkplek, niet aan zijn plek in de rij.
      const manned = station.status !== 'idle' || stableHash(`${station.id}|seat`) % 5 !== 4;
      const seatZ = slot.wall ? 1.15 : -1.05;
      out.push({
        x: slot.x + Math.sin(slot.yaw) * seatZ,
        y: slot.y,
        z: slot.z + Math.cos(slot.yaw) * seatZ,
        yaw: slot.yaw + (slot.wall ? Math.PI : 0),
        color: accent,
        active: station.status === 'working',
        present: manned,
        seat: true,
        scale: 1.15,
        seed: seed * 6,
      });
    });
    const m = layout.meeting;
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      out.push({
        x: m.x + Math.cos(a) * 1.6,
        y: m.y,
        z: m.z + Math.sin(a) * 1.6,
        yaw: -a,
        color: i % 2 ? '#8ab4ff' : accent,
        active: i % 2 === 0,
        present: true,
        seat: true,
        scale: 1,
        seed: i * 3.1,
      });
    }
    for (const s of seats) {
      out.push({
        x: s.x,
        y: s.y + 0.14,
        z: s.z,
        // De keten kijkt de vloer in: dat is wat ze doen.
        yaw: Math.PI,
        color: s.tier === 'chief' ? '#ffd75e' : s.tier === 'floor' ? '#d6cdf5' : accent,
        active: Boolean(s.member.busyWith),
        present: s.member.live !== false,
        seat: TIER_ORDER[s.tier] === 3,
        scale: s.scale,
        seed: (stableHash(s.member.id) % 997) / 166,
      });
    }
    return out;
  }, [office.stations, layout, seats, accent]);

  const alerts = useMemo(
    () =>
      office.stations
        .map((s, i) => ({ s, slot: layout.desks[i] }))
        .filter((e) => e.s.status === 'alert' && e.slot)
        .map((e) => ({ x: e.slot!.x, y: e.slot!.y, z: e.slot!.z })),
    [office.stations, layout.desks],
  );

  /** Welke naamplaatjes er hangen: nooit allemaal tegelijk, dat werd een wolk. */
  const deskLabels = useMemo(() => {
    const idx = new Set<number>();
    office.stations.forEach((s, i) => {
      if (s.status === 'alert' || s.id === selectedId) idx.add(i);
    });
    if (hoveredDesk !== null) idx.add(hoveredDesk);
    return [...idx].filter((i) => office.stations[i] && layout.desks[i]);
  }, [office.stations, selectedId, hoveredDesk, layout.desks]);

  /**
   * De tweede regel op een zonebordje. Tellen, niet invullen: de werkplekken
   * die werkelijk binnen het gebied staan, de bezetting van de keten zoals
   * `live` hem geeft, en de status die de overlegruimte zelf meldt.
   */
  const zoneSub = useMemo(() => {
    const liveStaff = office.staff.filter((s) => s.live !== false).length;
    return (zone: Zone): string => {
      if (zone.reads === 'chain') return `${liveStaff}/${office.staff.length} bezet`;
      if (zone.reads === 'room') return office.room.status;
      let n = 0;
      let alert = 0;
      office.stations.forEach((st, i) => {
        const slot = layout.desks[i];
        if (!slot) return;
        if (Math.abs(slot.x - zone.x) > zone.w / 2 || Math.abs(slot.z - zone.z) > zone.d / 2) return;
        n += 1;
        if (st.status === 'alert') alert += 1;
      });
      const base = `${n} ${spec.entityWord}`;
      return alert > 0 ? `${base} · ${alert} alarm` : base;
    };
  }, [office.staff, office.stations, office.room.status, layout.desks, spec.entityWord]);

  return (
    <group scale={fit}>
      {/* Was paars getint (#c9bdff) en dat kleurde álles mee, ook de
          zandkleurige bureaus en de gele figuren. Neutraal-warm licht laat de
          accentkleur van de tak het werk doen in plaats van het te overstemmen. */}
      <ambientLight intensity={palette.ambient} color="#fff1e2" />
      <hemisphereLight args={['#dcd2ff', palette.floor, 0.85]} />
      <directionalLight
        position={[10, 16, 8]}
        intensity={1.5}
        color="#fff2e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <pointLight position={[0, 7, -depth / 2 + 3]} color={accent} intensity={26} distance={30} />
      {/* Daglicht valt in een atelier van buiten naar binnen, niet van het
          plafond: twee vullingen net binnen de raamstroken. */}
      {layout.shell === 'atelier' && (
        <>
          <pointLight position={[0, 4.5, -depth / 2 + 1.5]} color="#e8f1ff" intensity={22} distance={26} />
          <pointLight position={[-width / 2 + 1.5, 4.5, 0]} color="#e8f1ff" intensity={22} distance={26} />
        </>
      )}
      {/* De commandostrook heeft zijn eigen licht: zonder dat verdwijnt de
          keten in de schaduw aan de rand van de zaal. */}
      <pointLight
        position={[(layout.lead.x0 + layout.lead.x1) / 2, layout.lead.y + 4.4, layout.lead.z]}
        color="#fff0d8"
        intensity={16}
        distance={26}
      />

      <Room
        office={office}
        layout={layout}
        accent={accent}
        openBoard={openBoard}
        onBoard={setOpenBoard}
      />
      {/* Het meubilair dat deze werkvloer tot díé werkvloer maakt. */}
      <Dressing office={office} accent={accent} layout={layout} />

      <ZoneMarks zones={zones} subOf={zoneSub} />

      {/* De bureaus: bladen, poten, kaders, standaards, toetsenborden en
          schotten — elk soort één tekenoproep voor de hele vloer. Het blad is
          ook het klikvlak; een los onzichtbaar vlak per bureau zou de winst
          weer opeten. */}
      <instancedMesh
        args={[G_BOX, MAT_SMOOTH, Math.max(1, parts.tops.length)]}
        frustumCulled={false}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          const i = e.instanceId;
          const st = i !== undefined ? office.stations[i] : undefined;
          if (st) onSelect(st.id);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          setHoveredDesk(e.instanceId ?? null);
        }}
        onPointerOut={() => setHoveredDesk(null)}
        ref={(im) => {
          if (!im) return;
          parts.tops.forEach((b, i) => {
            _g.position.set(b.x, b.y, b.z);
            _g.rotation.set(0, b.ry ?? 0, 0);
            _g.scale.set(b.w, b.h, b.d);
            _g.updateMatrix();
            im.setMatrixAt(i, _g.matrix);
            im.setColorAt(i, _col.set(b.color));
          });
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.computeBoundingSphere();
        }}
      />
      <Bricks bricks={parts.legs} geometry={G_CYL} />
      <Bricks bricks={parts.frames} material={MAT_SMOOTH} cast />
      <Bricks bricks={parts.stands} geometry={G_CYL} material={MAT_SMOOTH} />
      <Bricks bricks={parts.keys} />
      <Bricks bricks={parts.dividers} material={MAT_FADE} />
      <DeskScreens parts={parts} stations={office.stations} />
      <AlertRings points={alerts} />
      <WorkFlow layout={layout} stations={office.stations} />

      <ChainFloor
        seats={seats}
        area={chain}
        y={layout.lead.y}
        floor={palette.floor}
        accent={accent}
        selectedId={selectedId}
        onSelect={onSelect}
        onHover={setHoveredSeat}
      />

      <People figures={figures} />

      {/* Naamplaatjes. Twaalf bureaus met elk een permanent zwevend label werd
          één wolk waar niets meer uit te lezen viel — een kantoor vol post-its
          over elkaar heen. Nu alleen wat je nodig hebt: het bureau waar je
          overheen gaat, het bureau dat je koos, en alles wat om aandacht
          vraagt. De rest heeft zijn scherm en zijn kleur, en de volledige
          lijst staat rechts. */}
      {deskLabels.map((i) => {
        const st = office.stations[i]!;
        const slot = layout.desks[i]!;
        const mark = st.stale ? '!' : st.simulated ? '~' : '';
        const chip = chipTexture(st.label, st.sub, accent, mark);
        // Een echte werkplek zonder gemeten cijfer krijgt géén zwevend getal:
        // "+$0,00" boven een positie zonder pnl-kolom leest als winst nul.
        const showValue = !st.valueMissing;
        const text =
          office.valueKind === 'money'
            ? `${st.value >= 0 ? '+' : '-'}$${Math.abs(st.value).toFixed(2)}`
            : `${st.value >= 0 ? '+' : ''}${Math.round(st.value)}`;
        const value = valueTexture(text, st.value >= 0 ? 'good' : 'bad', st.simulated);
        return (
          <group key={st.id} position={[slot.x, slot.y, slot.z]}>
            <sprite position={[0, 1.95, 0]} scale={[1.45 * chip.aspect * 0.62, 0.62, 1]} renderOrder={10}>
              <spriteMaterial map={chip.texture} transparent depthWrite={false} depthTest={false} />
            </sprite>
            {showValue && (
              <sprite position={[1.2, 2.45, 0]} scale={[0.95, 0.28, 1]} renderOrder={10}>
                <spriteMaterial map={value.texture} transparent depthWrite={false} depthTest={false} />
              </sprite>
            )}
            {st.id === selectedId && (
              <mesh position={[0, 0.03, 0]} rotation={[FLAT, 0, 0]} scale={1.55}>
                <primitive object={G_RING} attach="geometry" />
                <meshBasicMaterial color="#ffd75e" transparent opacity={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Iedereen op de strook draagt zijn rol, altijd. Een kantoor met twaalf
          identieke poppetjes vertelt je niet wie de facturatie-controleur is
          en wie de keuringsbewaking; dat is precies wat je van een bezetting
          wil weten. De keten (chief, supervisor, manager, ops) krijgt een groot
          plaatje, de vaste rollen een klein naamplaatje — en wie je aanwijst of
          kiest krijgt de regel erbij die zegt waar die rol voor is (`does`). */}
      {seats.map((s, i) => {
        const focus = hoveredSeat === i || selectedId === s.member.id;
        const vacant = s.member.live === false;
        const line = focus ? (s.member.does ?? s.member.status) : s.named ? s.member.status : '';
        const chip = chipTexture(
          s.member.name,
          vacant && !focus ? 'vaste rol · leeg' : capLine(line),
          vacant ? '#8d85c9' : TIER_COLOR[s.tier],
        );
        // Een plaatje van 0,3 hoog is bij deze camerastand achttien pixels,
        // waarvan de rolnaam er zeven krijgt: je ziet dát er een bordje hangt en
        // niet wát erop staat. Dat is precies de klacht ("de namen van de agents
        // zijn onduidelijk wat diegene zijn functie is") — het bordje bestond
        // al, het was alleen niet te lezen. 0,46 maakt er achtentwintig pixels
        // van met elf voor de naam; met de rijverspringing hieronder
        // (`s.row * 0.52`) blijven ze elkaar nog steeds vrij houden.
        const h = focus ? 0.74 : s.named ? 0.62 : 0.46;
        return (
          <sprite
            key={s.member.id}
            position={[
              s.x,
              s.y + 0.14 + (focus ? 1.95 : s.named ? 1.85 : 1.18 + s.row * 0.52),
              s.z,
            ]}
            scale={[1.5 * chip.aspect * h, h, 1]}
            renderOrder={focus ? 12 : 11}
          >
            <spriteMaterial
              map={chip.texture}
              transparent
              opacity={vacant && !focus ? 0.7 : 1}
              depthWrite={false}
              depthTest={false}
            />
          </sprite>
        );
      })}

      {/* En aan de bureaus: wie daar zit. Het bordje op het bureau draagt de
          entiteit ("Truck 53"), niet de persoon — dus zonder dit zie je wel wat
          er behandeld wordt maar nooit door wie. Alleen werkplekken waar
          werkelijk een agent aan hangt krijgen er een; er wordt geen naam
          verzonnen voor een leeg bureau. */}
      {office.stations.map((st, i) => {
        const slot = layout.desks[i];
        if (!st.agentName || !slot) return null;
        // De agent-id ("ara-fleet-tech") zegt een ontwikkelaar iets; de eigenaar
        // wil weten wat die stoel dóét. De vaste rol uit het playbook draagt
        // die naam ("Wagenparkbeheer"), dus die komt eronder — en alleen als
        // hij er is: een losse worker krijgt geen functie toegedicht.
        const role = office.staff.find((m) => m.agent === st.agentName)?.name ?? '';
        const chip = chipTexture(st.agentName, role, accent);
        return (
          <sprite
            key={`who-${st.id}`}
            position={[slot.x, slot.y + 1.42, slot.z]}
            scale={[1.5 * chip.aspect * 0.4, 0.4, 1]}
            renderOrder={8}
          >
            <spriteMaterial map={chip.texture} transparent opacity={0.9} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}
