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

/** Token usage per session, upserted with absolute totals from the transcript. */
export interface SessionUsage {
  sessionId: string;
  project: string;
  updatedAt: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  model: string;
  /**
   * De rol die ARA zelf startte (`ara-manager`, `ara-qa-verifier`, …), leeg
   * als de eigenaar deze sessie zelf begon. Bepaalt of dit verbruik tegen het
   * dagbudget van de agents telt.
   */
  spawnedBy?: string;
}

export interface UsageSummaryRow {
  project: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /**
   * Alleen het verbruik van sessies die ARA zelf startte (invoer + uitvoer +
   * cache-creatie). Dit is het getal waar het dagbudget tegen afgezet hoort te
   * worden — de rest is handwerk van de eigenaar en hoort zijn agents niet
   * stil te zetten.
   */
  agentTokens: number;
  /** Het cache-creatie-deel daarvan, apart zodat de som te lezen blijft. */
  agentCacheCreateTokens: number;
}

/** Door agents aangeleverde werkplek-data voor een kantoor. */
export interface StationRow {
  project: string;
  stationId: string;
  json: string;
  updatedAt: number;
}

/** Chatbericht in een kantoor-ruimte (gebruiker ↔ agents). */
export interface ChatMessage {
  id: string;
  room: string;
  sender: string;
  role: 'user' | 'agent' | 'manager' | 'supervisor';
  text: string;
  ts: number;
}

export interface TaskStore {
  createTask(task: BoardTask): void;
  updateTask(
    id: string,
    patch: Partial<Pick<BoardTask, 'status' | 'result' | 'assignee' | 'detail'>>,
  ): BoardTask | null;
  getTask(id: string): BoardTask | null;
  listTasks(filter: { status?: string; assignee?: string; project?: string; limit?: number }): BoardTask[];
  upsertStation(row: StationRow): void;
  listStations(project: string): StationRow[];
  addMessage(message: ChatMessage): void;
  listMessages(room: string, limit?: number): ChatMessage[];
  upsertUsage(usage: SessionUsage): void;
  /** Per-project totals for sessions updated since `from`. */
  usageSummary(from: number): UsageSummaryRow[];
  addIntent(row: IntentRow): void;
  updateIntent(id: string, patch: Partial<Pick<IntentRow, 'status' | 'resolvedAt' | 'resolvedBy' | 'note'>>): IntentRow | null;
  getIntent(id: string): IntentRow | null;
  listIntents(filter: { status?: string; limit?: number }): IntentRow[];
  openPaperPositions(): PaperPositionRow[];
  /** Posities die sinds `from` gesloten zijn — de basis voor het rapport. */
  closedPaperPositions(from: number): PaperPositionRow[];
  addPaperPosition(row: PaperPositionRow): void;
  closePaperPosition(id: string, exitPrice: number, closedAt: number): PaperPositionRow | null;
  /** Gerealiseerd resultaat van papieren posities die op `day` gesloten zijn. */
  paperRealized(dayStart: number): { pnl: number; lastLossAt?: number };
}

/** Eén handelsvoorstel met zijn beoordeling — het audit-spoor. */
export interface IntentRow {
  id: string;
  createdAt: number;
  venture: string;
  instrument: string;
  side: 'buy' | 'sell';
  qty: number;
  entry: number;
  stop: number;
  target?: number;
  reason: string;
  /** JSON-array met bronnen. */
  sources: string;
  proposedBy: string;
  /** JSON van de RiskDecision. */
  decision: string;
  route: string;
  status: string;
  mode: string;
  resolvedAt?: number;
  resolvedBy: string;
  note: string;
}

export interface PaperPositionRow {
  id: string;
  instrument: string;
  side: 'buy' | 'sell';
  qty: number;
  entry: number;
  stop: number;
  mark?: number;
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  pnl?: number;
}

function toIntent(row: Record<string, unknown>): IntentRow {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    venture: String(row.venture),
    instrument: String(row.instrument),
    side: row.side === 'sell' ? 'sell' : 'buy',
    qty: Number(row.qty),
    entry: Number(row.entry),
    stop: Number(row.stop),
    target: row.target === null ? undefined : Number(row.target),
    reason: String(row.reason),
    sources: String(row.sources),
    proposedBy: String(row.proposed_by),
    decision: String(row.decision),
    route: String(row.route),
    status: String(row.status),
    mode: String(row.mode),
    resolvedAt: row.resolved_at === null ? undefined : Number(row.resolved_at),
    resolvedBy: String(row.resolved_by),
    note: String(row.note),
  };
}

function toPaper(row: Record<string, unknown>): PaperPositionRow {
  return {
    id: String(row.id),
    instrument: String(row.instrument),
    side: row.side === 'sell' ? 'sell' : 'buy',
    qty: Number(row.qty),
    entry: Number(row.entry),
    stop: Number(row.stop),
    mark: row.mark === null ? undefined : Number(row.mark),
    openedAt: Number(row.opened_at),
    closedAt: row.closed_at === null ? undefined : Number(row.closed_at),
    exitPrice: row.exit_price === null ? undefined : Number(row.exit_price),
    pnl: row.pnl === null ? undefined : Number(row.pnl),
  };
}

/** Lokale kalenderdag (collector-tijdzone) als sorteerbare YYYY-MM-DD. */
function localDay(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Usage-rijen zijn de basis voor de dag-delta's: gooi je ze na 7 dagen weg,
 * dan boekt een sessie die daarna weer iets post haar hele levensduur op één
 * dag. Ze mogen dus veel langer blijven staan dan de event-ringbuffer.
 */
const USAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Hooguit één keer per dag compacteren; VACUUM herschrijft het hele bestand. */
const VACUUM_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
    CREATE TABLE IF NOT EXISTS usage (
      session_id TEXT PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_create_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_usage_updated ON usage(updated_at);
    -- Dag-delta's: het dagbudget telt wat een sessie VANDAAG verbruikte, niet
    -- haar levenslange totaal (een dagenlang levende sessie post cumulatief).
    CREATE TABLE IF NOT EXISTS usage_days (
      day TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_create_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_days_day ON usage_days(day);
    CREATE TABLE IF NOT EXISTS office_stations (
      project TEXT NOT NULL,
      station_id TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project, station_id)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      sender TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      text TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_room ON chat_messages(room, ts);
    -- Handelsvoorstellen met hun volledige beoordeling. Dit is een audit-spoor:
    -- rijen worden nooit gewijzigd behalve om af te ronden, en nooit gewist door
    -- de gewone opruiming — een besluit over geld moet naspeurbaar blijven.
    CREATE TABLE IF NOT EXISTS trade_intents (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      venture TEXT NOT NULL DEFAULT '',
      instrument TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      entry REAL NOT NULL,
      stop REAL NOT NULL,
      target REAL,
      reason TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      proposed_by TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '{}',
      route TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'proposed',
      mode TEXT NOT NULL DEFAULT '',
      resolved_at INTEGER,
      resolved_by TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_intents_status ON trade_intents(status, created_at);
    -- Het papieren boek. Alleen posities die ARA zelf boekte; wat er bij een
    -- echte broker staat weet ARA niet en doet het niet alsof.
    CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      entry REAL NOT NULL,
      stop REAL NOT NULL,
      mark REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      exit_price REAL,
      pnl REAL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_open ON paper_positions(closed_at);
  `);

  /**
   * Wie deze sessie gestart heeft. Leeg = de eigenaar zelf achter zijn Mac.
   *
   * Zonder dit onderscheid telde het dagbudget álle Claude Code-sessies op de
   * machine, dus ook een dag handwerk van de eigenaar — en dan zetten zijn
   * eigen agents zichzelf stil terwijl ze niets hadden uitgegeven. Gemeten:
   * 15,9 miljoen tokens tegen een budget van 2 miljoen, waarvan 14,1 miljoen
   * cache-creatie uit één ontwikkelsessie.
   *
   * Als losse migratie, want deze kolommen komen bij bestaande databases erbij.
   */
  for (const table of ['usage', 'usage_days']) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN spawned_by TEXT NOT NULL DEFAULT ''`);
    } catch {
      /* kolom bestaat al — dat is de normale toestand na de eerste start */
    }
  }

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

  let lastVacuum = Date.now();

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
    upsertStation(row) {
      db.prepare(`
        INSERT INTO office_stations (project, station_id, json, updated_at)
        VALUES (@project, @stationId, @json, @updatedAt)
        ON CONFLICT(project, station_id) DO UPDATE SET
          json = excluded.json,
          updated_at = excluded.updated_at
      `).run(row);
    },
    listStations(project) {
      return db
        .prepare('SELECT project, station_id AS stationId, json, updated_at AS updatedAt FROM office_stations WHERE project = ?')
        .all(project) as StationRow[];
    },
    addMessage(message) {
      db.prepare(
        'INSERT OR REPLACE INTO chat_messages (id, room, sender, role, text, ts) VALUES (@id, @room, @sender, @role, @text, @ts)',
      ).run(message);
    },
    listMessages(room, limit = 100) {
      return (
        db
          .prepare('SELECT * FROM chat_messages WHERE room = ? ORDER BY ts DESC LIMIT ?')
          .all(room, limit) as ChatMessage[]
      ).reverse();
    },
    upsertUsage(usage) {
      // Delta t.o.v. de vorige absolute stand → bijschrijven op vandaag.
      // Collector-lokale tijdzone is de enige autoriteit voor "vandaag".
      const day = localDay(usage.updatedAt);
      const prev = db
        .prepare('SELECT input_tokens, output_tokens, cache_read_tokens, cache_create_tokens FROM usage WHERE session_id = ?')
        .get(usage.sessionId) as
        | { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_create_tokens: number }
        | undefined;
      const delta = {
        day,
        sessionId: usage.sessionId,
        project: usage.project,
        input: Math.max(0, usage.inputTokens - (prev?.input_tokens ?? 0)),
        output: Math.max(0, usage.outputTokens - (prev?.output_tokens ?? 0)),
        cacheRead: Math.max(0, usage.cacheReadTokens - (prev?.cache_read_tokens ?? 0)),
        cacheCreate: Math.max(0, usage.cacheCreateTokens - (prev?.cache_create_tokens ?? 0)),
        spawnedBy: usage.spawnedBy ?? '',
      };
      db.transaction(() => {
        db.prepare(`
          INSERT INTO usage (session_id, project, updated_at, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, model, spawned_by)
          VALUES (@sessionId, @project, @updatedAt, @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreateTokens, @model, @spawnedBy)
          ON CONFLICT(session_id) DO UPDATE SET
            project = excluded.project,
            updated_at = excluded.updated_at,
            input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            cache_read_tokens = excluded.cache_read_tokens,
            cache_create_tokens = excluded.cache_create_tokens,
            model = excluded.model,
            -- Eén keer gezet blijft gezet: een latere post zonder de env-variabele
            -- (bv. na een herstart van de hook) mag een agent-sessie niet stilletjes
            -- terugzetten naar "de eigenaar deed dit zelf".
            spawned_by = CASE WHEN excluded.spawned_by = '' THEN spawned_by ELSE excluded.spawned_by END
        `).run({ ...usage, spawnedBy: usage.spawnedBy ?? '' });
        db.prepare(`
          INSERT INTO usage_days (day, session_id, project, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, spawned_by)
          VALUES (@day, @sessionId, @project, @input, @output, @cacheRead, @cacheCreate, @spawnedBy)
          ON CONFLICT(day, session_id) DO UPDATE SET
            project = excluded.project,
            input_tokens = input_tokens + excluded.input_tokens,
            output_tokens = output_tokens + excluded.output_tokens,
            cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
            cache_create_tokens = cache_create_tokens + excluded.cache_create_tokens,
            spawned_by = CASE WHEN excluded.spawned_by = '' THEN spawned_by ELSE excluded.spawned_by END
        `).run(delta);
      })();
    },
    usageSummary(from) {
      return db
        .prepare(`
          SELECT project,
                 COUNT(DISTINCT session_id) AS sessions,
                 SUM(input_tokens) AS inputTokens,
                 SUM(output_tokens) AS outputTokens,
                 SUM(cache_read_tokens) AS cacheReadTokens,
                 SUM(cache_create_tokens) AS cacheCreateTokens,
                 -- Alleen wat ARA zelf startte telt tegen het dagbudget van de
                 -- agents; handwerk van de eigenaar staat in dezelfde tabel maar
                 -- hoort zijn eigen organisatie niet stil te zetten.
                 SUM(CASE WHEN spawned_by <> '' THEN input_tokens + output_tokens + cache_create_tokens ELSE 0 END) AS agentTokens,
                 SUM(CASE WHEN spawned_by <> '' THEN cache_create_tokens ELSE 0 END) AS agentCacheCreateTokens
          FROM usage_days
          WHERE day >= ?
          GROUP BY project
          ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
        `)
        .all(localDay(from)) as UsageSummaryRow[];
    },
    prune() {
      const cutoff = Date.now() - RETENTION_MS;
      pruneStmt.run(cutoff);
      // Afgeronde taken en oude usage-rijen mogen ook weg (anders groeit de
      // db onbegrensd, en die groei is via de API van buitenaf aan te sturen).
      db.prepare("DELETE FROM tasks WHERE status IN ('done','failed') AND updated_at < ?").run(cutoff);
      db.prepare('DELETE FROM usage WHERE updated_at < ?').run(Date.now() - USAGE_RETENTION_MS);
      db.prepare('DELETE FROM usage_days WHERE day < ?').run(localDay(Date.now() - USAGE_RETENTION_MS));
      db.prepare('DELETE FROM chat_messages WHERE ts < ?').run(cutoff);
      // Verwijderde rijen geven pas ruimte terug ná een checkpoint + VACUUM;
      // zonder dit groeit het bestand (en de WAL ernaast) alleen maar door.
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        if (Date.now() - lastVacuum > VACUUM_INTERVAL_MS) {
          db.exec('VACUUM');
          lastVacuum = Date.now();
        }
      } catch {
        /* compacteren is onderhoud, nooit reden om te falen */
      }
    },
    addIntent(row) {
      db.prepare(`
        INSERT INTO trade_intents
          (id, created_at, venture, instrument, side, qty, entry, stop, target, reason,
           sources, proposed_by, decision, route, status, mode, resolved_at, resolved_by, note)
        VALUES
          (@id, @createdAt, @venture, @instrument, @side, @qty, @entry, @stop, @target, @reason,
           @sources, @proposedBy, @decision, @route, @status, @mode, @resolvedAt, @resolvedBy, @note)
      `).run({ target: null, resolvedAt: null, ...row });
    },
    updateIntent(id, patch) {
      const current = this.getIntent(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      db.prepare(
        'UPDATE trade_intents SET status = ?, resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?',
      ).run(next.status, next.resolvedAt ?? null, next.resolvedBy, next.note, id);
      return next;
    },
    getIntent(id) {
      const row = db.prepare('SELECT * FROM trade_intents WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? toIntent(row) : null;
    },
    listIntents({ status, limit = 50 }) {
      const rows = status
        ? db
            .prepare('SELECT * FROM trade_intents WHERE status = ? ORDER BY created_at DESC LIMIT ?')
            .all(status, limit)
        : db.prepare('SELECT * FROM trade_intents ORDER BY created_at DESC LIMIT ?').all(limit);
      return (rows as Record<string, unknown>[]).map(toIntent);
    },
    openPaperPositions() {
      return (
        db.prepare('SELECT * FROM paper_positions WHERE closed_at IS NULL ORDER BY opened_at').all() as
          Record<string, unknown>[]
      ).map(toPaper);
    },
    closedPaperPositions(from) {
      return (
        db
          .prepare('SELECT * FROM paper_positions WHERE closed_at >= ? ORDER BY closed_at')
          .all(from) as Record<string, unknown>[]
      ).map(toPaper);
    },
    addPaperPosition(row) {
      db.prepare(`
        INSERT INTO paper_positions (id, instrument, side, qty, entry, stop, mark, opened_at)
        VALUES (@id, @instrument, @side, @qty, @entry, @stop, @mark, @openedAt)
      `).run({ mark: null, ...row });
    },
    closePaperPosition(id, exitPrice, closedAt) {
      const row = db.prepare('SELECT * FROM paper_positions WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row || row.closed_at !== null) return null;
      const position = toPaper(row);
      const direction = position.side === 'buy' ? 1 : -1;
      const pnl = (exitPrice - position.entry) * position.qty * direction;
      db.prepare('UPDATE paper_positions SET closed_at = ?, exit_price = ?, pnl = ? WHERE id = ?').run(
        closedAt,
        exitPrice,
        pnl,
        id,
      );
      return { ...position, closedAt, exitPrice, pnl };
    },
    paperRealized(dayStart) {
      const rows = db
        .prepare('SELECT pnl, closed_at FROM paper_positions WHERE closed_at >= ? ORDER BY closed_at')
        .all(dayStart) as { pnl: number | null; closed_at: number }[];
      let pnl = 0;
      let lastLossAt: number | undefined;
      for (const row of rows) {
        pnl += row.pnl ?? 0;
        if ((row.pnl ?? 0) < 0) lastLossAt = row.closed_at;
      }
      return { pnl, lastLossAt };
    },
    close() {
      db.close();
    },
  };
}
