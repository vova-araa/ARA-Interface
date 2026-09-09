import { useAra } from '../store.ts';
import { ageString, STATUS_COLORS, toolIcon } from '../util.ts';

export function DetailDrawer(): JSX.Element | null {
  const selectedSessionId = useAra((s) => s.selectedSessionId);
  const session = useAra((s) =>
    s.selectedSessionId ? s.snapshot.sessions[s.selectedSessionId] : undefined,
  );
  const events = useAra((s) => s.selectedEvents);
  const select = useAra((s) => s.select);

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
