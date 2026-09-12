/**
 * Kantoor-model: elk project (huisje op de kaart) heeft een eigen kantoor,
 * geperfectioneerd voor zijn branche. Een kantoor bestaat uit werkplekken
 * (stations) met branche-specifieke cijfers, een muurpaneel met KPI's, een
 * feitenfeed, de bezetting (supervisor/manager/agents) en een vergaderruimte.
 *
 * De samenstelling gebeurt hier zodat collector én viewer exact hetzelfde
 * kantoor zien (dezelfde symmetrie-regel als de WorldState-reducer).
 */
import { stableHash } from './hex.ts';
import type { SessionState } from './schema.ts';
import type { VentureStyle } from './world.ts';

/** Branche van een kantoor — bepaalt layout, kolommen en woordenschat. */
export type OfficeKind =
  | 'trading'
  | 'crypto'
  | 'tms'
  | 'fleet'
  | 'design'
  | 'studio'
  | 'music'
  | 'generic';

export type Tone = 'good' | 'bad' | 'warn' | 'muted' | 'info';
export type StationStatus = 'idle' | 'working' | 'alert' | 'done';

export interface Metric {
  label: string;
  value: string;
  tone?: Tone;
}

/** Uitgebreid paneel dat opent als je op een werkplek klikt. */
export interface StationDetail {
  title: string;
  subtitle: string;
  kpis: Metric[];
  /** "Belofte × geleverd": plan-cijfer naast de echte uitkomst. */
  plannedVsActual: { label: string; planned: string; actual: string }[];
  curve: number[];
  note?: string;
}

/** Eén werkplek: een bureau met een scherm en (soms) een agent erachter. */
export interface Station {
  id: string;
  label: string;
  sub: string;
  status: StationStatus;
  /** Zwevend cijfer boven het bureau (geld, aantal of tijd — zie valueKind). */
  value: number;
  metrics: Metric[];
  detail: StationDetail;
  /** Naam van de agent die hier werkt; leeg = onbemand bureau. */
  agentName?: string;
  agentId?: string;
  sessionId?: string;
}

export interface OfficeFact {
  ts: number;
  text: string;
  tone: Tone;
}

export interface StaffMember {
  id: string;
  name: string;
  role: 'supervisor' | 'manager' | 'agent' | 'scout' | 'ops';
  status: string;
  busyWith?: string;
  sessionId?: string;
}

export interface RoomMessage {
  from: string;
  text: string;
  /** Rechts = de leidinggevende die vraagt, links = het team dat antwoordt. */
  side: 'left' | 'right';
}

export interface OfficeSnapshot {
  project: string;
  venture: string;
  ventureLabel: string;
  kind: OfficeKind;
  /** Bordtekst boven in het kantoor, bv. "HANDELSVLOER — LIVE". */
  title: string;
  headline: { label: string; value: string; delta?: string; tone?: Tone };
  kpis: Metric[];
  chart: number[];
  facts: OfficeFact[];
  stations: Station[];
  staff: StaffMember[];
  room: { name: string; status: string; messages: RoomMessage[] };
  /** Eenheid van het zwevende cijfer boven de bureaus. */
  valueKind: 'money' | 'count' | 'time' | 'none';
  /**
   * true = de branche-cijfers zijn nog niet door agents aangeleverd en worden
   * deterministisch ingevuld zodat het kantoor leesbaar is. De UI toont dit.
   */
  simulated: boolean;
  now: number;
}

export const OFFICE_KIND_BY_VENTURE: Record<string, OfficeKind> = {
  traject: 'tms',
  blex: 'fleet',
  trading: 'trading',
  crypto: 'crypto',
  elevate: 'design',
  uprising: 'studio',
  vovara: 'music',
  misc: 'generic',
};

export function officeKindForVenture(ventureId: string): OfficeKind {
  return OFFICE_KIND_BY_VENTURE[ventureId] ?? 'generic';
}

/** Woordenschat per branche: zo praat elk kantoor zijn eigen taal. */
interface KindSpec {
  title: string;
  roomName: string;
  /** Kop van de grote teller op de muur. */
  headlineLabel: string;
  valueKind: OfficeSnapshot['valueKind'];
  /** Standaard-entiteiten (bureaus) als org.json er nog geen levert. */
  entities: string[];
  entityWord: string;
  /** Labels voor de vier muur-KPI's. */
  kpiLabels: [string, string, string, string];
  stationSub: (index: number, seed: number) => string;
  metricLabels: string[];
  planLabels: string[];
}

const KIND_SPECS: Record<OfficeKind, KindSpec> = {
  trading: {
    title: 'HANDELSVLOER — LIVE',
    roomName: 'Zaal QUANT',
    headlineLabel: 'PORTEFEUILLE',
    valueKind: 'money',
    entities: ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'NAS100', 'SPX500', 'BRENT', 'WTI', 'DAX40', 'AUDUSD'],
    entityWord: 'setups',
    kpiLabels: ['Setups in de lucht', 'Aanhechting', 'Live trefkans', 'Risico benut'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 4)} setups`,
    metricLabels: ['Situatie', 'Nominaal', 'Aantal', 'Ingang', 'Stop', 'Doel', 'Open', 'P&L vandaag', 'Trades', 'Trefkans'],
    planLabels: ['Trades', 'Trefkans', 'Winstfactor'],
  },
  crypto: {
    title: 'CRYPTO-VLOER — LIVE',
    roomName: 'Zaal ONCHAIN',
    headlineLabel: 'PORTEFEUILLE',
    valueKind: 'money',
    entities: ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'LINK', 'UNI', 'AAVE', 'DOGE', 'XLM', 'INJ', 'PAXG', 'SUI', 'TAO', 'NEAR', 'ZEC', 'HYPE'],
    entityWord: 'setups',
    kpiLabels: ['Setups in de lucht', 'Aanhechting', 'Live trefkans', 'Blootstelling'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 5)} setups`,
    metricLabels: ['Situatie', 'Nominaal', 'Aantal', 'Ingang', 'Stop', 'Doel', 'Open', 'P&L vandaag', 'Trades', 'Trefkans'],
    planLabels: ['Trades', 'Trefkans', 'Winstfactor'],
  },
  tms: {
    title: 'PLANNING — RITTEN VANDAAG',
    roomName: 'Zaal PLANNING',
    headlineLabel: 'OMZET RITTEN',
    valueKind: 'count',
    entities: ['NL-DE Venlo', 'NL-BE Antwerpen', 'DE-PL Poznań', 'NL-FR Lille', 'BE-DE Keulen', 'NL-NL Randstad', 'DE-AT Wenen', 'NL-DK Aarhus', 'FR-ES Girona', 'NL-CZ Praag', 'DE-IT Milaan', 'NL-UK Dover'],
    entityWord: 'ritten',
    kpiLabels: ['Ritten gepland', 'Bezetting', 'Op tijd', 'Lege km'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 6)} ritten`,
    metricLabels: ['Status', 'Chauffeur', 'Voertuig', 'Vertrek', 'ETA', 'Afstand', 'Lading', 'Bezetting', 'Stops', 'Marge'],
    planLabels: ['Ritten', 'Op tijd', 'Marge'],
  },
  fleet: {
    title: 'WAGENPARK — WERKPLAATS',
    roomName: 'Zaal GARAGE',
    headlineLabel: 'VLOOTWAARDE',
    valueKind: 'count',
    entities: ['Truck 41', 'Truck 42', 'Truck 47', 'Truck 53', 'Trailer T-08', 'Trailer T-11', 'Trailer T-19', 'Truck 61', 'Trailer T-24', 'Truck 66', 'Trailer T-30', 'Truck 72'],
    entityWord: 'checks',
    kpiLabels: ['Rijdend', 'In de garage', 'APK < 30 dagen', 'Storingen open'],
    stationSub: (i, seed) => ((seed + i) % 4 === 0 ? 'in de garage' : 'rijdend'),
    metricLabels: ['Status', 'Kenteken', 'Km-stand', 'APK', 'Onderhoud', 'Banden', 'Storingen', 'Chauffeur', 'Verbruik', 'Beschikbaar'],
    planLabels: ['Beschikbaarheid', 'Onderhoud op tijd', 'Storingen'],
  },
  design: {
    title: 'STUDIO — LOPEND WERK',
    roomName: 'Zaal CONCEPT',
    headlineLabel: 'ACTIEVE OPDRACHTEN',
    valueKind: 'count',
    entities: ['Campagne Lente', 'Merkgids', 'Webshop-hero', 'Social pack', 'Verpakking', 'Pitch-deck', 'Nieuwsbrief', 'Billboard', 'Productfoto', 'Logo-refresh'],
    entityWord: 'concepten',
    kpiLabels: ['Opdrachten open', 'In review', 'Goedgekeurd', 'Deadline < 7d'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 3)} concepten`,
    metricLabels: ['Status', 'Klant', 'Fase', 'Revisies', 'Deadline', 'Formaten', 'Feedback', 'Assets', 'Goedkeuring', 'Uren'],
    planLabels: ['Concepten', 'Revisierondes', 'Op tijd'],
  },
  studio: {
    title: 'STUDIO — PRODUCTIE',
    roomName: 'Zaal REGIE',
    headlineLabel: 'LOPENDE PRODUCTIES',
    valueKind: 'count',
    entities: ['Sessie A', 'Sessie B', 'Mix-room', 'Master', 'Boeking NL', 'Boeking DE', 'Site-release', 'Audio-tool', 'Podcast', 'Live-set'],
    entityWord: 'takes',
    kpiLabels: ['Producties', 'Boekingen', 'Opgeleverd', 'Wachtrij'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 4)} takes`,
    metricLabels: ['Status', 'Artiest', 'Fase', 'Takes', 'Lengte', 'Mix', 'Master', 'Release', 'Kanaal', 'Uren'],
    planLabels: ['Takes', 'Opgeleverd', 'Op tijd'],
  },
  music: {
    title: 'MUZIEK — RELEASES',
    roomName: 'Zaal RELEASE',
    headlineLabel: 'STREAMS DEZE MAAND',
    valueKind: 'count',
    entities: ['Single 1', 'Single 2', 'EP-track A', 'EP-track B', 'Remix', 'Videoclip', 'Promo NL', 'Promo DE', 'Playlist-pitch', 'Merch'],
    entityWord: 'tracks',
    kpiLabels: ['Releases', 'Playlists', 'Streams vandaag', 'Promo open'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 3)} tracks`,
    metricLabels: ['Status', 'Titel', 'Fase', 'Duur', 'Mix', 'Master', 'Datum', 'Kanalen', 'Streams', 'Promo'],
    planLabels: ['Releases', 'Streams', 'Playlists'],
  },
  generic: {
    title: 'KANTOOR — LOPEND WERK',
    roomName: 'Zaal OVERLEG',
    headlineLabel: 'OPEN WERK',
    valueKind: 'count',
    entities: ['Werkpakket 1', 'Werkpakket 2', 'Werkpakket 3', 'Werkpakket 4', 'Werkpakket 5', 'Werkpakket 6', 'Werkpakket 7', 'Werkpakket 8'],
    entityWord: 'taken',
    kpiLabels: ['Taken open', 'In behandeling', 'Afgerond', 'Geblokkeerd'],
    stationSub: (i, seed) => `${1 + ((seed + i) % 3)} taken`,
    metricLabels: ['Status', 'Eigenaar', 'Fase', 'Voortgang', 'Sinds', 'Prioriteit', 'Blokkades', 'Resultaat', 'Review', 'Uren'],
    planLabels: ['Taken', 'Afgerond', 'Op tijd'],
  },
};

export function officeSpec(kind: OfficeKind): { title: string; roomName: string; entityWord: string } {
  const spec = KIND_SPECS[kind];
  return { title: spec.title, roomName: spec.roomName, entityWord: spec.entityWord };
}

export interface BoardTaskLite {
  id: string;
  title: string;
  detail: string;
  status: string;
  assignee: string;
  createdBy: string;
  updatedAt: number;
}

export interface StationOverride {
  id: string;
  label?: string;
  sub?: string;
  status?: StationStatus;
  value?: number;
  metrics?: Metric[];
}

export interface OfficeInput {
  project: string;
  venture: VentureStyle;
  sessions: SessionState[];
  tasks: BoardTaskLite[];
  /** Branche-entiteiten uit org.json (munten, wagens, routes…). */
  entities?: string[];
  /** Echte, door agents aangeleverde werkplek-data. */
  overrides?: StationOverride[];
  now: number;
}

/** Deterministische pseudo-waarde in [0,1) voor een sleutel. */
function rnd(key: string): number {
  return (stableHash(key) % 10_000) / 10_000;
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '+';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function statusFor(index: number, working: number, seed: string): StationStatus {
  if (index < working) return 'working';
  const r = rnd(`${seed}-st`);
  if (r > 0.93) return 'alert';
  if (r > 0.82) return 'done';
  return 'idle';
}

/**
 * Stelt het volledige kantoor samen uit live sessie-/agent-/bordgegevens plus
 * de branche-entiteiten. Alles wat niet uit echte data komt is deterministisch
 * (zelfde project = zelfde kantoor) en wordt met `simulated` gemarkeerd.
 */
export function buildOffice(input: OfficeInput): OfficeSnapshot {
  const { project, venture, sessions, tasks, now } = input;
  const kind = officeKindForVenture(venture.id);
  const spec = KIND_SPECS[kind];
  const entities = input.entities?.length ? input.entities : spec.entities;
  const overrides = new Map((input.overrides ?? []).map((o) => [o.id, o]));
  const simulated = overrides.size === 0;
  const seed = stableHash(project);

  // ── Live bezetting: echte agents uit echte sessies van dit project ──────
  const liveAgents: { id: string; name: string; sessionId: string; busy?: string }[] = [];
  for (const session of sessions) {
    for (const agent of Object.values(session.agents)) {
      if (agent.stopped) continue;
      liveAgents.push({
        id: agent.agentId,
        name: agent.agentType ?? 'agent',
        sessionId: session.sessionId,
        busy: agent.lastToolSummary,
      });
    }
  }
  const activeSessions = sessions.filter((s) => !s.endedAt);
  // Bureaus die bemand zijn: één per live agent, plus één per werkende sessie.
  const working = Math.min(entities.length, liveAgents.length + activeSessions.filter((s) => s.status === 'working').length);

  // ── Werkplekken ────────────────────────────────────────────────────────
  const stations: Station[] = entities.map((label, i) => {
    const key = `${project}-${label}`;
    const override = overrides.get(label) ?? overrides.get(`${label}`);
    const status = override?.status ?? statusFor(i, working, key);
    const magnitude = kind === 'trading' || kind === 'crypto' ? 120 : 40;
    const raw = (rnd(`${key}-v`) - 0.42) * magnitude;
    const value = override?.value ?? Number(raw.toFixed(2));
    const agent = liveAgents[i];
    const metrics: Metric[] = override?.metrics ?? buildMetrics(kind, spec, key, value, status);
    return {
      id: label,
      label,
      sub: override?.sub ?? spec.stationSub(i, seed),
      status,
      value,
      metrics,
      agentName: agent?.name,
      agentId: agent?.id,
      sessionId: agent?.sessionId,
      detail: buildDetail(kind, spec, label, project, key, value, metrics),
    };
  });

  // ── Bezetting: supervisor + manager + agents ───────────────────────────
  const staff: StaffMember[] = [
    { id: 'chief', name: 'ARA Chief', role: 'supervisor', status: 'houdt de hele organisatie in de gaten' },
    {
      id: `manager:${venture.id}`,
      name: `Manager ${venture.label}`,
      role: 'manager',
      status: activeSessions.length > 0 ? 'stuurt het team aan' : 'wacht op werk',
      busyWith: tasks.find((t) => t.assignee === `manager:${venture.id}` && t.status !== 'done')?.title,
    },
    ...liveAgents.slice(0, 12).map((a) => ({
      id: a.id,
      name: a.name,
      role: (a.name.toLowerCase().includes('scout') || a.name.toLowerCase().includes('explore')
        ? 'scout'
        : 'agent') as StaffMember['role'],
      status: a.busy ? 'aan het werk' : 'beschikbaar',
      busyWith: a.busy,
      sessionId: a.sessionId,
    })),
  ];

  // ── Feitenfeed: echte bordtaken + echte sessie-gebeurtenissen ──────────
  const facts: OfficeFact[] = tasks
    .slice(0, 8)
    .map((t) => ({
      ts: t.updatedAt,
      text: `${t.status === 'done' ? '✔' : t.status === 'failed' ? '✖' : '•'} ${t.title}`,
      tone: (t.status === 'done' ? 'good' : t.status === 'failed' ? 'bad' : 'info') as Tone,
    }));
  for (const session of sessions.slice(0, 4)) {
    facts.push({
      ts: session.lastSeenAt,
      text: `${session.status === 'working' ? '▶' : '■'} sessie ${session.status}${session.lastToolSummary ? ` — ${session.lastToolSummary}` : ''}`,
      tone: session.status === 'error' ? 'bad' : 'info',
    });
  }
  facts.sort((a, b) => b.ts - a.ts);

  // ── Muur-KPI's ─────────────────────────────────────────────────────────
  const totalValue = stations.reduce((sum, s) => sum + s.value, 0);
  const busy = stations.filter((s) => s.status === 'working').length;
  const alerts = stations.filter((s) => s.status === 'alert').length;
  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const kpis: Metric[] = [
    { label: spec.kpiLabels[0], value: `${busy}/${stations.length}`, tone: busy > 0 ? 'good' : 'muted' },
    { label: spec.kpiLabels[1], value: `${(52 + Math.round(rnd(`${project}-adh`) * 36))}%`, tone: 'info' },
    { label: spec.kpiLabels[2], value: `${30 + Math.round(rnd(`${project}-hit`) * 40)}%`, tone: 'info' },
    { label: spec.kpiLabels[3], value: alerts > 0 ? `${alerts} let op` : 'rustig', tone: alerts > 0 ? 'warn' : 'muted' },
  ];

  // ── Grafiek: 60 punten, deterministische wandeling rond de totaalwaarde ─
  const chart: number[] = [];
  let walk = 0;
  for (let i = 0; i < 60; i += 1) {
    walk += (rnd(`${project}-c${i}`) - 0.5) * 2;
    chart.push(Number(walk.toFixed(3)));
  }

  // ── Vergaderruimte: echte manager-taken als gesprek ────────────────────
  const openForManager = tasks.filter((t) => t.status !== 'done').slice(0, 3);
  const messages: RoomMessage[] = openForManager.length
    ? openForManager.flatMap((t, i) => [
        { from: 'Manager', text: `Hoe staat "${t.title}"?`, side: 'right' as const },
        {
          from: liveAgents[i]?.name ?? 'Team',
          text: t.status === 'claimed' ? 'Opgepakt, ik ben bezig.' : 'Staat open, ik pak hem zo.',
          side: 'left' as const,
        },
      ])
    : [
        { from: 'Manager', text: 'Alles rond hier?', side: 'right' },
        { from: 'Team', text: 'Geen open taken — we staan klaar.', side: 'left' },
      ];

  return {
    project,
    venture: venture.id,
    ventureLabel: venture.label,
    kind,
    title: spec.title,
    headline: {
      label: spec.headlineLabel,
      value:
        spec.valueKind === 'money'
          ? `$${(10_000 + rnd(`${project}-eq`) * 9000).toFixed(2)}`
          : `${stations.length}`,
      delta: spec.valueKind === 'money' ? money(totalValue) : `${busy} bezig`,
      tone: totalValue >= 0 ? 'good' : 'bad',
    },
    kpis,
    chart,
    facts: facts.slice(0, 8),
    stations,
    staff,
    room: {
      name: spec.roomName,
      status: `${activeSessions.length} sessie(s) in de lucht · ${doneTasks} afgerond`,
      messages: messages.slice(0, 8),
    },
    valueKind: spec.valueKind,
    simulated,
    now,
  };
}

function buildMetrics(
  kind: OfficeKind,
  spec: KindSpec,
  key: string,
  value: number,
  status: StationStatus,
): Metric[] {
  const L = spec.metricLabels;
  const pick = (i: number, ...opts: string[]): string => opts[stableHash(`${key}-${i}`) % opts.length]!;
  if (kind === 'trading' || kind === 'crypto') {
    const entry = 100 + rnd(`${key}-e`) * 1200;
    return [
      { label: L[0]!, value: status === 'working' ? 'gekocht' : status === 'alert' ? 'stop geraakt' : 'wacht' },
      { label: L[1]!, value: `$${(200 + rnd(`${key}-n`) * 900).toFixed(2)}` },
      { label: L[2]!, value: (rnd(`${key}-q`) * 2).toFixed(2) },
      { label: L[3]!, value: entry.toFixed(2) },
      { label: L[4]!, value: (entry * 0.98).toFixed(2), tone: 'bad' },
      { label: L[5]!, value: (entry * 1.05).toFixed(2), tone: 'good' },
      { label: L[6]!, value: money(value), tone: value >= 0 ? 'good' : 'bad' },
      { label: L[7]!, value: money(value * 0.6), tone: value >= 0 ? 'good' : 'bad' },
      { label: L[8]!, value: `${Math.round(rnd(`${key}-t`) * 9)}` },
      { label: L[9]!, value: `${20 + Math.round(rnd(`${key}-h`) * 50)}%` },
    ];
  }
  if (kind === 'tms') {
    return [
      { label: L[0]!, value: status === 'working' ? 'onderweg' : status === 'alert' ? 'vertraagd' : 'gepland', tone: status === 'alert' ? 'warn' : undefined },
      { label: L[1]!, value: pick(1, 'Ali', 'Jeroen', 'Marek', 'Sanne', 'Youssef', 'Dave') },
      { label: L[2]!, value: `Truck ${41 + (stableHash(`${key}-v`) % 32)}` },
      { label: L[3]!, value: `${6 + (stableHash(`${key}-d`) % 10)}:00` },
      { label: L[4]!, value: `${12 + (stableHash(`${key}-a`) % 9)}:${(stableHash(`${key}-m`) % 6)}0` },
      { label: L[5]!, value: `${120 + Math.round(rnd(`${key}-km`) * 800)} km` },
      { label: L[6]!, value: pick(6, 'pallets', 'koelvracht', 'stukgoed', 'bulk') },
      { label: L[7]!, value: `${55 + Math.round(rnd(`${key}-b`) * 45)}%` },
      { label: L[8]!, value: `${1 + (stableHash(`${key}-s`) % 5)}` },
      { label: L[9]!, value: `${8 + Math.round(rnd(`${key}-mg`) * 22)}%`, tone: 'good' },
    ];
  }
  if (kind === 'fleet') {
    const inGarage = status === 'alert' || status === 'done';
    return [
      { label: L[0]!, value: inGarage ? 'in de garage' : 'rijdend', tone: inGarage ? 'warn' : 'good' },
      { label: L[1]!, value: `${pick(1, 'BX', 'VD', 'RJ', 'HT')}-${10 + (stableHash(`${key}-p`) % 89)}-${pick(2, 'NL', 'BN', 'ZK')}` },
      { label: L[2]!, value: `${(120 + Math.round(rnd(`${key}-km`) * 600)) * 1000} km` },
      { label: L[3]!, value: `${1 + (stableHash(`${key}-apk`) % 28)}-${1 + (stableHash(`${key}-apm`) % 12)}-2027` },
      { label: L[4]!, value: inGarage ? 'bezig' : `over ${1 + (stableHash(`${key}-oh`) % 90)} d` },
      { label: L[5]!, value: `${4 + (stableHash(`${key}-b`) % 6)} mm`, tone: stableHash(`${key}-b`) % 6 < 2 ? 'warn' : undefined },
      { label: L[6]!, value: `${stableHash(`${key}-st`) % 3}`, tone: stableHash(`${key}-st`) % 3 > 0 ? 'warn' : 'good' },
      { label: L[7]!, value: pick(7, 'Ali', 'Jeroen', 'Marek', 'Sanne', '—') },
      { label: L[8]!, value: `${26 + Math.round(rnd(`${key}-v`) * 12)} l/100` },
      { label: L[9]!, value: inGarage ? 'nee' : 'ja', tone: inGarage ? 'bad' : 'good' },
    ];
  }
  // design / studio / music / generic delen een werkstroom-vorm
  return [
    { label: L[0]!, value: status === 'working' ? 'in bewerking' : status === 'done' ? 'klaar' : status === 'alert' ? 'geblokkeerd' : 'wacht' },
    { label: L[1]!, value: pick(1, 'Intern', 'Klant A', 'Klant B', 'Label', 'Partner') },
    { label: L[2]!, value: pick(2, 'schets', 'uitwerking', 'review', 'oplevering') },
    { label: L[3]!, value: `${stableHash(`${key}-r`) % 5}` },
    { label: L[4]!, value: `${1 + (stableHash(`${key}-d`) % 21)} d` },
    { label: L[5]!, value: pick(5, 'laag', 'normaal', 'hoog') },
    { label: L[6]!, value: `${stableHash(`${key}-bl`) % 2}` },
    { label: L[7]!, value: status === 'done' ? 'opgeleverd' : 'onderweg' },
    { label: L[8]!, value: pick(8, 'wacht', 'akkoord', 'wijzigingen') },
    { label: L[9]!, value: `${2 + Math.round(rnd(`${key}-u`) * 30)} u` },
  ];
}

function buildDetail(
  kind: OfficeKind,
  spec: KindSpec,
  label: string,
  project: string,
  key: string,
  value: number,
  metrics: Metric[],
): StationDetail {
  const curve: number[] = [];
  let walk = 0;
  for (let i = 0; i < 24; i += 1) {
    walk += (rnd(`${key}-cv${i}`) - 0.46) * 2;
    curve.push(Number(walk.toFixed(3)));
  }
  const moneyKind = kind === 'trading' || kind === 'crypto';
  return {
    title: `${label} — ${project}`,
    subtitle: spec.title,
    kpis: [
      {
        label: 'Resultaat vandaag',
        value: moneyKind ? money(value) : `${Math.abs(Math.round(value))} ${spec.entityWord}`,
        tone: value >= 0 ? 'good' : 'bad',
      },
      { label: 'Nu open', value: moneyKind ? money(value * 0.7) : `${Math.max(0, Math.round(value / 3))}`, tone: 'info' },
      { label: 'Aanhechting', value: rnd(`${key}-ad`) > 0.5 ? 'opwarmend' : 'stabiel', tone: 'info' },
      { label: 'Laatste update', value: 'live', tone: 'muted' },
    ],
    plannedVsActual: spec.planLabels.map((planLabel, i) => ({
      label: planLabel,
      planned: `${1 + Math.round(rnd(`${key}-p${i}`) * 40)}`,
      actual: `${Math.round(rnd(`${key}-a${i}`) * 40)}`,
    })),
    curve,
    note: metrics[0]?.value,
  };
}
