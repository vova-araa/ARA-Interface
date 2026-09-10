/**
 * Generates fixtures/demo.jsonl — a ~2 minute animated story used by
 * `?demo=1` in the viewer and by tests. Timestamps are absolute at
 * generation time; the viewer remaps them relative to "now" on replay.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AraEvent, AraEventKind } from '@ara/shared';
import { FIXTURE_PATH } from './config.ts';

const BASE = Date.now();
const events: AraEvent[] = [];

function emit(
  offsetSec: number,
  kind: AraEventKind,
  sessionId: string,
  project: string,
  extra: Partial<AraEvent> = {},
): void {
  events.push({
    id: crypto.randomUUID(),
    ts: BASE + Math.round(offsetSec * 1000),
    kind,
    sessionId,
    cwd: `/Users/vova/dev/${project}`,
    project,
    ...extra,
  });
}

// ── Story ──────────────────────────────────────────────────────────────
// Session A: sharzi-tms — busy build with a subagent and a happy ending.
const A = 'demo-traject';
emit(0, 'session.start', A, 'sharzi-tms', { model: 'claude-haiku-4-5' });
emit(2, 'prompt', A, 'sharzi-tms', { message: 'Fix the invoice PDF export' });
emit(3, 'task.created', A, 'sharzi-tms', { message: 'Fix the invoice PDF export' });
emit(4, 'tool.pre', A, 'sharzi-tms', { tool: 'Read', toolSummary: 'Read invoice.ts' });
emit(6, 'tool.post', A, 'sharzi-tms', { tool: 'Read', status: 'ok', durationMs: 1800 });
emit(8, 'tool.pre', A, 'sharzi-tms', { tool: 'Grep', toolSummary: 'Search renderPdf usages' });
emit(10, 'tool.post', A, 'sharzi-tms', { tool: 'Grep', status: 'ok', durationMs: 900 });
emit(12, 'agent.start', A, 'sharzi-tms', { agentId: 'a1', agentType: 'Explore', toolSummary: 'Scout PDF pipeline' });
emit(14, 'tool.pre', A, 'sharzi-tms', { agentId: 'a1', tool: 'Glob', toolSummary: 'Find *.pdf.ts' });
emit(17, 'tool.post', A, 'sharzi-tms', { agentId: 'a1', tool: 'Glob', status: 'ok', durationMs: 700 });
emit(20, 'agent.stop', A, 'sharzi-tms', { agentId: 'a1' });
// Zwaar werk → org-beleid schakelt op naar een groter model (morph-animatie).
emit(22, 'model.switch', A, 'sharzi-tms', { model: 'claude-fable-5', message: 'claude-haiku-4-5 → claude-fable-5' });
emit(23, 'tool.batch', A, 'sharzi-tms', { message: '3 tools parallel' });
emit(24, 'tool.pre', A, 'sharzi-tms', { tool: 'Edit', toolSummary: 'Patch margin calculation' });
emit(27, 'tool.post', A, 'sharzi-tms', { tool: 'Edit', status: 'ok', durationMs: 2500 });
emit(30, 'tool.pre', A, 'sharzi-tms', { tool: 'Bash', toolSummary: 'pnpm test invoice' });
emit(38, 'tool.post', A, 'sharzi-tms', { tool: 'Bash', status: 'error', durationMs: 8000 });
emit(42, 'tool.pre', A, 'sharzi-tms', { tool: 'Edit', toolSummary: 'Fix failing snapshot' });
emit(45, 'tool.post', A, 'sharzi-tms', { tool: 'Edit', status: 'ok', durationMs: 2100 });
emit(48, 'tool.pre', A, 'sharzi-tms', { tool: 'Bash', toolSummary: 'pnpm test invoice' });
emit(56, 'tool.post', A, 'sharzi-tms', { tool: 'Bash', status: 'ok', durationMs: 7600 });
emit(60, 'task.completed', A, 'sharzi-tms', { message: 'Invoice export fixed, tests green' });
emit(64, 'session.end', A, 'sharzi-tms');

// Session B: blex — needs human mid-way.
const B = 'demo-blex';
emit(6, 'session.start', B, 'truck-trailers');
emit(8, 'prompt', B, 'truck-trailers', { message: 'Sync trailer inventory to Supabase' });
emit(11, 'tool.pre', B, 'truck-trailers', { tool: 'mcp__Supabase__execute_sql', toolSummary: 'Count trailers' });
emit(15, 'tool.post', B, 'truck-trailers', { tool: 'mcp__Supabase__execute_sql', status: 'ok', durationMs: 3400 });
emit(20, 'tool.pre', B, 'truck-trailers', { tool: 'Write', toolSummary: 'Write sync script' });
emit(24, 'tool.post', B, 'truck-trailers', { tool: 'Write', status: 'ok', durationMs: 2900 });
emit(30, 'notification', B, 'truck-trailers', { needsHuman: true, message: 'Permission needed: run migration on prod?' });
// Expliciete permissie-poort (poortwachter-animatie) bovenop de notificatie.
emit(44, 'permission.ask', B, 'truck-trailers', { message: 'permissie: Bash (migration)' });
emit(75, 'prompt', B, 'truck-trailers', { message: 'Yes, run it' });
emit(78, 'tool.pre', B, 'truck-trailers', { tool: 'Bash', toolSummary: 'Run migration' });
emit(86, 'tool.post', B, 'truck-trailers', { tool: 'Bash', status: 'ok', durationMs: 7800 });
emit(90, 'stop', B, 'truck-trailers');

// Session C: vovara — long research with two subagents in parallel.
const C = 'demo-vovara';
emit(15, 'session.start', C, 'vovara-site');
emit(17, 'prompt', C, 'vovara-site', { message: 'Redesign the releases page' });
emit(20, 'agent.start', C, 'vovara-site', { agentId: 'c1', agentType: 'Explore', toolSummary: 'Audit components' });
emit(21, 'agent.start', C, 'vovara-site', { agentId: 'c2', agentType: 'Plan', toolSummary: 'Draft layout plan' });
// c2 requested a helper → orchestrator spawned c3 under c2 (parent link).
emit(26, 'agent.start', C, 'vovara-site', { agentId: 'c3', agentType: 'ara-worker', parentAgentId: 'c2', toolSummary: 'Check image pipeline' });
emit(29, 'tool.pre', C, 'vovara-site', { agentId: 'c3', tool: 'Grep', toolSummary: 'grep imageLoader' });
emit(33, 'tool.post', C, 'vovara-site', { agentId: 'c3', tool: 'Grep', status: 'ok', durationMs: 3200 });
emit(42, 'agent.stop', C, 'vovara-site', { agentId: 'c3' });
emit(24, 'tool.pre', C, 'vovara-site', { agentId: 'c1', tool: 'Read', toolSummary: 'Read Releases.tsx' });
emit(28, 'tool.post', C, 'vovara-site', { agentId: 'c1', tool: 'Read', status: 'ok', durationMs: 3600 });
emit(32, 'tool.pre', C, 'vovara-site', { agentId: 'c2', tool: 'WebSearch', toolSummary: 'Music site inspiration' });
emit(40, 'tool.post', C, 'vovara-site', { agentId: 'c2', tool: 'WebSearch', status: 'ok', durationMs: 7800 });
emit(45, 'agent.stop', C, 'vovara-site', { agentId: 'c1' });
emit(50, 'agent.stop', C, 'vovara-site', { agentId: 'c2' });
// Lang onderzoek → context comprimeren (storm), daarna verder op een worktree.
emit(47, 'compact.start', C, 'vovara-site');
emit(52, 'compact.end', C, 'vovara-site');
emit(54, 'worktree.start', C, 'vovara-site', { message: 'worktree releases-redesign' });
emit(55, 'tool.pre', C, 'vovara-site', { tool: 'Edit', toolSummary: 'Apply new grid layout' });
emit(60, 'tool.post', C, 'vovara-site', { tool: 'Edit', status: 'ok', durationMs: 4200 });
// Een geweigerde permissie (rode slagboom) — de sessie werkt gewoon door.
emit(66, 'permission.deny', C, 'vovara-site', { message: 'permissie: WebFetch geweigerd' });
emit(70, 'tool.pre', C, 'vovara-site', { tool: 'Bash', toolSummary: 'pnpm build' });
emit(82, 'tool.post', C, 'vovara-site', { tool: 'Bash', status: 'error', durationMs: 11000 });
emit(86, 'tool.pre', C, 'vovara-site', { tool: 'Edit', toolSummary: 'Fix import path' });
emit(89, 'tool.post', C, 'vovara-site', { tool: 'Edit', status: 'ok', durationMs: 1900 });
emit(92, 'tool.pre', C, 'vovara-site', { tool: 'Bash', toolSummary: 'pnpm build' });
emit(103, 'tool.post', C, 'vovara-site', { tool: 'Bash', status: 'ok', durationMs: 10400 });
emit(105, 'worktree.stop', C, 'vovara-site', { message: 'worktree releases-redesign' });
emit(107, 'task.completed', C, 'vovara-site', { message: 'Releases page shipped' });

// Session D: a mystery repo lands in Nor Kaghak late in the story.
const D = 'demo-mystery';
emit(95, 'session.start', D, 'secret-lab');
emit(97, 'prompt', D, 'secret-lab', { message: 'Prototype something new' });
emit(100, 'tool.pre', D, 'secret-lab', { tool: 'Write', toolSummary: 'Scaffold prototype' });
emit(105, 'tool.post', D, 'secret-lab', { tool: 'Write', status: 'ok', durationMs: 4600 });
emit(112, 'stop', D, 'secret-lab');

events.sort((a, b) => a.ts - b.ts);
fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
fs.writeFileSync(FIXTURE_PATH, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`[fixture] wrote ${events.length} events → ${FIXTURE_PATH}`);
