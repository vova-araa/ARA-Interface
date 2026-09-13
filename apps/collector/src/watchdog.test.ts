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
