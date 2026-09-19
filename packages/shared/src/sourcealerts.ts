/**
 * Wat er in de bronbestanden op een mens wacht.
 *
 * De actielijst verzamelt alles wat niet vanzelf verder gaat: een handel die
 * op akkoord wacht, een vastgelopen sessie, een storing. Sinds de bronnen
 * bestanden zijn, staat daar ook werk in: een APK die verlopen is, een positie
 * zonder stop, een factuur die niemand betaalde. Dat hoort in dezelfde lijst —
 * anders staat het in een kantoor waar je toevallig wel of niet in kijkt.
 *
 * Pure functie, 0 tokens, dezelfde tabellen als het kantoor. De grenzen zijn
 * getallen in code (`DEADLINE_WINDOWS`, `ALERT_THRESHOLDS`), geen zinnen in
 * een prompt. En er is nooit een knop: ARA kan een APK niet afspreken en een
 * stop niet zetten; de lijst zegt wát er ligt, de eigenaar doet het.
 */
import { DRIVER_TERMS, VEHICLE_TERMS, fleetDeadlines, type Deadline, type Driver, type Vehicle } from './fleet.ts';
import { dayStartUtc, type SourceTables } from './officefeed.ts';
import type { SourceRow } from './sources.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Grenzen die een bronregel tot een actie maken. */
export const ALERT_THRESHOLDS = {
  /** Garagepunt dat langer dan dit open staat. */
  garageOpenDays: 14,
  /** Aanvraag die langer dan dit niet beantwoord is. */
  requestOpenDays: 2,
  /** Opdracht-deadline binnen dit aantal dagen. */
  deadlineSoonDays: 7,
} as const;

export type AlertUrgency = 'blocking' | 'soon' | 'whenever';

export interface SourceAlert {
  /** Stabiel per feit: dezelfde APK geeft morgen dezelfde id. */
  id: string;
  venture: string;
  urgency: AlertUrgency;
  title: string;
  detail: string;
  /** Bestand waar dit uit komt. */
  source: string;
}

const str = (v: SourceRow[string]): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: SourceRow[string]): number | undefined => (typeof v === 'number' ? v : undefined);
const days = (ts: number, now: number): number => Math.round((ts - dayStartUtc(now)) / DAY_MS);

const TERM_LABEL: Record<Deadline['term'], string> = {
  apk: 'APK',
  tachograaf: 'Tachograafkeuring',
  adr: 'ADR-certificaat',
  verzekering: 'Verzekering',
  rijbewijs: 'Rijbewijs',
  code95: 'Code 95',
  chauffeurskaart: 'Chauffeurskaart',
};

/**
 * De termijnen lopen via `fleetDeadlines`, dezelfde functie als `/fleet` —
 * niet een tweede lezing die net anders telt. De rijen zijn hier al
 * getypeerd (registry-kolommen), dus alleen nog in de vorm gieten die de
 * wagenparklezer kent.
 */
function fleetRows(tables: SourceTables): { vehicles: Vehicle[]; drivers: Driver[] } {
  const vehicles: Vehicle[] = (tables['vehicles.csv']?.rows ?? [])
    .filter((r) => str(r.kenteken))
    .map((r) => {
      const terms: Vehicle['terms'] = {};
      const missing: Vehicle['missing'] = [];
      for (const term of VEHICLE_TERMS) {
        const at = num(r[term]);
        if (at === undefined) missing.push(term);
        else terms[term] = at;
      }
      return { kenteken: str(r.kenteken)!.toUpperCase().replace(/\s+/g, ''), km: num(r.km), terms, missing };
    });
  const drivers: Driver[] = (tables['drivers.csv']?.rows ?? [])
    .filter((r) => str(r.naam))
    .map((r) => {
      const terms: Driver['terms'] = {};
      const missing: Driver['missing'] = [];
      for (const term of DRIVER_TERMS) {
        const at = num(r[term]);
        if (at === undefined) missing.push(term);
        else terms[term] = at;
      }
      return { naam: str(r.naam)!, terms, missing };
    });
  return { vehicles, drivers };
}

function fleet(v: string, t: SourceTables, now: number): SourceAlert[] {
  const out: SourceAlert[] = [];
  const { vehicles, drivers } = fleetRows(t);
  for (const d of fleetDeadlines(vehicles, drivers, now)) {
    if (d.window === 'ontbreekt' || d.window === '60') continue;
    const who = d.kind === 'voertuig' ? `wagen ${d.subject}` : d.subject;
    const source = d.kind === 'voertuig' ? 'vehicles.csv' : 'drivers.csv';
    out.push({
      id: `${v}-${source}-${d.subject}-${d.term}`,
      venture: v,
      urgency: d.window === 'verlopen' ? 'blocking' : d.window === '14' ? 'soon' : 'whenever',
      title:
        d.window === 'verlopen'
          ? `${TERM_LABEL[d.term]} van ${who} is ${-d.daysLeft!} dag(en) verlopen`
          : `${TERM_LABEL[d.term]} van ${who} verloopt over ${d.daysLeft} dag(en)`,
      detail:
        d.kind === 'voertuig'
          ? 'Rijdt zonder geldige keuring: boete en stilstand. Afspraak maken bij het keuringsstation is werk voor een mens — ARA plant dat niet.'
          : 'Zonder geldig document mag deze chauffeur niet rijden. Verlengen loopt via de chauffeur zelf.',
      source,
    });
  }
  // Ontbrekende termijnen samengevat: een gat in de administratie is één
  // actie, niet twintig.
  const missing = fleetDeadlines(vehicles, drivers, now).filter((d) => d.window === 'ontbreekt');
  if (missing.length > 0) {
    out.push({
      id: `${v}-fleet-missing`,
      venture: v,
      urgency: 'whenever',
      title: `${missing.length} termijn(en) zonder datum in het wagenpark`,
      detail: `${missing
        .slice(0, 8)
        .map((d) => `${d.subject}: ${TERM_LABEL[d.term]}`)
        .join(', ')}${missing.length > 8 ? ', …' : ''}\n\nEen lege datum ziet eruit als geen probleem. Vul hem in, of laat de kolom weg als de termijn niet geldt.`,
      source: 'vehicles.csv',
    });
  }
  for (const g of t['garage.csv']?.rows ?? []) {
    const gemeld = num(g.gemeld);
    if (g.afgemeld !== undefined || gemeld === undefined) continue;
    const open = -days(gemeld, now);
    if (open <= ALERT_THRESHOLDS.garageOpenDays) continue;
    out.push({
      id: `${v}-garage-${str(g.kenteken)}-${str(g.punt)}`,
      venture: v,
      urgency: 'soon',
      title: `Garagepunt "${str(g.punt) ?? '?'}" van ${str(g.kenteken) ?? '?'} staat ${open} dagen open`,
      detail: 'Langer dan twee weken zonder afmelding: navragen bij de werkplaats of het punt nog bestaat.',
      source: 'garage.csv',
    });
  }
  return out;
}

function tms(v: string, t: SourceTables, now: number): SourceAlert[] {
  const out: SourceAlert[] = [];
  const today = dayStartUtc(now);
  for (const r of t['ritten.csv']?.rows ?? []) {
    const st = str(r.status)?.toLowerCase();
    const eta = num(r.eta);
    const late = eta !== undefined && eta < today && st !== 'geleverd';
    if (st !== 'vertraagd' && !late) continue;
    out.push({
      id: `${v}-rit-${str(r.rit)}`,
      venture: v,
      urgency: 'soon',
      title: `Rit ${str(r.rit) ?? '?'} (${[str(r.van), str(r.naar)].filter(Boolean).join(' → ')}) ${st === 'vertraagd' ? 'is vertraagd' : 'is over zijn ETA'}`,
      detail: 'De klant hoort dit vóór hij belt. Contact met de klant loopt via dispatch, niet via ARA.',
      source: 'ritten.csv',
    });
  }
  for (const f of t['facturen.csv']?.rows ?? []) {
    const due = num(f.vervalt);
    if (f.betaald !== undefined || due === undefined || due >= today) continue;
    const bedrag = num(f.bedrag);
    out.push({
      id: `${v}-factuur-${str(f.factuur)}`,
      venture: v,
      urgency: 'soon',
      title: `Factuur ${str(f.factuur) ?? '?'} aan ${str(f.klant) ?? '?'} is ${-days(due, now)} dag(en) over de vervaldatum`,
      detail: `${bedrag !== undefined ? `€ ${bedrag.toLocaleString('nl-NL')} · ` : ''}Herinnering sturen is een besluit van de eigenaar; ARA schrijft geen klant aan.`,
      source: 'facturen.csv',
    });
  }
  return out;
}

function trading(v: string, t: SourceTables): SourceAlert[] {
  return (t['posities.csv']?.rows ?? [])
    .filter((p) => str(p.instrument) && num(p.stop) === undefined)
    .map((p) => ({
      id: `${v}-nostop-${str(p.instrument)!.toUpperCase()}`,
      venture: v,
      urgency: 'blocking' as const,
      title: `Positie ${str(p.instrument)!.toUpperCase()} (${str(p.richting) ?? '?'}) heeft geen stop`,
      detail: 'Een open positie zonder stop is ongelimiteerd risico. ARA zet geen stop — dat doe jij bij de broker.',
      source: 'posities.csv',
    }));
}

/**
 * Weging tegen de streefverdeling. Crypto per munt; aandelen per sector, want
 * de grenzen daar staan per sector — en dan moet elke positie een `sector`
 * dragen, anders is de som onvolledig en zwijgt dit.
 */
function portfolio(
  v: string,
  t: SourceTables,
  idKey: 'munt' | 'ticker',
  valueKey: string,
  allocFile: string,
  allocKey: string,
  groupKey?: string,
): SourceAlert[] {
  const rows = (t['portefeuille.csv']?.rows ?? []).filter((r) => str(r[idKey]));
  const alloc = t[allocFile]?.rows ?? [];
  if (rows.length === 0 || alloc.length === 0) return [];
  const values = rows.map((r) => num(r[valueKey]));
  // Zonder waarde (en groep) voor élke regel is er geen weging, en dus geen oordeel.
  if (values.some((x) => x === undefined)) return [];
  if (groupKey && rows.some((r) => !str(r[groupKey]))) return [];
  const total = (values as number[]).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const sums = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = str(groupKey ? r[groupKey] : r[idKey])!.toUpperCase();
    sums.set(key, (sums.get(key) ?? 0) + values[i]!);
  });
  const max = new Map(alloc.map((a) => [str(a[allocKey])?.toUpperCase() ?? '', num(a.max_pct)]));
  const out: SourceAlert[] = [];
  for (const [key, sum] of sums) {
    const pct = (sum / total) * 100;
    const lim = max.get(key);
    if (lim === undefined || pct <= lim) continue;
    out.push({
      id: `${v}-over-${key}`,
      venture: v,
      urgency: 'soon',
      title: `${groupKey ? `Sector ${key.toLowerCase()}` : key} weegt ${pct.toFixed(1)}% — boven je grens van ${lim}%`,
      detail: 'Concentratie boven je eigen streefverdeling. Afbouwen of de grens bewust verhogen is jouw besluit; ARA verhandelt niets.',
      source: 'portefeuille.csv',
    });
  }
  return out;
}

function design(v: string, t: SourceTables, now: number): SourceAlert[] {
  const out: SourceAlert[] = [];
  for (const j of t['opdrachten.csv']?.rows ?? []) {
    const st = str(j.status)?.toLowerCase();
    const dl = num(j.deadline);
    if (st === 'af' || dl === undefined) continue;
    const left = days(dl, now);
    if (left >= ALERT_THRESHOLDS.deadlineSoonDays) continue;
    out.push({
      id: `${v}-deadline-${str(j.opdracht)}`,
      venture: v,
      urgency: left < 0 ? 'blocking' : 'soon',
      title:
        left < 0
          ? `Opdracht "${str(j.opdracht)}" voor ${str(j.klant) ?? '?'} is ${-left} dag(en) over de deadline`
          : `Opdracht "${str(j.opdracht)}" voor ${str(j.klant) ?? '?'} moet over ${left} dag(en) af`,
      detail: 'Klantwerk: niets gaat naar buiten zonder de eigenaar. Status bijwerken in opdrachten.csv als dit al geregeld is.',
      source: 'opdrachten.csv',
    });
  }
  return out;
}

function studio(v: string, t: SourceTables, now: number): SourceAlert[] {
  const out: SourceAlert[] = [];
  for (const a of t['aanvragen.csv']?.rows ?? []) {
    const st = str(a.status)?.toLowerCase();
    const at = num(a.ontvangen);
    if (st !== 'nieuw' || at === undefined) continue;
    const open = -days(at, now);
    if (open < ALERT_THRESHOLDS.requestOpenDays) continue;
    out.push({
      id: `${v}-aanvraag-${str(a.van)}-${str(a.onderwerp)}`,
      venture: v,
      urgency: 'soon',
      title: `Aanvraag van ${str(a.van) ?? '?'} ("${str(a.onderwerp) ?? '?'}") wacht ${open} dagen op antwoord`,
      detail: 'Een boekingsaanvraag die stil blijft is een klant die ergens anders boekt. De boekingsflow is van de eigenaar.',
      source: 'aanvragen.csv',
    });
  }
  for (const b of t['boekingen.csv']?.rows ?? []) {
    if (str(b.status)?.toLowerCase() !== 'aanvraag') continue;
    const at = num(b.datum);
    out.push({
      id: `${v}-boeking-${str(b.klant)}-${at ?? '?'}`,
      venture: v,
      urgency: 'soon',
      title: `Boeking van ${str(b.klant) ?? '?'}${at !== undefined ? ` op ${new Date(at).toISOString().slice(0, 10)}` : ''} is nog niet bevestigd`,
      detail: 'Bevestigen of afwijzen is een besluit over de agenda van de studio — van de eigenaar.',
      source: 'boekingen.csv',
    });
  }
  return out;
}

/** Alle acties uit de bronnen van één tak; leeg als er niets ligt of niets gevuld is. */
export function sourceAlerts(ventureId: string, tables: SourceTables, now: number): SourceAlert[] {
  switch (ventureId) {
    case 'blex':
      return fleet(ventureId, tables, now);
    case 'traject':
      return tms(ventureId, tables, now);
    case 'trading':
      return trading(ventureId, tables);
    case 'crypto':
      return portfolio(ventureId, tables, 'munt', 'waarde_usd', 'allocatie.csv', 'munt_of_sector');
    case 'equities':
      return portfolio(ventureId, tables, 'ticker', 'waarde', 'sectorallocatie.csv', 'sector', 'sector');
    case 'elevate':
      return design(ventureId, tables, now);
    case 'uprising':
      return studio(ventureId, tables, now);
    default:
      return [];
  }
}
