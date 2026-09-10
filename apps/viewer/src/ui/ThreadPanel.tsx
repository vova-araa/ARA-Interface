import { useMemo, useRef } from 'react';
import { VENTURES, visibleInWorld } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { loadSessionEvents } from '../api.ts';
import { projectPlacement } from '../placements.ts';
import { ageString, STATUS_COLORS, toolIcon } from '../util.ts';
import { UsageTable } from './UsageTable.tsx';

export function ThreadPanel(): JSX.Element | null {
  const snapshot = useViewSnapshot();
  const world = useAra((s) => s.world);
  const panelOpen = useAra((s) => s.panelOpen);
  const filterVenture = useAra((s) => s.filterVenture);
  const setFilterVenture = useAra((s) => s.setFilterVenture);
  const search = useAra((s) => s.search);
  const setSearch = useAra((s) => s.setSearch);
  const select = useAra((s) => s.select);
  const setSelectedEvents = useAra((s) => s.setSelectedEvents);
  const flyTo = useAra((s) => s.flyTo);
  const selectedSessionId = useAra((s) => s.selectedSessionId);
  const demo = useAra((s) => s.demo);
  const setPanelOpen = useAra((s) => s.setPanelOpen);
  const touchStartY = useRef<number | null>(null);

  const groups = useMemo(() => {
    let sessions = Object.values(snapshot.sessions);
    if (world) sessions = sessions.filter((s) => visibleInWorld(world, s.project));
    if (filterVenture && world) {
      sessions = sessions.filter(
        (s) => projectPlacement(world, s.project).venture === filterVenture,
      );
    }
    if (search) {
      const q = search.toLowerCase();
      sessions = sessions.filter(
        (s) =>
          s.project.toLowerCase().includes(q) ||
          (s.message ?? '').toLowerCase().includes(q) ||
          (s.lastTool ?? '').toLowerCase().includes(q),
      );
    }
    const byProject = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const list = byProject.get(session.project) ?? [];
      list.push(session);
      byProject.set(session.project, list);
    }
    return [...byProject.entries()]
      .map(([project, list]) => ({
        project,
        sessions: list.sort((a, b) => b.lastSeenAt - a.lastSeenAt),
        latest: Math.max(...list.map((s) => s.lastSeenAt)),
      }))
      .sort((a, b) => b.latest - a.latest);
  }, [snapshot, search, filterVenture, world]);

  const activeVentures = useMemo(() => {
    if (!world) return [];
    return VENTURES.filter((v) => world.districts.some((d) => d.venture.id === v.id));
  }, [world]);

  if (!panelOpen) return null;

  const onSelect = (sessionId: string): void => {
    select(sessionId); // seeds the drawer from the in-memory event buffer
    flyTo(sessionId);
    if (!demo) {
      // Backfill older events from SQLite; merged with the live buffer.
      void loadSessionEvents(sessionId).then(setSelectedEvents);
    }
  };

  return (
    <div className="panel">
      {/* Mobiel: sleep de grip omlaag om de sheet te sluiten */}
      <div
        className="grip"
        onTouchStart={(e) => (touchStartY.current = e.touches[0]?.clientY ?? null)}
        onTouchMove={(e) => {
          const y = e.touches[0]?.clientY;
          if (touchStartY.current !== null && y !== undefined && y - touchStartY.current > 55) {
            touchStartY.current = null;
            setPanelOpen(false);
          }
        }}
      >
        <span className="grip-bar" />
      </div>
      <div className="panel-header">
        <input
          className="search"
          placeholder="Search threads…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="chips">
        <button
          className={`chip ${filterVenture === null ? 'chip-active' : ''}`}
          onClick={() => setFilterVenture(null)}
        >
          All
        </button>
        {activeVentures.map((v) => (
          <button
            key={v.id}
            className={`chip ${filterVenture === v.id ? 'chip-active' : ''}`}
            style={{ borderColor: v.color }}
            onClick={() => setFilterVenture(filterVenture === v.id ? null : v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="thread-list">
        {groups.length === 0 && <div className="empty">No sessions yet. Start a Claude Code session anywhere.</div>}
        {groups.map((group) => (
          <div key={group.project} className="thread-group">
            <div className="thread-project">{group.project}</div>
            {group.sessions.map((session) => (
              <button
                key={session.sessionId}
                className={`thread ${selectedSessionId === session.sessionId ? 'thread-selected' : ''}`}
                onClick={() => onSelect(session.sessionId)}
              >
                <span className="dot" style={{ background: STATUS_COLORS[session.status] }} />
                <span className="thread-title">
                  {session.message?.slice(0, 40) || session.sessionId.slice(0, 12)}
                </span>
                <span className="thread-meta">
                  {toolIcon(session.activeTool ?? session.lastTool)} {ageString(session.lastSeenAt)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <UsageTable />
    </div>
  );
}
