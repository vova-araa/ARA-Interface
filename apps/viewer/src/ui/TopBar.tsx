import { useRef } from 'react';
import { useAra, useViewSnapshot } from '../store.ts';

export function TopBar(): JSX.Element {
  const snapshot = useViewSnapshot();
  const counters = snapshot.counters;
  const replaying = useAra((s) => s.replayTs !== null);
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);
  const needsCycle = useRef(0);

  // Sessies die op een fout zijn blijven staan. Die stonden nergens in de
  // balk, terwijl het precies is wat je wilt zien voordat je iets anders doet.
  const broken = Object.values(snapshot.sessions).filter(
    (s) => s.status === 'error' && !s.endedAt,
  );
  const brokenCycle = useRef(0);
  const jumpToBroken = (): void => {
    if (broken.length === 0) return;
    const target = broken[brokenCycle.current % broken.length]!;
    brokenCycle.current += 1;
    select(target.sessionId);
    flyTo(target.sessionId);
  };

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
  const boardOpen = useAra((s) => s.boardOpen);
  const actionsOpen = useAra((s) => s.actionsOpen);
  const setActionsOpen = useAra((s) => s.setActionsOpen);
  const setBoardOpen = useAra((s) => s.setBoardOpen);
  const overviewOpen = useAra((s) => s.overviewOpen);
  const setOverviewOpen = useAra((s) => s.setOverviewOpen);
  const demo = useAra((s) => s.demo);

  return (
    <div className="topbar">
      <div className="topbar-title">
        ⬡ ARA World {demo && <span className="chip chip-demo">demo</span>}
        {replaying && <span className="chip chip-demo">replay</span>}
      </div>
      {/* Wat er nú gebeurt, op één rij. Het stond verspreid: draaiende sessies
          hier, fouten alleen in de threadlijst, escalaties alleen in het
          actiepaneel. Als je moet zoeken om te weten of er iets brandt, dan
          kijk je niet. */}
      <div className="topbar-stats">
        <span
          className={`stat stat-click ${counters.needsHuman > 0 ? 'stat-urgent' : ''}`}
          onClick={jumpToNeedy}
          title="Vlieg naar de volgende sessie die op jou wacht"
        >
          🔴 Wacht: <b>{counters.needsHuman}</b>
        </span>
        <span className="stat">🟡 Bezig: <b>{counters.running}</b></span>
        <span
          className={`stat stat-click ${broken.length > 0 ? 'stat-bad' : ''}`}
          onClick={jumpToBroken}
          title={broken.length > 0 ? broken.map((s) => s.project).join(', ') : 'Geen fouten'}
        >
          ⛔ Fout: <b>{broken.length}</b>
        </span>
        <span className="stat">🟢 Klaar: <b>{counters.doneToday}</b></span>
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
        <button
          className={`btn ${overviewOpen ? 'btn-active' : ''}`}
          onClick={() => setOverviewOpen(!overviewOpen)}
          title="Overzicht (o)"
        >
          ⊞
        </button>
        <button
          className={`btn ${boardOpen ? 'btn-active' : ''}`}
          onClick={() => setBoardOpen(!boardOpen)}
          title="Takenbord (b)"
        >
          ☷
        </button>
        <button
          className={`btn ${actionsOpen ? 'btn-active' : ''}`}
          onClick={() => setActionsOpen(!actionsOpen)}
          title="Acties — alles wat op jou wacht (a)"
        >
          ✓
        </button>
        <button className="btn" onClick={() => setPanelOpen(!panelOpen)} title="Thread list">
          ☰
        </button>
      </div>
    </div>
  );
}
