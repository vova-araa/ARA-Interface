import { useEffect, useState } from 'react';
import { useAra } from '../store.ts';
import { loadStats, type ProjectHourStats } from '../api.ts';
import { ageString, STATUS_COLORS, toolIcon } from '../util.ts';

/** 24 hourly bars of project activity; errors tint the bar red. */
function Sparkline({ project, stats }: { project: string; stats: ProjectHourStats[] }): JSX.Element | null {
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const rows = stats.filter((s) => s.project === project);
  if (rows.length === 0) return null;
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const bars = Array.from({ length: 24 }, (_, i) => byHour.get(nowHour - 23 + i));
  const max = Math.max(1, ...rows.map((r) => r.events));
  return (
    <div className="sparkline" title="Activity, last 24h">
      {bars.map((bar, i) => (
        <span
          key={i}
          className="sparkline-bar"
          style={{
            height: `${bar ? Math.max(8, (bar.events / max) * 100) : 4}%`,
            background: bar && bar.errors > 0 ? 'var(--amber)' : 'var(--accent)',
            opacity: bar ? 0.95 : 0.25,
          }}
        />
      ))}
    </div>
  );
}

export function DetailDrawer(): JSX.Element | null {
  const selectedSessionId = useAra((s) => s.selectedSessionId);
  const session = useAra((s) =>
    s.selectedSessionId ? s.snapshot.sessions[s.selectedSessionId] : undefined,
  );
  const events = useAra((s) => s.selectedEvents);
  const select = useAra((s) => s.select);
  const demo = useAra((s) => s.demo);
  const [stats, setStats] = useState<ProjectHourStats[]>([]);

  useEffect(() => {
    if (selectedSessionId && !demo) void loadStats().then(setStats);
    else setStats([]);
  }, [selectedSessionId, demo]);

  if (!selectedSessionId || !session) return null;

  const agents = Object.values(session.agents);

  return (
    <div className="drawer">
      <div className="drawer-header">
        <span className="dot" style={{ background: STATUS_COLORS[session.status] }} />
        <div className="drawer-title">
          <b>{session.project}</b>
          <span className="drawer-sub">
            {session.sessionId.slice(0, 16)} · started {ageString(session.startedAt)} ago
          </span>
        </div>
        <button className="btn" onClick={() => select(null)}>✕</button>
      </div>

      {session.message && <div className="drawer-message">“{session.message}”</div>}

      <div className="drawer-stats">
        <span>{session.toolCount} tools</span>
        <span className={session.errorCount ? 'stat-urgent' : ''}>{session.errorCount} errors</span>
        <span>{agents.length} agents</span>
        <span>{session.status}</span>
      </div>

      <Sparkline project={session.project} stats={stats} />

      <div className="timeline">
        {events.length === 0 && <div className="empty">No stored events for this session.</div>}
        {[...events].reverse().map((event) => (
          <div key={event.id} className="timeline-row">
            <span className="timeline-age">{ageString(event.ts)}</span>
            <span className="timeline-icon">{toolIcon(event.tool)}</span>
            <span className={`timeline-text ${event.status === 'error' ? 'stat-urgent' : ''}`}>
              {event.kind}
              {event.tool ? ` · ${event.tool}` : ''}
              {event.toolSummary ? ` — ${event.toolSummary}` : ''}
              {event.message ? ` — ${event.message.slice(0, 60)}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
