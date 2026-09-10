import crypto from 'node:crypto';
import fs from 'node:fs';
import express, { type Response } from 'express';
import {
  AraEventSchema,
  IncomingEventSchema,
  capText,
  redactValue,
  WorldState,
  type AraEvent,
} from '@ara/shared';
import type { EventStore } from './db.ts';
import { loadOrBuildWorldConfig, projectForCwd, refreshProjects } from './projects.ts';
import { ARA_TOKEN, FIXTURE_PATH, ORG_JSON_PATH, PROJECTS_JSON_PATH, VIEWER_DIST, WORLD_CONFIG_PATH } from './config.ts';
import { mapHookPayload, type HookPayload } from './hookmap.ts';

export interface CollectorApp {
  app: express.Express;
  state: WorldState;
  ingest(raw: unknown): AraEvent;
}

export function createCollector(store: EventStore): CollectorApp {
  const app = express();
  // Express matcht routes standaard case-INsensitief; met een case-sensitive
  // allowlist-regex was /State een auth-bypass. Routing hard op case-sensitive.
  app.set('case sensitive routing', true);
  app.use(express.json({ limit: '256kb' }));

  // Optional shared-secret auth (set ARA_TOKEN when exposing beyond the tailnet).
  // /health stays open for probes; static viewer assets are served unauthenticated —
  // all data flows through the guarded API. EventSource can't set headers, so a
  // ?token= query param is accepted too. De regex is case-insensitief als
  // verdediging-in-diepte: rare casing krijgt auth + 404, nooit data.
  const API_PATHS = /^\/(event|hook|events|state|world|session|history|fixture|stats|status|tasks|usage)(\/|$)/i;
  app.use((req, res, next) => {
    if (!ARA_TOKEN || !API_PATHS.test(req.path)) {
      next();
      return;
    }
    const header = req.get('authorization') ?? '';
    const presented =
      (header.startsWith('Bearer ') ? header.slice(7) : header) ||
      req.get('x-ara-token') ||
      String(req.query.token ?? '');
    if (presented === ARA_TOKEN) next();
    else res.status(401).json({ ok: false, error: 'unauthorized' });
  });

  // CORS: met token is '*' veilig (auth beschermt); zonder token alleen de
  // lokale dev-viewer, zodat een willekeurige website in de browser van de
  // gebruiker niet http://localhost:4747 kan uitlezen.
  const allowOrigin = (req: express.Request, res: Response): void => {
    if (ARA_TOKEN) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return;
    }
    const origin = req.get('origin') ?? '';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  };

  const state = new WorldState();
  const clients = new Set<Response>();

  // Rebuild in-memory state from the ring buffer so restarts are seamless.
  for (const event of store.all()) state.apply(event);

  function normalize(raw: unknown): AraEvent {
    const incoming = IncomingEventSchema.parse(raw);
    const event: AraEvent = AraEventSchema.parse({
      ...incoming,
      id: incoming.id ?? crypto.randomUUID(),
      ts: incoming.ts ?? Date.now(),
      project:
        incoming.project && incoming.project !== 'unknown'
          ? incoming.project
          : projectForCwd(incoming.cwd ?? ''),
      toolInput: incoming.toolInput === undefined ? undefined : redactValue(incoming.toolInput),
      toolSummary: capText(incoming.toolSummary, 200),
      message: capText(incoming.message, 500),
    });
    return event;
  }

  // Backpressure: een SSE-client die niets meer leest (dichtgeklapte laptop,
  // half-open TCP) mag geen geheugen opstapelen — bij >512KB buffer: verbreken.
  const MAX_SSE_BUFFER = 512 * 1024;
  function sseWrite(res: Response, frame: string): void {
    if (res.writableLength > MAX_SSE_BUFFER || res.destroyed) {
      clients.delete(res);
      res.destroy();
      return;
    }
    res.write(frame);
  }

  function broadcastFrame(frame: string): void {
    for (const res of clients) sseWrite(res, frame);
  }

  function broadcast(event: AraEvent): void {
    broadcastFrame(`event: ara\ndata: ${JSON.stringify(event)}\n\n`);
  }

  function ingest(raw: unknown): AraEvent {
    const event = normalize(raw);
    store.insert(event);
    state.apply(event);
    broadcast(event);
    return event;
  }

  function rebuildWorld(): void {
    refreshProjects();
    try {
      fs.rmSync(WORLD_CONFIG_PATH, { force: true });
    } catch {
      /* ignore */
    }
    loadOrBuildWorldConfig();
    broadcastFrame('event: world\ndata: {}\n\n');
  }

  // Live-remap the world when the project list changes (edits via
  // dev-project-manager, /ara-map writes, etc.). Debounced; best-effort.
  try {
    if (fs.existsSync(PROJECTS_JSON_PATH)) {
      let timer: NodeJS.Timeout | null = null;
      fs.watch(PROJECTS_JSON_PATH, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(rebuildWorld, 500);
      });
    }
  } catch {
    /* watching is optional */
  }

  // Raw Claude Code hook payloads from plugins/ara/hooks/emit.sh.
  app.post('/hook/:name', (req, res) => {
    try {
      const incoming = mapHookPayload(req.params.name, req.body as HookPayload);
      if (!incoming) {
        res.json({ ok: true, ignored: true });
        return;
      }
      const event = ingest(incoming);
      res.json({ ok: true, id: event.id });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  app.post('/event', (req, res) => {
    try {
      const event = ingest(req.body);
      res.json({ ok: true, id: event.id });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  app.get('/events', (req, res) => {
    allowOrigin(req, res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const heartbeat = setInterval(() => sseWrite(res, ': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });

  app.get('/state', (req, res) => {
    allowOrigin(req, res);
    res.json(state.snapshot());
  });

  app.get('/world', (req, res) => {
    allowOrigin(req, res);
    res.json(loadOrBuildWorldConfig());
  });

  app.post('/world/refresh', (_req, res) => {
    rebuildWorld();
    res.json(loadOrBuildWorldConfig());
  });

  app.get('/session/:id', (req, res) => {
    allowOrigin(req, res);
    res.json({ events: store.forSession(req.params.id, 50) });
  });

  app.get('/history', (req, res) => {
    allowOrigin(req, res);
    const to = Number(req.query.to ?? Date.now());
    const from = Number(req.query.from ?? to - 24 * 60 * 60 * 1000);
    res.json({ events: store.range(from, to) });
  });

  app.get('/stats', (req, res) => {
    allowOrigin(req, res);
    const from = Number(req.query.from ?? Date.now() - 24 * 60 * 60 * 1000);
    res.json({ stats: store.stats(from) });
  });

  app.get('/fixture', (req, res) => {
    allowOrigin(req, res);
    try {
      const lines = fs.readFileSync(FIXTURE_PATH, 'utf8').trim().split('\n');
      res.json({ events: lines.map((line) => JSON.parse(line) as AraEvent) });
    } catch {
      res.json({ events: [] });
    }
  });

  // ── Task board: supervisor ↔ managers ↔ agents hand-offs ──────────────
  const notifyTasks = (): void => {
    broadcastFrame('event: tasks\ndata: {}\n\n');
  };

  app.post('/tasks', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = capText(String(body.title ?? ''), 200);
    if (!title) {
      res.status(400).json({ ok: false, error: 'title required' });
      return;
    }
    const task = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title,
      detail: capText(String(body.detail ?? ''), 2000) ?? '',
      project: String(body.project ?? ''),
      assignee: String(body.assignee ?? ''),
      createdBy: String(body.createdBy ?? ''),
      parentId: body.parentId ? String(body.parentId) : null,
      status: 'open' as const,
      result: '',
    };
    store.createTask(task);
    notifyTasks();
    res.json({ ok: true, task });
  });

  app.patch('/tasks/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<typeof store.updateTask>[1] = {};
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!['open', 'claimed', 'done', 'failed'].includes(status)) {
        res.status(400).json({ ok: false, error: 'bad status' });
        return;
      }
      patch.status = status as 'open' | 'claimed' | 'done' | 'failed';
    }
    if (body.result !== undefined) patch.result = capText(String(body.result), 4000) ?? '';
    if (body.assignee !== undefined) patch.assignee = String(body.assignee);
    if (body.detail !== undefined) patch.detail = capText(String(body.detail), 2000) ?? '';
    const task = store.updateTask(req.params.id, patch);
    if (!task) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    notifyTasks();
    res.json({ ok: true, task });
  });

  app.get('/tasks', (req, res) => {
    allowOrigin(req, res);
    res.json({
      tasks: store.listTasks({
        status: req.query.status ? String(req.query.status) : undefined,
        assignee: req.query.assignee ? String(req.query.assignee) : undefined,
        project: req.query.project ? String(req.query.project) : undefined,
        // NaN of onzinnige waarden → veilige default (NaN laat sqlite gooien).
        limit: Number.isFinite(Number(req.query.limit))
          ? Math.min(500, Math.max(1, Math.floor(Number(req.query.limit))))
          : undefined,
      }),
    });
  });

  app.get('/tasks/:id', (req, res) => {
    allowOrigin(req, res);
    const task = store.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.json({ ok: true, task });
  });

  // ── Token usage (absolute totals per session, parsed from transcripts) ──
  app.post('/usage', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId) {
      res.status(400).json({ ok: false, error: 'sessionId required' });
      return;
    }
    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
    store.upsertUsage({
      sessionId,
      project:
        body.project && String(body.project) !== 'unknown'
          ? String(body.project)
          : projectForCwd(String(body.cwd ?? '')),
      updatedAt: Date.now(),
      inputTokens: num(body.inputTokens),
      outputTokens: num(body.outputTokens),
      cacheReadTokens: num(body.cacheReadTokens),
      cacheCreateTokens: num(body.cacheCreateTokens),
      model: String(body.model ?? ''),
    });
    res.json({ ok: true });
  });

  app.get('/usage', (req, res) => {
    allowOrigin(req, res);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const from = Number(req.query.from ?? dayStart.getTime());
    let budget = 2_000_000;
    try {
      const org = JSON.parse(fs.readFileSync(ORG_JSON_PATH, 'utf8')) as {
        policy?: { tokenBudgetDaily?: number };
      };
      if (org.policy?.tokenBudgetDaily) budget = org.policy.tokenBudgetDaily;
    } catch {
      /* default budget */
    }
    res.json({ usage: store.usageSummary(from), budget });
  });

  // ── Live statusline-feed (token-buizen, kosten, cache) ──────────────────
  // In-memory: vluchtige telemetrie, hoeft geen restart te overleven.
  interface LiveStatus {
    sessionId: string;
    ts: number;
    model: string;
    contextPct: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    linesAdded: number;
    linesRemoved: number;
    cacheHitRatio: number | null;
    cacheWarm: boolean | null;
  }
  const liveStatus = new Map<string, LiveStatus>();

  app.post('/status', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId) {
      res.status(400).json({ ok: false, error: 'sessionId required' });
      return;
    }
    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const status: LiveStatus = {
      sessionId,
      ts: Date.now(),
      model: String(body.model ?? ''),
      contextPct: Math.min(100, Math.max(0, num(body.contextPct))),
      inputTokens: Math.max(0, num(body.inputTokens)),
      outputTokens: Math.max(0, num(body.outputTokens)),
      costUsd: Math.max(0, num(body.costUsd)),
      linesAdded: Math.max(0, num(body.linesAdded)),
      linesRemoved: Math.max(0, num(body.linesRemoved)),
      cacheHitRatio: body.cacheHitRatio === null || body.cacheHitRatio === undefined ? null : num(body.cacheHitRatio),
      cacheWarm: typeof body.cacheWarm === 'boolean' ? body.cacheWarm : null,
    };
    liveStatus.set(sessionId, status);
    // Verlopen sessies (>24u stil) opruimen, lazy bij elke post.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, st] of liveStatus) if (st.ts < cutoff) liveStatus.delete(id);
    broadcastFrame(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    res.json({ ok: true });
  });

  app.get('/status', (req, res) => {
    allowOrigin(req, res);
    res.json({ status: [...liveStatus.values()] });
  });

  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // Serve the built viewer when present → collector is a single deployable
  // service (Render, or just one port on the Mac).
  if (fs.existsSync(VIEWER_DIST)) {
    app.use(express.static(VIEWER_DIST));
    app.get('*', (req, res, next) => {
      if (API_PATHS.test(req.path)) {
        next();
        return;
      }
      res.sendFile('index.html', { root: VIEWER_DIST });
    });
  }

  return { app, state, ingest };
}
