import type { AraEvent, SessionState, WorldSnapshot } from '@ara/shared';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // hide sessions idle > 6h from "running"
const START_OF_DAY = () => {
  const d = new Date();
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
  private doneDayStart = START_OF_DAY();

  apply(event: AraEvent): void {
    const session = this.getOrCreate(event);
    session.lastSeenAt = event.ts;

    switch (event.kind) {
      case 'session.start':
        session.status = 'idle';
        session.endedAt = undefined;
        break;
      case 'session.end':
        session.endedAt = event.ts;
        if (session.status !== 'error') session.status = 'done';
        this.bumpDone(event.ts);
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
        } else if (session.status === 'error') {
          // A successful tool clears a transient error.
          session.status = 'working';
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
        this.bumpDone(event.ts);
        break;
      case 'teammate.idle':
        if (session.status === 'working') session.status = 'idle';
        break;
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

  private bumpDone(ts: number): void {
    const dayStart = START_OF_DAY();
    if (dayStart !== this.doneDayStart) {
      this.doneDayStart = dayStart;
      this.doneToday = 0;
    }
    if (ts >= dayStart) this.doneToday += 1;
  }

  snapshot(): WorldSnapshot {
    const now = Date.now();
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
    return {
      now,
      sessions,
      projects: [...projects].sort(),
      counters: { needsHuman, running, doneToday: this.doneToday },
    };
  }
}
