import type { AraEvent, WorldConfig, WorldSnapshot } from '@ara/shared';
import { useAra } from './store.ts';

/** Live wiring: /world + /state hydration and the SSE stream with reconnect. */
export function connectLive(): void {
  void fetch('/world')
    .then((r) => r.json())
    .then((world: WorldConfig) => useAra.getState().setWorld(world))
    .catch(() => undefined);

  let source: EventSource | null = null;

  const resync = async (): Promise<void> => {
    try {
      const snapshot = (await (await fetch('/state')).json()) as WorldSnapshot;
      useAra.getState().hydrate(snapshot);
    } catch {
      /* collector down; SSE reconnect will retry */
    }
  };

  const open = (): void => {
    source?.close();
    source = new EventSource('/events');
    source.addEventListener('open', () => {
      useAra.getState().setConnected(true);
      void resync(); // replay from /state on (re)connect
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
    const res = (await (await fetch(`/session/${encodeURIComponent(sessionId)}`)).json()) as {
      events: AraEvent[];
    };
    return res.events;
  } catch {
    return [];
  }
}
