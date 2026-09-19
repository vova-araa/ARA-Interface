/**
 * Het wagenpark als data, zonder koppeling.
 *
 * Vijf van de vijf wagenpark-bronnen stonden op `configured: false`, en de
 * eerste twee — voertuigen met hun keuringsdata, chauffeurs met hun
 * termijnen — zijn puur rekenwerk op een lijst die de eigenaar al heeft. Een
 * agent die een verlopende APK vindt is meer waard dan een live koppeling die
 * er niet is. Dus: een CSV die je wekelijks ververst, en dit bestand dat hem
 * leest en de termijnen uitrekent. Geen model komt eraan te pas; de
 * compliance-rol krijgt de vensters kant-en-klaar en hoeft alleen nog te
 * zeggen wat eraan gedaan moet worden.
 *
 * De vier vensters staan hier als getal (`DEADLINE_WINDOWS`), niet als zin in
 * een prompt — regel 1 van dit huis. En een datum die ontbreekt wordt gemeld
 * als ontbrekend, nooit als "waarschijnlijk in orde": bij compliance is een
 * leeg veld het gevaarlijkste wat er is, want het ziet eruit als geen probleem.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dagen tot de vervaldatum waarbinnen een termijn iets te zeggen heeft. */
export const DEADLINE_WINDOWS = { soon: 14, plan: 30, watch: 60 } as const;

export type DeadlineWindow = 'verlopen' | '14' | '30' | '60' | 'ontbreekt';
export type DeadlineTone = 'bad' | 'warn' | 'info';

/** Termijnen per voertuig, in de volgorde van de CSV-kolommen. */
export const VEHICLE_TERMS = ['apk', 'tachograaf', 'adr', 'verzekering'] as const;
/** Termijnen per chauffeur. */
export const DRIVER_TERMS = ['rijbewijs', 'code95', 'chauffeurskaart'] as const;

export type VehicleTerm = (typeof VEHICLE_TERMS)[number];
export type DriverTerm = (typeof DRIVER_TERMS)[number];

export interface Vehicle {
  kenteken: string;
  km?: number;
  /** Vervaldatum per termijn (epoch ms); ontbreekt = niet in de bron. */
  terms: Partial<Record<VehicleTerm, number>>;
  /** Termijnen die in de bron leeg of onleesbaar waren. */
  missing: VehicleTerm[];
}

export interface Driver {
  naam: string;
  terms: Partial<Record<DriverTerm, number>>;
  missing: DriverTerm[];
}

export interface Deadline {
  kind: 'voertuig' | 'chauffeur';
  /** Kenteken of naam. */
  subject: string;
  term: VehicleTerm | DriverTerm;
  dueAt?: number;
  /** Negatief = al verlopen. Ontbreekt bij `ontbreekt`. */
  daysLeft?: number;
  window: DeadlineWindow;
  tone: DeadlineTone;
}

export interface ParsedTable<T> {
  rows: T[];
  /** Regels die niet te lezen waren, met regelnummer — die vallen niet stil weg. */
  errors: string[];
}

// ── CSV ──────────────────────────────────────────────────────────────────
// Bewust klein: een header, `;` of `,` als scheiding (een Nederlandse Excel
// exporteert met `;`), aanhalingstekens om velden met een scheidingsteken.
// Geen streaming, geen encodings-magie — dit zijn lijsten van tientallen
// regels, geen datasets.

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Kolomnaam zoals de bron hem schrijft → zoals wij hem zoeken. */
function normalizeHeader(name: string): string {
  // "Waarde USD", "waarde-usd" en "waarde_usd" zijn dezelfde kolom; het
  // onderstrepingsteken blijft, want de registry schrijft kolommen zo.
  return name
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function parseCsv(text: string): { header: string[]; records: Record<string, string>[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], records: [], errors: ['leeg bestand'] };
  const first = lines[0]!;
  // De scheiding die het vaakst in de kopregel staat, wint.
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitLine(first, sep).map(normalizeHeader);
  const records: Record<string, string>[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]!, sep);
    if (cells.length !== header.length) {
      errors.push(`regel ${i + 1}: ${cells.length} velden, kop heeft ${header.length}`);
      continue;
    }
    const rec: Record<string, string> = {};
    header.forEach((h, j) => (rec[h] = cells[j]!));
    records.push(rec);
  }
  return { header, records, errors };
}

/**
 * Een datum zoals mensen hem in een lijst zetten: 2026-03-14, 14-03-2026,
 * 14/03/2026. Alles anders is geen datum — en dus `undefined`, niet "vandaag".
 */
export function parseDate(raw: string | undefined): number | undefined {
  // Een tijd erachter (ETA "2026-09-20 14:30", ook met T, seconden, ms of Z) mag; de dag telt.
  const s = (raw ?? '').trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/, '');
  if (!s) return undefined;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
    if (!match) return undefined;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const ts = Date.UTC(y, m - 1, d);
  // 31-02 rolt over naar maart; dat is geen datum die iemand bedoelde.
  const back = new Date(ts);
  if (back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return undefined;
  return ts;
}

/**
 * 1.250,50 (NL) → 1250.50; 1,5 → 1.5; 1250.50 (EN) blijft. Eén punt met
 * precies drie cijfers erachter en geen komma (120.500) is een Nederlands
 * duizendtal, geen 120 en een half — de lijsten komen uit een NL-Excel.
 * Eén parser voor álle bronnen: twee lezingen van hetzelfde bestand die een
 * ander getal geven, is erger dan geen getal.
 */
export function parseNumber(raw: string | undefined): number | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  let normalized: string;
  if (s.includes(',') && s.includes('.')) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) normalized = s.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else normalized = s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * vehicles.csv — kolommen: kenteken (verplicht), km, apk, tachograaf, adr,
 * verzekering. Onbekende kolommen worden genegeerd, ontbrekende termijnen
 * worden als ontbrekend gemeld.
 */
export function readVehicles(text: string): ParsedTable<Vehicle> {
  const { header, records, errors } = parseCsv(text);
  if (header.length > 0 && !header.includes('kenteken')) {
    return { rows: [], errors: [...errors, 'kolom "kenteken" ontbreekt in de kopregel'] };
  }
  const rows: Vehicle[] = [];
  records.forEach((rec, i) => {
    const kenteken = (rec.kenteken ?? '').toUpperCase().replace(/\s+/g, '');
    if (!kenteken) {
      errors.push(`regel ${i + 2}: leeg kenteken`);
      return;
    }
    const terms: Vehicle['terms'] = {};
    const missing: VehicleTerm[] = [];
    for (const term of VEHICLE_TERMS) {
      const at = parseDate(rec[term]);
      if (at === undefined) missing.push(term);
      else terms[term] = at;
    }
    rows.push({ kenteken, km: parseNumber(rec.km), terms, missing });
  });
  return { rows, errors };
}

/** drivers.csv — kolommen: naam (verplicht), rijbewijs, code95, chauffeurskaart. */
export function readDrivers(text: string): ParsedTable<Driver> {
  const { header, records, errors } = parseCsv(text);
  if (header.length > 0 && !header.includes('naam')) {
    return { rows: [], errors: [...errors, 'kolom "naam" ontbreekt in de kopregel'] };
  }
  const rows: Driver[] = [];
  records.forEach((rec, i) => {
    const naam = (rec.naam ?? '').trim();
    if (!naam) {
      errors.push(`regel ${i + 2}: lege naam`);
      return;
    }
    const terms: Driver['terms'] = {};
    const missing: DriverTerm[] = [];
    for (const term of DRIVER_TERMS) {
      const at = parseDate(rec[term]);
      if (at === undefined) missing.push(term);
      else terms[term] = at;
    }
    rows.push({ naam, terms, missing });
  });
  return { rows, errors };
}

// ── Termijnen ───────────────────────────────────────────────────────────

function windowFor(daysLeft: number): { window: DeadlineWindow; tone: DeadlineTone } | undefined {
  if (daysLeft < 0) return { window: 'verlopen', tone: 'bad' };
  if (daysLeft <= DEADLINE_WINDOWS.soon) return { window: '14', tone: 'bad' };
  if (daysLeft <= DEADLINE_WINDOWS.plan) return { window: '30', tone: 'warn' };
  if (daysLeft <= DEADLINE_WINDOWS.watch) return { window: '60', tone: 'info' };
  return undefined;
}

/**
 * Alles wat binnen 60 dagen vervalt, al verlopen is, of niet in de bron staat —
 * ergste geval eerst. Wat verder weg ligt staat er niet in: daar valt niets
 * over te zeggen, en een lijst die alles noemt leest niemand.
 */
export function fleetDeadlines(vehicles: Vehicle[], drivers: Driver[], now: number): Deadline[] {
  const out: Deadline[] = [];
  const push = (kind: Deadline['kind'], subject: string, term: Deadline['term'], dueAt: number | undefined) => {
    if (dueAt === undefined) {
      out.push({ kind, subject, term, window: 'ontbreekt', tone: 'warn' });
      return;
    }
    // Een datum heeft geen tijd, dus rekenen vanaf middernacht: een APK van
    // vandaag is vandaag nog geldig, ook om tien uur 's ochtends.
    const daysLeft = Math.round((dueAt - Math.floor(now / DAY_MS) * DAY_MS) / DAY_MS);
    const w = windowFor(daysLeft);
    if (!w) return;
    out.push({ kind, subject, term, dueAt, daysLeft, ...w });
  };
  for (const v of vehicles) {
    for (const term of VEHICLE_TERMS) push('voertuig', v.kenteken, term, v.terms[term]);
  }
  for (const d of drivers) {
    for (const term of DRIVER_TERMS) push('chauffeur', d.naam, term, d.terms[term]);
  }
  // Verlopen vóór aflopend, aflopend op datum, en ontbrekend achteraan: dat
  // laatste is een gat in de administratie, geen wagen die nu stilstaat.
  const rank = (d: Deadline) => (d.window === 'ontbreekt' ? Number.MAX_SAFE_INTEGER : d.daysLeft!);
  return out.sort((a, b) => rank(a) - rank(b) || a.subject.localeCompare(b.subject));
}

export interface FleetSummary {
  verlopen: number;
  binnen14: number;
  binnen30: number;
  binnen60: number;
  ontbreekt: number;
}

export function summarizeDeadlines(deadlines: Deadline[]): FleetSummary {
  const s: FleetSummary = { verlopen: 0, binnen14: 0, binnen30: 0, binnen60: 0, ontbreekt: 0 };
  for (const d of deadlines) {
    if (d.window === 'verlopen') s.verlopen += 1;
    else if (d.window === '14') s.binnen14 += 1;
    else if (d.window === '30') s.binnen30 += 1;
    else if (d.window === '60') s.binnen60 += 1;
    else s.ontbreekt += 1;
  }
  return s;
}
