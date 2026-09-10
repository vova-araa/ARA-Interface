import type { AraEvent, SessionState, WorldSnapshot } from './schema.ts';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // hide sessions idle > 6h from "running"
// Sessies die zó lang niets deden verdwijnen ook uit het geheugen en /state.
const SESSION_RETENTION_MS = 48 * 60 * 60 * 1000;
const PRUNE_THRESHOLD = 400;
const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * In-memory world state, rebuilt from SQLite on boot and updated per event.
 * This is what GET /state returns and what the viewer replays on reconnect.
 */
export class WorldState {
  private sessions = new Map<string, SessionState>();
  private doneToday = 0;
  // 0 = nog geen dag gezien; het eerste event bepaalt de dag. Zo telt een
  // replay van gisteren gewoon gisteren's completions.
  private doneDayStart = 0;
  private doneCounted = new Set<string>();

  apply(event: AraEvent): void {
    // Geheugengrens: heel oude sessies opruimen zodra de map groot wordt
    // (weken uptime met veel korte sessies mag /state niet laten groeien).
    if (this.sessions.size > PRUNE_THRESHOLD) {
      const cutoff = event.ts - SESSION_RETENTION_MS;
      for (const [id, s] of this.sessions) {
        if (s.lastSeenAt < cutoff) this.sessions.delete(id);
      }
    }
    const session = this.getOrCreate(event);
    session.lastSeenAt = event.ts;
    if (event.model) session.model = event.model;

    switch (event.kind) {
      case 'session.start':
        session.status = 'idle';
        session.endedAt = undefined;
        break;
      case 'session.end':
        session.endedAt = event.ts;
        if (session.status !== 'error') session.status = 'done';
        this.bumpDone(event.ts, session.sessionId);
        break;
      case 'prompt':
        session.status = 'working';
        session.needsHuman = false;
        session.message = event.message;
        break;
      case 'tool.pre':
        session.status = 'working';
        session.activeTool = event.tool;
        session.lastTool = event.tool;
        session.lastToolSummary = event.toolSummary;
        session.toolCount += 1;
        if (event.agentId) {
          const agent = session.agents[event.agentId];
          if (agent) {
            agent.activeTool = event.tool;
            agent.lastToolSummary = event.toolSummary;
            agent.lastSeenAt = event.ts;
          }
        }
        break;
      case 'tool.post':
        session.activeTool = undefined;
        if (event.status === 'error') {
          session.errorCount += 1;
          session.status = 'error';
        } else {
          // Een geslaagde tool = de permissie is verleend en het werk loopt.
          if (session.status === 'error' || session.status === 'needsHuman') session.status = 'working';
          session.needsHuman = false;
        }
        if (event.agentId && session.agents[event.agentId]) {
          session.agents[event.agentId]!.activeTool = undefined;
          session.agents[event.agentId]!.lastSeenAt = event.ts;
        }
        break;
      case 'agent.start':
        if (event.agentId) {
          session.agents[event.agentId] = {
            agentId: event.agentId,
            agentType: event.agentType,
            parentAgentId: event.parentAgentId,
            sessionId: session.sessionId,
            startedAt: event.ts,
            lastSeenAt: event.ts,
            stopped: false,
          };
        }
        break;
      case 'agent.stop':
        if (event.agentId && session.agents[event.agentId]) {
          session.agents[event.agentId]!.stopped = true;
          session.agents[event.agentId]!.lastSeenAt = event.ts;
        }
        break;
      case 'stop':
        // Main loop finished a turn: waiting for the human.
        if (session.status === 'working') session.status = 'idle';
        session.activeTool = undefined;
        break;
      case 'notification':
        session.needsHuman = true;
        session.status = 'needsHuman';
        session.message = event.message;
        break;
      case 'task.completed':
        session.status = 'done';
        session.needsHuman = false;
        this.bumpDone(event.ts, session.sessionId);
        break;
      case 'teammate.idle':
        if (session.status === 'working') session.status = 'idle';
        break;
      case 'permission.ask':
        // Wacht op menselijke goedkeuring van een tool-call.
        session.status = 'needsHuman';
        session.needsHuman = true;
        session.message = event.message;
        break;
      case 'permission.deny':
        // Geweigerd (automatisch of door mens) — de sessie werkt door.
        session.needsHuman = false;
        if (session.status === 'needsHuman') session.status = 'working';
        break;
      case 'compact.start':
        session.compacting = true;
        break;
      case 'compact.end':
        session.compacting = false;
        break;
      case 'model.switch':
        break; // model is hierboven al gezet
      case 'worktree.start':
        session.worktrees = (session.worktrees ?? 0) + 1;
        break;
      case 'worktree.stop':
        session.worktrees = Math.max(0, (session.worktrees ?? 0) - 1);
        break;
      case 'tool.batch':
      case 'task.created':
        break; // alleen effect/ticker in de viewer
    }
  }

  private getOrCreate(event: AraEvent): SessionState {
    let session = this.sessions.get(event.sessionId);
    if (!session) {
      session = {
        sessionId: event.sessionId,
        project: event.project,
        cwd: event.cwd,
        startedAt: event.ts,
        lastSeenAt: event.ts,
        status: 'idle',
        needsHuman: false,
        toolCount: 0,
        errorCount: 0,
        agents: {},
      };
      this.sessions.set(event.sessionId, session);
    }
    if (event.project !== 'unknown') session.project = event.project;
    if (event.cwd) session.cwd = event.cwd;
    return session;
  }

  /**
   * One "done" per session per day, however many completion events arrive.
   * De dag komt uit het event-timestamp (niet de wandklok), zodat een
   * history-replay dezelfde tellingen geeft als de live stream destijds.
   */
  private bumpDone(ts: number, sessionId: string): void {
    const dayStart = startOfDay(ts);
    if (dayStart > this.doneDayStart) {
      this.doneDayStart = dayStart;
      this.doneToday = 0;
      this.doneCounted.clear();
    } else if (dayStart < this.doneDayStart) {
      return; // nagekomen event van gisteren: telt niet mee voor vandaag
    }
    if (!this.doneCounted.has(sessionId)) {
      this.doneCounted.add(sessionId);
      this.doneToday += 1;
    }
  }

  /** Seed from a /state snapshot (viewer reconnect path). */
  hydrate(snapshot: WorldSnapshot): void {
    this.sessions.clear();
    this.doneCounted.clear();
    for (const [id, session] of Object.entries(snapshot.sessions)) {
      this.sessions.set(id, structuredClone(session));
    }
    // doneSessions uit de snapshot is verliesvrij; oudere collectors zonder
    // dat veld vallen terug op de status-heuristiek.
    const counted = snapshot.counters.doneSessions;
    if (counted) {
      for (const id of counted) this.doneCounted.add(id);
    } else {
      for (const [id, session] of Object.entries(snapshot.sessions)) {
        if (session.status === 'done') this.doneCounted.add(id);
      }
    }
    this.doneToday = snapshot.counters.doneToday;
    this.doneDayStart = startOfDay(snapshot.now);
  }

  /** `now` overschrijfbaar zodat een history-scrub met de replay-tijd telt. */
  snapshot(now = Date.now()): WorldSnapshot {
    const sessions: Record<string, SessionState> = {};
    const projects = new Set<string>();
    let needsHuman = 0;
    let running = 0;
    for (const session of this.sessions.values()) {
      sessions[session.sessionId] = session;
      projects.add(session.project);
      const active = !session.endedAt && now - session.lastSeenAt < SESSION_TTL_MS;
      if (active && session.needsHuman) needsHuman += 1;
      if (active && session.status === 'working') running += 1;
    }
    // Na middernacht zonder nieuw completion-event toont de teller 0,
    // niet gisteren's stand.
    const sameDay = startOfDay(now) === this.doneDayStart;
    return {
      now,
      sessions,
      projects: [...projects].sort(),
      counters: {
        needsHuman,
        running,
        doneToday: sameDay ? this.doneToday : 0,
        doneSessions: sameDay ? [...this.doneCounted] : [],
      },
    };
  }
}
