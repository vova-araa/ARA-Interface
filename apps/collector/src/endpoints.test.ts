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

    // from op een toekomstige dag → leeg (budget telt per kalenderdag,
    // dus de granulariteit van het filter is een dag, geen milliseconde)
    res = (await (await fetch(`${base}/usage?from=${Date.now() + 25 * 60 * 60 * 1000}`)).json()) as typeof res;
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

test('/otel/v1/logs: tool_result → latency-statistiek per sessie', async () => {
  const { store, server, base } = boot();
  try {
    const record = (durationMs: number, tool: string) => ({
      attributes: [
        { key: 'event.name', value: { stringValue: 'claude_code.tool_result' } },
        { key: 'tool_name', value: { stringValue: tool } },
        { key: 'duration_ms', value: { intValue: String(durationMs) } },
      ],
    });
    const payload = {
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'session.id', value: { stringValue: 'lat-1' } }] },
          scopeLogs: [{ logRecords: [record(1000, 'Bash'), record(200, 'Read')] }],
        },
      ],
    };
    const post = await fetch(`${base}/otel/v1/logs`, { method: 'POST', headers: json, body: JSON.stringify(payload) });
    assert.equal(post.status, 200);

    const res = (await (await fetch(`${base}/latency`)).json()) as {
      latency: { sessionId: string; avgToolMs: number; lastToolMs: number; lastTool: string; samples: number }[];
    };
    assert.equal(res.latency.length, 1);
    const stat = res.latency[0]!;
    assert.equal(stat.sessionId, 'lat-1');
    assert.equal(stat.samples, 2);
    assert.equal(stat.lastTool, 'Read');
    assert.equal(stat.lastToolMs, 200);
    // EMA: 1000 * 0.7 + 200 * 0.3 = 760
    assert.equal(stat.avgToolMs, 760);

    // Andere events dan tool_result worden genegeerd; kapotte JSON → 400.
    const other = await fetch(`${base}/otel/v1/metrics`, { method: 'POST', headers: json, body: '{}' });
    assert.equal(other.status, 200);
  } finally {
    server.close();
    store.close();
  }
});

test('/office: branche-kantoor, werkplek-data van agents en chat naar het bord', async () => {
  const { store, server, base } = boot();
  try {
    // Kantoor van een onbekend project valt terug op het generieke kantoor.
    const office = (await (await fetch(`${base}/office/truck-trailers`)).json()) as {
      kind: string;
      stations: { id: string; status: string; value: number }[];
      staff: { role: string }[];
      simulated: boolean;
    };
    assert.ok(office.stations.length > 0, 'kantoor heeft werkplekken');
    assert.ok(office.staff.some((s) => s.role === 'supervisor'));
    assert.equal(office.simulated, true, 'zonder agent-data zijn het voorbeeldcijfers');

    // Een agent duwt echte werkplek-data in; die wint.
    const push = await fetch(`${base}/office/truck-trailers/station`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ id: office.stations[0]!.id, status: 'alert', value: 42 }),
    });
    assert.equal(push.status, 200);
    const updated = (await (await fetch(`${base}/office/truck-trailers`)).json()) as typeof office;
    assert.equal(updated.simulated, false);
    const station = updated.stations.find((s) => s.id === office.stations[0]!.id)!;
    assert.equal(station.status, 'alert');
    assert.equal(station.value, 42);

    // Zonder id is een push ongeldig.
    assert.equal(
      (await fetch(`${base}/office/truck-trailers/station`, { method: 'POST', headers: json, body: '{}' })).status,
      400,
    );

    // Chat: het bericht wordt bewaard én landt als taak bij de aangesproken rol.
    const room = 'office:truck-trailers';
    const sent = (await (
      await fetch(`${base}/chat`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ room, text: 'Staat truck 42 nog in de garage?', to: 'manager:blex', project: 'truck-trailers' }),
      })
    ).json()) as { ok: boolean; message: { id: string; role: string }; taskId: string };
    assert.equal(sent.ok, true);
    assert.equal(sent.message.role, 'user');
    assert.ok(sent.taskId, 'chatvraag wordt echt werk op het bord');
    assert.equal(store.getTask(sent.taskId)!.assignee, 'manager:blex');
    // Het detail moet een agent kúnnen uitvoeren: host, taak-id en twee curls.
    const detail = store.getTask(sent.taskId)!.detail;
    assert.ok(detail.includes('curl'), 'chattaak bevat een uitvoerbaar antwoord-commando');
    assert.ok(detail.includes(room), 'het antwoord-commando wijst naar dezelfde ruimte');
    assert.ok(detail.includes(sent.taskId), 'de agent kan de taak zelf afsluiten');

    const history = (await (await fetch(`${base}/chat?room=${encodeURIComponent(room)}`)).json()) as {
      messages: { text: string }[];
    };
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0]!.text, 'Staat truck 42 nog in de garage?');

    // Een antwoord van een agent maakt géén nieuwe taak aan (anders lus).
    const reply = (await (
      await fetch(`${base}/chat`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ room, role: 'manager', sender: 'Manager Truck & Trailers', text: 'Ja, remmen worden vervangen.' }),
      })
    ).json()) as { taskId?: string };
    assert.equal(reply.taskId, undefined);

    // room is verplicht
    assert.equal((await fetch(`${base}/chat`, { method: 'POST', headers: json, body: '{}' })).status, 400);
  } finally {
    server.close();
    store.close();
  }
});

test('/office: de meetlaag bevat alleen gemeten cijfers', async () => {
  const { store, server, base } = boot();
  try {
    // Een echte sessie + een afgeronde taak: dat zijn dingen die de collector
    // zelf kan tellen, dus die horen als gemeten door te komen.
    await fetch(`${base}/event`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        kind: 'tool.pre',
        sessionId: 'meet-1',
        project: 'truck-trailers',
        tool: 'Bash',
      }),
    });
    const { task } = (await (
      await fetch(`${base}/tasks`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: 'gemeten taak', project: 'truck-trailers' }),
      })
    ).json()) as { task: { id: string } };
    await fetch(`${base}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ status: 'done', result: 'af' }),
    });

    const office = (await (await fetch(`${base}/office/truck-trailers`)).json()) as {
      measured: { label: string; value: string; estimated: boolean }[];
      pulse?: { toolCallsToday?: number; measuredAt: number };
      simulated: boolean;
    };
    const find = (label: string) => office.measured.find((m) => m.label === label);

    assert.equal(find('Tool-calls vandaag')?.value, '1');
    assert.equal(find('Taken afgerond vandaag')?.value, '1');
    assert.equal(find('Taken open')?.value, '0');
    assert.ok(
      office.measured.every((m) => m.estimated === false),
      'de meetlaag bevat per definitie geen schattingen',
    );
    // Zonder pad in projects.json valt er niets uit git te lezen — dan hoort
    // die regel te ontbreken, niet op "onbekend" te staan.
    assert.equal(find('Branch'), undefined);
    // En meten verandert niets aan het oordeel over de werkplekken zelf.
    assert.equal(office.simulated, true);
  } finally {
    server.close();
    store.close();
  }
});
