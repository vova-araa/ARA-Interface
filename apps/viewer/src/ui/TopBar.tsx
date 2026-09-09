import { useRef } from 'react';
import { useAra, useViewSnapshot } from '../store.ts';

export function TopBar(): JSX.Element {
  const snapshot = useViewSnapshot();
  const counters = snapshot.counters;
  const replaying = useAra((s) => s.replayTs !== null);
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);
  const needsCycle = useRef(0);

  const jumpToNeedy = (): void => {
    const needy = Object.values(snapshot.sessions).filter((s) => s.needsHuman && !s.endedAt);
    if (needy.length === 0) return;
    const target = needy[needsCycle.current % needy.length]!;
    needsCycle.current += 1;
    select(target.sessionId);
    flyTo(target.sessionId);
  };
  const followLive = useAra((s) => s.followLive);
  const toggleFollowLive = useAra((s) => s.toggleFollowLive);
  const soundOn = useAra((s) => s.soundOn);
  const toggleSound = useAra((s) => s.toggleSound);
  const panelOpen = useAra((s) => s.panelOpen);
  const setPanelOpen = useAra((s) => s.setPanelOpen);
  const demo = useAra((s) => s.demo);

  return (
    <div className="topbar">
      <div className="topbar-title">
        ⬡ ARA World {demo && <span className="chip chip-demo">demo</span>}
        {replaying && <span className="chip chip-demo">replay</span>}
      </div>
      <div className="topbar-stats">
        <span
          className={`stat stat-click ${counters.needsHuman > 0 ? 'stat-urgent' : ''}`}
          onClick={jumpToNeedy}
          title="Fly to the next session that needs you"
        >
          🔴 Needs you: <b>{counters.needsHuman}</b>
        </span>
        <span className="stat">🟡 Running: <b>{counters.running}</b></span>
        <span className="stat">🟢 Done today: <b>{counters.doneToday}</b></span>
      </div>
      <div className="topbar-actions">
        <button
          className={`btn ${followLive ? 'btn-active' : ''}`}
          onClick={toggleFollowLive}
          title="Auto-fly to newest activity"
        >
          ◉ Follow
        </button>
        <button className={`btn ${soundOn ? 'btn-active' : ''}`} onClick={toggleSound} title="Sound">
          {soundOn ? '🔔' : '🔕'}
        </button>
        <button className="btn" onClick={() => setPanelOpen(!panelOpen)} title="Thread list">
          ☰
        </button>
      </div>
    </div>
  );
}
