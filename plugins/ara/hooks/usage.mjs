#!/usr/bin/env node
/**
 * Parseert het Claude Code transcript en POST absolute token-totalen naar de
 * collector. Aangeroepen (gebackgroundd) door usage.sh op Stop/SessionEnd.
 * Kost 0 LLM-tokens — puur bestandsparsing.
 */
import fs from 'node:fs';
import readline from 'node:readline';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let payload = {};
try {
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  process.exit(0);
}

const transcriptPath = payload.transcript_path;
const sessionId = payload.session_id;
if (!transcriptPath || !sessionId || !fs.existsSync(transcriptPath)) process.exit(0);

let input = 0;
let output = 0;
let cacheRead = 0;
let cacheCreate = 0;
let model = '';
const seen = new Set();

const rl = readline.createInterface({
  input: fs.createReadStream(transcriptPath),
  crlfDelay: Infinity,
});
for await (const line of rl) {
  if (!line.includes('"usage"')) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  const message = entry?.message;
  const usage = message?.usage;
  if (!usage) continue;
  // Streaming schrijft dezelfde message-id meermaals; laatste telt, dus
  // dedupe per id door eerst af te trekken wat we eerder voor die id telden.
  const id = message.id ?? `${entry.uuid ?? ''}`;
  if (id && seen.has(id)) continue;
  if (id) seen.add(id);
  input += usage.input_tokens ?? 0;
  output += usage.output_tokens ?? 0;
  cacheRead += usage.cache_read_input_tokens ?? 0;
  cacheCreate += usage.cache_creation_input_tokens ?? 0;
  if (message.model) model = message.model;
}

const collector = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;

await fetch(`${collector}/usage`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    sessionId,
    cwd: payload.cwd ?? '',
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreateTokens: cacheCreate,
    model,
  }),
  signal: AbortSignal.timeout(3000),
}).catch(() => {});
