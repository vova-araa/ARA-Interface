#!/usr/bin/env node
/**
 * ARA statusline: leest de live statusline-JSON van Claude Code (stdin),
 * print een compacte terminalregel én stuurt een subset door naar de
 * collector (fire-and-forget) → live token-buizen/kosten in de wereld.
 *
 * Activeren in ~/.claude/settings.json:
 *   "statusLine": { "type": "command",
 *     "command": "node <repo>/plugins/ara/hooks/statusline.mjs",
 *     "refreshInterval": 5 }
 */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let s = {};
try {
  s = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  process.exit(0);
}

const ctx = s.context_window ?? {};
const cost = s.cost ?? {};
const cache = s.prompt_cache ?? {};
const pct = Math.round(ctx.used_percentage ?? 0);
const usd = (cost.total_cost_usd ?? 0).toFixed(2);
const model = s.model?.display_name ?? s.model?.id ?? '?';

// Terminalregel (dit is wat Claude Code toont).
process.stdout.write(`${model} · ctx ${pct}% · $${usd}`);

// Doorsturen naar de collector — mag nooit de statusline vertragen.
const collector = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;
fetch(`${collector}/status`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    sessionId: s.session_id ?? '',
    cwd: s.cwd ?? s.workspace?.current_dir ?? '',
    model: s.model?.id ?? '',
    contextPct: ctx.used_percentage ?? 0,
    inputTokens: ctx.total_input_tokens ?? 0,
    outputTokens: ctx.total_output_tokens ?? 0,
    costUsd: cost.total_cost_usd ?? 0,
    linesAdded: cost.total_lines_added ?? 0,
    linesRemoved: cost.total_lines_removed ?? 0,
    cacheHitRatio: cache.hit_ratio ?? null,
    cacheWarm: cache.warm ?? null,
  }),
  signal: AbortSignal.timeout(1500),
}).catch(() => {});
