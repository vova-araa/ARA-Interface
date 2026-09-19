import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';

/**
 * Integratietest voor scripts/watchdog.mjs — de 24/7 bewaker. Hij draait als
 * echt proces tegen een echte collector, met spawns onderdrukt en Telegram in
 * dryrun. Zo leggen we vast dát hij de juiste taken oppakt zonder tokens of
 * echte sessies te kosten.
 */
process.env.ARA_WORLD_CONFIG ??= path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-world-')),
  'world.config.json',
);
// Vóór de server-import, want sources.ts leest de map bij het laden. Zonder
// dit leest de test de echte data/sources van deze checkout.
process.env.ARA_SOURCES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-sources-'));
const { openStore } = await import('./db.ts');
const { createCollector } = await import('./server.ts');

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * Let op: asynchroon draaien. De collector draait in ditzelfde proces, dus een
 * synchrone execFileSync zou de event-loop blokkeren en de watchdog zou zijn
 * eigen collector als "down" zien.
 */
function runWatchdog(base: string, lockDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(REPO, 'scripts', 'watchdog.mjs')], {
      env: {
        ...process.env,
        ARA_COLLECTOR_URL: base,
        ARA_LOCK_DIR: lockDir,
        ARA_WATCHDOG_NO_SPAWN: '1',
        ARA_NOTIFY_DRYRUN: '1',
        ARA_TELEGRAM_BOT_TOKEN: 'test',
        ARA_TELEGRAM_CHAT_ID: 'test',
        ARA_DAILY_PING: '0',
        ARA_BACKUP: '0',
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

test('watchdog pakt een kantoorvraag op, ook al staat die bij een manager', async () => {
  const store = openStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-')), 'test.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
  try {
    // Een vraag uit een kantoorchat belandt bij de aangesproken rol — níét bij
    // de supervisor. Precies die taken werden vroeger nooit opgepakt.
    await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room: 'office:truck-trailers',
        text: 'Staat truck 42 nog in de garage?',
        to: 'manager:blex',
        project: 'truck-trailers',
      }),
    });
    const open = store.listTasks({ status: 'open', limit: 10 });
    assert.equal(open.length, 1);
    assert.equal(open[0]!.assignee, 'manager:blex', 'de taak staat bij de manager, niet de supervisor');

    const output = await runWatchdog(base, lockDir);
    assert.match(output, /1 chatvraag/, 'watchdog telt de kantoorvraag');
    assert.match(output, /SPAWN onderdrukt \(test\): supervisor-ops/, 'en start de supervisor ervoor');
  } finally {
    server.close();
    store.close();
  }
});

test('watchdog stopt met spawnen na twee vruchteloze pogingen', async () => {
  const store = openStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd2-')), 'test.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd2-locks-'));
  try {
    await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: 'office:x', text: 'blijft open', to: 'manager:blex', project: 'x' }),
    });
    // Twee ticks met dezelfde open taak = twee pogingen; de derde moet stoppen
    // en in plaats daarvan de mens waarschuwen (anders elke 5 min tokens).
    await runWatchdog(base, lockDir);
    await runWatchdog(base, lockDir);
    const third = await runWatchdog(base, lockDir);
    assert.match(third, /supervisor kwam er 2× niet uit/, 'derde tick spawnt niet meer');
    assert.doesNotMatch(third, /SPAWN onderdrukt \(test\): supervisor-ops/);
  } finally {
    server.close();
    store.close();
  }
});

test('inbox: een taak uit git komt op het bord, precies één keer', async () => {
  const store = openStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-')), 'test.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
  // Een eigen repo-map: de echte ops/inbox van deze repo mag een test nooit
  // aanraken, en data/inbox-seen.json ook niet.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-repo-'));
  fs.mkdirSync(path.join(repo, 'ops', 'inbox'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'ops', 'inbox', 'taak.md'),
    '---\ntitle: Controleer de bandenspanning\nassignee: manager:blex\nproject: truck-trailers\n---\n\nLoop de vloot langs en meld wat eruit springt.\n',
  );

  const run = (env: Record<string, string>): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [path.join(REPO, 'scripts', 'watchdog.mjs')], {
        env: {
          ...process.env,
          ARA_COLLECTOR_URL: base,
          ARA_LOCK_DIR: lockDir,
          ARA_REPO: repo,
          ARA_WATCHDOG_NO_SPAWN: '1',
          ARA_NOTIFY_DRYRUN: '1',
          ARA_TELEGRAM_BOT_TOKEN: 'test',
          ARA_TELEGRAM_CHAT_ID: 'test',
          ARA_DAILY_PING: '0',
          ARA_BACKUP: '0',
          ...env,
        },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += String(chunk)));
      child.stderr.on('data', (chunk) => (out += String(chunk)));
      child.on('error', reject);
      child.on('close', () => resolve(out));
    });

  try {
    // Zonder de schakelaar gebeurt er niets. Werk dat op een machine van de
    // eigenaar draait mag nooit vanzelf beginnen omdat er een bestand verscheen.
    await run({});
    assert.equal(
      store.listTasks({ status: 'open', limit: 10 }).length,
      0,
      'zonder ARA_INBOX=1 blijft de inbox ongelezen',
    );

    await run({ ARA_INBOX: '1' });
    const open = store.listTasks({ status: 'open', limit: 10 });
    assert.equal(open.length, 1);
    assert.equal(open[0]!.title, 'Controleer de bandenspanning');
    assert.equal(open[0]!.assignee, 'manager:blex', 'de frontmatter bepaalt wie het krijgt');
    assert.match(open[0]!.detail, /bandenspanning|vloot/i, 'de opdracht zelf staat erbij');

    // Tweede ronde: hetzelfde bestand mag het bord niet nog eens vullen, anders
    // groeit één taak elke vijf minuten aan.
    await run({ ARA_INBOX: '1' });
    assert.equal(
      store.listTasks({ status: 'open', limit: 10 }).length,
      1,
      'een verwerkt inbox-bestand komt niet nog eens op het bord',
    );
  } finally {
    server.close();
    store.close();
  }
});

test('ritme: terugkerend werk komt op het bord, één keer, en alleen aangezet', async () => {
  const store = openStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-')), 'test.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
  // Eigen repo-map: data/rhythm.json van de echte repo mag een test niet raken.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-repo-'));

  const run = (env: Record<string, string>): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [path.join(REPO, 'scripts', 'watchdog.mjs')], {
        env: {
          ...process.env,
          ARA_COLLECTOR_URL: base,
          ARA_LOCK_DIR: lockDir,
          ARA_REPO: repo,
          ARA_WATCHDOG_NO_SPAWN: '1',
          ARA_NOTIFY_DRYRUN: '1',
          ARA_TELEGRAM_BOT_TOKEN: 'test',
          ARA_TELEGRAM_CHAT_ID: 'test',
          ARA_BACKUP: '0',
          ...env,
        },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += String(chunk)));
      child.stderr.on('data', (chunk) => (out += String(chunk)));
      child.on('error', reject);
      child.on('close', () => resolve(out));
    });

  try {
    // Uit betekent uit. Dit laat het systeem uit zichzelf tokens uitgeven;
    // dat mag nooit beginnen omdat de watchdog toevallig draait.
    await run({});
    assert.equal(
      store.listTasks({ status: 'open', limit: 300 }).length,
      0,
      'zonder ARA_RHYTHM=1 komt er geen terugkerend werk op het bord',
    );

    // Eén tak aan: alleen díé tak krijgt werk.
    await run({ ARA_RHYTHM: '1', ARA_RHYTHM_VENTURES: 'blex' });
    const first = store.listTasks({ status: 'open', limit: 300 });
    assert.ok(first.length > 0, 'blex krijgt zijn terugkerende werk');
    // "Alleen blex" toetsen we op wie het werk krijgt, niet meer op de
    // manager: sinds elke duty een eigenaar draagt landt het werk bij de
    // specialist die het doet. Dat de manager erop stond was een aanname over
    // hoe het toevallig werkte, en die aanname is nu onjuist zonder dat er
    // iets stuk is.
    const blexRoles = new Set([
      'manager:blex',
      ...(
        (await (await fetch(`${base}/org`)).json()) as {
          ventures: { id: string; playbook?: { specialists?: { agent: string }[] } }[];
        }
      ).ventures
        .filter((v) => v.id === 'blex')
        .flatMap((v) => (v.playbook?.specialists ?? []).map((sp) => sp.agent)),
    ]);
    assert.ok(
      first.every((t) => blexRoles.has(t.assignee)),
      `en geen enkele andere tak komt mee — onbekend: ${first
        .filter((t) => !blexRoles.has(t.assignee))
        .map((t) => t.assignee)
        .join(', ')}`,
    );
    // Het punt van duty.who: het werk ligt bij de rollen zelf, niet op één
    // stapel bij de manager. Zonder deze regel is `who` decoratie.
    assert.ok(
      first.some((t) => t.assignee !== 'manager:blex'),
      'terugkerend werk hoort bij de rol die het doet, niet allemaal bij de manager',
    );
    assert.ok(
      first.every((t) => /^(Dagelijks|Wekelijks|Maandelijks): /.test(t.title)),
      'de cadans staat in de titel, zodat je op het bord ziet wat wanneer hoort',
    );

    // Ops heeft eigen terugkerend werk (back-ups, org-audit, sleutels) en werd
    // nooit geplaatst: de ritme-lus liep alleen over de takken. Drie rollen met
    // een cadans die nooit aanbrak.
    await run({ ARA_RHYTHM: '1', ARA_RHYTHM_VENTURES: 'ops' });
    const withOps = store.listTasks({ status: 'open', limit: 300 });
    const opsTasks = withOps.filter((t) => !first.some((f) => f.id === t.id));
    assert.ok(opsTasks.length > 0, 'ops krijgt zijn eigen terugkerende werk');
    assert.ok(
      opsTasks.every((t) => t.assignee.startsWith('ara-')),
      `ops-werk hoort bij zijn eigen rollen: ${opsTasks.map((t) => t.assignee).join(', ')}`,
    );

    // Tweede ronde meteen erna: alles staat nog open én het interval is niet
    // verstreken. Eén taak per ritme, geen stapel die elke vijf minuten groeit.
    await run({ ARA_RHYTHM: '1', ARA_RHYTHM_VENTURES: 'blex' });
    assert.equal(
      store.listTasks({ status: 'open', limit: 300 }).length,
      withOps.length,
      'een tweede ronde stapelt niets bovenop',
    );
  } finally {
    server.close();
    store.close();
  }
});

test('watchdog maakt zelf een backup als de nieuwste ouder is dan een dag', async () => {
  // De verifier trof na een week een lege map aan: niemand had het commando
  // ooit gedraaid. De watchdog doet het nu zelf, en deze test pint vast dat
  // hij dat doet (lege map), en niet doet (verse kopie aanwezig).
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-data-'));
  const store = openStore(path.join(dataDir, 'ara-events.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
  const backupDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-backup-')), 'ara');

  const run = (env: Record<string, string>): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [path.join(REPO, 'scripts', 'watchdog.mjs')], {
        env: {
          ...process.env,
          ARA_COLLECTOR_URL: base,
          ARA_LOCK_DIR: lockDir,
          ARA_DATA_DIR: dataDir,
          ARA_BACKUP_DIR: backupDir,
          ARA_WATCHDOG_NO_SPAWN: '1',
          ARA_NOTIFY_DRYRUN: '1',
          ARA_TELEGRAM_BOT_TOKEN: 'test',
          ARA_TELEGRAM_CHAT_ID: 'test',
          ARA_DAILY_PING: '0',
          ...env,
        },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += String(chunk)));
      child.stderr.on('data', (chunk) => (out += String(chunk)));
      child.on('error', reject);
      child.on('close', () => resolve(out));
    });
  const copies = (): string[] =>
    fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => /^ara-events-.*\.db$/.test(f)) : [];

  try {
    await run({ ARA_BACKUP: '0' });
    assert.equal(copies().length, 0, 'uit is uit');

    const first = await run({});
    assert.equal(copies().length, 1, 'een lege map krijgt zijn eerste kopie');
    assert.match(first, /backup: /, 'en de watchdog zegt dat erbij');

    // Een verse kopie is genoeg: geen tweede binnen het venster, anders staat de
    // map na een dag vol met 288 exemplaren.
    await run({});
    assert.equal(copies().length, 1, 'binnen het venster komt er geen tweede');
  } finally {
    server.close();
    store.close();
  }
});

test('bronnen: een onleesbaar bestand wordt één keer per dag gemeld, een leesbaar niet', async () => {
  const { forgetSources } = await import('./sources.ts');
  const store = openStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-')), 'test.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = path.join(process.env.ARA_SOURCES_DIR!, 'equities');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'kwartaalagenda.csv');
  const alerts = (out: string) =>
    out.split('\n').filter((line) => line.includes('[notify dryrun]') && line.includes('kwartaalagenda.csv'));
  try {
    // Het bestand staat er, maar de kop klopt niet: precies de storing die de
    // actielijst niet toont (daar staat alleen ontbreekt/leeg) en de eigenaar
    // dus niet ziet.
    fs.writeFileSync(file, 'symbool;datum\nASML;2026-10-15\n');
    forgetSources();
    const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
    const first = await runWatchdog(base, lockDir);
    const sent = alerts(first);
    assert.equal(sent.length, 1, `één melding voor het kapotte bestand:\n${first}`);
    assert.match(sent[0]!, /kolom\(men\) ontbreken in de kop: ticker/, 'met de eerste foutregel');
    assert.match(sent[0]!, /Bronbestand onleesbaar/);

    // Tweede tick, zelfde dag, zelfde lock-map: niet nog eens — anders komt
    // hetzelfde bericht elke vijf minuten.
    const second = await runWatchdog(base, lockDir);
    assert.equal(alerts(second).length, 0, 'binnen dezelfde dag geen tweede melding');

    // Een leesbaar bestand is geen storing, ook met een verse lock-map.
    fs.writeFileSync(file, 'ticker;datum;soort\nASML;2026-10-15;kwartaalcijfers\n');
    forgetSources();
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
    const clean = await runWatchdog(base, fresh);
    assert.equal(alerts(clean).length, 0, 'een correcte CSV geeft geen melding');
    assert.doesNotMatch(clean, /Bronbestand onleesbaar/);
  } finally {
    server.close();
    store.close();
    fs.rmSync(file, { force: true });
    forgetSources();
  }
});

test('levensteken: telt de gevulde bronnen, en verzint geen getal als /sources ontbreekt', async () => {
  const { forgetSources } = await import('./sources.ts');
  const store = openStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-')), 'test.db'));
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-wd-locks-'));
  const dir = path.join(process.env.ARA_SOURCES_DIR!, 'vovara');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'releases.csv');
  const run = (env: Record<string, string>): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [path.join(REPO, 'scripts', 'watchdog.mjs')], {
        env: {
          ...process.env,
          ARA_COLLECTOR_URL: base,
          ARA_LOCK_DIR: lockDir,
          ARA_WATCHDOG_NO_SPAWN: '1',
          ARA_NOTIFY_DRYRUN: '1',
          ARA_TELEGRAM_BOT_TOKEN: 'test',
          ARA_TELEGRAM_CHAT_ID: 'test',
          ARA_BACKUP: '0',
          ARA_DAILY_PING: 'now',
          ...env,
        },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += String(chunk)));
      child.stderr.on('data', (chunk) => (out += String(chunk)));
      child.on('error', reject);
      child.on('close', () => resolve(out));
    });
  try {
    fs.writeFileSync(file, 'titel;datum;streams\nEP;2026-05-01;1200\n');
    forgetSources();
    const out = await run({});
    assert.match(out, /ARA World draait/, 'het levensteken is verstuurd');
    assert.match(out, /Bronnen: 1 van 22 gevuld/, 'één gevulde bron, geteld uit /sources');
  } finally {
    server.close();
    store.close();
    fs.rmSync(file, { force: true });
    forgetSources();
  }
});
