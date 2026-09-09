import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapHookPayload, toolSummary } from './hookmap.ts';

test('maps every supported hook to the right kind', () => {
  const cases: [string, string][] = [
    ['SessionStart', 'session.start'],
    ['SessionEnd', 'session.end'],
    ['UserPromptSubmit', 'prompt'],
    ['PreToolUse', 'tool.pre'],
    ['PostToolUse', 'tool.post'],
    ['SubagentStart', 'agent.start'],
    ['SubagentStop', 'agent.stop'],
    ['Stop', 'stop'],
    ['Notification', 'notification'],
    ['TaskCompleted', 'task.completed'],
    ['TeammateIdle', 'teammate.idle'],
  ];
  for (const [hook, kind] of cases) {
    const event = mapHookPayload(hook, { session_id: 's', cwd: '/x' });
    assert.equal(event?.kind, kind, hook);
  }
});

test('unknown hook name falls back to hook_event_name, else null', () => {
  const viaPayload = mapHookPayload('SomethingNew', {
    session_id: 's',
    hook_event_name: 'PreToolUse',
  });
  assert.equal(viaPayload?.kind, 'tool.pre');
  assert.equal(mapHookPayload('SomethingNew', { session_id: 's' }), null);
});

test('prompt carries the user message; notification flags needsHuman', () => {
  const prompt = mapHookPayload('UserPromptSubmit', { session_id: 's', prompt: 'fix the bug' });
  assert.equal(prompt?.message, 'fix the bug');
  const notification = mapHookPayload('Notification', { session_id: 's', message: 'Approve?' });
  assert.equal(notification?.needsHuman, true);
  assert.equal(notification?.message, 'Approve?');
});

test('PostToolUse detects errors from tool_response', () => {
  const ok = mapHookPayload('PostToolUse', { session_id: 's', tool_name: 'Bash', tool_response: {} });
  assert.equal(ok?.status, 'ok');
  const err = mapHookPayload('PostToolUse', {
    session_id: 's',
    tool_name: 'Bash',
    tool_response: { is_error: true },
  });
  assert.equal(err?.status, 'error');
  const err2 = mapHookPayload('PostToolUse', {
    session_id: 's',
    tool_name: 'Bash',
    tool_response: { error: 'boom' },
  });
  assert.equal(err2?.status, 'error');
});

test('agent events derive agentId from tool_use_id when missing', () => {
  const event = mapHookPayload('SubagentStart', {
    session_id: 's',
    tool_use_id: 'tu_1',
    subagent_type: 'Explore',
  });
  assert.equal(event?.agentId, 'tu_1');
  assert.equal(event?.agentType, 'Explore');
});

test('toolSummary per tool family', () => {
  assert.equal(toolSummary('Bash', { command: 'pnpm   test' }), 'pnpm test');
  assert.equal(toolSummary('Read', { file_path: '/a/b/invoice.ts' }), 'Read invoice.ts');
  assert.equal(toolSummary('Grep', { pattern: 'renderPdf' }), 'grep renderPdf');
  assert.equal(toolSummary('WebSearch', { query: 'three.js instancing' }), 'three.js instancing');
  assert.equal(toolSummary('Task', { description: 'Scout PDF pipeline' }), 'Scout PDF pipeline');
  assert.equal(toolSummary('mcp__Supabase__execute_sql', {}), 'Supabase execute_sql');
  assert.equal(toolSummary('Bash', { command: 'x'.repeat(200) })?.length, 60);
});
