import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Must be set before server.ts (and its config import) is evaluated.
process.env.ARA_TOKEN = 'testsecret';
const { openStore } = await import('./db.ts');
const { createCollector } = await import('./server.ts');

test('API is gated when ARA_TOKEN is set; /health stays open', async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-auth-')), 'test.db');
  const store = openStore(dbPath);
  const { app } = createCollector(store);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    assert.equal((await fetch(`${base}/health`)).status, 200, 'health open');
    assert.equal((await fetch(`${base}/state`)).status, 401, 'state gated');
    assert.equal((await fetch(`${base}/state?token=wrong`)).status, 401, 'wrong token');
    assert.equal((await fetch(`${base}/state?token=testsecret`)).status, 200, 'query token');
    assert.equal(
      (await fetch(`${base}/state`, { headers: { authorization: 'Bearer testsecret' } })).status,
      200,
      'bearer token',
    );

    const post = await fetch(`${base}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ara-token': 'testsecret' },
      body: JSON.stringify({ kind: 'session.start', sessionId: 'auth-1', cwd: '/x' }),
    });
    assert.equal(post.status, 200, 'x-ara-token header on POST');

    const postNoToken = await fetch(`${base}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'session.start', sessionId: 'auth-2', cwd: '/x' }),
    });
    assert.equal(postNoToken.status, 401, 'POST gated');
  } finally {
    server.close();
    store.close();
  }
});
