import { create } from 'zustand';
import {
  WorldState,
  type AraEvent,
  type WorldConfig,
  type WorldSnapshot,
} from '@ara/shared';

export type EffectType = 'sparkle' | 'smoke' | 'confetti' | 'flag' | 'nudge';

export interface Effect {
  id: string;
  type: EffectType;
  sessionId: string;
  ts: number;
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
  /** Verhoogd bij elk SSE 'tasks'-event zodat het bord live ververst. */
  tasksVersion: number;
  flyTarget: { sessionId: string; ts: number } | null;
  /** Non-null while scrubbing history: snapshot reconstructed at replayTs. */
  replaySnapshot: WorldSnapshot | null;
  replayTs: number | null;

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
  bumpTasks(): void;
  flyTo(sessionId: string): void;
  pruneEphemera(): void;
  setReplay(ts: number | null, snapshot: WorldSnapshot | null): void;
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

function remember(event: AraEvent): void {
  const list = recentEvents.get(event.sessionId) ?? [];
  list.push(event);
  if (list.length > RECENT_LIMIT) list.shift();
  recentEvents.set(event.sessionId, list);
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
  tasksVersion: 0,
  flyTarget: null,
  replaySnapshot: null,
  replayTs: null,

  setConnected: (connected) => set({ connected }),
  setWorld: (world) => set({ world }),

  hydrate: (snapshot) => {
    worldState.hydrate(snapshot);
    set({ snapshot: worldState.snapshot() });
  },

  applyEvent: (event) => {
    worldState.apply(event);
    remember(event);
    const now = Date.now();
    const effects = [...get().effects, ...effectsFor(event)].slice(-60);
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
  bumpTasks: () => set((s) => ({ tasksVersion: s.tasksVersion + 1 })),

  flyTo: (sessionId) => set({ flyTarget: { sessionId, ts: Date.now() } }),

  pruneEphemera: () => {
    const now = Date.now();
    const effects = get().effects.filter((e) => now - e.ts < 4000);
    const bubbles = get().bubbles.filter((b) => now - b.ts < 4000);
    if (effects.length !== get().effects.length || bubbles.length !== get().bubbles.length) {
      set({ effects, bubbles });
    }
  },

  setReplay: (ts, snapshot) => set({ replayTs: ts, replaySnapshot: snapshot }),
}));

/** The snapshot the scene should render: history scrub wins over live. */
export function useViewSnapshot(): WorldSnapshot {
  return useAra((s) => s.replaySnapshot ?? s.snapshot);
}
