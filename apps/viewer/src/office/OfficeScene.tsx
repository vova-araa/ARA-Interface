import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Dressing } from './Dressing.tsx';
import type { OfficeKind, OfficeSnapshot, Station, StaffMember } from '@ara/shared';
import { chipTexture, valueTexture, headlineTexture, factsTexture, roomTexture } from './textures.ts';

/**
 * Het kantoor-interieur: werkplekken met schermen en werkende agents, de
 * muurschermen met de cijfers, een overlegruimte en de leiding.
 *
 * De inhoud (wélke werkplekken, wélke cijfers, wélke staf) komt uit
 * `buildOffice` in @ara/shared en wordt hier niet aangeraakt — collector en
 * viewer moeten daar exact hetzelfde uit halen. Wat hier gebeurt is het gebouw
 * eromheen.
 *
 * En dat gebouw verschilt per tak. Een werkplaats met een hefbrug in een
 * kantoortuin is geen werkplaats; die hoort een hoge hal te zijn met een
 * rolpoort en een betonvloer. Een handelsvloer loopt trapsgewijs af naar de
 * koersenwand, een atelier is licht en open, een opnamestudio laag en gedempt,
 * ritplanning is een controlekamer. Het vloerplan vertelt het vak nog voor je
 * een label gelezen hebt.
 */

const STATUS_COLOR: Record<Station['status'], string> = {
  working: '#6ee7ff',
  idle: '#6b6390',
  alert: '#ff6b6b',
  done: '#4ade80',
};

/* ========================= het recept van een ruimte ========================= */

/** Hoe de schil gebouwd is: wanden, dak en vloerwerk hangen hieraan. */
export type OfficeShell = 'open' | 'hal' | 'controlroom' | 'floor' | 'atelier' | 'booth' | 'venue';

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
  meeting: { x: number; y: number; z: number; w: number; d: number; h: number };
  manager: [number, number, number];
  chief: [number, number, number];
  /** Muurschermen: positie en maat hangen af van de wandhoogte. */
  screen: { x: number; y: number; w: number; factsX: number; factsY: number; factsW: number };
}

/** Verhouding van de canvas-textures; hardcoded maten zouden ze uitrekken. */
const HEAD_RATIO = 3.8 / 14;
const FACTS_RATIO = 3.6 / 6.2;

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
      out.push({ x: Math.sin(a) * ring.r, y: 0, z: fz + Math.cos(a) * ring.r, yaw: a, wall: true });
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
  [-3.6, 4.6, -0.12],
  [6.2, 2.4, 0.22],
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
    out.push({ x: (i - (front - 1) / 2) * 3.2, y: 0, z: 1.6, yaw: 0, wall: true });
  }
  for (let i = 0; i < back; i += 1) {
    out.push({ x: -3 + (i - (back - 1) / 2) * 3.2, y: 0, z: 4.9, yaw: 0, wall: true });
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

/** Kantoortuin: het vertrouwde rijenplan voor takken zonder eigen ruimte. */
function openPlan(total: number): OfficeLayout {
  const counts = splitRows(total, 6);
  const rows = counts.length;
  const width = 28;
  const depth = Math.max(16, rows * 3 + 11);
  const rowZ = (r: number): number => (r - (rows - 1) / 2) * 3;
  return {
    kind: 'generic',
    shell: 'open',
    width,
    depth,
    wallH: 10,
    palette: OPEN_PALETTE,
    desks: rowSlots(counts, 3.5, 3, 0),
    lamps: counts.map((_, r) => ({ x: 0, y: 4.6, z: rowZ(r), len: 19.4, axis: 'x' as const, power: 7 })),
    steps: [],
    podium: null,
    dividers: true,
    door: null,
    dress: { x: width / 2 - 7.8, z: -depth / 2 + 5.6 },
    meeting: { x: -width / 2 + 3.6, y: 0, z: -depth / 2 + depth * 0.62, w: 6.4, d: 5.6, h: 3.4 },
    manager: [width / 2 - 3.4, 0, depth / 2 - 3.2],
    chief: [-width / 2 + 3.4, 0, depth / 2 - 3.2],
    screen: { x: -0.6, y: 5.2, w: 14, factsX: width / 2 - 4.4, factsY: 4.9, factsW: 6.2 },
  };
}

/**
 * Handelsvloer: een tribune die naar de koersenwand afloopt. De rijen lopen
 * omhoog richting de camera — dat is niet alleen hoe een zaal werkt, het is ook
 * de enige richting die van bovenaf leesbaar blijft: in isometrie tekent verder
 * weg zich hoger, dus de lage rijen vooraan verdwijnen niet achter de hoge.
 */
function tradingFloor(kind: OfficeKind, total: number): OfficeLayout {
  const counts = splitRows(total, 6);
  const rows = counts.length;
  const dz = 3.3;
  const rise = 0.62;
  const z0 = 1.4;
  const width = 28;
  const depth = rows * dz + 10.5;
  const top = (rows - 1) * rise;
  const rowZ = (r: number): number => z0 + (r - (rows - 1) / 2) * dz;
  return {
    kind,
    shell: 'floor',
    width,
    depth,
    wallH: 11,
    palette: TRADE_PALETTE,
    desks: rowSlots(counts, 3.4, dz, z0, 1.6, rise, true),
    // Eén balk per twee rijen: boven een tribune met neuzen werden vier
    // evenwijdige strepen één streepjespatroon in plaats van verlichting.
    lamps: counts
      .map((_, r) => r)
      .filter((r) => r % 2 === 0)
      .map((r) => ({ x: 1.6, y: 7.2 + r * rise, z: rowZ(r) - 1.1, len: 17, axis: 'x' as const, power: 9 })),
    steps: counts.slice(1).map((_, i) => ({ z: rowZ(i + 1) - dz / 2 - 0.2, h: (i + 1) * rise })),
    podium: null,
    dividers: false,
    door: null,
    dress: { x: 1.6, z: -depth / 2 + 0.9 },
    meeting: { x: -width / 2 + 3.4, y: top, z: depth / 2 - 3.0, w: 5.8, d: 5.0, h: 3.4 },
    manager: [width / 2 - 3.6, top, depth / 2 - 2.6],
    chief: [width / 2 - 8.2, top, depth / 2 - 2.6],
    // Het feitenpaneel hangt rechts: links op de achterwand ligt in isometrie
    // het hoogste punt van het beeld, en daar valt het buiten de kadrering.
    screen: { x: 1.6, y: 8.5, w: 12.5, factsX: width / 2 - 3, factsY: 6.9, factsW: 5.4 },
  };
}

/** Controlekamer: twee bogen om de kaarttafel, leiding op een verhoging erachter. */
function controlRoom(total: number): OfficeLayout {
  const width = 25;
  const depth = 19;
  return {
    kind: 'tms',
    shell: 'controlroom',
    width,
    depth,
    wallH: 7,
    palette: TMS_PALETTE,
    desks: arcSlots(total, -7.6, [{ r: 7.6, cap: 5 }, { r: 11, cap: 7 }, { r: 14.2, cap: 9 }], 3.6),
    lamps: [
      { x: 0, y: 4.8, z: -4.4, len: 12, axis: 'x', power: 5 },
      { x: 0, y: 4.8, z: 0.4, len: 16, axis: 'x', power: 6 },
      { x: 0, y: 4.8, z: 6.2, len: 10, axis: 'x', power: 4 },
    ],
    steps: [],
    podium: { z: 4.6, h: 0.5 },
    dividers: false,
    door: null,
    dress: { x: 0, z: -depth / 2 + 3.6 },
    meeting: { x: -width / 2 + 3.4, y: 0.5, z: depth / 2 - 2.6, w: 5.6, d: 4.4, h: 3.4 },
    manager: [width / 2 - 4.5, 0.5, depth / 2 - 2.6],
    chief: [width / 2 - 9, 0.5, depth / 2 - 2.6],
    screen: { x: 0, y: 4.7, w: 12, factsX: width / 2 - 4, factsY: 4.5, factsW: 5 },
  };
}

/** Werkplaats: een hoge hal met rolpoort en betonvloer, kantoorstrook opzij. */
function workshop(total: number): OfficeLayout {
  const width = 30;
  const depth = 19;
  return {
    kind: 'fleet',
    shell: 'hal',
    width,
    depth,
    wallH: 11,
    palette: FLEET_PALETTE,
    desks: stripSlots(total, width / 2 - 4.6, 3.5, 3, 0),
    lamps: [
      { x: -7, y: 8.4, z: -5, len: 11, axis: 'x', power: 9 },
      { x: -7, y: 8.4, z: 3, len: 11, axis: 'x', power: 9 },
      { x: 9.2, y: 5.2, z: 0, len: 15, axis: 'z', power: 7 },
    ],
    steps: [],
    podium: null,
    dividers: true,
    door: { x: -6.5, w: 8.5, h: 5.6 },
    dress: { x: -6.5, z: -2 },
    meeting: { x: -width / 2 + 4, y: 0, z: depth / 2 - 3, w: 6, d: 5, h: 3.4 },
    manager: [1.6, 0, depth / 2 - 2.8],
    chief: [-2.8, 0, depth / 2 - 2.8],
    screen: { x: 4.6, y: 6.6, w: 11, factsX: -6.5, factsY: 7.8, factsW: 5 },
  };
}

/** Atelier: lage borstwering, brede raamstroken, eilanden in plaats van rijen. */
function atelier(total: number): OfficeLayout {
  const width = 28;
  const depth = 19;
  return {
    kind: 'design',
    shell: 'atelier',
    width,
    depth,
    wallH: 8.6,
    palette: DESIGN_PALETTE,
    desks: islandSlots(total),
    lamps: [
      { x: -4, y: 6.4, z: -2, len: 9, axis: 'x', power: 4 },
      { x: 4, y: 6.4, z: 4, len: 9, axis: 'x', power: 4 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: 9, z: -depth / 2 + 4.4 },
    meeting: { x: -width / 2 + 3.6, y: 0, z: depth / 2 - 3.2, w: 6, d: 5, h: 3.4 },
    manager: [width / 2 - 3.4, 0, depth / 2 - 2.6],
    chief: [width / 2 - 8.6, 0, depth / 2 - 2.6],
    screen: { x: -1, y: 6.9, w: 11, factsX: width / 2 - 4, factsY: 6.8, factsW: 5 },
  };
}

/** Opnamestudio: lage zaal, akoestische wanden, baffles vlak boven je hoofd. */
function studio(total: number): OfficeLayout {
  const width = 24;
  const depth = 18;
  return {
    kind: 'studio',
    shell: 'booth',
    width,
    depth,
    wallH: 5.4,
    palette: STUDIO_PALETTE,
    desks: consoleSlots(total),
    lamps: [
      { x: -4, y: 4.6, z: -1, len: 7, axis: 'x', power: 4 },
      { x: 4, y: 4.6, z: 3.5, len: 7, axis: 'x', power: 4 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: -7, z: -depth / 2 + 4.4 },
    meeting: { x: width / 2 - 3.4, y: 0, z: depth / 2 - 3, w: 5.4, d: 4.4, h: 2.6 },
    manager: [2.6, 0, depth / 2 - 2.6],
    chief: [-2.6, 0, depth / 2 - 2.6],
    screen: { x: 1.5, y: 3.5, w: 9.5, factsX: width / 2 - 3, factsY: 3.4, factsW: 4.4 },
  };
}

/** Zaal: podium vooraan, twee werkblokken opzij, het midden blijft loopruimte. */
function venue(total: number): OfficeLayout {
  const width = 28;
  const depth = 19;
  return {
    kind: 'music',
    shell: 'venue',
    width,
    depth,
    wallH: 11,
    palette: MUSIC_PALETTE,
    desks: flankSlots(total, 10.2, 3.3, 3, 2),
    // De zaal hangt aan het podiumlicht; boven de werkblokken alleen genoeg om
    // een toetsenbord te zien.
    lamps: [
      { x: -8.6, y: 5.6, z: 2, len: 7, axis: 'z', power: 6 },
      { x: 8.6, y: 5.6, z: 2, len: 7, axis: 'z', power: 6 },
    ],
    steps: [],
    podium: null,
    dividers: false,
    door: null,
    dress: { x: 0, z: -depth / 2 + 4.8 },
    meeting: { x: -width / 2 + 3.8, y: 0, z: -depth / 2 + 3.4, w: 6, d: 4.8, h: 3.4 },
    manager: [2.6, 0, depth / 2 - 2.6],
    chief: [-2.6, 0, depth / 2 - 2.6],
    screen: { x: 0, y: 7.6, w: 12, factsX: width / 2 - 4, factsY: 7.4, factsW: 5 },
  };
}

/** Het vloerplan van deze tak. */
export function officeLayout(kind: OfficeKind, total: number): OfficeLayout {
  switch (kind) {
    case 'trading':
    case 'crypto':
    case 'equities':
      return tradingFloor(kind, total);
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

/* ============================== de mensen =============================== */

/** Klein werkend poppetje: typt, wiebelt, kijkt rond. */
function Worker({ color, active, seed }: { color: string; active: boolean; seed: number }): JSX.Element {
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (active) {
      // Typen: armen tikken tegenfasig, romp veert mee.
      if (leftArm.current) leftArm.current.rotation.x = -0.9 + Math.sin(t * 9) * 0.22;
      if (rightArm.current) rightArm.current.rotation.x = -0.9 + Math.sin(t * 9 + Math.PI) * 0.22;
      if (body.current) body.current.position.y = Math.sin(t * 4.5) * 0.012;
      if (head.current) head.current.rotation.y = Math.sin(t * 0.7) * 0.18;
    } else {
      if (leftArm.current) leftArm.current.rotation.x = -0.35;
      if (rightArm.current) rightArm.current.rotation.x = -0.35;
      if (head.current) head.current.rotation.y = Math.sin(t * 0.45) * 0.5;
      if (body.current) body.current.position.y = Math.sin(t * 1.6) * 0.02;
    }
  });

  return (
    <group ref={body}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.17, 0.3, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      <group ref={leftArm} position={[-0.2, 0.6, 0]}>
        <mesh position={[0, -0.12, 0.1]}>
          <capsuleGeometry args={[0.05, 0.2, 3, 6]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.2, 0.6, 0]}>
        <mesh position={[0, -0.12, 0.1]}>
          <capsuleGeometry args={[0.05, 0.2, 3, 6]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      </group>
      <group ref={head} position={[0, 0.82, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.16, 12, 10]} />
          <meshStandardMaterial color="#ffd9b8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.07, 0]}>
          <sphereGeometry args={[0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#2a2340" roughness={0.75} />
        </mesh>
      </group>
      {/* stoel */}
      <mesh position={[0, 0.26, -0.34]}>
        <boxGeometry args={[0.42, 0.5, 0.08]} />
        <meshStandardMaterial color="#2f2750" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Eén werkplek: bureau, scherm, naamplaatje, resultaat en de agent erachter. */
function Desk({
  station,
  slot,
  index,
  layout,
  accent,
  selected,
  valueKind,
  onSelect,
}: {
  station: Station;
  slot: DeskSlot;
  index: number;
  layout: OfficeLayout;
  accent: string;
  selected: boolean;
  valueKind: OfficeSnapshot['valueKind'];
  onSelect: (id: string) => void;
}): JSX.Element {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const valueSprite = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  // Elk bureau heeft iemand zitten; alleen de werkenden typen echt.
  const manned = station.status !== 'idle' || index % 5 !== 4;

  // Kijkt de agent de zaal in, dan verhuizen stoel, toetsenbord en scherm naar
  // de camerakant van het blad — het beeldscherm blijft zo naar je toe staan.
  const seatZ = slot.wall ? 1.15 : -1.05;
  const screenZ = slot.wall ? 0.3 : -0.3;
  const keyZ = slot.wall ? 0.72 : 0.25;

  const mark = station.stale ? '!' : station.simulated ? '~' : '';
  const chip = useMemo(
    () => chipTexture(station.label, station.sub, accent, mark),
    [station.label, station.sub, accent, mark],
  );
  const valueText =
    valueKind === 'money'
      ? `${station.value >= 0 ? '+' : '-'}$${Math.abs(station.value).toFixed(2)}`
      : `${station.value >= 0 ? '+' : ''}${Math.round(station.value)}`;
  const tone = station.value >= 0 ? 'good' : 'bad';
  const value = useMemo(
    () => valueTexture(valueText, tone, station.simulated),
    [valueText, tone, station.simulated],
  );

  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + index * 0.7;
    if (screen.current) {
      const base = station.status === 'working' ? 1.1 : station.status === 'alert' ? 0.9 : 0.35;
      screen.current.emissiveIntensity = base + Math.sin(t * (station.status === 'working' ? 6 : 1.5)) * 0.18;
    }
    if (valueSprite.current) {
      valueSprite.current.position.y = 2.45 + Math.sin(t * 1.3) * 0.07;
    }
    if (ring.current) ring.current.rotation.z = t * 0.9;
  });

  return (
    <group
      position={[slot.x, slot.y, slot.z]}
      rotation={[0, slot.yaw, 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(station.id); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      {/* blad + poten */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.09, 1.25]} />
        <meshStandardMaterial color={layout.palette.desk} roughness={0.55} />
      </mesh>
      {[[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx!, 0.37, lz!]}>
          <cylinderGeometry args={[0.05, 0.05, 0.74, 6]} />
          <meshStandardMaterial color={layout.palette.deskLeg} roughness={0.8} />
        </mesh>
      ))}
      {/* scherm */}
      <group position={[0, 1.18, screenZ]} rotation={[-0.16, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.35, 0.8, 0.06]} />
          <meshStandardMaterial color="#15102c" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <planeGeometry args={[1.22, 0.68]} />
          <meshStandardMaterial
            ref={screen}
            color="#0d0a1e"
            emissive={STATUS_COLOR[station.status]}
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh position={[0, 0.87, screenZ]}>
        <cylinderGeometry args={[0.16, 0.2, 0.16, 8]} />
        <meshStandardMaterial color="#15102c" roughness={0.5} />
      </mesh>
      {/* toetsenbord */}
      <mesh position={[0, 0.8, keyZ]} rotation={[-0.05, 0, 0]}>
        <boxGeometry args={[0.8, 0.03, 0.28]} />
        <meshStandardMaterial color="#2a2350" roughness={0.7} />
      </mesh>

      {/* Tussenschot: hoort bij een kantoortuin en bij de kantoorstrook in de
          hal. In een atelier of op een podiumvloer staat het niemand in de weg
          te zijn, dus daar staat het er niet. */}
      {layout.dividers && (
        <mesh position={[1.42, 1.05, -0.05]}>
          <boxGeometry args={[0.07, 0.62, 1.3]} />
          <meshStandardMaterial color={layout.palette.trim} roughness={0.85} transparent opacity={0.85} />
        </mesh>
      )}

      {manned && (
        <group position={[0, 0, seatZ]} rotation={[0, slot.wall ? Math.PI : 0, 0]} scale={1.15}>
          <Worker color={accent} active={station.status === 'working'} seed={index * 1.7} />
        </group>
      )}

      {/* Naamplaatje. Twaalf bureaus met elk een permanent zwevend label werd
          één wolk waar niets meer uit te lezen viel — een kantoor vol post-its
          over elkaar heen. Nu alleen wat je nodig hebt: het bureau waar je
          overheen gaat, het bureau dat je koos, en alles wat om aandacht
          vraagt. De rest heeft zijn scherm en zijn kleur, en de volledige
          lijst staat rechts.

          De chip draagt het ≈-teken van een werkplek op voorbeeldcijfers en het
          zwevende cijfer is dan gedempt: sprites met basic-materiaal, dus geen
          enkel vloerplan of lichtplan kan die aanduiding wegpoetsen. */}
      {(hovered || selected || station.status === 'alert') && (
        <>
          <sprite position={[0, 1.95, 0]} scale={[1.45 * chip.aspect * 0.62, 0.62, 1]} renderOrder={10}>
            <spriteMaterial map={chip.texture} transparent depthWrite={false} depthTest={false} />
          </sprite>
          <sprite ref={valueSprite} position={[1.2, 2.45, 0]} scale={[0.95, 0.28, 1]} renderOrder={10}>
            <spriteMaterial map={value.texture} transparent depthWrite={false} depthTest={false} />
          </sprite>
        </>
      )}

      {/* selectie- en alarmring op de vloer */}
      {(selected || station.status === 'alert') && (
        <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.35, 1.55, 32]} />
          <meshBasicMaterial
            color={selected ? '#ffd75e' : '#ff6b6b'}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/** Leidinggevende op een verhoging: manager per tak, chief boven alles. */
function Leader({
  member,
  position,
  color,
  onSelect,
  selected,
}: {
  member: StaffMember;
  position: [number, number, number];
  color: string;
  onSelect: (id: string) => void;
  selected: boolean;
}): JSX.Element {
  const chip = useMemo(
    () => chipTexture(member.name, member.status, color),
    [member.name, member.status, color],
  );
  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); onSelect(member.id); }}>
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <cylinderGeometry args={[1.1, 1.25, 0.32, 8]} />
        <meshStandardMaterial color={selected ? '#4b3c86' : '#3a2f6b'} roughness={0.8} />
      </mesh>
      <group position={[0, 0.32, 0]}>
        <Worker color={color} active={Boolean(member.busyWith)} seed={7} />
      </group>
      <sprite position={[0, 1.85, 0]} scale={[1.5 * chip.aspect * 0.6, 0.6, 1]}>
        <spriteMaterial map={chip.texture} transparent depthWrite={false} />
      </sprite>
      <pointLight position={[0, 2.2, 0]} color={color} intensity={6} distance={6} />
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
}: {
  len: number;
  layout: OfficeLayout;
  tone: 'back' | 'side';
  windows: boolean;
  door: OfficeLayout['door'];
  panels: boolean;
}): JSX.Element {
  const p = layout.palette;
  const color = tone === 'back' ? p.wall : p.wallSide;
  const h = layout.wallH;
  const sill = 1.5;
  const head = Math.min(5.2, h - 1.6);
  const mullions = Math.max(1, Math.round(len / 3.2) - 1);
  const pads = Math.max(2, Math.round(len / 1.9));

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
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[0, door.h * (0.5 + i * 0.075), 0.1]}>
              <boxGeometry args={[door.w - 0.2, door.h * 0.06, 0.16]} />
              <meshStandardMaterial color={i % 2 ? p.plint : p.floor} roughness={0.7} />
            </mesh>
          ))}
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
      {panels &&
        Array.from({ length: pads }, (_, i) => (
          <mesh key={i} position={[(-len / 2) + (len / pads) * (i + 0.5), h * 0.55, 0.22]}>
            <boxGeometry args={[len / pads - 0.28, h * 0.62, 0.16]} />
            <meshStandardMaterial color={i % 2 ? p.trim : p.wallSide} roughness={1} />
          </mesh>
        ))}

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
}: {
  office: OfficeSnapshot;
  layout: OfficeLayout;
  accent: string;
}): JSX.Element {
  const { width, depth, wallH, palette: p } = layout;
  const backZ = -depth / 2;
  const head = useMemo(() => headlineTexture(office), [office]);
  const facts = useMemo(() => factsTexture(office), [office]);
  const room = useMemo(() => roomTexture(office), [office]);

  // Elke trede iets lichter dan de vorige: zo lees je de tribune van bovenaf
  // als treden en niet als één blok.
  const stepColor = (i: number): string =>
    new THREE.Color(p.floor).lerp(new THREE.Color('#ffffff'), 0.085 * (i + 1)).getStyle();

  return (
    <group>
      {/* Vloer — altijd de lichtste waarde van de ruimte. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={p.floor} roughness={0.9} />
      </mesh>

      {/* Vloerwerk per tak: tapijtbanen, belijning, een pit of lichtvlekken. */}
      {layout.shell === 'open' &&
        layout.lamps.map((l, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, l.z]} receiveShadow>
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
              rotation={[-Math.PI / 2, 0, 0]}
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
              rotation={[-Math.PI / 2, 0, 0]}
              position={[width / 2 - 10.4 + i * 0.7, 0.014, 0]}
            >
              <planeGeometry args={[0.16, depth - 2]} />
              <meshStandardMaterial color={p.mark} roughness={0.7} emissive={p.mark} emissiveIntensity={0.25} />
            </mesh>
          ))}
        </>
      )}

      {/* De pit: het lichte vlak waar de bogen omheen staan. Hij blijft binnen
          de wanden — een vloervlak dat door een wand heen loopt verraadt dat de
          ruimte geen ruimte is. */}
      {layout.shell === 'controlroom' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -1]} receiveShadow>
          <circleGeometry args={[8.2, 40]} />
          <meshStandardMaterial color={p.mark} roughness={0.9} />
        </mesh>
      )}

      {layout.shell === 'atelier' &&
        ISLANDS.map(([ix, iz], i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[ix, 0.012, iz]} receiveShadow>
            <planeGeometry args={[9, 4.4]} />
            <meshStandardMaterial color={p.mark} roughness={0.95} />
          </mesh>
        ))}

      {layout.shell === 'booth' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 3]} receiveShadow>
          <planeGeometry args={[width - 5, 9]} />
          <meshStandardMaterial color={p.mark} roughness={0.98} />
        </mesh>
      )}

      {layout.shell === 'venue' &&
        [-8.6, 0, 8.6].map((lx, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[lx, 0.012, 1]} receiveShadow>
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
        />
      </group>

      {/* Spanten: een hal en een zaal zijn hoog omdat je de constructie ziet. */}
      {(layout.shell === 'hal' || layout.shell === 'venue') && (
        <group>
          {/* Dun en licht: dikke donkere liggers werden balken die dwars door
              het beeld sneden — dezelfde fout als de TL-balken van weleer. */}
          {[-depth / 4, depth / 4].map((tz) => (
            <mesh key={tz} position={[0, wallH - 1.6, tz]}>
              <boxGeometry args={[width, 0.14, 0.2]} />
              <meshStandardMaterial color={p.plint} roughness={0.8} />
            </mesh>
          ))}
          {/* Langsliggers alleen in de hal: in de zaal kruisten ze de dwarsbalken
              tot een ruitpatroon over het halve beeld. */}
          {layout.shell === 'hal' &&
            [-width / 4, width / 4].map((tx) => (
              <mesh key={tx} position={[tx, wallH - 1.85, 0]}>
                <boxGeometry args={[0.16, 0.12, depth]} />
                <meshStandardMaterial color={p.plint} roughness={0.8} />
              </mesh>
            ))}
          {/* Stalen kolommen langs de achterwand. */}
          {layout.shell === 'hal' &&
            [-width / 2 + 2, width / 2 - 2].map((cx) => (
              <mesh key={cx} position={[cx, wallH / 2, backZ + 0.6]} castShadow>
                <boxGeometry args={[0.55, wallH, 0.55]} />
                <meshStandardMaterial color={p.trim} roughness={0.85} />
              </mesh>
            ))}
        </group>
      )}

      {/* Baffles: een laag plafond dat je nog nét doorkijkt. Een dicht plafond
          zou onder deze camera de hele ruimte afdekken — dit dempt hem zonder
          hem te sluiten. */}
      {/* Baffles boven de regie — niet over de hele zaal. Een veld van bar na
          bar dekte onder deze camera de halve ruimte af; boven de console
          alleen zegt hetzelfde (laag, gedempt) zonder iets te verbergen. */}
      {layout.shell === 'booth' &&
        Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[-1, wallH - 0.35, -0.6 + i * 2.2]}>
            <boxGeometry args={[width - 7, 0.22, 0.2]} />
            <meshStandardMaterial color={p.mark} roughness={1} />
          </mesh>
        ))}

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
      <mesh position={[layout.screen.x, layout.screen.y, backZ + 0.42]}>
        <planeGeometry args={[layout.screen.w, layout.screen.w * HEAD_RATIO]} />
        <meshBasicMaterial map={head.texture} transparent toneMapped={false} />
      </mesh>
      <mesh position={[layout.screen.factsX, layout.screen.factsY, backZ + 0.42]}>
        <planeGeometry args={[layout.screen.factsW, layout.screen.factsW * FACTS_RATIO]} />
        <meshBasicMaterial map={facts.texture} transparent toneMapped={false} />
      </mesh>

      {/* Overleghok. Glas op de twee camerazijden, dichte panelen op de andere
          twee: zo staat het in elk vloerplan overeind, ook los van een wand. */}
      <group position={[layout.meeting.x, layout.meeting.y, layout.meeting.z]}>
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[layout.meeting.w, layout.meeting.d]} />
          <meshStandardMaterial color={p.mark} roughness={0.8} />
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
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          return (
            <group key={i} position={[Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6]} rotation={[0, -a, 0]}>
              <Worker color={i % 2 ? '#8ab4ff' : accent} active={i % 2 === 0} seed={i * 3.1} />
            </group>
          );
        })}
      </group>
    </group>
  );
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
  const manager = office.staff.find((s) => s.role === 'manager');
  const chief = office.staff.find((s) => s.role === 'supervisor');

  return (
    <group>
      {/* Was paars getint (#c9bdff) en dat kleurde álles mee, ook de
          zandkleurige bureaus en de gele figuren. Neutraal-warm licht laat de
          accentkleur van de tak het werk doen in plaats van het te overstemmen.
          Hoeveel licht er hangt verschilt per tak — een atelier staat vol
          daglicht, een opnamestudio is gedempt — maar de aanduidingen op de
          werkplekken zijn sprites en basic-materialen: die blijven even goed
          leesbaar hoe donker de ruimte ook is. */}
      <ambientLight intensity={palette.ambient} color="#fff1e2" />
      <hemisphereLight args={['#dcd2ff', palette.floor, 0.85]} />
      <directionalLight
        position={[10, 16, 8]}
        intensity={1.5}
        color="#fff2e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
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

      <Room office={office} layout={layout} accent={accent} />
      {/* Het meubilair dat deze werkvloer tot díé werkvloer maakt. */}
      <Dressing office={office} accent={accent} layout={layout} />

      {office.stations.map((station, i) => (
        <Desk
          key={station.id}
          station={station}
          slot={layout.desks[i] ?? { x: 0, y: 0, z: 0, yaw: 0, wall: false }}
          index={i}
          layout={layout}
          accent={accent}
          selected={selectedId === station.id}
          valueKind={office.valueKind}
          onSelect={onSelect}
        />
      ))}

      {manager && (
        <Leader
          member={manager}
          position={layout.manager}
          color={accent}
          onSelect={onSelect}
          selected={selectedId === manager.id}
        />
      )}
      {chief && (
        <Leader
          member={chief}
          position={layout.chief}
          color="#ffd75e"
          onSelect={onSelect}
          selected={selectedId === chief.id}
        />
      )}
    </group>
  );
}
