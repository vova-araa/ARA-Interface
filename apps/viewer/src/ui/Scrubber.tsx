import { useRef, useState } from 'react';
import { WorldState, type AraEvent } from '@ara/shared';
import { useAra } from '../store.ts';
import { withToken } from '../api.ts';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STEPS = 1000;

let historyCache: { events: AraEvent[]; fetchedAt: number } | null = null;

async function loadHistory(): Promise<AraEvent[]> {
  if (historyCache && Date.now() - historyCache.fetchedAt < 60_000) return historyCache.events;
  const to = Date.now();
  const res = (await (await fetch(withToken(`/history?from=${to - WINDOW_MS}&to=${to}`))).json()) as {
    events: AraEvent[];
  };
  historyCache = { events: res.events, fetchedAt: Date.now() };
  return res.events;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Bottom time-scrubber: rebuilds the world at any moment in the last 24h. */
export function Scrubber(): JSX.Element | null {
  const demo = useAra((s) => s.demo);
  const replayTs = useAra((s) => s.replayTs);
  const setReplay = useAra((s) => s.setReplay);
  const [value, setValue] = useState(STEPS);
  const pending = useRef<number | null>(null);
  const busy = useRef(false);

  if (demo) return null; // fixture story has its own clock

  const applyScrub = async (v: number): Promise<void> => {
    if (v >= STEPS) {
      setReplay(null, null);
      return;
    }
    pending.current = v;
    if (busy.current) return;
    busy.current = true;
    try {
      const events = await loadHistory();
      while (pending.current !== null) {
        const step = pending.current;
        pending.current = null;
        const ts = Date.now() - WINDOW_MS + (step / STEPS) * WINDOW_MS;
        const state = new WorldState();
        for (const event of events) {
          if (event.ts > ts) break;
          state.apply(event);
        }
        // Snapshot op de scrub-tijd, niet de wandklok: anders vallen alle
        // gereplayde sessies buiten de TTL en tonen de tellers 0.
        setReplay(ts, state.snapshot(ts));
      }
    } catch {
      setReplay(null, null);
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="scrubber">
      <button
        className={`btn ${replayTs === null ? 'btn-active' : ''}`}
        onClick={() => {
          setValue(STEPS);
          setReplay(null, null);
        }}
      >
        LIVE
      </button>
      <input
        type="range"
        min={0}
        max={STEPS}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          void applyScrub(v);
        }}
      />
      <span className="scrubber-label">
        {replayTs === null ? 'now' : fmt(replayTs)}
      </span>
    </div>
  );
}
