import { useEffect, useMemo, useState } from 'react';
import { VENTURES, type SessionState } from '@ara/shared';
import { useAra, useViewSnapshot } from '../store.ts';
import {
  loadStats,
  loadTasks,
  loadUsage,
  type BoardTask,
  type ProjectHourStats,
  type UsageRow,
} from '../api.ts';
import { projectPlacement } from '../placements.ts';
import { ageString } from '../util.ts';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface VentureCard {
  id: string;
  label: string;
  color: string;
  sessions: SessionState[];
  running: number;
  needsHuman: number;
  errors: number;
  tokens: number;
  openTasks: number;
  lastActivity: number;
  hours: ProjectHourStats[];
}

function MiniSpark({ hours }: { hours: ProjectHourStats[] }): JSX.Element {
  const nowHour = Math.floor(Date.now() / 3_600_000);
  const byHour = new Map<number, number>();
  for (const row of hours) byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.events);
  const bars = Array.from({ length: 24 }, (_, i) => byHour.get(nowHour - 23 + i) ?? 0);
  const max = Math.max(1, ...bars);
  return (
    <div className="ov-spark">
      {bars.map((v, i) => (
        <span key={i} style={{ height: `${v ? Math.max(10, (v / max) * 100) : 4}%` }} />
      ))}
    </div>
  );
}

/** Volledig functionaliteits-overzicht per venture: sessies, tokens, activiteit, taken. */
export function OverviewPanel(): JSX.Element | null {
  const open = useAra((s) => s.overviewOpen);
  const setOpen = useAra((s) => s.setOverviewOpen);
  const snapshot = useViewSnapshot();
  const world = useAra((s) => s.world);
  const demo = useAra((s) => s.demo);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const select = useAra((s) => s.select);
  const flyTo = useAra((s) => s.flyTo);

  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [stats, setStats] = useState<ProjectHourStats[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);

  useEffect(() => {
    if (!open || demo) return;
    const refresh = (): void => {
      void loadUsage().then((r) => setUsage(r.usage));
      void loadStats().then(setStats);
      void loadTasks().then(setTasks);
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [open, demo, tasksVersion]);

  const cards = useMemo((): VentureCard[] => {
    if (!world) return [];
    const projectVenture = (project: string): string => projectPlacement(world, project).venture;
    const byVenture = new Map<string, VentureCard>();
    for (const venture of VENTURES) {
      byVenture.set(venture.id, {
        id: venture.id,
        label: venture.label,
        color: venture.color,
        sessions: [],
        running: 0,
        needsHuman: 0,
        errors: 0,
        tokens: 0,
        openTasks: 0,
        lastActivity: 0,
        hours: [],
      });
    }
    for (const session of Object.values(snapshot.sessions)) {
      const card = byVenture.get(projectVenture(session.project));
      if (!card) continue;
      card.sessions.push(session);
      card.lastActivity = Math.max(card.lastActivity, session.lastSeenAt);
      if (!session.endedAt && session.status === 'working') card.running += 1;
      if (session.needsHuman) card.needsHuman += 1;
      card.errors += session.errorCount;
    }
    for (const row of usage) {
      const card = byVenture.get(projectVenture(row.project));
      if (card) card.tokens += row.inputTokens + row.outputTokens;
    }
    for (const row of stats) {
      const card = byVenture.get(projectVenture(row.project));
      if (card) card.hours.push(row);
    }
    for (const task of tasks) {
      if (task.status !== 'open' && task.status !== 'claimed') continue;
      const card = task.project ? byVenture.get(projectVenture(task.project)) : undefined;
      if (card) card.openTasks += 1;
    }
    return [...byVenture.values()]
      .filter((card) => card.sessions.length > 0 || card.tokens > 0 || card.openTasks > 0)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }, [world, snapshot, usage, stats, tasks]);

  if (!open) return null;

  const jumpTo = (card: VentureCard): void => {
    const target = [...card.sessions].sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
    if (target) {
      select(target.sessionId);
      flyTo(target.sessionId);
      setOpen(false);
    }
  };

  return (
    <div className="overview">
      <div className="ov-header">
        <b>Overzicht</b>
        <span className="ov-sub">
          {snapshot.counters.running} bezig · {snapshot.counters.needsHuman} wachten op jou ·{' '}
          {snapshot.counters.doneToday} af vandaag
        </span>
        <button className="btn" onClick={() => setOpen(false)}>✕</button>
      </div>
      <div className="ov-grid">
        {cards.length === 0 && <div className="empty">Nog geen activiteit vandaag.</div>}
        {cards.map((card) => (
          <button key={card.id} className="ov-card" style={{ borderColor: card.color }} onClick={() => jumpTo(card)}>
            <div className="ov-card-head">
              <span className="ov-dot" style={{ background: card.color }} />
              <b>{card.label}</b>
              {card.lastActivity > 0 && <span className="ov-age">{ageString(card.lastActivity)}</span>}
            </div>
            <MiniSpark hours={card.hours} />
            <div className="ov-stats">
              <span>{card.sessions.length} sessies</span>
              <span>{card.running} bezig</span>
              <span className={card.needsHuman ? 'stat-urgent' : ''}>{card.needsHuman} ⚠</span>
              <span className={card.errors ? 'stat-urgent' : ''}>{card.errors} fouten</span>
            </div>
            <div className="ov-stats">
              <span>⚡ {fmt(card.tokens)}</span>
              <span>☷ {card.openTasks} open</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
