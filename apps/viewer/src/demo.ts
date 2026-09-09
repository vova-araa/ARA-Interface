import type { AraEvent, WorldConfig } from '@ara/shared';
import { useAra } from './store.ts';

/**
 * Demo mode (?demo=1): replays the bundled fixture as a ~2 minute story.
 * Timestamps are remapped so the story starts "now"; loops forever.
 */
export async function runDemo(): Promise<void> {
  const store = useAra.getState();

  try {
    const world = (await (await fetch('/world')).json()) as WorldConfig;
    store.setWorld(world);
  } catch {
    /* viewer still renders a hub-only world */
  }

  let events: AraEvent[] = [];
  try {
    events = ((await (await fetch('/fixture')).json()) as { events: AraEvent[] }).events;
  } catch {
    /* no fixture — nothing to replay */
  }
  if (events.length === 0) {
    useAra.getState().setConnected(true);
    return;
  }

  useAra.getState().setConnected(true);
  const first = events[0]!.ts;

  const playOnce = (): number => {
    const base = Date.now();
    let last = 0;
    for (const event of events) {
      const offset = event.ts - first;
      last = offset;
      setTimeout(() => {
        useAra.getState().applyEvent({ ...event, ts: base + offset });
      }, offset);
    }
    return last;
  };

  const loop = (): void => {
    useAra.getState().resetState();
    const duration = playOnce();
    setTimeout(loop, duration + 8000); // linger on the finished world, then restart
  };
  loop();

  setInterval(() => useAra.getState().pruneEphemera(), 1000);
}
