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
 * ontbreekt levert geen metric op, niet een verzonnen waarde (regel 4). Een
 * bestand dat wekelijks ververst wordt is na dertig minuten niet "verouderd":
 * elke werkplek draagt zijn eigen termijn (`staleAfterMs`) in plaats van de
 * dertig minuten die voor een agent-push gelden.
 */
import type { Metric, StationOverride, StationStatus } from './office.ts';
import { officeKindForVenture } from './office.ts';
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
}
export type SourceTables = Record<string, FeedTable>;

export interface OfficeFeed {
  entities: string[];
  overrides: StationOverride[];
}

const str = (v: SourceRow[string]): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: SourceRow[string]): number | undefined => (typeof v === 'number' ? v : undefined);
const dateText = (ts: number | undefined): string | undefined =>
  ts === undefined ? undefined : new Date(ts).toISOString().slice(0, 10);
const daysLeft = (ts: number | undefined, now: number): number | undefined =>
  ts === undefined ? undefined : Math.floor((ts - now) / DAY_MS);
const money = (n: number | undefined): string | undefined =>
  n === undefined ? undefined : n.toLocaleString('nl-NL', { maximumFractionDigits: 2 });

/** Alleen metrics waarvoor een waarde bestaat; een lege regel wordt weggelaten. */
function metrics(pairs: [string, string | undefined, Metric['tone']?][]): Metric[] {
  return pairs
    .filter((p): p is [string, string, Metric['tone']?] => p[1] !== undefined)
    .map(([label, value, tone]) => (tone ? { label, value, tone } : { label, value }));
}

function station(
  id: string,
  updatedAt: number | undefined,
  fields: Omit<StationOverride, 'id' | 'updatedAt' | 'staleAfterMs'>,
): StationOverride {
  return { id, ...fields, updatedAt, staleAfterMs: FILE_STALE_MS };
}

// ── per branche ──────────────────────────────────────────────────────────

function fleet(t: SourceTables, now: number): OfficeFeed | undefined {
  const vehicles = t['vehicles.csv'];
  if (!vehicles || vehicles.rows.length === 0) return undefined;
  const garage = t['garage.csv']?.rows ?? [];
  const openPoints = (kenteken: string) =>
    garage.filter((g) => str(g.kenteken)?.toUpperCase().replace(/\s+/g, '') === kenteken && g.afgemeld === undefined).length;
  const overrides = vehicles.rows.slice(0, STATION_CAP).map((v) => {
    const kenteken = str(v.kenteken)!.toUpperCase().replace(/\s+/g, '');
    const apk = daysLeft(num(v.apk), now);
    const open = openPoints(kenteken);
    const status: StationStatus = apk !== undefined && apk <= 14 ? 'alert' : open > 0 ? 'working' : 'idle';
    return station(kenteken, vehicles.updatedAt, {
      label: kenteken,
      sub: open > 0 ? 'in de garage' : 'rijdend',
      status,
      value: open,
      metrics: metrics([
        ['Kenteken', kenteken],
        ['Km-stand', num(v.km)?.toLocaleString('nl-NL')],
        ['APK', apk === undefined ? 'ontbreekt' : apk < 0 ? `verlopen (${-apk} d)` : `${apk} d`, apk === undefined ? 'warn' : apk <= 14 ? 'bad' : apk <= 30 ? 'warn' : undefined],
        ['Storingen', String(open), open > 0 ? 'warn' : undefined],
      ]),
    });
  });
  return { entities: overrides.map((o) => o.id), overrides };
}

const TMS_STATUS: Record<string, StationStatus> = { gepland: 'idle', onderweg: 'working', geleverd: 'done', vertraagd: 'alert' };

function tms(t: SourceTables, now: number): OfficeFeed | undefined {
  const ritten = t['ritten.csv'];
  if (!ritten || ritten.rows.length === 0) return undefined;
  // Vertraagd en onderweg eerst: dat is wat de planner nu wil zien.
  const order: Record<string, number> = { vertraagd: 0, onderweg: 1, gepland: 2, geleverd: 3 };
  const rows = [...ritten.rows].sort(
    (a, b) => (order[str(a.status)?.toLowerCase() ?? ''] ?? 9) - (order[str(b.status)?.toLowerCase() ?? ''] ?? 9),
  );
  const overrides = rows.slice(0, STATION_CAP).map((r) => {
    const id = str(r.rit)!;
    const st = str(r.status)?.toLowerCase() ?? '';
    const eta = num(r.eta);
    return station(id, ritten.updatedAt, {
      label: id,
      sub: [str(r.van), str(r.naar)].filter(Boolean).join(' → ') || 'rit',
      status: TMS_STATUS[st] ?? 'idle',
      value: 1,
      metrics: metrics([
        ['Status', str(r.status), st === 'vertraagd' ? 'bad' : undefined],
        ['Voertuig', str(r.kenteken)],
        ['ETA', eta === undefined ? undefined : `${dateText(eta)}${eta < now && st !== 'geleverd' ? ' · voorbij' : ''}`, eta !== undefined && eta < now && st !== 'geleverd' ? 'bad' : undefined],
      ]),
    });
  });
  return { entities: overrides.map((o) => o.id), overrides };
}

function trading(t: SourceTables): OfficeFeed | undefined {
  const pos = t['posities.csv'];
  if (!pos || pos.rows.length === 0) return undefined;
  const overrides = pos.rows.slice(0, STATION_CAP).map((p) => {
    const id = str(p.instrument)!;
    const stop = num(p.stop);
    return station(id, pos.updatedAt, {
      label: id,
      sub: `${str(p.richting) ?? 'positie'} · open`,
      // Een positie zonder stop is precies wat de risicobewaker moet zien.
      status: stop === undefined ? 'alert' : 'working',
      value: num(p.pnl) ?? 0,
      metrics: metrics([
        ['Situatie', str(p.richting)],
        ['Nominaal', money(num(p.inzet))],
        ['Ingang', money(num(p.entry))],
        ['Stop', stop === undefined ? 'GEEN STOP' : money(stop), stop === undefined ? 'bad' : undefined],
        ['Open', dateText(num(p.geopend))],
      ]),
    });
  });
  return { entities: overrides.map((o) => o.id), overrides };
}

/**
 * Weging alleen als élke regel een waarde heeft: één munt zonder waarde maakt
 * elk percentage een gok, en dan liever geen percentage.
 */
function weights(rows: SourceRow[], key: string): Map<string, number> | undefined {
  const values = rows.map((r) => num(r[key]));
  if (values.some((v) => v === undefined)) return undefined;
  const total = (values as number[]).reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  return new Map(rows.map((r, i) => [String(r.munt ?? r.ticker ?? i), (values[i]! / total) * 100]));
}

function portfolio(t: SourceTables, idKey: 'munt' | 'ticker', valueKey: string, alloc?: { rows: SourceRow[]; key: string }): OfficeFeed | undefined {
  const pf = t['portefeuille.csv'];
  if (!pf || pf.rows.length === 0) return undefined;
  const w = weights(pf.rows, valueKey);
  const maxPct = new Map((alloc?.rows ?? []).map((a) => [str(a[alloc!.key])?.toUpperCase() ?? '', num(a.max_pct)]));
  const overrides = pf.rows.slice(0, STATION_CAP).map((r) => {
    const id = str(r[idKey])!.toUpperCase();
    const weight = w?.get(String(r[idKey]));
    const max = maxPct.get(id);
    const over = weight !== undefined && max !== undefined && weight > max;
    return station(id, pf.updatedAt, {
      label: id,
      sub: weight === undefined ? 'positie' : `${weight.toFixed(1)}% van de portefeuille`,
      status: over ? 'alert' : 'working',
      value: num(r[valueKey]) ?? 0,
      metrics: metrics([
        ['Aantal', num(r.aantal)?.toLocaleString('nl-NL')],
        ['Koers', money(num(r.koers))],
        ['Weging', weight === undefined ? undefined : `${weight.toFixed(1)}%${max !== undefined ? ` (max ${max}%)` : ''}`, over ? 'bad' : undefined],
      ]),
    });
  });
  return { entities: overrides.map((o) => o.id), overrides };
}

const DESIGN_STATUS: Record<string, StationStatus> = { offerte: 'idle', lopend: 'working', review: 'alert', af: 'done' };

function design(t: SourceTables, now: number): OfficeFeed | undefined {
  const jobs = t['opdrachten.csv'];
  if (!jobs || jobs.rows.length === 0) return undefined;
  const overrides = jobs.rows.slice(0, STATION_CAP).map((j) => {
    const id = str(j.opdracht)!;
    const left = daysLeft(num(j.deadline), now);
    const st = str(j.status)?.toLowerCase() ?? '';
    return station(id, jobs.updatedAt, {
      label: id,
      sub: str(j.klant) ?? 'opdracht',
      status: left !== undefined && left < 7 && st !== 'af' ? 'alert' : DESIGN_STATUS[st] ?? 'idle',
      value: 1,
      metrics: metrics([
        ['Status', str(j.status)],
        ['Klant', str(j.klant)],
        ['Deadline', left === undefined ? undefined : left < 0 ? `${-left} d over tijd` : `${left} d`, left !== undefined && left < 7 ? 'bad' : undefined],
      ]),
    });
  });
  return { entities: overrides.map((o) => o.id), overrides };
}

const STUDIO_STATUS: Record<string, StationStatus> = { aanvraag: 'alert', bevestigd: 'working', geannuleerd: 'done' };

function studio(t: SourceTables, now: number): OfficeFeed | undefined {
  const bookings = t['boekingen.csv'];
  if (!bookings || bookings.rows.length === 0) return undefined;
  // Wat eraan komt, op datum; wat geweest is achteraan.
  const rows = [...bookings.rows].sort((a, b) => {
    const da = num(a.datum) ?? Number.MAX_SAFE_INTEGER;
    const db = num(b.datum) ?? Number.MAX_SAFE_INTEGER;
    const pa = da < now ? 1 : 0;
    const pb = db < now ? 1 : 0;
    return pa - pb || da - db;
  });
  const overrides = rows.slice(0, STATION_CAP).map((b, i) => {
    const id = `${str(b.klant) ?? 'boeking'} · ${str(b.ruimte) ?? i + 1}`;
    return station(id, bookings.updatedAt, {
      label: id,
      sub: dateText(num(b.datum)) ?? 'datum ontbreekt',
      status: STUDIO_STATUS[str(b.status)?.toLowerCase() ?? ''] ?? 'idle',
      value: num(b.uren) ?? 1,
      metrics: metrics([
        ['Status', str(b.status)],
        ['Artiest', str(b.klant)],
        ['Uren', num(b.uren)?.toString()],
      ]),
    });
  });
  return { entities: overrides.map((o) => o.id), overrides };
}

const MUSIC_STATUS: Record<string, StationStatus> = { idee: 'idle', productie: 'working', ingeleverd: 'alert', uit: 'done' };

function music(t: SourceTables): OfficeFeed | undefined {
  const releases = t['releases.csv'];
  const plan = t['releaseplanning.csv'];
  if ((!releases || releases.rows.length === 0) && (!plan || plan.rows.length === 0)) return undefined;
  const planned = (plan?.rows ?? []).filter((p) => str(p.status)?.toLowerCase() !== 'uit');
  const overrides: StationOverride[] = [
    ...planned.map((p) =>
      station(str(p.titel)!, plan!.updatedAt, {
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
    ...(releases?.rows ?? []).map((r) =>
      station(str(r.titel)!, releases!.updatedAt, {
        label: str(r.titel)!,
        sub: `uit ${dateText(num(r.datum)) ?? '—'}`,
        status: 'done',
        value: num(r.streams) ?? 0,
        metrics: metrics([
          ['Datum', dateText(num(r.datum))],
          ['Streams', num(r.streams)?.toLocaleString('nl-NL')],
        ]),
      }),
    ),
  ].slice(0, STATION_CAP);
  return { entities: overrides.map((o) => o.id), overrides };
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
