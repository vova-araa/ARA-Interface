/**
 * Echte werkplekken uit de bronbestanden — zonder reporter-sessie.
 *
 * Een kantoor toonde voorbeeldcijfers totdat een agent ze kwam vervangen via
 * `POST /office/:project/station`. Dat kost per keer een sessie, en het
 * cijfer was daarna niet beter dan wat de agent uit hetzelfde bestand had
 * gelezen. Dus: zodra een bron gevuld is, worden de bureaus hieruit gevuld.
 * Pure functie, 0 tokens, en dezelfde regel als de rest van het kantoor —
 * collector en viewer zien exact hetzelfde.
 *
 * Wat hier staat is uitsluitend wat in het bestand staat. Een kolom die
 * ontbreekt levert geen metric op en geen waarde — niet een nul (regel 4).
 * Een bestand dat wekelijks ververst wordt is na dertig minuten niet
 * "verouderd": elke werkplek draagt zijn eigen termijn (`staleAfterMs`).
 *
 * Er passen twaalf bureaus in een kantoor. Daarom sorteert elke branche op
 * ernst vóór hij afkapt: een verlopen APK op regel dertien van de lijst is
 * anders precies de wagen die je niet ziet. Wat afvalt telt `truncated`.
 */
import type { Metric, StationOverride, StationStatus } from './office.ts';
import { officeKindForVenture } from './office.ts';
import { DEADLINE_WINDOWS, dayStart } from './fleet.ts';
import type { SourceRow } from './sources.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bestanden worden per week ververst; een week plus een dag speling is "nog vers". */
export const FILE_STALE_MS = 8 * DAY_MS;
/** Meer bureaus dan dit staan er niet in een kantoor. */
export const STATION_CAP = 12;

export interface FeedTable {
  rows: SourceRow[];
  /** mtime van het bestand: het moment waarop dit gemeten is. */
  updatedAt?: number;
  /** Eigen verversingstermijn van deze bron (een maandexport is na een week niet oud). */
  staleAfterMs?: number;
}
export type SourceTables = Record<string, FeedTable>;

export interface OfficeFeed {
  entities: string[];
  overrides: StationOverride[];
  /** Regels die niet meer op een bureau pasten; 0 = alles staat er. */
  truncated: number;
}

const str = (v: SourceRow[string]): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: SourceRow[string]): number | undefined => (typeof v === 'number' ? v : undefined);
const dateText = (ts: number | undefined): string | undefined =>
  ts === undefined ? undefined : new Date(ts).toISOString().slice(0, 10);
/** Zie `dayStart` in fleet.ts: een datumkolom heeft geen tijd, dus vandaag is dag 0, niet dag -1. */
export const dayStartUtc = dayStart;
const daysLeft = (ts: number | undefined, now: number): number | undefined =>
  ts === undefined ? undefined : Math.round((ts - dayStart(now)) / DAY_MS);
const money = (n: number | undefined): string | undefined =>
  n === undefined ? undefined : n.toLocaleString('nl-NL', { maximumFractionDigits: 2 });
const plate = (v: SourceRow[string]): string | undefined => str(v)?.toUpperCase().replace(/\s+/g, '');
/** Ontbrekend achteraan, verder oplopend. */
const asc = (a: number | undefined, b: number | undefined): number =>
  (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);

/** Alleen metrics waarvoor een waarde bestaat; een lege regel wordt weggelaten. */
function metrics(pairs: [string, string | undefined, Metric['tone']?][]): Metric[] {
  return pairs
    .filter((p): p is [string, string, Metric['tone']?] => p[1] !== undefined)
    .map(([label, value, tone]) => (tone ? { label, value, tone } : { label, value }));
}

function station(
  id: string,
  source: string,
  table: FeedTable,
  fields: Omit<StationOverride, 'id' | 'updatedAt' | 'staleAfterMs' | 'source'>,
): StationOverride {
  return { id, ...fields, source, updatedAt: table.updatedAt, staleAfterMs: table.staleAfterMs ?? FILE_STALE_MS };
}

/**
 * Van gesorteerde rijen naar een feed: één bureau per id (een dubbele regel
 * in de lijst is één bureau, niet twee), hoogstens STATION_CAP, en de rest
 * geteld in plaats van stilzwijgend weggelaten.
 */
function feed(overrides: StationOverride[]): OfficeFeed {
  const seen = new Set<string>();
  const unique = overrides.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  const kept = unique.slice(0, STATION_CAP);
  return { entities: kept.map((o) => o.id), overrides: kept, truncated: overrides.length - kept.length };
}

// ── per branche ──────────────────────────────────────────────────────────

function fleet(t: SourceTables, now: number): OfficeFeed | undefined {
  const vehicles = t['vehicles.csv'];
  if (!vehicles || vehicles.rows.length === 0) return undefined;
  // Zonder garagelijst is "0 storingen" geen meting maar een gok; dan zwijgt
  // die kolom en heet het bureau niet "rijdend".
  const garage = t['garage.csv']?.rows;
  const openPoints = (kenteken: string): number | undefined =>
    garage === undefined
      ? undefined
      : garage.filter((g) => plate(g.kenteken) === kenteken && g.afgemeld === undefined).length;
  const rows = vehicles.rows
    .filter((v) => plate(v.kenteken))
    .map((v) => ({ v, kenteken: plate(v.kenteken)!, apk: daysLeft(num(v.apk), now) }))
    .map((r) => ({ ...r, open: openPoints(r.kenteken) }))
    // Ergste APK eerst (ontbrekend achteraan), daarna wie het meest in de garage staat.
    .sort((a, b) => asc(a.apk, b.apk) || (b.open ?? 0) - (a.open ?? 0));
  return feed(
    rows.map(({ v, kenteken, apk, open }) => {
      const status: StationStatus =
        apk !== undefined && apk <= DEADLINE_WINDOWS.soon ? 'alert' : (open ?? 0) > 0 ? 'working' : 'idle';
      return station(kenteken, 'vehicles.csv', vehicles, {
        label: kenteken,
        sub: open === undefined ? 'geen garagelijst' : open > 0 ? 'in de garage' : 'rijdend',
        status,
        value: open,
        metrics: metrics([
          ['Kenteken', kenteken],
          ['Km-stand', num(v.km)?.toLocaleString('nl-NL')],
          [
            'APK',
            apk === undefined ? 'ontbreekt' : apk < 0 ? `verlopen (${-apk} d)` : `${apk} d`,
            apk === undefined ? 'warn' : apk <= DEADLINE_WINDOWS.soon ? 'bad' : apk <= DEADLINE_WINDOWS.plan ? 'warn' : undefined,
          ],
          ['Storingen', open === undefined ? undefined : String(open), open ? 'warn' : undefined],
        ]),
      });
    }),
  );
}

const TMS_STATUS: Record<string, StationStatus> = { gepland: 'idle', onderweg: 'working', geleverd: 'done', vertraagd: 'alert' };

function tms(t: SourceTables, now: number): OfficeFeed | undefined {
  const ritten = t['ritten.csv'];
  if (!ritten || ritten.rows.length === 0) return undefined;
  const today = dayStartUtc(now);
  // Vertraagd en onderweg eerst: dat is wat de planner nu wil zien.
  const order: Record<string, number> = { vertraagd: 0, onderweg: 1, gepland: 2, geleverd: 3 };
  const rows = ritten.rows
    .filter((r) => str(r.rit))
    .sort((a, b) => (order[str(a.status)?.toLowerCase() ?? ''] ?? 9) - (order[str(b.status)?.toLowerCase() ?? ''] ?? 9));
  return feed(
    rows.map((r) => {
      const id = str(r.rit)!;
      const st = str(r.status)?.toLowerCase() ?? '';
      const eta = num(r.eta);
      const late = eta !== undefined && eta < today && st !== 'geleverd';
      return station(id, 'ritten.csv', ritten, {
        label: id,
        sub: [str(r.van), str(r.naar)].filter(Boolean).join(' → ') || 'rit',
        status: TMS_STATUS[st] ?? 'idle',
        value: 1,
        metrics: metrics([
          ['Status', str(r.status), st === 'vertraagd' ? 'bad' : undefined],
          ['Voertuig', str(r.kenteken)],
          ['ETA', eta === undefined ? undefined : `${dateText(eta)}${late ? ' · voorbij' : ''}`, late ? 'bad' : undefined],
        ]),
      });
    }),
  );
}

function trading(t: SourceTables): OfficeFeed | undefined {
  const pos = t['posities.csv'];
  if (!pos || pos.rows.length === 0) return undefined;
  // Een positie zonder stop is precies wat de risicobewaker moet zien — vooraan.
  const rows = pos.rows.filter((p) => str(p.instrument)).sort((a, b) => Number(num(a.stop) !== undefined) - Number(num(b.stop) !== undefined));
  return feed(
    rows.map((p) => {
      const id = str(p.instrument)!.toUpperCase();
      const stop = num(p.stop);
      return station(id, 'posities.csv', pos, {
        label: id,
        sub: `${str(p.richting) ?? 'positie'} · open`,
        status: stop === undefined ? 'alert' : 'working',
        value: num(p.pnl),
        metrics: metrics([
          ['Situatie', str(p.richting)],
          ['Nominaal', money(num(p.inzet))],
          ['Ingang', money(num(p.entry))],
          ['Stop', stop === undefined ? 'GEEN STOP' : money(stop), stop === undefined ? 'bad' : undefined],
          ['Open', dateText(num(p.geopend))],
        ]),
      });
    }),
  );
}

/**
 * Weging alleen als élke regel een waarde heeft: één munt zonder waarde maakt
 * elk percentage een gok, en dan liever geen percentage.
 */
function weights(rows: { id: string; value: number | undefined }[]): Map<string, number> | undefined {
  if (rows.some((r) => r.value === undefined)) return undefined;
  const total = rows.reduce((a, r) => a + r.value!, 0);
  if (total <= 0) return undefined;
  return new Map(rows.map((r) => [r.id, (r.value! / total) * 100]));
}

function portfolio(
  t: SourceTables,
  idKey: 'munt' | 'ticker',
  valueKey: string,
  alloc?: { rows: SourceRow[]; key: string },
): OfficeFeed | undefined {
  const pf = t['portefeuille.csv'];
  if (!pf || pf.rows.length === 0) return undefined;
  // Twee regels voor dezelfde munt zijn twee lots: één bureau met de som —
  // dezelfde lezing als de actielijst, anders zegt het bureau "in orde" en de
  // lijst "boven je grens" over hetzelfde bestand.
  const lots = new Map<string, { r: SourceRow; id: string; value: number | undefined; aantal: number | undefined }>();
  for (const r of pf.rows) {
    if (!str(r[idKey])) continue;
    const id = str(r[idKey])!.toUpperCase();
    const prev = lots.get(id);
    const value = num(r[valueKey]);
    const aantal = num(r.aantal);
    if (!prev) lots.set(id, { r, id, value, aantal });
    else {
      prev.value = prev.value === undefined || value === undefined ? undefined : prev.value + value;
      prev.aantal = prev.aantal === undefined || aantal === undefined ? undefined : prev.aantal + aantal;
    }
  }
  const rows = [...lots.values()];
  const w = weights(rows);
  const maxPct = new Map((alloc?.rows ?? []).map((a) => [str(a[alloc!.key])?.toUpperCase() ?? '', num(a.max_pct)]));
  const judged = rows
    .map((x) => {
      const weight = w?.get(x.id);
      const max = maxPct.get(x.id);
      return { ...x, weight, max, over: weight !== undefined && max !== undefined && weight > max };
    })
    // Boven zijn grens eerst, dan de zwaarste posities.
    .sort((a, b) => Number(b.over) - Number(a.over) || (b.weight ?? 0) - (a.weight ?? 0));
  return feed(
    judged.map(({ r, id, value, aantal, weight, max, over }) =>
      station(id, 'portefeuille.csv', pf, {
        label: id,
        sub: weight === undefined ? 'positie' : `${weight.toFixed(1)}% van de portefeuille`,
        status: over ? 'alert' : 'working',
        value,
        metrics: metrics([
          ['Aantal', aantal?.toLocaleString('nl-NL')],
          ['Koers', money(num(r.koers))],
          ['Weging', weight === undefined ? undefined : `${weight.toFixed(1)}%${max !== undefined ? ` (max ${max}%)` : ''}`, over ? 'bad' : undefined],
        ]),
      }),
    ),
  );
}

const DESIGN_STATUS: Record<string, StationStatus> = { offerte: 'idle', lopend: 'working', review: 'alert', af: 'done' };

function design(t: SourceTables, now: number): OfficeFeed | undefined {
  const jobs = t['opdrachten.csv'];
  if (!jobs || jobs.rows.length === 0) return undefined;
  const rows = jobs.rows
    .filter((j) => str(j.opdracht))
    .map((j) => ({ j, left: daysLeft(num(j.deadline), now), st: str(j.status)?.toLowerCase() ?? '' }))
    // Afgerond werk achteraan; daarvoor de krapste deadline eerst.
    .sort((a, b) => Number(a.st === 'af') - Number(b.st === 'af') || asc(a.left, b.left));
  return feed(
    rows.map(({ j, left, st }) =>
      station(str(j.opdracht)!, 'opdrachten.csv', jobs, {
        label: str(j.opdracht)!,
        sub: str(j.klant) ?? 'opdracht',
        status: left !== undefined && left < 7 && st !== 'af' ? 'alert' : DESIGN_STATUS[st] ?? 'idle',
        value: 1,
        metrics: metrics([
          ['Status', str(j.status)],
          ['Klant', str(j.klant)],
          ['Deadline', left === undefined ? undefined : left < 0 ? `${-left} d over tijd` : `${left} d`, left !== undefined && left < 7 ? 'bad' : undefined],
        ]),
      }),
    ),
  );
}

const STUDIO_STATUS: Record<string, StationStatus> = { aanvraag: 'alert', bevestigd: 'working', geannuleerd: 'done' };

function studio(t: SourceTables, now: number): OfficeFeed | undefined {
  const bookings = t['boekingen.csv'];
  if (!bookings || bookings.rows.length === 0) return undefined;
  const today = dayStartUtc(now);
  // Onbeantwoorde aanvragen eerst, dan wat eraan komt op datum (vandaag hoort
  // daarbij), en wat geweest is achteraan.
  const rows = [...bookings.rows].sort((a, b) => {
    const da = num(a.datum);
    const db = num(b.datum);
    const ra = str(a.status)?.toLowerCase() === 'aanvraag' ? 0 : 1;
    const rb = str(b.status)?.toLowerCase() === 'aanvraag' ? 0 : 1;
    const pa = da !== undefined && da < today ? 1 : 0;
    const pb = db !== undefined && db < today ? 1 : 0;
    return ra - rb || pa - pb || asc(da, db);
  });
  return feed(
    rows.map((b, i) => {
      // De datum hoort bij het feit: dezelfde klant in dezelfde ruimte op twee
      // dagen zijn twee boekingen, niet één.
      const id = `${str(b.klant) ?? 'boeking'} · ${str(b.ruimte) ?? i + 1} · ${dateText(num(b.datum)) ?? '?'}`;
      return station(id, 'boekingen.csv', bookings, {
        label: id,
        sub: dateText(num(b.datum)) ?? 'datum ontbreekt',
        status: STUDIO_STATUS[str(b.status)?.toLowerCase() ?? ''] ?? 'idle',
        value: num(b.uren),
        metrics: metrics([
          ['Status', str(b.status)],
          ['Artiest', str(b.klant)],
          ['Uren', num(b.uren)?.toString()],
        ]),
      });
    }),
  );
}

const MUSIC_STATUS: Record<string, StationStatus> = { idee: 'idle', productie: 'working', ingeleverd: 'alert', uit: 'done' };

function music(t: SourceTables): OfficeFeed | undefined {
  const releases = t['releases.csv'];
  const plan = t['releaseplanning.csv'];
  if ((!releases || releases.rows.length === 0) && (!plan || plan.rows.length === 0)) return undefined;
  const planned = (plan?.rows ?? []).filter((p) => str(p.titel) && str(p.status)?.toLowerCase() !== 'uit');
  return feed([
    ...planned.map((p) =>
      station(str(p.titel)!, 'releaseplanning.csv', plan!, {
        label: str(p.titel)!,
        sub: `gepland ${dateText(num(p.geplande_datum)) ?? '—'}`,
        status: MUSIC_STATUS[str(p.status)?.toLowerCase() ?? ''] ?? 'idle',
        value: 0,
        metrics: metrics([
          ['Status', str(p.status)],
          ['Datum', dateText(num(p.geplande_datum))],
        ]),
      }),
    ),
    ...(releases?.rows ?? [])
      .filter((r) => str(r.titel))
      .map((r) =>
        station(str(r.titel)!, 'releases.csv', releases!, {
          label: str(r.titel)!,
          sub: `uit ${dateText(num(r.datum)) ?? '—'}`,
          status: 'done',
          value: num(r.streams),
          metrics: metrics([
            ['Datum', dateText(num(r.datum))],
            ['Streams', num(r.streams)?.toLocaleString('nl-NL')],
          ]),
        }),
      ),
  ]);
}

/**
 * De werkplekken van een tak uit zijn gevulde bronnen. `undefined` betekent:
 * geen bron die dit kantoor kan vullen — dan blijft het bij voorbeeldcijfers,
 * gemarkeerd als zodanig.
 */
export function stationsFromSources(ventureId: string, tables: SourceTables, now: number): OfficeFeed | undefined {
  switch (officeKindForVenture(ventureId)) {
    case 'fleet':
      return fleet(tables, now);
    case 'tms':
      return tms(tables, now);
    case 'trading':
      return trading(tables);
    case 'crypto':
      return portfolio(tables, 'munt', 'waarde_usd', tables['allocatie.csv'] ? { rows: tables['allocatie.csv'].rows, key: 'munt_of_sector' } : undefined);
    case 'equities':
      return portfolio(tables, 'ticker', 'waarde');
    case 'design':
      return design(tables, now);
    case 'studio':
      return studio(tables, now);
    case 'music':
      return music(tables);
    default:
      return undefined;
  }
}
