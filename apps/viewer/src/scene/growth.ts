import type { SessionState } from '@ara/shared';

/**
 * Hoeveel stad een project verdient.
 *
 * De skyline is het dashboard: waar gewerkt wordt bouwt de stad uit, waar het
 * stil blijft vervalt ze. Dat vraagt om één getal per project waar de hele
 * bebouwing uit volgt, en dat getal moet uit echte cijfers komen — de sessies
 * die de collector nog heeft, meer is er niet. Een project zonder sessies is
 * dus *stil*, niet *onbekend*: we tekenen een vervallen dorp, geen vraagteken.
 *
 * Twee getallen, omdat ze verschillende dingen doen: `score` bepaalt hoevéél
 * er staat (panden, verdiepingen), `idle` hoe het eruitziet (kleur, daken,
 * onkruid). Ze lopen niet gelijk op — een project dat vorige week hard liep en
 * nu zwijgt houdt nog even zijn torens, maar wordt wel meteen dof.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Verder terug dan dit kijken we niet. De collector bewaart sessies maar een
 * beperkte tijd, dus alles wat ouder is bestaat voor de wereld simpelweg niet;
 * doen alsof we het weten zou de skyline laten liegen.
 */
const WINDOW_MS = 7 * DAY;
/** Werk van gisteren telt half zo zwaar als dat van vandaag. */
const HALF_LIFE_MS = 2 * DAY;
/** Een sessie van dit formaat telt als één volle werkbeurt. */
const SESSION_UNIT_MS = 20 * MINUTE;
/** Eén marathonsessie is geen district: de duur telt mee, maar begrensd. */
const MAX_SESSION_WEIGHT = 2.5;
const MIN_SESSION_WEIGHT = 0.3;
/** Zoveel gewogen werkbeurten in het venster = een volgroeide stad. */
const FULL_CITY = 10;
/** Een dag niets is een weekend, geen verval. Daarna begint het te tellen. */
const DECAY_GRACE_MS = DAY;

export interface Growth {
  /** 0..1 — hoeveel er gebouwd staat. */
  score: number;
  /** 0..1 — hoe lang het stil is; 1 = een week lang niets. */
  idle: number;
}

/** Wat een project krijgt waar niets van bekend is: een stil dorp. */
export const SILENT: Growth = { score: 0, idle: 1 };

/**
 * Sessies → activiteit per project. `now` komt uit de snapshot zelf, zodat de
 * stad tijdens een history-scrub het verleden laat zien in plaats van de klok
 * van de browser.
 */
export function growthByProject(
  sessions: Record<string, SessionState>,
  now: number,
): Map<string, Growth> {
  const work = new Map<string, number>();
  const newest = new Map<string, number>();

  for (const session of Object.values(sessions)) {
    // Een lopende sessie heeft geen eind; dan is "tot nu toe" haar staart.
    const seen = session.endedAt ?? session.lastSeenAt;
    const age = now - seen;
    if (age > WINDOW_MS) continue;

    const busy = Math.max(0, seen - session.startedAt);
    const size = Math.min(
      MAX_SESSION_WEIGHT,
      Math.max(MIN_SESSION_WEIGHT, busy / SESSION_UNIT_MS),
    );
    const fade = Math.pow(0.5, Math.max(0, age) / HALF_LIFE_MS);
    work.set(session.project, (work.get(session.project) ?? 0) + size * fade);
    newest.set(session.project, Math.max(newest.get(session.project) ?? 0, seen));
  }

  const out = new Map<string, Growth>();
  for (const [project, total] of work) {
    // Logaritmisch: het verschil tussen niets en iets moet groot zijn, dat
    // tussen druk en drukker klein — anders walst één project de rest plat.
    const score = Math.min(1, Math.log1p(total) / Math.log1p(FULL_CITY));
    const since = now - (newest.get(project) ?? 0);
    const idle = clamp01((since - DECAY_GRACE_MS) / (WINDOW_MS - DECAY_GRACE_MS));
    out.set(project, { score, idle });
  }
  return out;
}

/**
 * Percelen per hex. Vijf is het maximum dat op deze schaal nog als straat
 * leest; daarboven wordt het een kluwen. Een district met weinig activiteit
 * gebruikt er één, een bruisend district alle vijf.
 */
const PLOT_THRESHOLDS = [0, 0.14, 0.32, 0.52, 0.74];
export const PLOTS_PER_HEX = PLOT_THRESHOLDS.length;

/**
 * Vanaf welke score op dit perceel gebouwd wordt. Het eerste perceel staat er
 * altijd: een stil project is vervallen, niet weggevaagd. De jitter (±0.05)
 * zorgt dat een groeiend district niet in één klap vijf panden tegelijk krijgt.
 */
export function plotThreshold(index: number, jitter: number): number {
  const base = PLOT_THRESHOLDS[Math.min(index, PLOT_THRESHOLDS.length - 1)] ?? 1;
  return base <= 0 ? 0 : base + jitter;
}

/** Hoogte van één verdieping; ook de periode van de raamstroken in de shader. */
export const FLOOR_H = 0.23;

/**
 * Verdiepingen als kommagetal, met opzet: een pand dat bij elke nieuwe sessie
 * een hele verdieping omhoog springt trekt de aandacht naar de sprong in
 * plaats van naar de groei. Zo groeit hij er doorheen en komt de volgende
 * raamstrook vanzelf tevoorschijn.
 *
 * `tower` (0..1) kwadratisch: de meeste percelen blijven laagbouw en een enkel
 * perceel schiet echt de lucht in, wat een skyline een silhouet geeft.
 */
export function floorsFor(score: number, tower: number): number {
  return 1 + score * (1.2 + tower * tower * 6);
}

/**
 * Hoe "aanwezig" een perceel is (0..1). Een zachte band rond de drempel in
 * plaats van aan/uit, zodat een pand de grond uit groeit in plaats van te
 * verschijnen.
 */
const THRESHOLD_BAND = 0.07;
export function presenceOf(score: number, threshold: number): number {
  const t = clamp01((score - threshold + THRESHOLD_BAND) / (THRESHOLD_BAND * 2));
  return t * t * (3 - 2 * t);
}

/**
 * Hoe wild het onkruid op een leeg perceel staat. Ook een druk district heeft
 * groene plekken — pas stilte laat ze echt overwoekeren.
 */
export function weedsOf(presence: number, idle: number): number {
  return (1 - presence) * (0.3 + 0.7 * idle);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
