import { create } from 'zustand';
import {
  WorldState,
  type AraEvent,
  type WorldConfig,
  type WorldSnapshot,
} from '@ara/shared';

export type EffectType =
  | 'sparkle'
  | 'smoke'
  | 'confetti'
  | 'flag'
  | 'nudge'
  | 'gate' // permissie gevraagd: poortwachter
  | 'deny' // permissie geweigerd: rode slagboom
  | 'repair' // eerste geslaagde tool na een error: reparatie
  | 'storm' // context-compaction: herinneringen-wervelwind
  | 'morph' // model-switch: transformatie-ring
  | 'bolt' // parallelle tool-batch: waaier van stralen
  | 'paper'; // taak aangemaakt: papiertje vliegt vanaf de hub

/** OTel-latency per sessie: echte tool-duur drijft de animatiesnelheid. */
export interface LatencyStat {
  sessionId: string;
  ts: number;
  avgToolMs: number;
  lastToolMs: number;
  lastTool: string;
  samples: number;
}

/** Live statusline-telemetrie per sessie (token-buis, kosten, cache). */
export interface LiveStatus {
  sessionId: string;
  ts: number;
  model: string;
  contextPct: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
  cacheHitRatio: number | null;
  cacheWarm: boolean | null;
}

export interface Effect {
  id: string;
  type: EffectType;
  sessionId: string;
  ts: number;
}

export interface TickerItem {
  id: string;
  ts: number;
  text: string;
  kind: AraEvent['kind'];
  error: boolean;
}

export interface SpeechBubble {
  sessionId: string;
  agentId?: string;
  text: string;
  ts: number;
}

interface AraStore {
  connected: boolean;
  demo: boolean;
  world: WorldConfig | null;
  snapshot: WorldSnapshot;
  effects: Effect[];
  bubbles: SpeechBubble[];
  ticker: TickerItem[];
  overviewOpen: boolean;
  lastEventSessionId: string | null;

  selectedSessionId: string | null;
  selectedEvents: AraEvent[];
  filterVenture: string | null;
  search: string;
  followLive: boolean;
  soundOn: boolean;
  panelOpen: boolean;
  boardOpen: boolean;
  /** LOD: true wanneer ver uitgezoomd — icons/bubbles verbergen (perf). */
  lodFar: boolean;
  /** Cinematic postprocessing (tilt-shift/bloom); governor zet uit bij lage fps. */
  postFxOn: boolean;
  /** Zwak device: zware sier-lagen (crowd/districtlife/weer) uit. */
  perfLow: boolean;
  /** Verhoogd bij elk SSE 'tasks'-event zodat het bord live ververst. */
  tasksVersion: number;
  flyTarget: { sessionId: string; ts: number } | null;
  /** Non-null while scrubbing history: snapshot reconstructed at replayTs. */
  replaySnapshot: WorldSnapshot | null;
  replayTs: number | null;
  /** Statusline-feed: sessionId → live context/kosten/cache. */
  liveStatus: Record<string, LiveStatus>;
  /** OTel-feed: sessionId → latency-statistiek. */
  latency: Record<string, LatencyStat>;

  setConnected(connected: boolean): void;
  setWorld(world: WorldConfig): void;
  hydrate(snapshot: WorldSnapshot): void;
  applyEvent(event: AraEvent): void;
  resetState(): void;
  select(sessionId: string | null): void;
  setSelectedEvents(events: AraEvent[]): void;
  setFilterVenture(venture: string | null): void;
  setSearch(search: string): void;
  toggleFollowLive(): void;
  toggleSound(): void;
  setPanelOpen(open: boolean): void;
  setBoardOpen(open: boolean): void;
  setLodFar(far: boolean): void;
  setOverviewOpen(open: boolean): void;
  setPostFxOn(on: boolean): void;
  setPerfLow(low: boolean): void;
  bumpTasks(): void;
  flyTo(sessionId: string): void;
  pruneEphemera(): void;
  setReplay(ts: number | null, snapshot: WorldSnapshot | null): void;
  setLiveStatus(status: LiveStatus): void;
  setAllLiveStatus(list: LiveStatus[]): void;
  setLatency(stat: LatencyStat): void;
  setAllLatency(list: LatencyStat[]): void;
}

const worldState = new WorldState();
const EMPTY: WorldSnapshot = {
  now: Date.now(),
  sessions: {},
  projects: [],
  counters: { needsHuman: 0, running: 0, doneToday: 0 },
};

// Rolling per-session event buffer so the detail drawer updates live and
// works in demo mode (fixture events never reach SQLite).
const recentEvents = new Map<string, AraEvent[]>();
const RECENT_LIMIT = 50;
const RECENT_SESSIONS_LIMIT = 300;

function remember(event: AraEvent): void {
  const list = recentEvents.get(event.sessionId) ?? [];
  list.push(event);
  if (list.length > RECENT_LIMIT) list.shift();
  // Delete+set ververst de insertion-order → oudst-aangeraakte sessie staat
  // vooraan en wordt weggegooid zodra de buffer te veel sessies bevat.
  recentEvents.delete(event.sessionId);
  recentEvents.set(event.sessionId, list);
  if (recentEvents.size > RECENT_SESSIONS_LIMIT) {
    const oldest = recentEvents.keys().next().value;
    if (oldest !== undefined) recentEvents.delete(oldest);
  }
}

/** Merge fetched history with the live buffer, dedup by id, ascending ts. */
export function eventsForSession(sessionId: string, fetched: AraEvent[] = []): AraEvent[] {
  const map = new Map<string, AraEvent>();
  for (const e of fetched) map.set(e.id, e);
  for (const e of recentEvents.get(sessionId) ?? []) map.set(e.id, e);
  return [...map.values()].sort((a, b) => a.ts - b.ts).slice(-RECENT_LIMIT);
}

function loadPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode */
  }
}

function effectsFor(event: AraEvent): Effect[] {
  const make = (type: EffectType): Effect => ({
    id: `${event.id}-${type}`,
    type,
    sessionId: event.sessionId,
    ts: Date.now(),
  });
  switch (event.kind) {
    case 'tool.post':
      return [make(event.status === 'error' ? 'smoke' : 'sparkle')];
    case 'task.completed':
      return [make('flag'), make('confetti')];
    case 'session.end':
      return [make('confetti')];
    case 'notification':
      return [make('nudge')];
    case 'permission.ask':
      return [make('gate')];
    case 'permission.deny':
      return [make('deny')];
    case 'compact.start':
      return [make('storm')];
    case 'model.switch':
      return [make('morph')];
    case 'tool.batch':
      return [make('bolt')];
    case 'task.created':
      return [make('paper')];
    default:
      return [];
  }
}

export const useAra = create<AraStore>((set, get) => ({
  connected: false,
  demo: new URLSearchParams(location.search).has('demo'),
  world: null,
  snapshot: EMPTY,
  effects: [],
  bubbles: [],
  ticker: [],
  overviewOpen: false,
  lastEventSessionId: null,

  selectedSessionId: null,
  selectedEvents: [],
  filterVenture: null,
  search: '',
  followLive: loadPref('ara.followLive', false),
  soundOn: loadPref('ara.soundOn', false),
  panelOpen: window.innerWidth > 800,
  boardOpen: false,
  lodFar: false,
  postFxOn: true,
  perfLow: false,
  tasksVersion: 0,
  flyTarget: null,
  replaySnapshot: null,
  replayTs: null,
  liveStatus: {},
  latency: {},

  setConnected: (connected) => set({ connected }),
  setWorld: (world) => set({ world }),

  hydrate: (snapshot) => {
    worldState.hydrate(snapshot);
    set({ snapshot: worldState.snapshot() });
  },

  applyEvent: (event) => {
    // Vóór apply: was deze sessie in error? Dan is een geslaagde tool een
    // "reparatie" — dat verhaal vertellen we met een eigen effect.
    const prevStatus = get().snapshot.sessions[event.sessionId]?.status;
    worldState.apply(event);
    remember(event);
    const now = Date.now();
    const newEffects = effectsFor(event);
    if (prevStatus === 'error' && event.kind === 'tool.post' && event.status === 'ok') {
      newEffects.push({ id: `${event.id}-repair`, type: 'repair', sessionId: event.sessionId, ts: now });
    }
    const effects = [...get().effects, ...newEffects].slice(-60);

    // Live-ticker: alleen betekenisvolle regels.
    let ticker = get().ticker;
    const TICKER_TEXT: Partial<Record<AraEvent['kind'], () => string>> = {
      'session.start': () => `▶ ${event.project}: sessie gestart`,
      'session.end': () => `■ ${event.project}: sessie klaar`,
      'tool.pre': () => `${event.project}: ${event.toolSummary ?? event.tool ?? ''}`,
      'agent.start': () => `${event.project}: agent ${event.agentType ?? ''} erbij`,
      notification: () => `⚠ ${event.project}: ${event.message?.slice(0, 60) ?? 'heeft je nodig'}`,
      'task.completed': () => `✔ ${event.project}: ${event.message?.slice(0, 60) ?? 'taak afgerond'}`,
      'task.created': () => `📋 ${event.project}: ${event.message?.slice(0, 60) ?? 'nieuwe taak'}`,
      'model.switch': () => `⚡ ${event.project}: ${event.message ?? 'model-switch'}`,
      'permission.ask': () => `✋ ${event.project}: wacht op toestemming`,
      'compact.start': () => `🌀 ${event.project}: context comprimeren`,
      'worktree.start': () => `🏝 ${event.project}: ${event.message ?? 'worktree'}`,
      'tool.batch': () => `⛓ ${event.project}: ${event.message ?? 'parallelle tools'}`,
    };
    const line = TICKER_TEXT[event.kind]?.();
    if (line) {
      ticker = [
        ...ticker,
        {
          id: event.id,
          ts: now,
          text: line.slice(0, 90),
          kind: event.kind,
          error: event.status === 'error' || event.kind === 'notification',
        },
      ].slice(-6);
    }
    let bubbles = get().bubbles;
    if (event.toolSummary && event.kind === 'tool.pre') {
      bubbles = [
        ...bubbles.filter((b) => b.sessionId !== event.sessionId || b.agentId !== event.agentId),
        {
          sessionId: event.sessionId,
          agentId: event.agentId,
          text: event.toolSummary.slice(0, 60),
          ts: now,
        },
      ].slice(-20);
    }
    set({
      snapshot: worldState.snapshot(),
      effects,
      bubbles,
      ticker,
      lastEventSessionId: event.sessionId,
      // Keep the open drawer live.
      selectedEvents:
        get().selectedSessionId === event.sessionId
          ? eventsForSession(event.sessionId, get().selectedEvents)
          : get().selectedEvents,
    });
    const { followLive, flyTo, replayTs } = get();
    if (followLive && !replayTs && event.kind !== 'tool.post') flyTo(event.sessionId);
  },

  resetState: () => {
    worldState.hydrate(EMPTY);
    recentEvents.clear();
    set({ snapshot: worldState.snapshot(), effects: [], bubbles: [], selectedEvents: [] });
  },

  select: (sessionId) =>
    set({
      selectedSessionId: sessionId,
      selectedEvents: sessionId ? eventsForSession(sessionId) : [],
    }),
  setSelectedEvents: (events) =>
    set((s) => ({
      selectedEvents: s.selectedSessionId ? eventsForSession(s.selectedSessionId, events) : events,
    })),
  setFilterVenture: (venture) => set({ filterVenture: venture }),
  setSearch: (search) => set({ search }),
  toggleFollowLive: () =>
    set((s) => {
      savePref('ara.followLive', !s.followLive);
      return { followLive: !s.followLive };
    }),
  toggleSound: () =>
    set((s) => {
      savePref('ara.soundOn', !s.soundOn);
      return { soundOn: !s.soundOn };
    }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setBoardOpen: (open) => set({ boardOpen: open }),
  setLodFar: (far) => set({ lodFar: far }),
  setOverviewOpen: (open) => set({ overviewOpen: open }),
  setPostFxOn: (on) => set({ postFxOn: on }),
  setPerfLow: (low) => set({ perfLow: low }),
  bumpTasks: () => set((s) => ({ tasksVersion: s.tasksVersion + 1 })),

  flyTo: (sessionId) => set({ flyTarget: { sessionId, ts: Date.now() } }),

  pruneEphemera: () => {
    const now = Date.now();
    const effects = get().effects.filter((e) => now - e.ts < 4000);
    const bubbles = get().bubbles.filter((b) => now - b.ts < 4000);
    const ticker = get().ticker.filter((t) => now - t.ts < 12_000);
    if (
      effects.length !== get().effects.length ||
      bubbles.length !== get().bubbles.length ||
      ticker.length !== get().ticker.length
    ) {
      set({ effects, bubbles, ticker });
    }
  },

  setReplay: (ts, snapshot) => set({ replayTs: ts, replaySnapshot: snapshot }),

  setLiveStatus: (status) =>
    set((s) => ({ liveStatus: { ...s.liveStatus, [status.sessionId]: status } })),
  setAllLiveStatus: (list) =>
    set({ liveStatus: Object.fromEntries(list.map((st) => [st.sessionId, st])) }),
  setLatency: (stat) => set((s) => ({ latency: { ...s.latency, [stat.sessionId]: stat } })),
  setAllLatency: (list) =>
    set({ latency: Object.fromEntries(list.map((st) => [st.sessionId, st])) }),
}));

/**
 * Latency-physics: echte tool-duur → animatiesnelheid.
 * ~100ms gemiddeld = 1.5× (hyperactief), ~1s = 0.95×, 10s+ = 0.55× (zwoegen).
 */
export function speedForLatency(stat: LatencyStat | undefined): number {
  if (!stat || stat.samples < 2) return 1;
  const avg = Math.max(50, stat.avgToolMs);
  return Math.min(1.6, Math.max(0.55, 2.6 - 0.55 * Math.log10(avg)));
}

/** The snapshot the scene should render: history scrub wins over live. */
export function useViewSnapshot(): WorldSnapshot {
  return useAra((s) => s.replaySnapshot ?? s.snapshot);
}
