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
    assert.ok(
      first.every((t) => t.assignee === 'manager:blex'),
      'en geen enkele andere tak komt mee',
    );
    assert.ok(
      first.every((t) => /^(Dagelijks|Wekelijks|Maandelijks): /.test(t.title)),
      'de cadans staat in de titel, zodat je op het bord ziet wat wanneer hoort',
    );

    // Tweede ronde meteen erna: alles staat nog open én het interval is niet
    // verstreken. Eén taak per ritme, geen stapel die elke vijf minuten groeit.
    await run({ ARA_RHYTHM: '1', ARA_RHYTHM_VENTURES: 'blex' });
    assert.equal(
      store.listTasks({ status: 'open', limit: 300 }).length,
      first.length,
      'een tweede ronde stapelt niets bovenop',
    );
  } finally {
    server.close();
    store.close();
  }
});
