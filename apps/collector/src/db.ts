import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AraEvent } from '@ara/shared';
import { DB_PATH, RETENTION_MS } from './config.ts';

export interface EventStore extends TaskStore {
  insert(event: AraEvent): void;
  /** Events in [from, to], ascending by ts. */
  range(from: number, to: number, limit?: number): AraEvent[];
  /** Last N events for one session, ascending. */
  forSession(sessionId: string, limit?: number): AraEvent[];
  /** All events, ascending — used to rebuild state on boot. */
  all(limit?: number): AraEvent[];
  /** Hourly activity per project since `from` (for sparklines). */
  stats(from: number): ProjectStats[];
  prune(): void;
  close(): void;
}

export interface ProjectStats {
  project: string;
  hour: number; // epoch hours (ts / 3_600_000, floored)
  events: number;
  errors: number;
}

/** Task board: how supervisor, managers and agents hand work to each other. */
export interface BoardTask {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  detail: string;
  project: string;
  assignee: string; // role or session name, e.g. "manager:traject", "supervisor"
  createdBy: string;
  parentId: string | null;
  status: 'open' | 'claimed' | 'done' | 'failed';
  result: string;
}

export interface TaskStore {
  createTask(task: BoardTask): void;
  updateTask(
    id: string,
    patch: Partial<Pick<BoardTask, 'status' | 'result' | 'assignee' | 'detail'>>,
  ): BoardTask | null;
  getTask(id: string): BoardTask | null;
  listTasks(filter: { status?: string; assignee?: string; project?: string; limit?: number }): BoardTask[];
}

export function openStore(dbPath = DB_PATH): EventStore {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      assignee TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      result TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee, status);
  `);

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO events (id, ts, kind, session_id, project, json) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const rangeStmt = db.prepare(
    'SELECT json FROM events WHERE ts BETWEEN ? AND ? ORDER BY ts ASC, rowid ASC LIMIT ?',
  );
  const sessionStmt = db.prepare(
    'SELECT json FROM (SELECT json, ts, rowid AS rid FROM events WHERE session_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?) ORDER BY ts ASC, rid ASC',
  );
  const allStmt = db.prepare(
    'SELECT json FROM (SELECT json, ts, rowid AS rid FROM events ORDER BY ts DESC, rowid DESC LIMIT ?) ORDER BY ts ASC, rid ASC',
  );
  const pruneStmt = db.prepare('DELETE FROM events WHERE ts < ?');
  const statsStmt = db.prepare(`
    SELECT project,
           CAST(ts / 3600000 AS INTEGER) AS hour,
           COUNT(*) AS events,
           SUM(CASE WHEN json LIKE '%"status":"error"%' THEN 1 ELSE 0 END) AS errors
    FROM events
    WHERE ts >= ?
    GROUP BY project, hour
    ORDER BY project, hour
  `);

  const parse = (rows: unknown[]): AraEvent[] =>
    (rows as { json: string }[]).map((r) => JSON.parse(r.json) as AraEvent);

  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (id, created_at, updated_at, title, detail, project, assignee, created_by, parent_id, status, result)
    VALUES (@id, @createdAt, @updatedAt, @title, @detail, @project, @assignee, @createdBy, @parentId, @status, @result)
  `);
  const getTaskStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');

  interface TaskRow {
    id: string;
    created_at: number;
    updated_at: number;
    title: string;
    detail: string;
    project: string;
    assignee: string;
    created_by: string;
    parent_id: string | null;
    status: BoardTask['status'];
    result: string;
  }

  const rowToTask = (row: TaskRow): BoardTask => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    detail: row.detail,
    project: row.project,
    assignee: row.assignee,
    createdBy: row.created_by,
    parentId: row.parent_id,
    status: row.status,
    result: row.result,
  });

  return {
    insert(event) {
      insertStmt.run(event.id, event.ts, event.kind, event.sessionId, event.project, JSON.stringify(event));
    },
    range(from, to, limit = 10_000) {
      return parse(rangeStmt.all(from, to, limit));
    },
    forSession(sessionId, limit = 50) {
      return parse(sessionStmt.all(sessionId, limit));
    },
    all(limit = 50_000) {
      return parse(allStmt.all(limit));
    },
    stats(from) {
      return statsStmt.all(from) as ProjectStats[];
    },
    createTask(task) {
      insertTaskStmt.run(task);
    },
    updateTask(id, patch) {
      const existing = getTaskStmt.get(id) as TaskRow | undefined;
      if (!existing) return null;
      const merged = { ...rowToTask(existing), ...patch, updatedAt: Date.now() };
      db.prepare(
        'UPDATE tasks SET updated_at=@updatedAt, status=@status, result=@result, assignee=@assignee, detail=@detail WHERE id=@id',
      ).run(merged);
      return merged;
    },
    getTask(id) {
      const row = getTaskStmt.get(id) as TaskRow | undefined;
      return row ? rowToTask(row) : null;
    },
    listTasks({ status, assignee, project, limit = 100 }) {
      const where: string[] = [];
      const params: Record<string, unknown> = { limit };
      if (status) {
        where.push('status = @status');
        params.status = status;
      }
      if (assignee) {
        where.push('assignee = @assignee');
        params.assignee = assignee;
      }
      if (project) {
        where.push('project = @project');
        params.project = project;
      }
      const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT @limit`;
      return (db.prepare(sql).all(params) as TaskRow[]).map(rowToTask);
    },
    prune() {
      pruneStmt.run(Date.now() - RETENTION_MS);
    },
    close() {
      db.close();
    },
  };
}
