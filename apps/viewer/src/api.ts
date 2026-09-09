import type { AraEvent, WorldConfig, WorldSnapshot } from '@ara/shared';
import { useAra } from './store.ts';

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

  const resync = async (): Promise<void> => {
    try {
      const snapshot = (await (await fetch(withToken('/state'))).json()) as WorldSnapshot;
      useAra.getState().hydrate(snapshot);
    } catch {
      /* collector down; SSE reconnect will retry */
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
    source.addEventListener('ara', (msg) => {
      try {
        useAra.getState().applyEvent(JSON.parse((msg as MessageEvent).data) as AraEvent);
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

export interface ProjectHourStats {
  project: string;
  hour: number;
  events: number;
  errors: number;
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
