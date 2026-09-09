import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openStore } from './db.ts';
import { createCollector } from './server.ts';

function boot() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-tasks-')), 'test.db');
  const store = openStore(dbPath);
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, server, base };
}

test('task board: create → claim → done flow between roles', async () => {
  const { store, server, base } = boot();
  try {
    // Supervisor creates a task for a manager.
    const created = await (
      await fetch(`${base}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Fix invoice export',
          project: 'traject-tms',
          assignee: 'manager:traject',
          createdBy: 'supervisor',
        }),
      })
    ).json();
    assert.equal(created.ok, true);
    const id = created.task.id as string;

    // Manager claims it, then hands a subtask to a worker.
    const claimed = await (
      await fetch(`${base}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'claimed' }),
      })
    ).json();
    assert.equal(claimed.task.status, 'claimed');

    const sub = await (
      await fetch(`${base}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Patch margin calc',
          parentId: id,
          assignee: 'agent:worker',
          createdBy: 'manager:traject',
        }),
      })
    ).json();
    assert.equal(sub.task.parentId, id);

    // Worker finishes; manager closes the parent with a result.
    await fetch(`${base}/tasks/${sub.task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', result: 'margin fixed, tests green' }),
    });
    const closed = await (
      await fetch(`${base}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done', result: 'shipped via worker' }),
      })
    ).json();
    assert.equal(closed.task.status, 'done');

    // Supervisor lists what managers finished.
    const list = await (await fetch(`${base}/tasks?status=done`)).json();
    assert.equal(list.tasks.length, 2);

    // Filters work per assignee.
    const mine = await (await fetch(`${base}/tasks?assignee=agent:worker`)).json();
    assert.equal(mine.tasks.length, 1);
    assert.equal(mine.tasks[0].result, 'margin fixed, tests green');
  } finally {
    server.close();
    store.close();
  }
});

test('task board validation: title required, bad status rejected, 404 on unknown id', async () => {
  const { store, server, base } = boot();
  try {
    assert.equal(
      (await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      400,
    );
    const t = await (
      await fetch(`${base}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      })
    ).json();
    assert.equal(
      (
        await fetch(`${base}/tasks/${t.task.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'nonsense' }),
        })
      ).status,
      400,
    );
    assert.equal((await fetch(`${base}/tasks/does-not-exist`)).status, 404);
  } finally {
    server.close();
    store.close();
  }
});
