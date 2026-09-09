import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AraEvent } from '@ara/shared';
import { DB_PATH, RETENTION_MS } from './config.ts';

export interface EventStore {
  insert(event: AraEvent): void;
  /** Events in [from, to], ascending by ts. */
  range(from: number, to: number, limit?: number): AraEvent[];
  /** Last N events for one session, ascending. */
  forSession(sessionId: string, limit?: number): AraEvent[];
  /** All events, ascending — used to rebuild state on boot. */
  all(limit?: number): AraEvent[];
  prune(): void;
  close(): void;
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

  const parse = (rows: unknown[]): AraEvent[] =>
    (rows as { json: string }[]).map((r) => JSON.parse(r.json) as AraEvent);

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
    prune() {
      pruneStmt.run(Date.now() - RETENTION_MS);
    },
    close() {
      db.close();
    },
  };
}
