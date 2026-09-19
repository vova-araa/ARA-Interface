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
// Idem voor de projectlijst. Zonder dit leest de collector de echte
// projects.json van de machine waarop de test draait, en hangt de uitkomst van
// /org en /office af van wat daar toevallig in staat — op de Mac van de een
// groen, bij de ander rood. Een leeg bestand laat de demo-projecten staan, en
// díé zijn wel vast.
process.env.ARA_PROJECTS_JSON = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'ara-projects-')),
  'projects.json',
);

// En het wagenpark: een eigen map, zodat de test nooit de echte lijsten van de
// eigenaar leest of daar iets naast zet.
process.env.ARA_SOURCES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-sources-'));

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

test('/org: de organisatie is data, compleet per tak', async () => {
  const { store, server, base } = boot();
  try {
    const org = (await (await fetch(`${base}/org`)).json()) as {
      ventures: {
        id: string;
        label: string;
        manager: string;
        playbook: {
          managerName: string;
          specialists: { agent: string; name: string; does: string }[];
          duties: string[];
          escalate: string[];
          dataSources: { label: string; configured: boolean }[];
        };
      }[];
    };

    const byId = new Map(org.ventures.map((v) => [v.id, v]));
    // De namen uit org.json winnen van het branche-standaard.
    assert.equal(byId.get('traject')!.playbook.managerName, 'Manager Ritplanning');
    assert.equal(byId.get('blex')!.playbook.managerName, 'Manager Wagenpark');

    // Elke tak is compleet: nooit een lege rollenlijst of lege grenzen.
    for (const v of org.ventures) {
      assert.ok(v.playbook.specialists.length > 0, `${v.id} zonder rollen`);
      assert.ok(v.playbook.duties.length > 0, `${v.id} zonder werk`);
      assert.ok(v.playbook.escalate.length > 0, `${v.id} zonder grenzen`);
      assert.equal(v.manager, `manager:${v.id}`);
    }

    // De handel houdt zijn read-only grens, ook via de API.
    const trading = byId.get('trading')!.playbook;
    assert.ok(trading.escalate.some((e) => /orderlogica/i.test(e)));
    assert.ok(trading.specialists.some((s) => s.agent === 'ara-market-analyst'));

    // Het kantoor gebruikt hetzelfde playbook als /org zegt.
    const office = (await (await fetch(`${base}/office/truck-trailers`)).json()) as {
      staff: { agent?: string; live?: boolean; name: string; role: string }[];
      playbook?: { managerName: string };
    };
    assert.equal(office.playbook?.managerName, 'Manager Wagenpark');
    assert.ok(
      office.staff.some((s) => s.agent === 'ara-fleet-tech' && s.live === false),
      'de vaste rol staat in het kantoor en is zichtbaar onbezet',
    );
  } finally {
    server.close();
    store.close();
  }
});

test('/trade: voorstel, toets, noodstop en het slot op de modus', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-trade-'));
  fs.writeFileSync(
    path.join(dir, 'limits.json'),
    JSON.stringify({
      accountValue: 100_000,
      maxRiskPerTradePct: 1,
      maxTotalExposurePct: 20,
      maxPositionsTotal: 3,
      maxPositionsPerInstrument: 1,
      dailyLossLimitPct: 2,
      maxDrawdownPct: 10,
      allowedInstruments: ['XAUUSD'],
      minRewardRisk: 1.5,
      cooldownAfterLossMin: 0,
    }),
  );
  process.env.ARA_TRADING_LIMITS = path.join(dir, 'limits.json');
  process.env.ARA_DATA_DIR = dir;
  // Verse import: de handelsmodule leest paden bij het laden.
  const { createCollector: makeCollector } = await import(`./server.ts?trade=${Date.now()}`);
  const store = openStore(path.join(dir, 'test.db'));
  const { app } = makeCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const propose = (patch: Record<string, unknown> = {}) =>
    fetch(`${base}/trade/intent`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        venture: 'trading',
        instrument: 'XAUUSD',
        side: 'buy',
        qty: 10,
        entry: 2000,
        stop: 1980,
        target: 2060,
        reason: 'uitbraak boven de weekopening, bevestigd op het uur',
        sources: ['bot-status.json 12:00'],
        proposedBy: 'ara-market-analyst',
        ...patch,
      }),
    });

  try {
    // Standaardmodus is paper — nooit live, ook niet als niemand iets instelde.
    const state0 = (await (await fetch(`${base}/trade/state`)).json()) as {
      state: { mode: string; halted: boolean };
      unlocked: boolean;
    };
    assert.equal(state0.state.mode, 'paper');
    assert.equal(state0.state.halted, false);
    assert.equal(state0.unlocked, false, 'zonder ARA_TRADING_UNLOCK is het slot dicht');

    // Een goed voorstel wordt op papier geboekt.
    const ok = (await (await propose()).json()) as { ok: boolean; route: { action: string }; id: string };
    assert.equal(ok.ok, true);
    assert.equal(ok.route.action, 'paper');

    // Een voorstel zonder bron wordt geweigerd — en de reden staat erbij.
    const noSource = (await (await propose({ sources: [] })).json()) as {
      ok: boolean;
      route: { action: string };
      decision: { blockedBy: string[] };
    };
    assert.equal(noSource.ok, false);
    assert.equal(noSource.route.action, 'reject');
    assert.ok(noSource.decision.blockedBy.includes('bron opgegeven'));

    // Tweede positie in hetzelfde instrument: geblokkeerd door de portefeuille,
    // niet door de vorm van het voorstel. De toets kijkt dus echt naar de stand.
    const second = (await (await propose()).json()) as { ok: boolean; decision: { blockedBy: string[] } };
    assert.equal(second.ok, false);
    assert.ok(second.decision.blockedBy.includes('posities per instrument'));

    // Elke poging staat in het audit-spoor, ook de afgewezen.
    const all = (await (await fetch(`${base}/trade/intents`)).json()) as { intents: { status: string }[] };
    assert.equal(all.intents.length, 3);
    assert.equal(all.intents.filter((i) => i.status === 'rejected').length, 2);

    // Positie sluiten boekt het resultaat — en maakt het boek weer vlak, zodat
    // de volgende controles de modus toetsen en niet de portefeuille.
    const closed = (await (
      await fetch(`${base}/trade/positions/${ok.id}/close`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ price: 2040 }),
      })
    ).json()) as { ok: boolean; position: { pnl: number }; autoHalted: string | null };
    assert.equal(closed.ok, true);
    assert.equal(closed.position.pnl, 400);
    assert.equal(closed.autoHalted, null, 'winst mag de dag niet stilleggen');

    // Het slot: de modus kan niet omhoog via de API.
    const raise = await fetch(`${base}/trade/mode`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ mode: 'live', by: 'agent' }),
    });
    assert.equal(raise.status, 403, 'live zetten mag nooit via een verzoek');
    assert.match(((await raise.json()) as { why: string }).why, /ARA_TRADING_UNLOCK/);

    // Omlaag mag altijd — veiliger worden is nooit geblokkeerd.
    const lower = await fetch(`${base}/trade/mode`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ mode: 'off', by: 'vova' }),
    });
    assert.equal(lower.status, 200);
    const offRes = (await (await propose({ instrument: 'XAUUSD', qty: 1 })).json()) as {
      route: { action: string; why: string };
    };
    assert.equal(offRes.route.action, 'reject');
    assert.match(offRes.route.why, /staat uit/);

    // Noodstop wint van alles, ook van een verder geldig voorstel.
    await fetch(`${base}/trade/mode`, { method: 'POST', headers: json, body: JSON.stringify({ mode: 'paper' }) });
    await fetch(`${base}/trade/halt`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ reason: 'test' }),
    });
    const halted = (await (await propose({ instrument: 'XAUUSD' })).json()) as { route: { action: string; why: string } };
    assert.equal(halted.route.action, 'reject');
    assert.match(halted.route.why, /noodstop/);

    // Hervatten zet terug op paper, niet op wat het daarvoor was.
    const resumed = (await (
      await fetch(`${base}/trade/resume`, { method: 'POST', headers: json, body: JSON.stringify({ by: 'vova' }) })
    ).json()) as { state: { halted: boolean; mode: string } };
    assert.equal(resumed.state.halted, false);
    assert.equal(resumed.state.mode, 'paper');

    // Een al gesloten positie sluit niet nog een keer.
    assert.equal(
      (
        await fetch(`${base}/trade/positions/${ok.id}/close`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ price: 2100 }),
        })
      ).status,
      404,
      'dubbel sluiten zou het resultaat twee keer boeken',
    );
  } finally {
    server.close();
    store.close();
    delete process.env.ARA_TRADING_LIMITS;
  }
});

test('/actions: alles wat op een mens wacht, met de knop erbij', async () => {
  const { store, server, base } = boot();
  try {
    // Een escalatie van het bord hoort in de lijst, met een knop om 'm te sluiten.
    const { task } = (await (
      await fetch(`${base}/tasks`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: 'migratie op productie gevraagd', assignee: 'supervisor' }),
      })
    ).json()) as { task: { id: string } };
    await fetch(`${base}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ result: 'ESCALATE: productie-uitvoering gevraagd' }),
    });

    // Een sessie die vastzit.
    await fetch(`${base}/event`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        kind: 'notification',
        sessionId: 'stuck-1',
        project: 'sharzi-tms',
        message: 'mag ik deze rit verzetten?',
      }),
    });

    const { actions } = (await (await fetch(`${base}/actions`)).json()) as {
      actions: {
        id: string;
        kind: string;
        urgency: string;
        title: string;
        detail: string;
        buttons: { label: string; method: string; path: string; confirm?: boolean }[];
      }[];
    };

    const kinds = new Set(actions.map((a) => a.kind));
    assert.ok(kinds.has('escalation'), 'een escalatie hoort in de actielijst');
    assert.ok(kinds.has('needs-human'), 'een vastzittende sessie hoort in de actielijst');
    assert.ok(kinds.has('data-source'), 'niet-aangesloten bronnen horen zichtbaar te zijn');

    // Blokkerende items staan bovenaan — anders verdwijnen ze onder de rest.
    const urgencies = actions.map((a) => a.urgency);
    assert.deepEqual(
      [...urgencies].sort((a, b) => ({ blocking: 0, soon: 1, whenever: 2 })[a as 'soon'] - ({ blocking: 0, soon: 1, whenever: 2 })[b as 'soon']),
      urgencies,
      'de lijst hoort op urgentie gesorteerd te zijn',
    );

    // Een escalatie draagt zijn eigen afhandeling: geen onthouden welk endpoint.
    const escalation = actions.find((a) => a.kind === 'escalation')!;
    assert.equal(escalation.buttons[0]!.method, 'PATCH');
    assert.match(escalation.buttons[0]!.path, /^\/tasks\//);

    // Een vastzittende sessie krijgt bewust géén knop: dat los je in de sessie
    // zelf op, niet van afstand.
    assert.equal(actions.find((a) => a.kind === 'needs-human')!.buttons.length, 0);

    // Databronnen die nog niet aangesloten zijn, staan er zonder knop maar wél
    // met wat je moet doen.
    const source = actions.find((a) => a.kind === 'data-source')!;
    assert.match(source.detail, /org\.json/);
  } finally {
    server.close();
    store.close();
  }
});

test('opruimen raakt het handelsspoor niet aan', async () => {
  // Events en usage worden geprund; een besluit over geld hoort te blijven
  // staan, ook als het ouder is dan de ringbuffer. Dit staat als garantie in
  // CLAUDE.md, dus het hoort een test te hebben en geen aanname te zijn.
  const { store, server, base } = boot();
  try {
    const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
    store.addIntent({
      id: 'oud-1',
      createdAt: old,
      venture: 'trading',
      instrument: 'XAUUSD',
      side: 'buy',
      qty: 1,
      entry: 2000,
      stop: 1990,
      reason: 'oud voorstel uit het archief',
      sources: '["bron"]',
      proposedBy: 'ara-execution-trader',
      decision: '{}',
      route: 'paper',
      status: 'paper-filled',
      mode: 'paper',
      resolvedBy: '',
      note: '',
    });
    await fetch(`${base}/event`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ kind: 'session.start', sessionId: 'oud-sessie', cwd: '/x', ts: old }),
    });

    store.prune();

    assert.ok(store.getIntent('oud-1'), 'een handelsbesluit mag nooit weggeprund worden');
    assert.equal(
      store.forSession('oud-sessie', 10).length,
      0,
      'een event van 400 dagen oud hoort juist wél weg te zijn',
    );
  } finally {
    server.close();
    store.close();
  }
});

test('/usage: het dagbudget telt alleen sessies die ARA zelf startte', async () => {
  const { server, base } = boot();
  try {
    // De eigenaar zelf aan het werk: veel tokens, geen spawnedBy. Dit was de
    // hele bug — een dag handwerk zette zijn eigen agents stil terwijl die
    // niets hadden uitgegeven.
    await fetch(`${base}/usage`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        sessionId: 'mens-1',
        cwd: '/tmp/proj-a',
        inputTokens: 5_000,
        outputTokens: 1_500_000,
        cacheCreateTokens: 14_000_000,
      }),
    });
    // Een agent die ARA startte.
    await fetch(`${base}/usage`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        sessionId: 'agent-1',
        cwd: '/tmp/proj-a',
        inputTokens: 1_000,
        outputTokens: 2_000,
        cacheCreateTokens: 7_000,
        spawnedBy: 'ara-qa-verifier',
      }),
    });

    const res = (await (await fetch(`${base}/usage?from=0`)).json()) as {
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreateTokens: number;
        agentTokens: number;
        agentCacheCreateTokens: number;
      }[];
    };
    const total = res.usage.reduce((sum, r) => sum + r.inputTokens + r.outputTokens + r.cacheCreateTokens, 0);
    const agent = res.usage.reduce((sum, r) => sum + r.agentTokens, 0);
    const agentCache = res.usage.reduce((sum, r) => sum + r.agentCacheCreateTokens, 0);

    assert.equal(agent, 10_000, 'alleen de agent-sessie telt tegen het budget');
    assert.equal(agentCache, 7_000, 'het cache-deel staat apart zodat de som te lezen blijft');
    assert.ok(total > 15_000_000, 'het totaal blijft zichtbaar — we verbergen het verbruik niet');
  } finally {
    server.close();
  }
});

test('/usage: een latere post zonder stempel maakt van een agent geen mens', async () => {
  const { server, base } = boot();
  try {
    const post = (body: Record<string, unknown>) =>
      fetch(`${base}/usage`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    await post({ sessionId: 's1', cwd: '/tmp/p', outputTokens: 100, spawnedBy: 'ara-manager' });
    // Dezelfde sessie post opnieuw, maar de env-variabele is weg (hook opnieuw
    // geladen, andere shell). Zonder bescherming zou dit verbruik stilletjes
    // naar de eigenaar verhuizen en uit het budget verdwijnen.
    await post({ sessionId: 's1', cwd: '/tmp/p', outputTokens: 300 });

    const res = (await (await fetch(`${base}/usage?from=0`)).json()) as {
      usage: { agentTokens: number }[];
    };
    assert.equal(res.usage.reduce((sum, r) => sum + r.agentTokens, 0), 300);
  } finally {
    server.close();
  }
});

test('/fleet: zonder bestand niet aangesloten, met bestand uitgerekend en in /org gemarkeerd', async () => {
  const { forgetFleet } = await import('./fleet.ts');
  const { forgetSources } = await import('./sources.ts');
  const { store, server, base } = boot();
  const fleetDir = path.join(process.env.ARA_SOURCES_DIR!, 'blex');
  fs.mkdirSync(fleetDir, { recursive: true });
  try {
    forgetFleet();
    const empty = await (await fetch(`${base}/fleet`)).json();
    assert.equal(empty.vehicles.present, false);
    assert.equal(empty.deadlines.length, 0);
    const orgBefore = await (await fetch(`${base}/org`)).json();
    const blexBefore = orgBefore.ventures.find((v: { id: string }) => v.id === 'blex');
    const src = (org: typeof orgBefore, label: string) =>
      org.ventures
        .find((v: { id: string }) => v.id === 'blex')
        .playbook.dataSources.find((d: { label: string }) => d.label.startsWith(label));
    assert.equal(src(orgBefore, 'Kenteken').configured, false);
    assert.ok(blexBefore, 'blex bestaat');

    // Een lijst neerzetten is de hele koppeling.
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(fleetDir, 'vehicles.csv'), `kenteken;km;apk\n12-ABC-3;1000;${soon}\n`);
    forgetFleet();
    forgetSources();
    const report = await (await fetch(`${base}/fleet`)).json();
    assert.equal(report.vehicles.present, true);
    assert.equal(report.vehicles.rows.length, 1);
    assert.equal(report.deadlines[0].window, '14');
    assert.equal(report.summary.binnen14, 1);
    // Alleen kolommen die in de kop staan tellen: deze lijst kent alleen apk,
    // en die is gevuld — dus geen gaten.
    assert.equal(report.summary.ontbreekt, 0);

    const orgAfter = await (await fetch(`${base}/org`)).json();
    assert.equal(src(orgAfter, 'Kenteken').configured, true);
    assert.equal(src(orgAfter, 'Chauffeurstermijnen').configured, false, 'drivers.csv staat er niet');
    const actions = (await (await fetch(`${base}/actions`)).json()).actions as { title: string }[];
    assert.ok(!actions.some((a) => a.title.includes('Kenteken, APK-datum')), 'uit de actielijst');
    assert.ok(actions.some((a) => a.title.includes('Chauffeurstermijnen')), 'de andere staat er nog');
  } finally {
    server.close();
    store.close();
    fs.rmSync(path.join(fleetDir, 'vehicles.csv'), { force: true });
    forgetFleet();
    forgetSources();
  }
});

test('/sources: ontbreekt → leeg → gevuld, en alleen gevuld telt als aangesloten', async () => {
  const { forgetSources } = await import('./sources.ts');
  const { store, server, base } = boot();
  const dir = path.join(process.env.ARA_SOURCES_DIR!, 'equities');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'kwartaalagenda.csv');
  const find = (all: { ventures: { id: string; sources: { file: string; state: string; rowCount: number; errors: string[] }[] }[] }) =>
    all.ventures.find((v) => v.id === 'equities')!.sources.find((s) => s.file === 'kwartaalagenda.csv')!;
  const configured = async () =>
    (await (await fetch(`${base}/org`)).json()).ventures
      .find((v: { id: string }) => v.id === 'equities')
      .playbook.dataSources.find((d: { label: string }) => d.label === 'Kwartaalagenda').configured as boolean;
  try {
    forgetSources();
    const all = await (await fetch(`${base}/sources`)).json();
    // Elke tak heeft zijn lijst, en elke bron uit het playbook staat erin.
    assert.equal(all.ventures.length, 8);
    assert.equal(find(all).state, 'ontbreekt');
    assert.equal(await configured(), false);

    // Alleen een kop: er is niets gemeten, dus niet aangesloten — met opzet.
    fs.writeFileSync(file, 'ticker;datum;soort\n');
    const empty = await (await fetch(`${base}/sources?refresh=1`)).json();
    assert.equal(find(empty).state, 'leeg');
    assert.equal(await configured(), false);

    fs.writeFileSync(file, 'ticker;datum;soort\nASML;2026-10-15;kwartaalcijfers\n');
    const filled = await (await fetch(`${base}/sources?refresh=1`)).json();
    assert.equal(find(filled).state, 'gevuld');
    assert.equal(find(filled).rowCount, 1);
    assert.equal(await configured(), true);
    const one = await (await fetch(`${base}/sources/equities/kwartaalagenda.csv`)).json();
    assert.equal(one.rows[0].ticker, 'ASML');
    assert.equal(one.rows[0].datum, Date.UTC(2026, 9, 15), 'datum is getypeerd, geen tekst');
    const unknown = await fetch(`${base}/sources/equities/nope.csv`);
    assert.equal(unknown.status, 404);

    // Een verkeerde kop is een fout die je te zien krijgt, geen stille lege bron.
    fs.writeFileSync(file, 'symbool;datum\nASML;2026-10-15\n');
    const broken = find(await (await fetch(`${base}/sources?refresh=1`)).json());
    assert.equal(broken.state, 'leeg');
    assert.match(broken.errors[0]!, /ticker/);
  } finally {
    server.close();
    store.close();
    fs.rmSync(file, { force: true });
    forgetSources();
  }
});

test('/office: een gevuld bronbestand vult de bureaus — echt, niet verouderd, zonder agent', async () => {
  const { forgetSources } = await import('./sources.ts');
  const { store, server, base } = boot();
  const dir = path.join(process.env.ARA_SOURCES_DIR!, 'blex');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'vehicles.csv');
  type Office = { stations: { id: string; label: string; simulated: boolean; stale: boolean; status: string; metrics: { label: string; value: string }[] }[] };
  try {
    forgetSources();
    const before = (await (await fetch(`${base}/office/truck-trailers`)).json()) as Office;
    assert.ok(before.stations.every((s) => s.simulated), 'zonder bron: voorbeeldcijfers, en dat staat erbij');

    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    fs.writeFileSync(file, `Kenteken;Km;APK\n12-abc-3;120.500;${soon}\n45-XYZ-9;9000;\n`);
    forgetSources();
    const after = (await (await fetch(`${base}/office/truck-trailers`)).json()) as Office;
    assert.deepEqual(after.stations.map((s) => s.id), ['12-ABC-3', '45-XYZ-9'], 'de kentekens zijn de bureaus');
    assert.ok(after.stations.every((s) => !s.simulated && !s.stale));
    assert.equal(after.stations[0]!.status, 'alert', 'APK over vijf dagen');
    assert.equal(after.stations[0]!.metrics.find((m) => m.label === 'Km-stand')!.value, '120.500');
    assert.equal(after.stations[1]!.metrics.find((m) => m.label === 'APK')!.value, 'ontbreekt');

    // Een verse agent-push over dezelfde werkplek wint van het bestand.
    await fetch(`${base}/office/truck-trailers/station`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ id: '12-ABC-3', value: 7, sub: 'net uit de garage' }),
    });
    const pushed = (await (await fetch(`${base}/office/truck-trailers`)).json()) as Office & { stations: { value: number; sub: string }[] };
    assert.equal(pushed.stations[0]!.value, 7);
    assert.equal(pushed.stations[0]!.sub, 'net uit de garage');
    // Maar een push die ouder is dan het bestand niet: de lijst van vandaag telt.
    store.upsertStation({ project: 'truck-trailers', stationId: '45-XYZ-9', json: JSON.stringify({ value: 99 }), updatedAt: Date.now() - 3 * 86_400_000 });
    const fresh = (await (await fetch(`${base}/office/truck-trailers`)).json()) as Office & { stations: { value: number; valueMissing?: boolean }[] };
    assert.notEqual(fresh.stations[1]!.value, 99);
    assert.equal(fresh.stations[1]!.valueMissing, true, 'geen garagelijst: geen storingencijfer');
    // Een kapotte regel (lege verplichte cel) haalt de collector niet neer.
    fs.writeFileSync(file, `Kenteken;Km;APK\n12-abc-3;120.500;${soon}\n;9;\n`);
    const survived = await fetch(`${base}/office/truck-trailers?x=${Date.now()}`);
    assert.equal(survived.status, 200);
    const fleetFresh = await (await fetch(`${base}/fleet?refresh=1`)).json();
    assert.equal(fleetFresh.vehicles.rows.length, 1);
    assert.equal(fleetFresh.vehicles.errors.length, 1, 'de lege regel is een gemelde fout');
  } finally {
    server.close();
    store.close();
    fs.rmSync(file, { force: true });
    forgetSources();
  }
});

test('/actions: wat in de bronbestanden ligt staat naast de rest, zonder knop', async () => {
  const { forgetSources } = await import('./sources.ts');
  const { store, server, base } = boot();
  const blex = path.join(process.env.ARA_SOURCES_DIR!, 'blex');
  const trading = path.join(process.env.ARA_SOURCES_DIR!, 'trading');
  fs.mkdirSync(blex, { recursive: true });
  fs.mkdirSync(trading, { recursive: true });
  const vehicles = path.join(blex, 'vehicles.csv');
  const positions = path.join(trading, 'posities.csv');
  try {
    const gone = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    fs.writeFileSync(vehicles, `kenteken;km;apk\n12-ABC-3;1000;${gone}\n`);
    fs.writeFileSync(positions, 'instrument;richting;inzet;entry;stop\nXAUUSD;long;500;2410;\n');
    forgetSources();
    const { actions } = (await (await fetch(`${base}/actions`)).json()) as {
      actions: { kind: string; urgency: string; title: string; detail: string; buttons: unknown[]; venture?: string }[];
    };
    const apk = actions.find((a) => a.kind === 'source-alert' && a.title.includes('APK van wagen 12-ABC-3'))!;
    assert.ok(apk, 'de verlopen APK staat in de actielijst');
    assert.equal(apk.urgency, 'blocking');
    assert.match(apk.title, /^Truck & Trailers: /);
    assert.match(apk.detail, /Bron: data\/sources\/blex\/vehicles\.csv/);
    assert.deepEqual(apk.buttons, [], 'ARA plant geen keuring: geen knop');
    const stop = actions.find((a) => a.kind === 'source-alert' && a.title.includes('geen stop'))!;
    assert.equal(stop.urgency, 'blocking');
    assert.equal(stop.venture, 'trading');
    // En de bron zelf is niet meer "nog niet aangesloten".
    assert.ok(!actions.some((a) => a.title.includes('Kenteken, APK-datum, kilometerstand nog niet aangesloten')));
  } finally {
    server.close();
    store.close();
    fs.rmSync(vehicles, { force: true });
    fs.rmSync(positions, { force: true });
    forgetSources();
  }
});
