import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Vóór de server-import: eigen world-config pad zodat /world/refresh nooit
// het echte world.config.json van de repo aanraakt.
process.env.ARA_WORLD_CONFIG = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'ara-worldcfg-')),
  'world.config.json',
);
const { openStore } = await import('./db.ts');
const { createCollector } = await import('./server.ts');

function boot() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-ep-')), 'test.db');
  const store = openStore(dbPath);
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, server, base };
}

const json = { 'content-type': 'application/json' };

test('/usage: validatie, clamping, upsert en dagfilter', async () => {
  const { store, server, base } = boot();
  try {
    // sessionId verplicht
    assert.equal(
      (await fetch(`${base}/usage`, { method: 'POST', headers: json, body: '{}' })).status,
      400,
    );
    // negatieve en niet-numerieke waarden → 0
    await fetch(`${base}/usage`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ sessionId: 'u1', cwd: '/tmp/proj-a', inputTokens: -50, outputTokens: 'nonsens' }),
    });
    let res = (await (await fetch(`${base}/usage?from=0`)).json()) as {
      usage: { project: string; inputTokens: number; outputTokens: number }[];
      budget: number;
    };
    assert.equal(res.usage[0]!.inputTokens, 0);
    assert.equal(res.usage[0]!.outputTokens, 0);
    assert.ok(res.budget > 0, 'budget meegegeven');

    // upsert: absolute totalen overschrijven, niet optellen
    await fetch(`${base}/usage`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ sessionId: 'u1', cwd: '/tmp/proj-a', inputTokens: 1000, outputTokens: 200 }),
    });
    await fetch(`${base}/usage`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ sessionId: 'u1', cwd: '/tmp/proj-a', inputTokens: 1500, outputTokens: 300 }),
    });
    res = (await (await fetch(`${base}/usage?from=0`)).json()) as typeof res;
    assert.equal(res.usage[0]!.inputTokens, 1500, 'upsert overschrijft');

    // twee sessies zelfde project → gesommeerd
    await fetch(`${base}/usage`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ sessionId: 'u2', cwd: '/tmp/proj-a', inputTokens: 500, outputTokens: 100 }),
    });
    res = (await (await fetch(`${base}/usage?from=0`)).json()) as typeof res;
    assert.equal(res.usage[0]!.inputTokens, 2000);

    // from in de toekomst → leeg
    res = (await (await fetch(`${base}/usage?from=${Date.now() + 60_000}`)).json()) as typeof res;
    assert.equal(res.usage.length, 0);
  } finally {
    server.close();
    store.close();
  }
});

test('/world en /world/refresh geven een geldige config met hiddenVentures', async () => {
  const { store, server, base } = boot();
  try {
    const world = (await (await fetch(`${base}/world`)).json()) as {
      districts: unknown[];
      hiddenVentures?: string[];
    };
    assert.ok(Array.isArray(world.districts));
    const refreshed = (await (
      await fetch(`${base}/world/refresh`, { method: 'POST' })
    ).json()) as typeof world;
    assert.ok(Array.isArray(refreshed.districts));
  } finally {
    server.close();
    store.close();
  }
});

test('/stats groepeert per project en uur; /history respecteert het bereik', async () => {
  const { store, server, base } = boot();
  try {
    const now = Date.now();
    for (const [offset, status] of [[0, 'ok'], [1000, 'error'], [2000, 'ok']] as const) {
      await fetch(`${base}/event`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ kind: 'tool.post', sessionId: 'st1', cwd: '/tmp/proj-b', tool: 'Bash', status, ts: now - offset }),
      });
    }
    const stats = (await (await fetch(`${base}/stats?from=0`)).json()) as {
      stats: { project: string; events: number; errors: number }[];
    };
    const row = stats.stats.find((r) => r.project === 'proj-b');
    assert.ok(row && row.events >= 3 && row.errors === 1);

    const history = (await (
      await fetch(`${base}/history?from=${now - 1500}&to=${now}`)
    ).json()) as { events: unknown[] };
    assert.equal(history.events.length, 2, 'alleen events binnen het bereik');
  } finally {
    server.close();
    store.close();
  }
});
