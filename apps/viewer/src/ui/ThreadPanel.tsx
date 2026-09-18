import { useMemo, useRef, type CSSProperties } from 'react';
import { VENTURES, visibleInWorld, type PodStatus, type SessionState } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import { loadSessionEvents } from '../api.ts';
import { projectPlacement, ventureOf } from '../placements.ts';
import { ageString, STATUS_COLORS, toolIcon } from '../util.ts';
import { UsageTable } from './UsageTable.tsx';

/**
 * Wat een status betekent, in woorden. Een gekleurde stip alleen is een quiz:
 * geel is hier "wacht op jou" en niet "let op" — dat verschil bepaalt of je je
 * telefoon pakt of niet, dus staat het er ook echt.
 */
const STATUS_LABEL: Record<PodStatus, string> = {
  needsHuman: 'wacht op jou',
  error: 'vastgelopen',
  working: 'bezig',
  done: 'klaar',
  idle: 'stil',
};

/** Volgorde waarin een groep aandacht verdient: mensen eerst, dan storingen. */
const STATUS_WEIGHT: Record<PodStatus, number> = {
  needsHuman: 3,
  error: 2,
  working: 1,
  idle: 0,
  done: 0,
};

function urgency(sessions: SessionState[]): number {
  return sessions.reduce((max, s) => Math.max(max, STATUS_WEIGHT[s.status] ?? 0), 0);
}

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

  /** Alles wat zichtbaar is vóór het filter — nodig om "0 van 7" te kunnen zeggen. */
  const visible = useMemo(() => {
    const sessions = Object.values(snapshot.sessions);
    return world ? sessions.filter((s) => visibleInWorld(world, s.project)) : sessions;
  }, [snapshot, world]);

  const groups = useMemo(() => {
    let sessions = visible;
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
    const byProject = new Map<string, SessionState[]>();
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
        live: list.filter((s) => !s.endedAt).length,
        urgency: urgency(list),
        color: world ? ventureOf(world, project).color : 'var(--border)',
      }))
      // Wie op een mens wacht staat bovenaan, daarna wat stukstaat, daarna de
      // recentste. Anders zakt precies het ene ding waarvoor je kijkt weg
      // onder vijf projecten die het prima doen.
      .sort((a, b) => b.urgency - a.urgency || b.latest - a.latest);
  }, [visible, search, filterVenture, world]);

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

  const filtering = Boolean(search) || filterVenture !== null;
  const clearFilters = (): void => {
    setSearch('');
    setFilterVenture(null);
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
        <div className="search-wrap">
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            className="search"
            placeholder="Zoek in sessies…"
            aria-label="Zoek in sessies"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear"
              title="Zoekterm wissen"
              aria-label="Zoekterm wissen"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          )}
        </div>
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
            /* De takkleur zat eerst in de rand van élke chip: negen gekleurde
               ringen naast elkaar, en dan is niets meer geaccentueerd. Nu draagt
               de chip een stipje in zijn kleur en kleurt alleen de actieve. */
            className={`chip ${filterVenture === v.id ? 'chip-active' : ''}`}
            style={{ '--venture': v.color } as CSSProperties}
            onClick={() => setFilterVenture(filterVenture === v.id ? null : v.id)}
          >
            <span className="chip-dot" aria-hidden="true" />
            {v.label}
          </button>
        ))}
      </div>
      <div className="thread-list">
        {groups.length === 0 && (
          /* Lege staat met een reden erbij: "niets gevonden" en "er is nog
             niets" zijn twee verschillende problemen met twee verschillende
             vervolgstappen, en een kale regel tekst vertelt je niet welke. */
          <div className="empty">
            {filtering ? (
              <>
                <div className="empty-icon" aria-hidden="true">
                  ⌕
                </div>
                <div className="empty-title">Geen sessie past hierbij</div>
                <div className="empty-hint">
                  {visible.length > 0
                    ? `${visible.length} ${visible.length === 1 ? 'sessie staat' : 'sessies staan'} buiten dit filter.`
                    : 'Er loopt op dit moment niets.'}
                </div>
                <button type="button" className="btn empty-btn" onClick={clearFilters}>
                  Filter wissen
                </button>
              </>
            ) : (
              <>
                <div className="empty-icon" aria-hidden="true">
                  ⬡
                </div>
                <div className="empty-title">Nog geen sessies</div>
                <div className="empty-hint">
                  Start ergens een Claude Code sessie — die verschijnt hier binnen een paar
                  seconden als pod in de wereld.
                </div>
              </>
            )}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.project} className="thread-group">
            {/* Projectkop draagt de takkleur en de samenvatting; de sessieregels
                eronder hangen aan een rail in diezelfde kleur, zodat je ziet
                waar een groep begint zonder de kop te hoeven lezen. */}
            <div
              className="thread-project"
              style={{ '--venture': group.color } as CSSProperties}
            >
              <span className="thread-project-name">{group.project}</span>
              <span className="thread-project-meta">
                {group.live > 0 && <span className="thread-live">{group.live} actief</span>}
                <span className="thread-age">{ageString(group.latest)}</span>
              </span>
            </div>
            <div
              className="thread-rows"
              style={{ '--venture': group.color } as CSSProperties}
            >
              {group.sessions.map((session) => {
                const attention =
                  session.status === 'needsHuman'
                    ? 'thread-needs'
                    : session.status === 'error'
                      ? 'thread-error'
                      : '';
                const tool = session.activeTool ?? session.lastTool;
                return (
                  <button
                    key={session.sessionId}
                    className={`thread ${attention} ${
                      selectedSessionId === session.sessionId ? 'thread-selected' : ''
                    }`}
                    title={`${session.project} — ${STATUS_LABEL[session.status]}`}
                    onClick={() => onSelect(session.sessionId)}
                  >
                    <span
                      className={`dot ${session.status === 'working' ? 'dot-live' : ''}`}
                      style={{ background: STATUS_COLORS[session.status] }}
                    />
                    <span className="thread-body">
                      <span className="thread-title">
                        {session.message?.slice(0, 60) || session.sessionId.slice(0, 12)}
                      </span>
                      {/* Tweede regel: wat het nú doet. Het stond op dezelfde
                          regel als de titel en werd daar als eerste afgekapt. */}
                      <span className="thread-sub">
                        <span
                          className={`thread-status thread-status-${session.status}`}
                          style={{ color: STATUS_COLORS[session.status] }}
                        >
                          {STATUS_LABEL[session.status]}
                        </span>
                        {tool && (
                          <span className="thread-tool">
                            {toolIcon(tool)} {session.lastToolSummary?.slice(0, 34) || tool}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="thread-meta">{ageString(session.lastSeenAt)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <UsageTable />
    </div>
  );
}
