import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './db.ts';
import { createCollector } from './server.ts';

function tempDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ara-test-')), 'test.db');
}

test('ingest fills in id/ts/project and updates state', () => {
  const store = openStore(tempDb());
  const { state, ingest } = createCollector(store);

  const event = ingest({ kind: 'session.start', sessionId: 's1', cwd: '/tmp/mystery-repo' });
  assert.ok(event.id);
  assert.ok(event.ts > 0);
  assert.equal(event.project, 'mystery-repo');

  ingest({ kind: 'tool.pre', sessionId: 's1', cwd: '/tmp/mystery-repo', tool: 'Bash' });
  const snap = state.snapshot();
  assert.equal(snap.sessions['s1']!.status, 'working');
  assert.equal(snap.sessions['s1']!.activeTool, 'Bash');
  assert.equal(snap.counters.running, 1);
  store.close();
});

test('secrets are redacted before storage', () => {
  const store = openStore(tempDb());
  const { ingest } = createCollector(store);
  const event = ingest({
    kind: 'tool.pre',
    sessionId: 's2',
    cwd: '/tmp/x',
    tool: 'Bash',
    toolInput: { apiKey: 'sk-ant-supersecret1234567890' },
    toolSummary: 'export TOKEN=sk-ant-supersecret1234567890abc',
  });
  const stored = store.forSession('s2')[0]!;
  assert.ok(!JSON.stringify(stored).includes('supersecret'));
  assert.ok(!JSON.stringify(event.toolInput).includes('supersecret'));
  store.close();
});

test('notification marks session needsHuman; task.completed clears it', () => {
  const store = openStore(tempDb());
  const { state, ingest } = createCollector(store);
  ingest({ kind: 'session.start', sessionId: 's3', cwd: '/tmp/x' });
  ingest({ kind: 'notification', sessionId: 's3', cwd: '/tmp/x', needsHuman: true, message: 'Approve?' });
  assert.equal(state.snapshot().sessions['s3']!.status, 'needsHuman');
  assert.equal(state.snapshot().counters.needsHuman, 1);
  ingest({ kind: 'task.completed', sessionId: 's3', cwd: '/tmp/x' });
  assert.equal(state.snapshot().sessions['s3']!.status, 'done');
  assert.equal(state.snapshot().counters.needsHuman, 0);
  store.close();
});

test('state is rebuilt from SQLite on restart', () => {
  const dbPath = tempDb();
  const store1 = openStore(dbPath);
  const collector1 = createCollector(store1);
  collector1.ingest({ kind: 'session.start', sessionId: 's4', cwd: '/tmp/y' });
  collector1.ingest({ kind: 'tool.pre', sessionId: 's4', cwd: '/tmp/y', tool: 'Edit' });
  store1.close();

  const store2 = openStore(dbPath);
  const collector2 = createCollector(store2);
  assert.equal(collector2.state.snapshot().sessions['s4']!.status, 'working');
  store2.close();
});

test('subagent lifecycle tracked on session', () => {
  const store = openStore(tempDb());
  const { state, ingest } = createCollector(store);
  ingest({ kind: 'session.start', sessionId: 's5', cwd: '/tmp/z' });
  ingest({ kind: 'agent.start', sessionId: 's5', cwd: '/tmp/z', agentId: 'ag1', agentType: 'Explore' });
  ingest({ kind: 'tool.pre', sessionId: 's5', cwd: '/tmp/z', agentId: 'ag1', tool: 'Grep' });
  let agent = state.snapshot().sessions['s5']!.agents['ag1']!;
  assert.equal(agent.activeTool, 'Grep');
  assert.equal(agent.stopped, false);
  ingest({ kind: 'agent.stop', sessionId: 's5', cwd: '/tmp/z', agentId: 'ag1' });
  agent = state.snapshot().sessions['s5']!.agents['ag1']!;
  assert.equal(agent.stopped, true);
  store.close();
});
