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
  flyTarget: { sessionId: string; ts: number } | null;

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
  flyTo(sessionId: string): void;
  pruneEphemera(): void;
}

const worldState = new WorldState();
const EMPTY: WorldSnapshot = {
  now: Date.now(),
  sessions: {},
  projects: [],
  counters: { needsHuman: 0, running: 0, doneToday: 0 },
};

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
  followLive: false,
  soundOn: false,
  panelOpen: window.innerWidth > 800,
  flyTarget: null,

  setConnected: (connected) => set({ connected }),
  setWorld: (world) => set({ world }),

  hydrate: (snapshot) => {
    worldState.hydrate(snapshot);
    set({ snapshot: worldState.snapshot() });
  },

  applyEvent: (event) => {
    worldState.apply(event);
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
    });
    const { followLive, flyTo } = get();
    if (followLive && event.kind !== 'tool.post') flyTo(event.sessionId);
  },

  resetState: () => {
    worldState.hydrate(EMPTY);
    set({ snapshot: worldState.snapshot(), effects: [], bubbles: [] });
  },

  select: (sessionId) =>
    set({ selectedSessionId: sessionId, selectedEvents: sessionId ? get().selectedEvents : [] }),
  setSelectedEvents: (events) => set({ selectedEvents: events }),
  setFilterVenture: (venture) => set({ filterVenture: venture }),
  setSearch: (search) => set({ search }),
  toggleFollowLive: () => set((s) => ({ followLive: !s.followLive })),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  setPanelOpen: (open) => set({ panelOpen: open }),

  flyTo: (sessionId) => set({ flyTarget: { sessionId, ts: Date.now() } }),

  pruneEphemera: () => {
    const now = Date.now();
    const effects = get().effects.filter((e) => now - e.ts < 4000);
    const bubbles = get().bubbles.filter((b) => now - b.ts < 4000);
    if (effects.length !== get().effects.length || bubbles.length !== get().bubbles.length) {
      set({ effects, bubbles });
    }
  },
}));
