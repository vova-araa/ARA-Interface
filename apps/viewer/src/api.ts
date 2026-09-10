import type { AraEvent, WorldConfig, WorldSnapshot } from '@ara/shared';
import { useAra, type LiveStatus } from './store.ts';

/**
 * Auth token for online deployments (collector started with ARA_TOKEN).
 * Arrives once via ?token=… in the URL, then lives in localStorage.
 * EventSource can't set headers, so the token rides as a query param.
 */
function getToken(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('token');
    if (fromUrl) {
      localStorage.setItem('ara.token', fromUrl);
      return fromUrl;
    }
    return localStorage.getItem('ara.token') ?? '';
  } catch {
    return '';
  }
}

export function withToken(path: string): string {
  const token = getToken();
  if (!token) return path;
  return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

/** Live wiring: /world + /state hydration and the SSE stream with reconnect. */
export function connectLive(): void {
  void fetch(withToken('/world'))
    .then((r) => r.json())
    .then((world: WorldConfig) => useAra.getState().setWorld(world))
    .catch(() => undefined);

  let source: EventSource | null = null;

  // Events die binnenkomen terwijl /state onderweg is worden gebufferd en ná
  // de hydrate alsnog toegepast — anders wist een verouderde snapshot het
  // effect van een net ontvangen event (pod flitst terug naar 'idle').
  let resyncing = false;
  let buffered: AraEvent[] = [];

  const resync = async (): Promise<void> => {
    resyncing = true;
    buffered = [];
    // Statusline-feed is vluchtig: bij (re)connect de volledige stand ophalen.
    void fetch(withToken('/status'))
      .then((r) => r.json())
      .then((res: { status?: LiveStatus[] }) => {
        if (res.status) useAra.getState().setAllLiveStatus(res.status);
      })
      .catch(() => undefined);
    try {
      const snapshot = (await (await fetch(withToken('/state'))).json()) as WorldSnapshot;
      useAra.getState().hydrate(snapshot);
      for (const event of buffered) {
        if (event.ts > snapshot.now) useAra.getState().applyEvent(event);
      }
    } catch {
      /* collector down; SSE reconnect will retry */
    } finally {
      resyncing = false;
      buffered = [];
    }
  };

  const open = (): void => {
    source?.close();
    source = new EventSource(withToken('/events'));
    source.addEventListener('open', () => {
      useAra.getState().setConnected(true);
      void resync(); // replay from /state on (re)connect
    });
    source.addEventListener('world', () => {
      // Project list changed → collector rebuilt the map; refetch it.
      void fetch(withToken('/world'))
        .then((r) => r.json())
        .then((world: WorldConfig) => useAra.getState().setWorld(world))
        .catch(() => undefined);
    });
    source.addEventListener('tasks', () => useAra.getState().bumpTasks());
    source.addEventListener('status', (msg) => {
      try {
        useAra.getState().setLiveStatus(JSON.parse((msg as MessageEvent).data) as LiveStatus);
      } catch {
        /* skip malformed frame */
      }
    });
    source.addEventListener('ara', (msg) => {
      try {
        const event = JSON.parse((msg as MessageEvent).data) as AraEvent;
        if (resyncing) buffered.push(event);
        else useAra.getState().applyEvent(event);
      } catch {
        /* skip malformed frame */
      }
    });
    source.addEventListener('error', () => {
      useAra.getState().setConnected(false);
      // EventSource retries by itself; force a fresh object if it gave up.
      if (source?.readyState === EventSource.CLOSED) setTimeout(open, 3000);
    });
  };

  void resync();
  open();

  // Ephemera pruning loop (speech bubbles, effects).
  setInterval(() => useAra.getState().pruneEphemera(), 1000);
}

export async function loadSessionEvents(sessionId: string): Promise<AraEvent[]> {
  try {
    const res = (await (
      await fetch(withToken(`/session/${encodeURIComponent(sessionId)}`))
    ).json()) as { events: AraEvent[] };
    return res.events;
  } catch {
    return [];
  }
}

export interface BoardTask {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  detail: string;
  project: string;
  assignee: string;
  createdBy: string;
  parentId: string | null;
  status: 'open' | 'claimed' | 'done' | 'failed';
  result: string;
}

export async function loadTasks(): Promise<BoardTask[]> {
  try {
    const res = (await (await fetch(withToken('/tasks?limit=100'))).json()) as {
      tasks: BoardTask[];
    };
    return res.tasks;
  } catch {
    return [];
  }
}

/** Tap-to-prompt: een taak vanaf telefoon/laptop → supervisor pakt hem op (watchdog-tick, ≤5 min). */
export async function createUserTask(title: string, project: string): Promise<boolean> {
  try {
    const res = await fetch(withToken('/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, project, assignee: 'supervisor', createdBy: 'user' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ProjectHourStats {
  project: string;
  hour: number;
  events: number;
  errors: number;
}

export interface UsageRow {
  project: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export async function loadUsage(): Promise<{ usage: UsageRow[]; budget: number }> {
  try {
    const res = (await (await fetch(withToken('/usage'))).json()) as {
      usage?: UsageRow[];
      budget?: number;
    };
    return { usage: res.usage ?? [], budget: res.budget ?? 2_000_000 };
  } catch {
    return { usage: [], budget: 2_000_000 };
  }
}

export async function loadStats(): Promise<ProjectHourStats[]> {
  try {
    const res = (await (await fetch(withToken('/stats'))).json()) as {
      stats: ProjectHourStats[];
    };
    return res.stats;
  } catch {
    return [];
  }
}
