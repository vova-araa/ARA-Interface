import { axialKey, hexDisc, stableHash, WORLD_HEX_RADIUS } from '@ara/shared';

/**
 * De vorm van de wereld: waar het meer ligt en hoe hoog de grond is.
 *
 * Dit stond in zeven bestanden. Zeven kopieën van dezelfde twee getallen, elk
 * met een comment erboven dat ze gelijk moesten blijven — en dat is precies de
 * afspraak die niemand nakomt op de dag dat het meer verschuift. Het viel ook
 * al een keer om: het terreinreliëf kwam later dan het verkeer, en toen reed
 * alles onder de weg door omdat die hoogte op drie plekken los vastlag.
 *
 * Eén bron. Wie de wereld verplaatst, verplaatst hem hier.
 */

export const LAKE_CENTER = { q: -2, r: 6 };
export const LAKE_RADIUS = 2;

/** De hexen die onder water liggen. */
export function lakeKeys(): Set<string> {
  return new Set(hexDisc(LAKE_CENTER, LAKE_RADIUS).map(axialKey));
}

/**
 * Waardenruis over een grover raster dan de tegels zelf, met smoothstep tussen
 * de roosterpunten. Dat is het verschil tussen landschap en puin: een hash per
 * tegel geeft buren die niets met elkaar te maken hebben, dus een veld losse
 * zuilen. Hier hangt een tegel samen met zijn omgeving en ontstaan glooiingen.
 */
export function valueNoise(q: number, r: number, scale: number): number {
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

/** Hoeveel een tegel omhoog ligt ten opzichte van het nulvlak. */
export function terrainLift(hex: { q: number; r: number }): number {
  const height = valueNoise(hex.q, hex.r, 5) * 0.72 + valueNoise(hex.q, hex.r, 2) * 0.28;
  const distance = Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
  // Naar de rand toe loopt het op: de hoogvlakte rond Yerevan. Dat houdt het
  // oog ook binnen de wereld in plaats van er overheen te laten glijden.
  const rim = Math.pow(distance / WORLD_HEX_RADIUS, 2.4);
  return -0.04 + height * 0.5 + rim * 1.1;
}

/**
 * De bovenkant van de tegel: de hoogte waar iets op staat.
 *
 * Tegelprisma's zijn 2,4 hoog en hangen op -1,05 (grond) of -1,03 (weg); hun
 * bovenkant ligt dus op 0,15 respectievelijk 0,17 plus de lift.
 */
export function groundTop(hex: { q: number; r: number }): number {
  return 0.16 + terrainLift(hex);
}

/** Het wateroppervlak ligt vlak, ongeacht het reliëf eromheen. */
export const WATER_TOP = 0.05;
