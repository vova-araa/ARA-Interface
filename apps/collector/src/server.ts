import crypto from 'node:crypto';
import fs from 'node:fs';
import express, { type Response } from 'express';
import {
  AraEventSchema,
  IncomingEventSchema,
  buildOffice,
  capText,
  capValue,
  placementForProject,
  redactValue,
  resolvePlaybook,
  evaluateIntent,
  routeIntent,
  autoHaltReason,
  buildTradeReview,
  VENTURES,
  WorldState,
  type AraEvent,
  type RawPlaybook,
  type TradeIntent,
  type TradingMode,
  type StationOverride,
} from '@ara/shared';
import type { EventStore } from './db.ts';
import { loadOrBuildWorldConfig, projectForCwd, refreshProjects } from './projects.ts';
import { projectPulse } from './pulse.ts';
import * as trading from './trading.ts';
import { buildActions } from './actions.ts';
import { ARA_TOKEN, COLLECTOR_PORT, FIXTURE_PATH, ORG_JSON_PATH, PROJECTS_JSON_PATH, VIEWER_DIST, WORLD_CONFIG_PATH } from './config.ts';
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
  const API_PATHS = /^\/(event|hook|events|state|world|session|history|fixture|stats|status|tasks|usage|otel|latency|office|chat|org|trade|actions)(\/|$)/i;
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
    // Timing-safe vergelijking: een gewone === lekt via responstijd hoeveel
    // tekens van het token kloppen.
    const a = Buffer.from(presented);
    const b = Buffer.from(ARA_TOKEN);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) next();
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
      // Redigeren én afkappen: een Write van een heel bestand hoort niet in de
      // database of over de SSE-stroom.
      toolInput:
        incoming.toolInput === undefined ? undefined : capValue(redactValue(incoming.toolInput)),
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

  // Laatste binnengekomen event — maakt "de hooks zijn stilgevallen" meetbaar.
  let lastEventAt = 0;
  for (const event of store.all(1)) lastEventAt = Math.max(lastEventAt, event.ts);

  function ingest(raw: unknown): AraEvent {
    const event = normalize(raw);
    lastEventAt = Math.max(lastEventAt, event.ts);
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
  // Een atomaire herschrijving (schrijf-temp + rename) maakt de oude watcher
  // dood; daarom hangen we er opnieuw aan zodra dat gebeurt.
  let watchTimer: NodeJS.Timeout | null = null;
  function watchProjects(): void {
    try {
      if (!fs.existsSync(PROJECTS_JSON_PATH)) return;
      const watcher = fs.watch(PROJECTS_JSON_PATH, (eventType) => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(rebuildWorld, 500);
        if (eventType === 'rename') {
          watcher.close();
          setTimeout(watchProjects, 1000);
        }
      });
      watcher.on('error', () => {
        watcher.close();
        setTimeout(watchProjects, 5000);
      });
    } catch {
      /* watching is optional */
    }
  }
  watchProjects();

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

  // ── OTLP-receiver (http/json) → latency-physics ─────────────────────────
  // Claude Code exporteert OpenTelemetry-events; wij vangen alleen de logs op
  // en filteren claude_code.tool_result (echte duration_ms per tool-call).
  // Geen protobuf-dependencies: exporter op OTEL_EXPORTER_OTLP_PROTOCOL=http/json.
  interface LatencyStat {
    sessionId: string;
    ts: number;
    /** Exponentieel gladgestreken gemiddelde tool-duur (ms). */
    avgToolMs: number;
    lastToolMs: number;
    lastTool: string;
    samples: number;
  }
  const latencyStats = new Map<string, LatencyStat>();

  type OtlpValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean };
  type OtlpAttr = { key?: string; value?: OtlpValue };
  const attrValue = (v: OtlpValue | undefined): string | number | boolean | undefined => {
    if (!v) return undefined;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.intValue !== undefined) return Number(v.intValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    return v.boolValue;
  };
  const toAttrMap = (attrs: unknown): Map<string, string | number | boolean> => {
    const map = new Map<string, string | number | boolean>();
    if (Array.isArray(attrs)) {
      for (const a of attrs as OtlpAttr[]) {
        const value = attrValue(a?.value);
        if (a?.key && value !== undefined) map.set(a.key, value);
      }
    }
    return map;
  };

  app.post('/otel/v1/logs', (req, res) => {
    if (!/json/i.test(req.get('content-type') ?? '')) {
      // http/protobuf niet ondersteund — wel 200 zodat de exporter niet blijft retryen.
      res.json({ partialSuccess: { rejectedLogRecords: 0, errorMessage: 'use OTEL_EXPORTER_OTLP_PROTOCOL=http/json' } });
      return;
    }
    try {
      const body = (req.body ?? {}) as {
        resourceLogs?: { resource?: { attributes?: unknown }; scopeLogs?: { logRecords?: unknown[] }[] }[];
      };
      let updated = 0;
      for (const rl of body.resourceLogs ?? []) {
        const resourceAttrs = toAttrMap(rl.resource?.attributes);
        for (const sl of rl.scopeLogs ?? []) {
          for (const record of (sl.logRecords ?? []) as { attributes?: unknown; body?: OtlpValue }[]) {
            const attrs = toAttrMap(record.attributes);
            const eventName = String(attrs.get('event.name') ?? attrValue(record.body) ?? '');
            if (!eventName.includes('tool_result')) continue;
            const sessionId = String(attrs.get('session.id') ?? resourceAttrs.get('session.id') ?? '');
            const duration = Number(attrs.get('duration_ms') ?? NaN);
            if (!sessionId || !Number.isFinite(duration) || duration < 0) continue;
            const prev = latencyStats.get(sessionId);
            const avg = prev ? prev.avgToolMs * 0.7 + duration * 0.3 : duration;
            const stat: LatencyStat = {
              sessionId,
              ts: Date.now(),
              avgToolMs: Math.round(avg),
              lastToolMs: Math.round(duration),
              lastTool: String(attrs.get('tool_name') ?? ''),
              samples: (prev?.samples ?? 0) + 1,
            };
            latencyStats.set(sessionId, stat);
            broadcastFrame(`event: latency\ndata: ${JSON.stringify(stat)}\n\n`);
            updated += 1;
          }
        }
      }
      if (updated > 0 && latencyStats.size > 500) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const [id, st] of latencyStats) if (st.ts < cutoff) latencyStats.delete(id);
      }
      res.json({ partialSuccess: {} });
    } catch {
      res.status(400).json({ partialSuccess: { errorMessage: 'malformed OTLP JSON' } });
    }
  });

  // Metrics/traces accepteren we (200) maar gebruiken we nog niet — zo blijft
  // de exporter tevreden met alle drie de signalen op één endpoint.
  app.post('/otel/v1/metrics', (_req, res) => res.json({ partialSuccess: {} }));
  app.post('/otel/v1/traces', (_req, res) => res.json({ partialSuccess: {} }));

  app.get('/latency', (req, res) => {
    allowOrigin(req, res);
    res.json({ latency: [...latencyStats.values()] });
  });

  // ── Kantoren: per project een branche-specifiek kantoor ────────────────
  /** Branche-entiteiten (munten, wagens, routes) uit org.json, optioneel. */
  interface OrgFile {
    offices?: Record<string, string[]>;
    ventures?: { id: string; manager?: string; priority?: number; focus?: string; playbook?: RawPlaybook }[];
    chief?: unknown;
    ops?: unknown;
    policy?: unknown;
  }

  function readOrg(): OrgFile {
    try {
      return JSON.parse(fs.readFileSync(ORG_JSON_PATH, 'utf8')) as OrgFile;
    } catch {
      return {};
    }
  }

  function officeEntities(ventureId: string): string[] | undefined {
    const list = readOrg().offices?.[ventureId];
    return Array.isArray(list) && list.length > 0 ? list : undefined;
  }

  function playbookFor(ventureId: string, ventureLabel: string) {
    const raw = readOrg().ventures?.find((v) => v.id === ventureId)?.playbook;
    return resolvePlaybook(ventureId, ventureLabel, raw);
  }

  /**
   * De organisatie als data, niet als bestand. De viewer tekent hiermee de
   * echte hiërarchie per tak, en een agent kan zijn eigen playbook opvragen
   * zonder org.json te hoeven lezen en interpreteren.
   */
  app.get('/org', (req, res) => {
    allowOrigin(req, res);
    const org = readOrg();
    res.json({
      chief: org.chief ?? null,
      ops: org.ops ?? null,
      policy: org.policy ?? null,
      ventures: VENTURES.filter((v) => v.id !== 'misc').map((v) => {
        const entry = org.ventures?.find((o) => o.id === v.id);
        return {
          id: v.id,
          label: v.label,
          color: v.color,
          manager: entry?.manager ?? `manager:${v.id}`,
          priority: entry?.priority ?? 2,
          focus: entry?.focus ?? '',
          playbook: resolvePlaybook(v.id, v.label, entry?.playbook),
        };
      }),
    });
  });

  app.get('/office/:project', async (req, res) => {
    allowOrigin(req, res);
    const project = req.params.project;
    const world = loadOrBuildWorldConfig();
    const placement = placementForProject(world, project);
    const venture = VENTURES.find((v) => v.id === placement.venture) ?? VENTURES[VENTURES.length - 1]!;
    const snapshot = state.snapshot();
    const sessions = Object.values(snapshot.sessions).filter((s) => s.project === project);
    const tasks = store
      .listTasks({ project, limit: 40 })
      .map((t) => ({
        id: t.id,
        title: t.title,
        detail: t.detail,
        status: t.status,
        assignee: t.assignee,
        createdBy: t.createdBy,
        updatedAt: t.updatedAt,
      }));
    const overrides: StationOverride[] = [];
    for (const row of store.listStations(project)) {
      try {
        overrides.push({
          id: row.stationId,
          ...(JSON.parse(row.json) as Omit<StationOverride, 'id'>),
          updatedAt: row.updatedAt,
        });
      } catch {
        /* kapotte rij overslaan */
      }
    }
    // Meetlaag: de enige cijfers in een kantoor die nergens op geraden zijn.
    // Sessies leveren tool-calls en fouten van vandaag, het bord de taken,
    // de usage-tabel de tokens; git doet de rest in pulse.ts.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todaySessions = sessions.filter((s) => s.lastSeenAt >= dayStart.getTime());
    const tokensRow = store
      .usageSummary(dayStart.getTime())
      .find((row) => row.project === project);
    const pulse = await projectPulse(project, {
      toolCallsToday: todaySessions.reduce((sum, s) => sum + s.toolCount, 0),
      errorsToday: todaySessions.reduce((sum, s) => sum + s.errorCount, 0),
      tokensToday: tokensRow
        ? tokensRow.inputTokens + tokensRow.outputTokens + tokensRow.cacheCreateTokens
        : undefined,
      openTasks: tasks.filter((t) => t.status !== 'done' && t.status !== 'failed').length,
      doneTasksToday: tasks.filter((t) => t.status === 'done' && t.updatedAt >= dayStart.getTime())
        .length,
    });
    res.json(
      buildOffice({
        project,
        venture,
        sessions,
        tasks,
        entities: officeEntities(venture.id),
        overrides,
        pulse,
        playbook: playbookFor(venture.id, venture.label),
        now: Date.now(),
      }),
    );
  });

  /** Agents duwen hier echte werkplek-data in (vervangt de ingevulde cijfers). */
  app.post('/office/:project/station', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stationId = String(body.id ?? '');
    if (!stationId) {
      res.status(400).json({ ok: false, error: 'id required' });
      return;
    }
    const { id: _ignored, ...rest } = body;
    store.upsertStation({
      project: req.params.project,
      stationId,
      json: JSON.stringify(rest).slice(0, 8000),
      updatedAt: Date.now(),
    });
    broadcastFrame('event: office\ndata: {}\n\n');
    res.json({ ok: true });
  });

  /**
   * Alles wat op een mens wacht, op één plek. Dit is geen dashboard maar een
   * werklijst: elke regel draagt het verzoek dat 'm afhandelt, zodat je 'm
   * vanaf hier kunt doen in plaats van te onthouden dat het moet.
   */
  app.get('/actions', (req, res) => {
    allowOrigin(req, res);
    const org = readOrg();
    const report = trading.readLimits();
    const tradingState = trading.readState();
    res.json({
      actions: buildActions({
        store,
        snapshot: state.snapshot(),
        ventures: VENTURES.filter((v) => v.id !== 'misc').map((v) => ({
          id: v.id,
          label: v.label,
          playbook: resolvePlaybook(v.id, v.label, org.ventures?.find((o) => o.id === v.id)?.playbook),
        })),
        tradingProblems: report.problems,
        tradingHalted: tradingState.halted,
        haltReason: tradingState.haltReason,
        now: Date.now(),
      }),
    });
  });

  // ── Handel: agents stellen voor, deterministische code beslist ─────────
  // De volgorde is met opzet: eerst de risicotoets (pure functie in shared),
  // dan de routering (modus + noodstop). Een voorstel dat de toets niet haalt
  // bereikt nooit een uitvoeringspad, ook niet in live.
  const dayStartOf = (ts: number): number => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function portfolioNow(limits: ReturnType<typeof trading.readLimits>['limits']) {
    const open = store.openPaperPositions().map((p) => ({
      instrument: p.instrument,
      side: p.side,
      qty: p.qty,
      entry: p.entry,
      stop: p.stop,
      mark: p.mark,
      openedAt: p.openedAt,
    }));
    const realized = store.paperRealized(dayStartOf(Date.now()));
    return trading.portfolioFrom(open, realized.pnl, limits, realized.lastLossAt);
  }

  /** Volledige stand: limieten, modus, portefeuille en wat er mis is. */
  app.get('/trade/state', (req, res) => {
    allowOrigin(req, res);
    const report = trading.readLimits();
    const state = trading.readState();
    const portfolio = portfolioNow(report.limits);
    res.json({
      state,
      unlocked: trading.unlocked(),
      limits: report.limits,
      limitsSource: report.source,
      limitsFingerprint: report.fingerprint,
      problems: report.problems,
      portfolio,
      openIntents: store.listIntents({ status: 'awaiting', limit: 50 }).length,
    });
  });

  /** Een agent dient een voorstel in. Hij krijgt het besluit terug, niet de macht. */
  app.post('/trade/intent', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = Date.now();
    const intent: TradeIntent = {
      id: crypto.randomUUID(),
      createdAt: now,
      venture: capText(String(body.venture ?? ''), 40) ?? '',
      instrument: capText(String(body.instrument ?? ''), 40) ?? '',
      side: body.side === 'sell' ? 'sell' : 'buy',
      qty: Number(body.qty),
      entry: Number(body.entry),
      stop: Number(body.stop),
      target: body.target === undefined ? undefined : Number(body.target),
      reason: capText(String(body.reason ?? ''), 500) ?? '',
      sources: Array.isArray(body.sources)
        ? body.sources.map((x) => capText(String(x), 200) ?? '').filter(Boolean)
        : [],
      proposedBy: capText(String(body.proposedBy ?? ''), 80) ?? '',
    };
    if (!intent.instrument) {
      res.status(400).json({ ok: false, error: 'instrument required' });
      return;
    }

    const report = trading.readLimits();
    const state = trading.readState();
    const decision = evaluateIntent(intent, report.limits, portfolioNow(report.limits), now);
    const route = routeIntent(state, decision);

    // Alles wordt vastgelegd — juist de afwijzingen. Een agent die twintig keer
    // op dezelfde limiet stukloopt is een patroon dat je wilt zien.
    const status =
      route.action === 'reject'
        ? 'rejected'
        : route.action === 'paper'
          ? 'paper-filled'
          : route.action === 'await-approval'
            ? 'awaiting'
            : 'handoff';
    store.addIntent({
      ...intent,
      sources: JSON.stringify(intent.sources),
      decision: JSON.stringify(decision),
      route: route.action,
      status,
      mode: state.mode,
      resolvedBy: '',
      note: route.why,
    });

    if (route.action === 'paper') {
      store.addPaperPosition({
        id: intent.id,
        instrument: intent.instrument,
        side: intent.side,
        qty: intent.qty,
        entry: intent.entry,
        stop: intent.stop,
        openedAt: now,
      });
    }

    broadcastFrame('event: trade\ndata: {}\n\n');
    res.json({ ok: route.action !== 'reject', id: intent.id, route, decision, mode: state.mode });
  });

  app.get('/trade/intents', (req, res) => {
    allowOrigin(req, res);
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = store.listIntents({ status, limit: Math.min(Number(req.query.limit ?? 50), 200) });
    res.json({
      intents: rows.map((r) => ({
        ...r,
        sources: JSON.parse(r.sources) as string[],
        decision: JSON.parse(r.decision) as unknown,
      })),
    });
  });

  /**
   * Menselijk akkoord op een wachtend voorstel. De risicotoets wordt hier
   * opnieuw gedraaid: tussen voorstel en akkoord kan de portefeuille veranderd
   * zijn, en dan is het oude "ja" niet meer geldig.
   */
  app.post('/trade/intents/:id/approve', (req, res) => {
    const row = store.getIntent(req.params.id);
    if (!row || row.status !== 'awaiting') {
      res.status(404).json({ ok: false, error: 'geen wachtend voorstel met dat id' });
      return;
    }
    const by = capText(String((req.body ?? {}).by ?? 'mens'), 80) ?? 'mens';
    const now = Date.now();
    const report = trading.readLimits();
    const state = trading.readState();
    const fresh = evaluateIntent(
      {
        id: row.id,
        createdAt: row.createdAt,
        venture: row.venture,
        instrument: row.instrument,
        side: row.side,
        qty: row.qty,
        entry: row.entry,
        stop: row.stop,
        target: row.target,
        reason: row.reason,
        sources: JSON.parse(row.sources) as string[],
        proposedBy: row.proposedBy,
      },
      report.limits,
      portfolioNow(report.limits),
      now,
    );
    if (!fresh.ok || state.halted) {
      store.updateIntent(row.id, {
        status: 'rejected',
        resolvedAt: now,
        resolvedBy: by,
        note: state.halted ? 'noodstop actief bij akkoord' : `hertoets faalde: ${fresh.blockedBy.join(', ')}`,
      });
      broadcastFrame('event: trade\ndata: {}\n\n');
      res.status(409).json({ ok: false, error: 'hertoets faalde', decision: fresh, halted: state.halted });
      return;
    }
    store.updateIntent(row.id, { status: 'handoff', resolvedAt: now, resolvedBy: by, note: 'akkoord gegeven' });
    broadcastFrame('event: trade\ndata: {}\n\n');
    res.json({ ok: true, decision: fresh });
  });

  app.post('/trade/intents/:id/reject', (req, res) => {
    const by = capText(String((req.body ?? {}).by ?? 'mens'), 80) ?? 'mens';
    const note = capText(String((req.body ?? {}).note ?? 'afgewezen door mens'), 200) ?? '';
    const updated = store.updateIntent(req.params.id, {
      status: 'rejected',
      resolvedAt: Date.now(),
      resolvedBy: by,
      note,
    });
    if (!updated) {
      res.status(404).json({ ok: false, error: 'onbekend voorstel' });
      return;
    }
    broadcastFrame('event: trade\ndata: {}\n\n');
    res.json({ ok: true });
  });

  /** Noodstop. Eén verzoek, geen bevestiging, geen voorwaarden. */
  app.post('/trade/halt', (req, res) => {
    const reason = capText(String((req.body ?? {}).reason ?? 'handmatige noodstop'), 200) ?? '';
    const state = trading.halt(reason, Date.now());
    broadcastFrame('event: trade\ndata: {}\n\n');
    res.json({ ok: true, state });
  });

  /** Hervatten zet de modus terug op paper — je begint niet live weer. */
  app.post('/trade/resume', (req, res) => {
    const by = capText(String((req.body ?? {}).by ?? 'mens'), 80) ?? 'mens';
    const state = trading.resume(by, Date.now());
    broadcastFrame('event: trade\ndata: {}\n\n');
    res.json({ ok: true, state });
  });

  app.post('/trade/mode', (req, res) => {
    const mode = String((req.body ?? {}).mode ?? '') as TradingMode;
    const by = capText(String((req.body ?? {}).by ?? 'mens'), 80) ?? 'mens';
    const result = trading.setMode(mode, by, Date.now());
    broadcastFrame('event: trade\ndata: {}\n\n');
    res.status(result.ok ? 200 : 403).json(result);
  });

  /**
   * Het handelsspoor als rapport. Bewust een endpoint en geen agent-taak: de
   * cijfers komen uit deterministische code, niet uit een samenvatting. Een
   * rapport dat door een model geteld is, kun je niet naast dat van vorige week
   * leggen.
   */
  app.get('/trade/review', (req, res) => {
    allowOrigin(req, res);
    const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 365);
    const intents = store.listIntents({ limit: 2000 }).map((row) => {
      let blockedBy: string[] = [];
      let riskPct = 0;
      let rewardRisk: number | undefined;
      try {
        const decision = JSON.parse(row.decision) as {
          blockedBy?: string[];
          riskPct?: number;
          rewardRisk?: number;
        };
        blockedBy = decision.blockedBy ?? [];
        riskPct = decision.riskPct ?? 0;
        rewardRisk = decision.rewardRisk;
      } catch {
        /* kapotte beoordeling telt als geen blokkade-informatie */
      }
      return {
        id: row.id,
        createdAt: row.createdAt,
        venture: row.venture,
        instrument: row.instrument,
        side: row.side,
        proposedBy: row.proposedBy,
        status: row.status,
        route: row.route,
        mode: row.mode,
        blockedBy,
        riskPct,
        rewardRisk,
      };
    });
    const positions = store
      .closedPaperPositions(Date.now() - days * 24 * 60 * 60 * 1000)
      .map((p) => ({
        instrument: p.instrument,
        side: p.side,
        qty: p.qty,
        entry: p.entry,
        stop: p.stop,
        openedAt: p.openedAt,
        closedAt: p.closedAt ?? 0,
        exitPrice: p.exitPrice ?? 0,
        pnl: p.pnl ?? 0,
      }));
    res.json(buildTradeReview(intents, positions, days, Date.now()));
  });

  /** Een papieren positie sluiten en het resultaat boeken. */
  app.post('/trade/positions/:id/close', (req, res) => {
    const price = Number((req.body ?? {}).price);
    if (!Number.isFinite(price) || price <= 0) {
      res.status(400).json({ ok: false, error: 'price required' });
      return;
    }
    const closed = store.closePaperPosition(req.params.id, price, Date.now());
    if (!closed) {
      res.status(404).json({ ok: false, error: 'geen open positie met dat id' });
      return;
    }
    // Na elke afgeronde trade toetsen of de dag zichzelf hoort stil te leggen.
    // Anders merkt het systeem een geraakte limiet pas als er toevallig weer
    // iemand wil handelen.
    const report = trading.readLimits();
    const reason = autoHaltReason(report.limits, portfolioNow(report.limits));
    if (reason) trading.halt(reason, Date.now());
    broadcastFrame('event: trade\ndata: {}\n\n');
    res.json({ ok: true, position: closed, autoHalted: reason });
  });

  // ── Chat: gebruiker praat direct met agents, managers en de chief ───────
  app.get('/chat', (req, res) => {
    allowOrigin(req, res);
    const room = String(req.query.room ?? '');
    if (!room) {
      res.status(400).json({ ok: false, error: 'room required' });
      return;
    }
    res.json({ messages: store.listMessages(room, 100) });
  });

  /**
   * Wat een headless agent nodig heeft om deze vraag écht te beantwoorden:
   * twee commando's die hij letterlijk kan plakken. Een beschrijving als
   * "antwoord met POST /chat" was te weinig — zonder host, zonder token en
   * zonder taak-id kwam er niets terug in het kantoor.
   */
  const chatTaskDetail = (room: string, text: string, taskId: string): string => {
    const base = `http://127.0.0.1:${COLLECTOR_PORT}`;
    const auth = ARA_TOKEN ? ` \\\n    -H 'X-ARA-Token: ${ARA_TOKEN}'` : '';
    return [
      `Kantoorchat uit "${room}". De gebruiker wacht op antwoord in dat kantoor.`,
      '',
      'Vraag:',
      text,
      '',
      '1) Zet je antwoord in dezelfde ruimte:',
      `  curl -sS -X POST ${base}/chat \\`,
      `    -H 'Content-Type: application/json'${auth} \\`,
      `    -d '{"room":"${room}","role":"agent","sender":"<jouw rol>","text":"<je antwoord>"}'`,
      '',
      '2) Sluit daarna deze taak:',
      `  curl -sS -X PATCH ${base}/tasks/${taskId} \\`,
      `    -H 'Content-Type: application/json'${auth} \\`,
      `    -d '{"status":"done","result":"beantwoord in ${room}"}'`,
    ].join('\n');
  };

  app.post('/chat', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const room = String(body.room ?? '');
    const text = capText(String(body.text ?? ''), 2000);
    if (!room || !text) {
      res.status(400).json({ ok: false, error: 'room and text required' });
      return;
    }
    const roleRaw = String(body.role ?? 'user');
    const role = (['user', 'agent', 'manager', 'supervisor'].includes(roleRaw) ? roleRaw : 'user') as
      | 'user'
      | 'agent'
      | 'manager'
      | 'supervisor';
    const message = {
      id: crypto.randomUUID(),
      room,
      sender: capText(String(body.sender ?? (role === 'user' ? 'jij' : role)), 60) ?? role,
      role,
      text,
      ts: Date.now(),
    };
    store.addMessage(message);
    broadcastFrame(`event: chat\ndata: ${JSON.stringify(message)}\n\n`);

    // Een vraag van de gebruiker wordt echt werk: hij landt op het bord bij de
    // aangesproken rol, zodat de watchdog die agent wakker maakt.
    if (role === 'user') {
      const to = capText(String(body.to ?? 'supervisor'), 80) ?? 'supervisor';
      const taskId = crypto.randomUUID();
      const task = {
        id: taskId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: capText(`CHAT: ${text}`, 200) ?? 'CHAT',
        detail: chatTaskDetail(room, text, taskId),
        project: capText(String(body.project ?? ''), 120) ?? '',
        assignee: to,
        createdBy: 'user',
        parentId: null,
        status: 'open' as const,
        result: '',
      };
      store.createTask(task);
      notifyTasks();
      res.json({ ok: true, message, taskId: task.id });
      return;
    }
    res.json({ ok: true, message });
  });

  app.get('/health', (_req, res) =>
    res.json({
      ok: true,
      uptime: process.uptime(),
      // Seconden sinds het laatste hook-event. Loopt dit op terwijl er gewerkt
      // wordt, dan zijn de hooks stuk — anders merkt niemand dat ooit.
      lastEventAgeSec: lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null,
      sessions: Object.keys(state.snapshot().sessions).length,
    }),
  );

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
