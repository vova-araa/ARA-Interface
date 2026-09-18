import { axialKey, axialToWorld, hexDisc, stableHash, WORLD_HEX_RADIUS, type WorldConfig } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';
import { groundTop } from './terrain.ts';

// Doorgeven zodat wie het wegennet gebruikt de hoogte niet apart hoeft te
// zoeken; de bron blijft terrain.ts.
export { groundTop };

/**
 * Het wegennet, op één plek.
 *
 * De grond tekent de wegtegels en het verkeer rijdt erover. Die twee moeten
 * hetzelfde net gebruiken, anders rijden er vrachtwagens door het gras naast
 * een weg die er ook ligt. Daarom staat het hier en niet in HexGround.
 */

export interface RoadNet {
  /** Sleutels van alle tegels die weg zijn — voor de grondlaag. */
  tiles: Set<string>;
  /** Per district één route van de hub naar het hart, in wereldcoördinaten. */
  paths: { venture: string; color: string; points: { x: number; z: number; y: number }[] }[];
}

/**
 * Rechte lijn over het hex-raster, in kubuscoördinaten geïnterpoleerd en
 * teruggerond. Met alleen axiale interpolatie vallen er gaten waar de
 * afronding twee keer dezelfde tegel kiest.
 */
export function hexLine(
  a: { q: number; r: number },
  b: { q: number; r: number },
): { q: number; r: number }[] {
  const dist = Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
  const out: { q: number; r: number }[] = [];
  for (let i = 0; i <= dist; i += 1) {
    const t = dist === 0 ? 0 : i / dist;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    const sAxis = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(sAxis);
    // De as met de grootste afrondfout wordt uit de andere twee afgeleid,
    // anders valt de som niet meer op nul en ligt de tegel naast het pad.
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - sAxis);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    out.push({ q: rq, r: rr });
  }
  return out;
}

export function buildRoads(
  world: WorldConfig | null,
  blocked: { claimed: Set<string>; lake: Set<string> },
): RoadNet {
  const net: RoadNet = { tiles: new Set(), paths: [] };
  if (!world) return net;

  for (const district of world.districts) {
    const hexes = district.projects.flatMap((project) => project.hexes);
    if (hexes.length === 0) continue;
    const centre = {
      q: Math.round(hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length),
      r: Math.round(hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length),
    };

    const points: { x: number; z: number; y: number }[] = [];
    for (const hex of hexLine({ q: 0, r: 0 }, centre)) {
      const key = axialKey(hex);
      // Een weg loopt niet dóór een district of het meer heen; hij houdt op
      // waar hij aankomt. Maar de route zelf loopt wél door tot het hart,
      // anders stopt het verkeer midden in het veld.
      if (!blocked.claimed.has(key) && !blocked.lake.has(key)) net.tiles.add(key);
      const { x, z } = axialToWorld(hex);
      // De hoogte hoort bij het punt: een route is een lijn over heuvels, geen
      // lijn op zeeniveau met iets erboven.
      points.push({ x: x * HEX_SPACING, z: z * HEX_SPACING, y: groundTop(hex) });
    }
    net.paths.push({ venture: district.venture.id, color: district.venture.color, points });
  }
  return net;
}

/**
 * Hexen buiten de districten, het meer en de wegen: daar is plek voor dieren
 * en voor alles wat de lege grond moet vullen. Deterministisch gesorteerd,
 * zodat een kudde niet bij elke render ergens anders staat.
 */
export function openGround(
  blocked: { claimed: Set<string>; lake: Set<string>; roads: Set<string> },
): { q: number; r: number }[] {
  return hexDisc({ q: 0, r: 0 }, WORLD_HEX_RADIUS - 1).filter((hex) => {
    const key = axialKey(hex);
    if (blocked.claimed.has(key) || blocked.lake.has(key) || blocked.roads.has(key)) return false;
    // Niet pal naast de hub: daar staat het monument en lopen de figuren.
    return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) > 2;
  });
}

/** Deterministische pseudo-random uit een sleutel, in [0,1). */
export const rand = (key: string): number => (stableHash(key) % 10_000) / 10_000;
