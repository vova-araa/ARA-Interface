import { useEffect, useState } from 'react';
import { stableHash } from '@ara/shared';

/**
 * Real-time day/night cycle: sky palette + light levels per dagdeel,
 * plus het seizoen waar die dag in valt.
 *
 * Het seizoen is hier gaan wonen en niet in de seizoenslaag zelf, omdat het
 * licht er zelf van verandert: een winterdag is korter én kouder, en dat is
 * dezelfde beslissing als het dagdeel. Twee modules die allebei "hoe laat en
 * hoe donker is het" bepalen lopen gegarandeerd uit elkaar.
 *
 * Alles hieronder is een pure functie van de klok — geen Math.random, dus twee
 * schermen naast elkaar tonen hetzelfde weer op hetzelfde moment.
 */

export type Season = 'winter' | 'lente' | 'zomer' | 'herfst';

/** Gewichten per seizoen, samen altijd 1 — de bron van elke vloeiende overgang. */
export interface SeasonMix {
  winter: number;
  lente: number;
  zomer: number;
  herfst: number;
}

export interface Precip {
  kind: 'regen' | 'sneeuw' | 'geen';
  /** 0..1 — hoe hard het valt; 0 hoort bij kind 'geen'. */
  intensity: number;
}

export interface Daylight {
  period: 'night' | 'dawn' | 'day' | 'dusk';
  /** Gradient stops zenith → horizon. */
  stops: [string, string, string, string];
  ambient: number;
  directional: number;
  lightColor: string;
  fogColor: string;

  // ---- seizoen ------------------------------------------------------------
  // Later toegevoegd; alles hierboven houdt exact dezelfde betekenis, want
  // vier andere bestanden lezen die velden.
  /** Het seizoen dat op dit moment het zwaarst weegt — een naam, geen schakelaar. */
  season: Season;
  /** Gebruik dít om iets te mengen; `season` springt op de datumgrens, de mix nooit. */
  seasonMix: SeasonMix;
  /** Positie in het jaar, 0 = 1 januari 00:00, 1 = oudjaar middernacht. */
  yearPhase: number;
  /** Zonsopkomst/-ondergang in decimale uren; zomer lang, winter kort. */
  sunrise: number;
  sunset: number;
  /** 0..1 — hoeveel sneeuw er op de grond hoort te liggen. */
  snowCover: number;
  /** 0..1 — hoe nat de grond is; loopt achter op de regen en droogt langzaam. */
  wetGround: number;
  /** Neerslag van dit moment. Seizoensweer: achtergrond, geen signaal. */
  precip: Precip;
  /** Windsterkte t.o.v. een gemiddelde dag; herfst waait hard, zomer staat stil. */
  windScale: number;
  /** Kleur van het blad aan de seizoensbomen. */
  leafTint: string;
  /** 0..1 — hoe kaal de bomen staan (1 = winter, alleen takken). */
  bareness: number;
}

/** Het dagdeel-palet zoals het altijd was; het seizoen kleurt het daarna bij. */
interface Palette {
  stops: [string, string, string, string];
  ambient: number;
  directional: number;
  lightColor: string;
  fogColor: string;
}

const PALETTES: Record<Daylight['period'], Palette> = {
  // De omgevingslichtwaarden lagen laag genoeg om de wereld 's avonds tot één
  // paarse massa te maken. Dit ding moet vooral leesbaar zijn: je moet kunnen
  // zien wélk district vastloopt, ook om half elf 's avonds. Sfeer komt uit de
  // kleur van het licht, niet uit het weglaten ervan.
  night: {
    stops: ['#0b1026', '#18224a', '#2c3a5c', '#3b4a6b'],
    ambient: 0.52,
    directional: 0.7,
    lightColor: '#a8c0ff',
    fogColor: '#2c3a5c',
  },
  dawn: {
    stops: ['#2b3a67', '#7a6a9e', '#e8927c', '#f6c89f'],
    ambient: 0.64,
    directional: 1.1,
    lightColor: '#ffe8cf',
    fogColor: '#e8b9a0',
  },
  day: {
    stops: ['#2f6fca', '#6fa8dc', '#a8cbe8', '#e6f2fb'],
    ambient: 0.6,
    directional: 1.3,
    lightColor: '#fff6e8',
    fogColor: '#c9dcee',
  },
  dusk: {
    stops: ['#232b52', '#5d4a7e', '#d97b5f', '#e8b56b'],
    ambient: 0.66,
    directional: 1.0,
    lightColor: '#ffd9b0',
    fogColor: '#c99a86',
  },
};

// ---------------------------------------------------------------------------
// Kleurhulp — hex in, hex uit. Bewust zonder three: dit bestand wordt door de
// helft van de scene geïmporteerd en hoeft geen renderer mee te slepen.
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(rgb[0]) << 16) | (clamp(rgb[1]) << 8) | clamp(rgb[2]))
    .toString(16)
    .slice(1)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

// ---------------------------------------------------------------------------
// Het jaar
// ---------------------------------------------------------------------------

/**
 * De harten van de seizoenen, niet hun begindatum. Precies een kwart jaar uit
 * elkaar, want daar hangt de mix-formule hieronder van af: op de grens tussen
 * twee seizoenen wegen ze dan exact even zwaar.
 */
const SEASON_CENTER: Record<Season, number> = {
  winter: 0.0411, // ~15 januari
  lente: 0.2911, // ~16 april
  zomer: 0.5411, // ~17 juli
  herfst: 0.7911, // ~16 oktober
};

const SEASONS: Season[] = ['winter', 'lente', 'zomer', 'herfst'];

function yearPhaseOf(now: Date): number {
  const start = Date.UTC(now.getFullYear(), 0, 1);
  const next = Date.UTC(now.getFullYear() + 1, 0, 1);
  const at = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
  );
  return (at - start) / (next - start);
}

/**
 * Gewicht per seizoen uit één jaarstand.
 *
 * cos over de afstand tot het hart van elk seizoen: in het hart is het gewicht
 * 1 en zijn de buren 0, op de grens wegen de twee buren precies even zwaar.
 * Daardoor kán er geen sprong op 1 maart bestaan — er is geen datum waarop
 * iets omklapt, alleen een verhouding die elke dag een beetje verschuift.
 */
export function seasonMixFor(phase: number): SeasonMix {
  const raw = SEASONS.map((season) => {
    const d = phase - SEASON_CENTER[season];
    const wrapped = d - Math.round(d); // kortste weg over de jaargrens
    return Math.max(0, Math.cos(wrapped * Math.PI * 2));
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return {
    winter: raw[0]! / sum,
    lente: raw[1]! / sum,
    zomer: raw[2]! / sum,
    herfst: raw[3]! / sum,
  };
}

function dominant(mix: SeasonMix): Season {
  return SEASONS.reduce((best, s) => (mix[s] > mix[best] ? s : best), 'winter' as Season);
}

/** Gewogen som over de vier seizoenen — de enige manier waarop hier gemengd wordt. */
function bySeason(mix: SeasonMix, values: Record<Season, number>): number {
  return (
    mix.winter * values.winter +
    mix.lente * values.lente +
    mix.zomer * values.zomer +
    mix.herfst * values.herfst
  );
}

function tintBySeason(
  base: string,
  mix: SeasonMix,
  tints: Record<Season, { color: string; amount: number }>,
): string {
  const out: [number, number, number] = [0, 0, 0];
  for (const season of SEASONS) {
    const t = tints[season];
    const c = parseHex(mixHex(base, t.color, t.amount));
    out[0] += c[0] * mix[season];
    out[1] += c[1] * mix[season];
    out[2] += c[2] * mix[season];
  }
  return toHex(out);
}

// ---------------------------------------------------------------------------
// Neerslag — een functie van de datum, geen dobbelsteen
// ---------------------------------------------------------------------------

/** Hoe vaak het in dit seizoen regent (of sneeuwt). Zomer is droog, herfst nat. */
const WET_DAYS: Record<Season, number> = { winter: 0.42, lente: 0.46, zomer: 0.16, herfst: 0.58 };

const rand01 = (key: string): number => (stableHash(key) % 100_000) / 100_000;

const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/**
 * De bui van één kalenderdag, uitgerekend in absolute uren sinds middernacht
 * van die dag. Terug te lezen als: elke dag trekt één lot; valt dat lot onder
 * de seizoenskans, dan hangt er die dag één bui, met een vast begin en een
 * vaste duur. Twee keer dezelfde dag geeft twee keer dezelfde bui.
 */
function showerAt(dayStart: number, hours: number, mix: SeasonMix): number {
  const key = dayKey(dayStart);
  const draw = rand01(`neerslag:${key}`);
  const chance = bySeason(mix, WET_DAYS);
  if (draw >= chance) return 0;
  // Hoe verder onder de drempel, hoe steviger de bui — zo is een natte dag in
  // de herfst gemiddeld natter dan een natte dag in de zomer.
  const strength = Math.min(1, 0.35 + (1 - draw / Math.max(chance, 0.001)) * 0.75);
  const begin = rand01(`buiuur:${key}`) * 24;
  const duration = 1.5 + rand01(`buiduur:${key}`) * 4.5;
  const t = (hours - begin) / duration;
  if (t <= 0 || t >= 1) return 0;
  // Sinus-envelop: een bui begint en eindigt zacht. Een blokgolf leest als een
  // schakelaar, en een schakelaar is precies wat toestandsweer wél is.
  return strength * Math.sin(t * Math.PI) ** 0.7;
}

/** Neerslagsterkte op een moment; kijkt ook naar gisteren, want een bui van
 *  23:00 mag niet om middernacht ophouden te bestaan. */
function precipAt(now: Date, mix: SeasonMix): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hours = (now.getTime() - midnight) / 3_600_000;
  const today = showerAt(midnight, hours, mix);
  const yesterday = showerAt(midnight - 86_400_000, hours + 24, mix);
  return Math.max(today, yesterday);
}

/**
 * Natte grond loopt achter op de bui: het blijft glanzen als het net gestopt
 * is en het wordt niet meteen nat als het net begint. Uitgerekend door een
 * paar momenten terug te kijken in dezelfde pure functie — geen toestand, dus
 * ook geen verkeerde stand na een herladen of een replay.
 */
function wetnessAt(now: Date, mix: SeasonMix): number {
  let wet = 0;
  for (const back of [0, 10, 25, 45, 75, 110]) {
    const then = new Date(now.getTime() - back * 60_000);
    const decay = 1 - back / 130;
    wet = Math.max(wet, precipAt(then, mix) * decay);
  }
  return Math.min(1, wet * 1.15);
}

// ---------------------------------------------------------------------------
// Dagdeel
// ---------------------------------------------------------------------------

/** Zonsopkomst/-ondergang per seizoen (decimale uren, Armeens-Europees ritme). */
const SUNRISE: Record<Season, number> = { winter: 8.2, lente: 6.4, zomer: 5.4, herfst: 7.4 };
const SUNSET: Record<Season, number> = { winter: 17.0, lente: 19.9, zomer: 21.2, herfst: 18.4 };

/**
 * Het dagdeel bij een uur. Zonder seizoen blijft dit exact de oude indeling —
 * er zijn aanroepers buiten dit bestand en die mogen niet stiekem iets anders
 * gaan betekenen.
 */
export function periodForHour(hour: number, mix?: SeasonMix): Daylight['period'] {
  if (!mix) {
    if (hour >= 22 || hour < 6) return 'night';
    if (hour < 9) return 'dawn';
    if (hour < 17) return 'day';
    return 'dusk';
  }
  const sunrise = bySeason(mix, SUNRISE);
  const sunset = bySeason(mix, SUNSET);
  // De schemering hangt aan de zon vast, niet aan de klok: in december wordt
  // het om vijf uur donker en in juli niet, en dat is het hele punt.
  if (hour < sunrise - 0.9 || hour > sunset + 0.9) return 'night';
  if (hour < sunrise + 2.1) return 'dawn';
  if (hour < sunset - 1.9) return 'day';
  return 'dusk';
}

// ---------------------------------------------------------------------------
// Overrides voor demo's en screenshots
// ---------------------------------------------------------------------------

function param(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

/** ?time=day|night|dawn|dusk forceert het palet (demo's, screenshots). */
const FORCED: Daylight['period'] | null = (() => {
  const value = param('time');
  return value === 'day' || value === 'night' || value === 'dawn' || value === 'dusk'
    ? value
    : null;
})();

/**
 * ?season=winter|lente|zomer|herfst forceert het seizoen. Zonder deze knop is
 * driekwart van deze laag een jaar lang niet te zien, laat staan te testen.
 */
const FORCED_SEASON: Season | null = (() => {
  const value = param('season');
  return SEASONS.includes(value as Season) ? (value as Season) : null;
})();

/** ?weer=regen|sneeuw|droog forceert de neerslag — om dezelfde reden. */
const FORCED_WEATHER: 'regen' | 'sneeuw' | 'droog' | null = (() => {
  const value = param('weer');
  return value === 'regen' || value === 'sneeuw' || value === 'droog' ? value : null;
})();

// ---------------------------------------------------------------------------
// Samenstellen
// ---------------------------------------------------------------------------

/** Koeler en bleker in de winter, warm en verzadigd in de zomer. */
const LIGHT_TINT: Record<Season, { color: string; amount: number }> = {
  winter: { color: '#cfe0ff', amount: 0.38 },
  lente: { color: '#f2ffe4', amount: 0.14 },
  zomer: { color: '#fff0c8', amount: 0.2 },
  herfst: { color: '#ffd7a4', amount: 0.26 },
};
const FOG_TINT: Record<Season, { color: string; amount: number }> = {
  winter: { color: '#dde7f5', amount: 0.32 },
  lente: { color: '#dceedd', amount: 0.16 },
  zomer: { color: '#e8dcbc', amount: 0.22 },
  herfst: { color: '#dcbb92', amount: 0.28 },
};
const SKY_TINT: Record<Season, { color: string; amount: number }> = {
  winter: { color: '#b9cbe4', amount: 0.2 },
  lente: { color: '#cfe4e8', amount: 0.1 },
  zomer: { color: '#4f9fe0', amount: 0.14 },
  herfst: { color: '#c79a6a', amount: 0.16 },
};
const AMBIENT_FACTOR: Record<Season, number> = { winter: 0.96, lente: 1, zomer: 1.04, herfst: 0.98 };
const DIRECT_FACTOR: Record<Season, number> = { winter: 0.86, lente: 1, zomer: 1.12, herfst: 0.92 };
const WIND_FACTOR: Record<Season, number> = { winter: 1.15, lente: 0.95, zomer: 0.75, herfst: 1.8 };
const BARENESS: Record<Season, number> = { winter: 1, lente: 0.15, zomer: 0, herfst: 0.35 };
const LEAF: Record<Season, string> = {
  winter: '#8a9aa6',
  lente: '#ffd9e4', // abrikozenbloesem
  zomer: '#4f8f3d',
  herfst: '#d98b2b',
};

/**
 * Arrays met dezelfde inhoud krijgen dezelfde identiteit terug.
 *
 * Backdrop bakt zijn luchtgradiënt in een useMemo op `daylight.stops`. Zonder
 * deze cache is dat elke minuut een nieuwe array, dus elke minuut een nieuwe
 * canvas-texture voor precies hetzelfde plaatje.
 */
const stopsCache = new Map<string, [string, string, string, string]>();
function cachedStops(stops: [string, string, string, string]): [string, string, string, string] {
  const key = stops.join('|');
  const hit = stopsCache.get(key);
  if (hit) return hit;
  stopsCache.set(key, stops);
  return stops;
}

let memo: { key: string; value: Daylight } | null = null;

/** Het volledige daglicht op een moment. Pure functie; de cache gaat alleen
 *  over identiteit, nooit over inhoud. */
export function daylightAt(now: Date): Daylight {
  const phase = FORCED_SEASON ? SEASON_CENTER[FORCED_SEASON] : yearPhaseOf(now);
  const mix = FORCED_SEASON
    ? ({ winter: 0, lente: 0, zomer: 0, herfst: 0, [FORCED_SEASON]: 1 } as SeasonMix)
    : seasonMixFor(phase);
  const hour = now.getHours() + now.getMinutes() / 60;
  const period = FORCED ?? periodForHour(hour, mix);

  const rawPrecip =
    FORCED_WEATHER === 'droog'
      ? 0
      : FORCED_WEATHER
        ? 0.8
        : precipAt(now, mix);
  const wetGround =
    FORCED_WEATHER === 'droog' ? 0 : FORCED_WEATHER ? 0.85 : wetnessAt(now, mix);

  // Sneeuw in plaats van regen zodra de winter zwaar genoeg weegt; daartussen
  // is het natte sneeuw en dat ziet er als regen uit.
  const cold = mix.winter;
  const kind: Precip['kind'] =
    FORCED_WEATHER === 'sneeuw'
      ? 'sneeuw'
      : FORCED_WEATHER === 'regen'
        ? 'regen'
        : rawPrecip < 0.02
          ? 'geen'
          : cold > 0.55
            ? 'sneeuw'
            : 'regen';

  // Sneeuwdek volgt de winter zelf, niet de laatste bui: het ligt er weken en
  // smelt in het voorjaar weg. Verse sneeuwval legt er een laagje bovenop.
  const cover = Math.max(
    0,
    Math.min(1, cold * 1.5 - 0.22) + (kind === 'sneeuw' ? rawPrecip * 0.25 : 0),
  );

  // Kwantiseren: het palet mag hooguit per dag verschuiven, anders bakt
  // Backdrop elke minuut een nieuwe lucht voor een verschil dat niemand ziet.
  const day = Math.floor(phase * 365);
  const wetStep = Math.round(rawPrecip * 5) / 5;
  const key = `${period}|${day}|${wetStep}|${FORCED ?? ''}|${FORCED_SEASON ?? ''}|${FORCED_WEATHER ?? ''}`;
  if (memo && memo.key === key) return memo.value;

  const base = PALETTES[period];
  // Regen haalt de lucht leeg: minder kleur, minder zon. Dit blijft wereldwijd
  // en traag — het districtweer in Weather.tsx doet het tegenovergestelde en
  // hangt één donkere wolk boven één district.
  const grey = wetStep * 0.45;
  const stops = cachedStops(
    base.stops.map((stop) =>
      mixHex(tintBySeason(stop, mix, SKY_TINT), '#9aa6b4', grey * 0.5),
    ) as [string, string, string, string],
  );

  const value: Daylight = {
    period,
    stops,
    ambient: base.ambient * bySeason(mix, AMBIENT_FACTOR) * (1 - grey * 0.08),
    directional: base.directional * bySeason(mix, DIRECT_FACTOR) * (1 - grey * 0.3),
    lightColor: mixHex(tintBySeason(base.lightColor, mix, LIGHT_TINT), '#cdd6e2', grey * 0.5),
    fogColor: mixHex(tintBySeason(base.fogColor, mix, FOG_TINT), '#9fadbd', grey * 0.55),
    season: FORCED_SEASON ?? dominant(mix),
    seasonMix: mix,
    yearPhase: phase,
    sunrise: bySeason(mix, SUNRISE),
    sunset: bySeason(mix, SUNSET),
    snowCover: cover,
    wetGround: kind === 'sneeuw' ? wetGround * 0.3 : wetGround,
    precip: { kind, intensity: kind === 'geen' ? 0 : Math.min(0.9, rawPrecip) },
    windScale: bySeason(mix, WIND_FACTOR) * (1 + wetStep * 0.3),
    leafTint: tintBySeason(LEAF.zomer, mix, {
      winter: { color: LEAF.winter, amount: 1 },
      lente: { color: LEAF.lente, amount: 1 },
      zomer: { color: LEAF.zomer, amount: 1 },
      herfst: { color: LEAF.herfst, amount: 1 },
    }),
    bareness: bySeason(mix, BARENESS),
  };
  memo = { key, value };
  return value;
}

export function useDaylight(): Daylight {
  // De minuut is de klok van deze hook; alles eromheen wordt eruit afgeleid.
  // Eén state-waarde in plaats van een hele Daylight: zo kan de gecachete
  // objectidentiteit niet per component uit elkaar lopen.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    if (FORCED && FORCED_SEASON && FORCED_WEATHER) return; // volledig bevroren demo
    const timer = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(timer);
  }, []);
  void minute;
  return daylightAt(new Date());
}
