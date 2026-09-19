import type { Playbook } from './org.ts';
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
  | 'equities'
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
  /** true = ingevuld cijfer, niet door een agent aangeleverd. */
  estimated?: boolean;
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
  /** true = belofte×geleverd en de curve zijn invullingen, geen metingen. */
  estimated: boolean;
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
  /** true = niemand leverde data voor deze werkplek; cijfers zijn ingevuld. */
  simulated: boolean;
  /** true = wél echte data, maar te lang niet ververst (dode koppeling). */
  stale: boolean;
  /** Wanneer een agent deze werkplek voor het laatst bijwerkte. */
  updatedAt?: number;
  /**
   * Waar het cijfer vandaan komt: de bestandsnaam (`vehicles.csv`) als een
   * bron het bureau vulde, leeg bij een agent-push of een voorbeeld. Een
   * cijfer zonder herkomst is niet na te lopen.
   */
  source?: string;
}

export interface OfficeFact {
  ts: number;
  text: string;
  tone: Tone;
}

/**
 * Gemeten projectcijfers. Alles hierin is écht: git leest de repo, het bord
 * telt taken, de usage-tabel telt tokens. Wat niet gemeten kan worden ontbreekt
 * gewoon — er wordt hier nooit iets ingevuld. Daarmee heeft elk kantoor altijd
 * minstens één paneel dat geen voorbeeldcijfers toont.
 */
export interface ProjectPulse {
  /** Ontbreekt als het project geen pad in projects.json heeft. */
  branch?: string;
  commitsToday?: number;
  commits7d?: number;
  lastCommitAt?: number;
  lastCommitSubject?: string;
  /** Aantal gewijzigde/ongetrackte bestanden in de working tree. */
  dirtyFiles?: number;
  /** Uit de WorldState: tool-calls en fouten van vandaag in dit project. */
  toolCallsToday?: number;
  errorsToday?: number;
  /** Uit de usage-tabel. */
  tokensToday?: number;
  openTasks?: number;
  doneTasksToday?: number;
  /** Wanneer deze meting gedaan is. */
  measuredAt: number;
}

/**
 * Waar iemand in de keten hangt: chief → supervisor → manager → de vloer,
 * met de vaste ops-manager ernaast. `role` zegt wát iemand is (en blijft wat
 * het was), `tier` zegt wáár hij staat — zonder dat laatste is de bezetting
 * een rij poppetjes en geen organisatie, en kan het 3D-kantoor de keten niet
 * tekenen. De keten die hier uit komt is die van org.json (plugins/ara):
 * de chief is het enige aanspreekpunt, de supervisor zit ertussen, en pas
 * daaronder hangt de manager van déze tak met zijn vaste rollen.
 */
export type StaffTier =
  | 'chief'
  | 'supervisor'
  | 'manager'
  /** Vaste ops-manager: storingen, staat naast de takken. */
  | 'ops'
  /** Vaste rol uit het playbook van deze tak. */
  | 'specialist'
  /** Draait nu in een sessie van dit project, buiten het playbook om. */
  | 'floor';

export interface StaffMember {
  id: string;
  name: string;
  role: 'supervisor' | 'manager' | 'agent' | 'scout' | 'ops';
  status: string;
  busyWith?: string;
  sessionId?: string;
  /** Plaats in de keten. */
  tier?: StaffTier;
  /**
   * Id van de leidinggevende binnen dezelfde `staff`-lijst; leeg = de top.
   * Elke verwijzing wijst naar een lid dat er ook echt staat, zodat een
   * tekenaar de keten kan volgen zonder op een dood id te stuiten.
   */
  reportsTo?: string;
  /** Diepte in de keten (0 = chief). Afgeleid van `reportsTo`, niet los bedacht. */
  depth?: number;
  /**
   * false = vaste rol uit het playbook die nu niet draait. Een lege stoel is
   * eerlijker dan een rol die er actief uitziet zonder sessie erachter.
   */
  live?: boolean;
  /** Agent-definitie achter deze rol (alleen bij playbook-rollen). */
  agent?: string;
  /** Eén regel: wat deze rol hier doet. */
  does?: string;
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
  headline: { label: string; value: string; delta?: string; tone?: Tone; estimated: boolean };
  kpis: Metric[];
  chart: number[];
  facts: OfficeFact[];
  stations: Station[];
  staff: StaffMember[];
  room: { name: string; status: string; messages: RoomMessage[] };
  /** Eenheid van het zwevende cijfer boven de bureaus. */
  valueKind: 'money' | 'count' | 'time' | 'none';
  /** true = géén enkele werkplek heeft echte data (alles ingevuld). */
  simulated: boolean;
  /** Aantal werkplekken met echte, door een agent aangeleverde cijfers. */
  realStations: number;
  /** Aantal werkplekken waarvan de koppeling stil is gevallen. */
  staleStations: number;
  /** Gemeten projectcijfers; ontbreekt als er niets te meten viel. */
  pulse?: ProjectPulse;
  /** De organisatie van deze tak zoals die in het kantoor getekend wordt. */
  playbook?: Playbook;
  /** Afgeleid uit pulse: rijen die je zonder voorbehoud mag geloven. */
  measured: Metric[];
  /** true = de grafiek op de muur is een ingevuld verloop, geen meting. */
  chartEstimated: boolean;
  /** Het bord van dit project: waar dit kantoor nu daadwerkelijk aan werkt. */
  work: OfficeWork;
  now: number;
}

export const OFFICE_KIND_BY_VENTURE: Record<string, OfficeKind> = {
  traject: 'tms',
  blex: 'fleet',
  trading: 'trading',
  crypto: 'crypto',
  equities: 'equities',
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
  /**
   * Regel onder het bureau. Krijgt het label van de werkplek mee: een munt
   * hoort bij een sector en een aandeel bij een tak, en dat zegt meer dan een
   * getal dat bij elk bureau hetzelfde betekent.
   */
  stationSub: (index: number, seed: number, label: string) => string;
  metricLabels: string[];
  planLabels: string[];
}

/**
 * Sectoren voor de takken die er in hun eigen woorden over praten. Zolang
 * niemand ze aanlevert zijn ze deterministisch afgeleid van de naam — dezelfde
 * munt krijgt dus altijd dezelfde sector, en ze staan (net als de rest van een
 * onbevoorraad kantoor) als voorbeeldcijfer gemarkeerd.
 */
const CRYPTO_SECTORS = ['L1', 'L2', 'DeFi', 'AI', 'RWA', 'infra', 'privacy', 'meme'];
const EQUITY_SECTORS = [
  'halfgeleiders',
  'financials',
  'consument',
  'industrie',
  'software',
  'gezondheid',
  'energie',
  'vastgoed',
];
function sectorFor(pool: string[], label: string): string {
  return pool[stableHash(`sector-${label}`) % pool.length]!;
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
  equities: {
    title: 'AANDELEN — PORTEFEUILLE',
    roomName: 'Zaal RESEARCH',
    headlineLabel: 'PORTEFEUILLEWAARDE',
    valueKind: 'money',
    entities: ['ASML', 'ADYEN', 'ASM', 'BESI', 'HEIA', 'INGA', 'PHIA', 'AD', 'WKL', 'PRX', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'BRK.B', 'COST'],
    entityWord: 'posities',
    // Aandelen zijn geen trades maar bezit: de kolommen gaan over de these en
    // de kostprijs, niet over een setup die vandaag geldt.
    kpiLabels: ['Posities', 'Winnaars', 'Grootste weging', 'Cijfers deze week'],
    stationSub: (i: number, seed: number, label: string) =>
      `${sectorFor(EQUITY_SECTORS, label)} · ${1 + ((seed + i) % 4)}e jaar in bezit`,
    metricLabels: ['These', 'Sector', 'Aantal', 'Kostprijs', 'Koers', 'Weging', 'Rendement', 'Dividend', 'Cijfers', 'Stop'],
    planLabels: ['Rendement', 'Weging', 'Sinds aankoop'],
  },
  crypto: {
    title: 'CRYPTO-VLOER — LIVE',
    roomName: 'Zaal ONCHAIN',
    headlineLabel: 'PORTEFEUILLE',
    valueKind: 'money',
    entities: ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'LINK', 'UNI', 'AAVE', 'DOGE', 'XLM', 'INJ', 'PAXG', 'SUI', 'TAO', 'NEAR', 'ZEC', 'HYPE'],
    entityWord: 'setups',
    kpiLabels: ['Setups in de lucht', 'Aanhechting', 'Live trefkans', 'Blootstelling'],
    stationSub: (i, seed, label) => `${sectorFor(CRYPTO_SECTORS, label)} · ${1 + ((seed + i) % 5)} setups`,
    // Een munt is geen valutapaar. Naast de setup tellen hier de dingen waar
    // de allocatiebewaker, de veiligheidscheck en de eventscout op zitten:
    // weging, liquiditeit en wat eraan komt (unlock, listing, upgrade).
    metricLabels: ['Situatie', 'Inzet', 'Aantal', 'Ingang', 'Stop', 'Doel', 'Open', 'Weging', 'Liquiditeit', 'Volgende unlock'],
    planLabels: ['Voorstellen', 'Trefkans', 'Concentratie'],
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
    // "Werkpakket 1 t/m 8" zei niets: acht bureaus met een volgnummer. Een tak
    // zonder eigen branche heeft wél vast werk — dit zijn de stromen die elk
    // project heeft, en ze komen terug in de vaste rollen uit het playbook
    // (controle, afhankelijkheden, documentatie, beveiliging).
    entities: [
      'Backlog',
      'Inkomende vragen',
      'Bugs',
      'Onderhoud',
      'Documentatie',
      'Beveiliging',
      'Afhankelijkheden',
      'Infrastructuur',
      'Onderzoek',
      'Releases',
    ],
    entityWord: 'taken',
    kpiLabels: ['Taken open', 'In behandeling', 'Afgerond', 'Geblokkeerd'],
    stationSub: (i, seed) =>
      `${1 + ((seed + i) % 3)} taken · ${(seed + i) % 4 === 0 ? '1 geblokkeerd' : 'loopt'}`,
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
  /** Wat de agent terugmeldde; leeg zolang de taak open staat. */
  result?: string;
}

/**
 * Een weigering begint met ESCALATE: op de eerste regel — de keten zoekt
 * letterlijk op dat woord. Die regel staat hier omdat de actielijst en het
 * kantoor hem allebei nodig hebben, en twee lezingen van "wacht dit op een
 * mens" is er één te veel: dan staat een escalatie in de ene lijst wel en in
 * de andere niet, en vertrouw je geen van beide meer.
 */
export function isEscalated(task: { result?: string; detail?: string }): boolean {
  return (task.result ?? '').startsWith('ESCALATE') || (task.detail ?? '').includes('ESCALATE:');
}

/** Een bordtaak zoals het kantoor hem toont. */
export interface OfficeTask {
  id: string;
  title: string;
  status: string;
  assignee: string;
  createdBy: string;
  updatedAt: number;
  /** true = deze taak wacht op een mens, niet op een agent. */
  escalated: boolean;
  /** De rol uit `staff` waar deze taak bij hoort, als hij te plaatsen is. */
  staffId?: string;
  /** Eén regel uit result of detail; leeg als er niets te zeggen valt. */
  note?: string;
}

/**
 * Wat dit kantoor daadwerkelijk aan het doen is.
 *
 * De werkvloer toonde tot nu toe werkplekken en bemensing, maar niet het werk:
 * je zag wie er zat, niet waar hij mee bezig was. Dit is het bord van dit ene
 * project, met de escalaties apart — die wachten op jou en horen niet tussen
 * de rest te verdwijnen.
 */
export interface OfficeWork {
  escalations: OfficeTask[];
  open: OfficeTask[];
  /** Vandaag afgerond. Geen schatting: geteld op updatedAt. */
  doneToday: number;
  /**
   * true = er kwamen precies zoveel taken terug als de limiet toeliet, dus
   * `open` is een ondergrens. Het kantoor zegt dan "≥", net als de kaart.
   */
  truncated: boolean;
}

export interface StationOverride {
  id: string;
  label?: string;
  sub?: string;
  status?: StationStatus;
  value?: number;
  metrics?: Metric[];
  /** Tijdstip van de push; bepaalt of de koppeling nog leeft. */
  updatedAt?: number;
  /**
   * Na hoeveel ms deze werkplek als verouderd geldt. Een agent-push is na
   * dertig minuten oud (`STATION_STALE_MS`); een weekbestand niet — dat zegt
   * zelf hoe vers het hoort te zijn.
   */
  staleAfterMs?: number;
  /** Bestandsnaam van de bron die dit bureau vulde; leeg = een agent-push. */
  source?: string;
}

/** Een koppeling die hier langer dan dit niets stuurde, geldt als stilgevallen. */
export const STATION_STALE_MS = 30 * 60 * 1000;

export interface OfficeInput {
  /**
   * De limiet waarmee de aanroeper `tasks` ophaalde. Kwam dat aantal exact
   * terug, dan is het bord een ondergrens; zonder dit getal kan het kantoor
   * dat niet weten en doet het alsof het alles ziet.
   */
  taskLimit?: number;
  project: string;
  venture: VentureStyle;
  sessions: SessionState[];
  tasks: BoardTaskLite[];
  /** Branche-entiteiten uit org.json (munten, wagens, routes…). */
  entities?: string[];
  /** Echte, door agents aangeleverde werkplek-data. */
  overrides?: StationOverride[];
  /** Gemeten projectcijfers (git/bord/tokens) — nooit ingevuld. */
  pulse?: ProjectPulse;
  /** Organisatie van deze tak (manager, vaste rollen, escalaties). */
  playbook?: Playbook;
  now: number;
}

/** Deterministische pseudo-waarde in [0,1) voor een sleutel. */
/** Middernacht van de dag waar `now` in valt, in lokale tijd. */
export function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rnd(key: string): number {
  return (stableHash(key) % 10_000) / 10_000;
}

/** "3 min geleden" — leesbaar zonder een datum-bibliotheek. */
function ago(ts: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  if (secs < 60) return `${secs}s geleden`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min geleden`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} uur geleden`;
  return `${Math.round(hours / 24)} dag(en) geleden`;
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
    const override = overrides.get(label);
    // Eerlijk per werkplek: deze is alleen "echt" als er voor díe werkplek
    // data is gepusht. Eén echte werkplek maakt de rest niet echt.
    const isReal = override !== undefined;
    const stale =
      isReal &&
      override.updatedAt !== undefined &&
      now - override.updatedAt > (override.staleAfterMs ?? STATION_STALE_MS);
    const status = override?.status ?? statusFor(i, working, key);
    const magnitude = kind === 'trading' || kind === 'crypto' ? 120 : 40;
    const raw = (rnd(`${key}-v`) - 0.42) * magnitude;
    const value = override?.value ?? Number(raw.toFixed(2));
    const agent = liveAgents[i];
    const baseMetrics: Metric[] = override?.metrics ?? buildMetrics(kind, spec, key, label, value, status);
    // Zonder echte bron is élk cijfer op deze werkplek een invulling.
    const metrics = isReal ? baseMetrics : baseMetrics.map((m) => ({ ...m, estimated: true }));
    return {
      id: label,
      label,
      sub: override?.sub ?? spec.stationSub(i, seed, label),
      status,
      value,
      metrics,
      agentName: agent?.name,
      agentId: agent?.id,
      sessionId: agent?.sessionId,
      simulated: !isReal,
      stale,
      updatedAt: override?.updatedAt,
      source: override?.source,
      detail: buildDetail(kind, spec, label, project, key, value, metrics, !isReal, stale),
    };
  });

  // ── Bezetting: chief → manager → vaste rollen → wie er nú draait ───────
  // De vaste rollen komen uit het playbook van de tak en staan er altijd, ook
  // als er niemand draait (live: false). Zo zie je de organisatie, niet alleen
  // het toeval van dit moment.
  const playbook = input.playbook;
  const liveNames = new Set(liveAgents.map((a) => a.name.toLowerCase()));
  //
  // De keten zelf staat er ook in, niet alleen de uiteinden: chief →
  // supervisor → manager → vloer. De supervisor ontbrak, waardoor het kantoor
  // een organisatie toonde die één schakel korter was dan de echte — en
  // precies die schakel is degene die het werk verdeelt.
  const CHIEF_ID = 'chief';
  const SUPERVISOR_ID = 'supervisor';
  const managerId = `manager:${venture.id}`;
  const supervisorLive = liveNames.has('ara-supervisor');
  // Ops staat naast de takken en wordt door de watchdog gewekt bij een
  // storing. Een vaste stoel in elk kantoor zou suggereren dat hij overal
  // meekijkt; hij komt er pas te staan als er hier echt een incident ligt.
  const opsTasks = tasks.filter((t) => t.assignee === 'manager:ops' && t.status !== 'done');
  const staff: StaffMember[] = [
    {
      id: CHIEF_ID,
      name: 'ARA Chief',
      role: 'supervisor',
      tier: 'chief',
      depth: 0,
      status: 'houdt de hele organisatie in de gaten',
      does: 'enige aanspreekpunt van de gebruiker; zet werk uit via de supervisor',
      live: true,
    },
    {
      id: SUPERVISOR_ID,
      name: 'ARA Supervisor',
      role: 'supervisor',
      tier: 'supervisor',
      depth: 1,
      reportsTo: CHIEF_ID,
      // Meetbaar of niet: precies dezelfde regel als bij een vaste rol. Een
      // draaiende supervisor-agent maakt hem bezet, anders staat de stoel leeg.
      status: supervisorLive ? 'verdeelt het werk' : 'vaste rol · niet actief',
      live: supervisorLive,
      agent: 'ara-supervisor',
      does: 'verdeelt het werk over de managers en bewaakt de keten — de enige weg van chief naar deze vloer',
    },
    {
      id: managerId,
      name: playbook?.managerName ?? `Manager ${venture.label}`,
      role: 'manager',
      tier: 'manager',
      depth: 2,
      reportsTo: SUPERVISOR_ID,
      status: activeSessions.length > 0 ? 'stuurt het team aan' : 'wacht op werk',
      busyWith: tasks.find((t) => t.assignee === managerId && t.status !== 'done')?.title,
      live: activeSessions.length > 0,
      does: `stuurt ${venture.label} aan: verdeelt de bordtaken van deze tak en bewaakt de grenzen uit het playbook`,
    },
    ...(opsTasks.length > 0
      ? [
          {
            id: 'manager:ops',
            name: 'Ops-manager',
            role: 'ops' as StaffMember['role'],
            tier: 'ops' as StaffTier,
            depth: 2,
            reportsTo: SUPERVISOR_ID,
            // Geteld, niet geschat: dit zijn de ops-taken die op dít bord staan.
            status: `${opsTasks.length} storing(en) op dit bord`,
            busyWith: opsTasks[0]?.title,
            live: liveNames.has('ara-ops-manager'),
            agent: 'ara-ops-manager',
            does: 'pakt storingen op deze vloer op — incidenten, niet het gewone werk',
          },
        ]
      : []),
    ...(playbook?.specialists ?? []).map((role) => ({
      id: `rol:${role.agent}:${role.name}`,
      name: role.name,
      role: (role.agent === 'ara-web-scout' ? 'scout' : 'agent') as StaffMember['role'],
      tier: 'specialist' as StaffTier,
      depth: 3,
      reportsTo: managerId,
      // Een vaste rol met een draaiende agent van hetzelfde type telt als bezet.
      status: liveNames.has(role.agent) ? 'aan het werk' : 'vaste rol · niet actief',
      live: liveNames.has(role.agent),
      agent: role.agent,
      does: role.does,
    })),
    ...liveAgents.slice(0, 12).map((a) => ({
      id: a.id,
      live: true,
      name: a.name,
      role: (a.name.toLowerCase().includes('scout') || a.name.toLowerCase().includes('explore')
        ? 'scout'
        : 'agent') as StaffMember['role'],
      tier: 'floor' as StaffTier,
      depth: 3,
      reportsTo: managerId,
      status: a.busy ? 'aan het werk' : 'beschikbaar',
      busyWith: a.busy,
      sessionId: a.sessionId,
    })),
  ];

  // ── Het bord van dit project ───────────────────────────────────────────
  // Een kantoor liet zien wie er zat, niet waar hij mee bezig was. Dit zijn de
  // echte taken; er wordt hier niets ingevuld, dus een leeg bord blijft leeg.
  const staffIdFor = (assignee: string): string | undefined =>
    staff.find((m) => m.id === assignee || m.agent === assignee)?.id;
  const firstLine = (text: string): string | undefined => {
    const line = text.split('\n').find((l) => l.trim().length > 0)?.trim();
    return line ? (line.length > 160 ? `${line.slice(0, 159)}…` : line) : undefined;
  };
  const asOfficeTask = (t: BoardTaskLite): OfficeTask => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    createdBy: t.createdBy,
    updatedAt: t.updatedAt,
    escalated: isEscalated(t),
    staffId: staffIdFor(t.assignee),
    note: firstLine(t.result ?? '') ?? firstLine(t.detail),
  });
  const live = tasks.filter((t) => t.status !== 'done' && t.status !== 'failed');
  const work: OfficeWork = {
    escalations: live.filter((t) => isEscalated(t)).map(asOfficeTask),
    open: live.filter((t) => !isEscalated(t)).map(asOfficeTask),
    doneToday: tasks.filter((t) => t.status === 'done' && t.updatedAt >= startOfToday(now)).length,
    // De aanroeper haalt met een limiet op; komt dat aantal exact terug, dan is
    // dit een ondergrens en zegt het kantoor "≥" in plaats van een getal.
    truncated: input.taskLimit !== undefined && tasks.length >= input.taskLimit,
  };

  // ── Feitenfeed: echte bordtaken + echte sessie-gebeurtenissen ──────────
  // Op volgorde van wanneer er iets gebeurde, niet op volgorde van aanlevering:
  // de feed werd afgekapt vóór het sorteren, zodat acht willekeurige taken de
  // plek innamen van de acht meest recente gebeurtenissen.
  const facts: OfficeFact[] = [...tasks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
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
  const realStations = stations.filter((s) => !s.simulated).length;
  const staleStations = stations.filter((s) => s.stale).length;
  const allReal = realStations === stations.length && stations.length > 0;
  const kpis: Metric[] = [
    {
      label: spec.kpiLabels[0],
      value: `${busy}/${stations.length}`,
      tone: busy > 0 ? 'good' : 'muted',
      estimated: !allReal,
    },
    // Deze twee heeft nog niemand aangeleverd — altijd een invulling.
    { label: spec.kpiLabels[1], value: `${(52 + Math.round(rnd(`${project}-adh`) * 36))}%`, tone: 'info', estimated: true },
    { label: spec.kpiLabels[2], value: `${30 + Math.round(rnd(`${project}-hit`) * 40)}%`, tone: 'info', estimated: true },
    {
      label: spec.kpiLabels[3],
      value: alerts > 0 ? `${alerts} let op` : 'rustig',
      tone: alerts > 0 ? 'warn' : 'muted',
      estimated: !allReal,
    },
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

  // ── Gemeten laag: alles hieronder is echt of staat er niet ─────────────
  // Dit is het enige paneel in het kantoor dat nooit een invulling bevat.
  const pulse = input.pulse;
  const measured: Metric[] = [];
  const add = (label: string, value: string | undefined, tone: Tone = 'info'): void => {
    if (value !== undefined) measured.push({ label, value, tone, estimated: false });
  };
  if (pulse) {
    add('Branch', pulse.branch);
    add(
      'Commits vandaag',
      pulse.commitsToday === undefined ? undefined : String(pulse.commitsToday),
      pulse.commitsToday ? 'good' : 'muted',
    );
    add('Commits 7 dagen', pulse.commits7d === undefined ? undefined : String(pulse.commits7d));
    add('Laatste commit', pulse.lastCommitAt === undefined ? undefined : ago(pulse.lastCommitAt, now));
    add(
      'Onopgeslagen wijzigingen',
      pulse.dirtyFiles === undefined ? undefined : `${pulse.dirtyFiles} bestand(en)`,
      pulse.dirtyFiles ? 'warn' : 'muted',
    );
    add(
      'Tool-calls vandaag',
      pulse.toolCallsToday === undefined ? undefined : String(pulse.toolCallsToday),
    );
    add(
      'Fouten vandaag',
      pulse.errorsToday === undefined ? undefined : String(pulse.errorsToday),
      pulse.errorsToday ? 'bad' : 'muted',
    );
    add(
      'Tokens vandaag',
      pulse.tokensToday === undefined ? undefined : pulse.tokensToday.toLocaleString('nl-NL'),
    );
    add('Taken open', pulse.openTasks === undefined ? undefined : String(pulse.openTasks));
    add(
      'Taken afgerond vandaag',
      pulse.doneTasksToday === undefined ? undefined : String(pulse.doneTasksToday),
      pulse.doneTasksToday ? 'good' : 'muted',
    );
  }

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
      // De portefeuillestand wordt door niets gevoed; het verschil is de som
      // van de werkplekken en is dus pas echt als die allemaal echt zijn.
      estimated: spec.valueKind === 'money' ? true : !allReal,
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
    pulse,
    playbook,
    measured,
    valueKind: spec.valueKind,
    simulated: realStations === 0,
    realStations,
    staleStations,
    chartEstimated: true, // het verloop is een invulling zolang niets het voedt
    work,
    now,
  };
}

/**
 * De cijfers op één werkplek, in de woorden van de branche.
 *
 * Elke tak heeft hier zijn eigen tak van de boom: de kolomnamen komen uit
 * `KIND_SPECS` en de waarden horen daar één-op-één bij. Dat klonk
 * vanzelfsprekend maar was het niet — aandelen, muziek en studio deelden tot
 * nu toe het werkstroom-blok van een ontwerpbureau, zodat de kolom "These"
 * "schets" kon zeggen en "Mix" een aantal dagen. Een kolomnaam die iets anders
 * belooft dan wat eronder staat is erger dan een lege kolom.
 *
 * Alles hier is een deterministische invulling; de aanroeper markeert het als
 * zodanig zodra er geen echte bron voor deze werkplek is.
 */
function buildMetrics(
  kind: OfficeKind,
  spec: KindSpec,
  key: string,
  label: string,
  value: number,
  status: StationStatus,
): Metric[] {
  const L = spec.metricLabels;
  const pick = (i: number, ...opts: string[]): string => opts[stableHash(`${key}-${i}`) % opts.length]!;
  const hash = (salt: string): number => stableHash(`${key}-${salt}`);
  if (kind === 'trading') {
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
  if (kind === 'crypto') {
    // Een munt draagt meer dan een setup: hoe zwaar hij weegt, hoe diep de
    // markt is en wat er aan komt. Dat zijn de drie dingen waar de
    // allocatiebewaker, de veiligheidscheck en de eventscout op zitten.
    const entry = 0.35 + rnd(`${key}-e`) * 2400;
    const dp = entry < 10 ? 4 : 2;
    const weight = 1 + Math.round(rnd(`${key}-w`) * 24);
    const depth = pick(8, 'diep', 'voldoende', 'ondiep', 'zeer ondiep');
    return [
      {
        label: L[0]!,
        value:
          status === 'working'
            ? 'in positie'
            : status === 'alert'
              ? 'stop geraakt'
              : status === 'done'
                ? 'gesloten'
                : 'op de volglijst',
      },
      { label: L[1]!, value: `$${(150 + rnd(`${key}-n`) * 1200).toFixed(2)}` },
      { label: L[2]!, value: (rnd(`${key}-q`) * 40).toFixed(4) },
      { label: L[3]!, value: entry.toFixed(dp) },
      { label: L[4]!, value: (entry * 0.92).toFixed(dp), tone: 'bad' },
      { label: L[5]!, value: (entry * 1.24).toFixed(dp), tone: 'good' },
      { label: L[6]!, value: money(value), tone: value >= 0 ? 'good' : 'bad' },
      // Concentratie is hier het echte risico, niet de losse trade.
      { label: L[7]!, value: `${weight}%`, tone: weight > 20 ? 'warn' : undefined },
      { label: L[8]!, value: depth, tone: depth.includes('ondiep') ? 'warn' : undefined },
      { label: L[9]!, value: `over ${3 + (hash('ul') % 90)} d` },
    ];
  }
  if (kind === 'equities') {
    // Bezit, geen setup: kostprijs tegen koers, weging in de portefeuille, en
    // een breekpunt in plaats van een stop — een aandeel verkoop je omdat de
    // these breekt, niet omdat een niveau geraakt wordt.
    const cost = 8 + rnd(`${key}-c`) * 340;
    const price = cost * (0.7 + rnd(`${key}-p`) * 0.8);
    const ret = ((price - cost) / cost) * 100;
    const thesis = pick(0, 'intact', 'intact', 'onder druk', 'breekpunt nabij');
    const weight = 2 + Math.round(rnd(`${key}-w`) * 18);
    const div = rnd(`${key}-d`);
    return [
      { label: L[0]!, value: thesis, tone: thesis === 'intact' ? 'good' : 'warn' },
      { label: L[1]!, value: sectorFor(EQUITY_SECTORS, label) },
      { label: L[2]!, value: `${10 + (hash('q') % 400)}` },
      { label: L[3]!, value: `€${cost.toFixed(2)}` },
      { label: L[4]!, value: `€${price.toFixed(2)}` },
      { label: L[5]!, value: `${weight}%`, tone: weight > 15 ? 'warn' : undefined },
      { label: L[6]!, value: `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`, tone: ret >= 0 ? 'good' : 'bad' },
      { label: L[7]!, value: div > 0.35 ? `${(div * 5).toFixed(1)}%` : 'geen' },
      { label: L[8]!, value: `over ${4 + (hash('ea') % 80)} d` },
      { label: L[9]!, value: `breekpunt €${(cost * 0.78).toFixed(2)}`, tone: 'muted' },
    ];
  }
  if (kind === 'tms') {
    return [
      { label: L[0]!, value: status === 'working' ? 'onderweg' : status === 'alert' ? 'vertraagd' : 'gepland', tone: status === 'alert' ? 'warn' : undefined },
      { label: L[1]!, value: pick(1, 'Ali', 'Jeroen', 'Marek', 'Sanne', 'Youssef', 'Dave') },
      { label: L[2]!, value: `Truck ${41 + (hash('v') % 32)}` },
      { label: L[3]!, value: `${6 + (hash('d') % 10)}:00` },
      { label: L[4]!, value: `${12 + (hash('a') % 9)}:${hash('m') % 6}0` },
      { label: L[5]!, value: `${120 + Math.round(rnd(`${key}-km`) * 800)} km` },
      { label: L[6]!, value: pick(6, 'pallets', 'koelvracht', 'stukgoed', 'bulk') },
      { label: L[7]!, value: `${55 + Math.round(rnd(`${key}-b`) * 45)}%` },
      { label: L[8]!, value: `${1 + (hash('s') % 5)}` },
      { label: L[9]!, value: `${8 + Math.round(rnd(`${key}-mg`) * 22)}%`, tone: 'good' },
    ];
  }
  if (kind === 'fleet') {
    const inGarage = status === 'alert' || status === 'done';
    return [
      { label: L[0]!, value: inGarage ? 'in de garage' : 'rijdend', tone: inGarage ? 'warn' : 'good' },
      { label: L[1]!, value: `${pick(1, 'BX', 'VD', 'RJ', 'HT')}-${10 + (hash('p') % 89)}-${pick(2, 'NL', 'BN', 'ZK')}` },
      { label: L[2]!, value: `${(120 + Math.round(rnd(`${key}-km`) * 600)) * 1000} km` },
      { label: L[3]!, value: `${1 + (hash('apk') % 28)}-${1 + (hash('apm') % 12)}-2027` },
      { label: L[4]!, value: inGarage ? 'bezig' : `over ${1 + (hash('oh') % 90)} d` },
      { label: L[5]!, value: `${4 + (hash('b') % 6)} mm`, tone: hash('b') % 6 < 2 ? 'warn' : undefined },
      { label: L[6]!, value: `${hash('st') % 3}`, tone: hash('st') % 3 > 0 ? 'warn' : 'good' },
      { label: L[7]!, value: pick(7, 'Ali', 'Jeroen', 'Marek', 'Sanne', '—') },
      { label: L[8]!, value: `${26 + Math.round(rnd(`${key}-v`) * 12)} l/100` },
      { label: L[9]!, value: inGarage ? 'nee' : 'ja', tone: inGarage ? 'bad' : 'good' },
    ];
  }
  if (kind === 'design') {
    // Klantwerk: het gaat om revisierondes, formaten en wie er akkoord moet geven.
    const feedback = pick(6, 'verwerkt', 'open', 'wacht op klant');
    const approval = pick(8, 'wacht', 'akkoord', 'wijzigingen');
    return [
      { label: L[0]!, value: status === 'working' ? 'in bewerking' : status === 'done' ? 'klaar' : status === 'alert' ? 'geblokkeerd' : 'wacht', tone: status === 'alert' ? 'warn' : undefined },
      { label: L[1]!, value: pick(1, 'Klant A', 'Klant B', 'Klant C', 'Intern', 'Pitch') },
      { label: L[2]!, value: pick(2, 'briefing', 'schets', 'uitwerking', 'review', 'oplevering') },
      { label: L[3]!, value: `${hash('r') % 5}` },
      { label: L[4]!, value: `over ${1 + (hash('d') % 21)} d` },
      { label: L[5]!, value: `${2 + (hash('f') % 6)} formaten` },
      { label: L[6]!, value: feedback, tone: feedback === 'verwerkt' ? 'good' : 'warn' },
      { label: L[7]!, value: `${3 + (hash('as') % 40)}` },
      { label: L[8]!, value: approval, tone: approval === 'akkoord' ? 'good' : 'warn' },
      { label: L[9]!, value: `${2 + Math.round(rnd(`${key}-u`) * 30)} u` },
    ];
  }
  if (kind === 'studio') {
    // Productie: takes, mixversies en de agenda — en de boekingsflow die
    // nadrukkelijk niet zomaar naar productie mag.
    const master = pick(6, 'wacht', 'klaar', 'revisie');
    return [
      { label: L[0]!, value: status === 'working' ? 'opname' : status === 'done' ? 'opgeleverd' : status === 'alert' ? 'geblokkeerd' : 'wacht', tone: status === 'alert' ? 'warn' : undefined },
      { label: L[1]!, value: pick(1, 'Intern', 'Boeking', 'Gastartiest', 'Label', 'Podcast-gast') },
      { label: L[2]!, value: pick(2, 'opname', 'editing', 'mix', 'master', 'oplevering') },
      { label: L[3]!, value: `${1 + (hash('tk') % 12)}` },
      { label: L[4]!, value: `${2 + (hash('len') % 6)}:${10 + (hash('sec') % 50)}` },
      { label: L[5]!, value: `v${1 + (hash('mix') % 4)}` },
      { label: L[6]!, value: master, tone: master === 'klaar' ? 'good' : undefined },
      { label: L[7]!, value: status === 'done' ? 'opgeleverd' : `over ${2 + (hash('rel') % 30)} d` },
      { label: L[8]!, value: pick(8, 'eigen site', 'distributeur', 'podcast', 'live-set') },
      { label: L[9]!, value: `${2 + Math.round(rnd(`${key}-u`) * 30)} u` },
    ];
  }
  if (kind === 'music') {
    // Releases: de titel is de werkplek zelf, en de kolommen lopen mee met het
    // pad naar buiten — mix, master, datum, kanalen, promo.
    const master = pick(5, 'wacht', 'klaar');
    return [
      { label: L[0]!, value: status === 'working' ? 'in productie' : status === 'done' ? 'uit' : status === 'alert' ? 'geblokkeerd' : 'gepland', tone: status === 'alert' ? 'warn' : undefined },
      { label: L[1]!, value: label },
      { label: L[2]!, value: pick(2, 'demo', 'opname', 'mix', 'master', 'distributie') },
      { label: L[3]!, value: `${2 + (hash('len') % 4)}:${10 + (hash('sec') % 50)}` },
      { label: L[4]!, value: `v${1 + (hash('mix') % 4)}` },
      { label: L[5]!, value: master, tone: master === 'klaar' ? 'good' : undefined },
      { label: L[6]!, value: `${1 + (hash('dd') % 28)}-${1 + (hash('mm') % 12)}` },
      { label: L[7]!, value: `${2 + (hash('ch') % 6)}` },
      { label: L[8]!, value: (120 + hash('str') % 40_000).toLocaleString('nl-NL') },
      { label: L[9]!, value: pick(9, 'concept klaar', 'niets klaar', 'loopt'), tone: 'info' },
    ];
  }
  // generic: elk project heeft werk, ook zonder branche — en dan gaat het over
  // eigenaar, voortgang en wat er in de weg staat.
  const review = pick(8, 'wacht', 'akkoord', 'wijzigingen');
  const blocked = hash('bl') % 3;
  return [
    { label: L[0]!, value: status === 'working' ? 'in uitvoering' : status === 'done' ? 'klaar' : status === 'alert' ? 'geblokkeerd' : 'wacht', tone: status === 'alert' ? 'warn' : undefined },
    { label: L[1]!, value: pick(1, 'Uitvoerder', 'Scout', 'Controle', 'Documentatie', 'Beveiliging', '—') },
    { label: L[2]!, value: pick(2, 'opgepakt', 'in uitvoering', 'in review', 'afgerond') },
    { label: L[3]!, value: `${10 * (hash('vg') % 11)}%` },
    { label: L[4]!, value: `${1 + (hash('d') % 21)} d` },
    { label: L[5]!, value: pick(5, 'laag', 'normaal', 'hoog') },
    { label: L[6]!, value: `${blocked}`, tone: blocked > 0 ? 'warn' : 'good' },
    { label: L[7]!, value: status === 'done' ? 'opgeleverd' : 'onderweg' },
    { label: L[8]!, value: review, tone: review === 'akkoord' ? 'good' : undefined },
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
  estimated: boolean,
  /** true = er is wél een bron, maar die stuurt al te lang niets meer. */
  stale: boolean,
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
        estimated,
      },
      {
        label: 'Nu open',
        value: moneyKind ? money(value * 0.7) : `${Math.max(0, Math.round(value / 3))}`,
        tone: 'info',
        estimated,
      },
      { label: 'Aanhechting', value: rnd(`${key}-ad`) > 0.5 ? 'opwarmend' : 'stabiel', tone: 'info', estimated: true },
      {
        // Een stilgevallen koppeling stond hier "live" — precies de fout die
        // het hele kantoor onbetrouwbaar maakt: oude cijfers die er vers
        // uitzien. De werkplek weet dat hij stil is, dit paneel zegt het nu ook.
        label: 'Laatste update',
        value: estimated ? 'geen bron' : stale ? 'stilgevallen' : 'live',
        tone: stale ? 'warn' : 'muted',
      },
    ],
    // Plan-versus-echt is nog nergens op gebaseerd; altijd als invulling tonen.
    plannedVsActual: spec.planLabels.map((planLabel, i) => ({
      label: planLabel,
      planned: `${1 + Math.round(rnd(`${key}-p${i}`) * 40)}`,
      actual: `${Math.round(rnd(`${key}-a${i}`) * 40)}`,
    })),
    estimated: true,
    curve,
    note: metrics[0]?.value,
  };
}
