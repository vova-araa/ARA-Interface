import crypto from 'node:crypto';
import fs from 'node:fs';
import express, { type Response } from 'express';
import {
  AraEventSchema,
  IncomingEventSchema,
  capText,
  redactValue,
  type AraEvent,
} from '@ara/shared';
import type { EventStore } from './db.ts';
import { WorldState } from './state.ts';
import { loadOrBuildWorldConfig, projectForCwd, refreshProjects } from './projects.ts';
import { FIXTURE_PATH } from './config.ts';
import { mapHookPayload, type HookPayload } from './hookmap.ts';

export interface CollectorApp {
  app: express.Express;
  state: WorldState;
  ingest(raw: unknown): AraEvent;
}

export function createCollector(store: EventStore): CollectorApp {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

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

  function broadcast(event: AraEvent): void {
    const frame = `event: ara\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      res.write(frame);
    }
  }

  function ingest(raw: unknown): AraEvent {
    const event = normalize(raw);
    store.insert(event);
    state.apply(event);
    broadcast(event);
    return event;
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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });

  app.get('/state', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(state.snapshot());
  });

  app.get('/world', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(loadOrBuildWorldConfig());
  });

  app.post('/world/refresh', (_req, res) => {
    refreshProjects();
    try {
      fs.rmSync('world.config.json', { force: true });
    } catch {
      /* ignore */
    }
    res.json(loadOrBuildWorldConfig());
  });

  app.get('/session/:id', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ events: store.forSession(req.params.id, 50) });
  });

  app.get('/history', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const to = Number(req.query.to ?? Date.now());
    const from = Number(req.query.from ?? to - 24 * 60 * 60 * 1000);
    res.json({ events: store.range(from, to) });
  });

  app.get('/fixture', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const lines = fs.readFileSync(FIXTURE_PATH, 'utf8').trim().split('\n');
      res.json({ events: lines.map((line) => JSON.parse(line) as AraEvent) });
    } catch {
      res.json({ events: [] });
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  return { app, state, ingest };
}
