import { useAra } from '../store.ts';

export function TopBar(): JSX.Element {
  const counters = useAra((s) => s.snapshot.counters);
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
      </div>
      <div className="topbar-stats">
        <span className={`stat ${counters.needsHuman > 0 ? 'stat-urgent' : ''}`}>
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
