/**
 * Soak/load test: simulates N parallel Claude Code sessions hammering the
 * collector, while one SSE client counts received frames. Reports POST/state
 * latency and memory. Accelerated stand-in for the "30-min, 3 sessions" QA
 * step; tune with env vars.
 *
 *   ARA_SOAK_SESSIONS=3 ARA_SOAK_SECONDS=60 ARA_SOAK_EPS=10 pnpm soak
 */
export {}; // top-level await needs module context

const BASE = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const SESSIONS = Number(process.env.ARA_SOAK_SESSIONS ?? 3);
const SECONDS = Number(process.env.ARA_SOAK_SECONDS ?? 60);
const EVENTS_PER_SEC = Number(process.env.ARA_SOAK_EPS ?? 10); // per session

const TOOLS = ['Bash', 'Read', 'Edit', 'Grep', 'WebSearch'];
const latencies: number[] = [];
let posted = 0;
let received = 0;
let errors = 0;

async function post(body: unknown): Promise<void> {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) errors += 1;
    latencies.push(performance.now() - start);
    posted += 1;
  } catch {
    errors += 1;
  }
}

async function sseCounter(signal: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/events`, { signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += (decoder.decode(value, { stream: true }).match(/^event: ara$/gm) ?? []).length;
    }
  } catch {
    /* aborted */
  }
}

async function runSession(index: number, until: number): Promise<void> {
  const sessionId = `soak-${process.pid}-${index}`;
  const cwd = `/tmp/soak-project-${index}`;
  await post({ kind: 'session.start', sessionId, cwd });
  let flip = false;
  while (Date.now() < until) {
    const tool = TOOLS[Math.floor(Math.random() * TOOLS.length)]!;
    flip = !flip;
    await post(
      flip
        ? { kind: 'tool.pre', sessionId, cwd, tool, toolSummary: `${tool} soak op` }
        : { kind: 'tool.post', sessionId, cwd, tool, status: Math.random() < 0.05 ? 'error' : 'ok' },
    );
    await new Promise((resolve) => setTimeout(resolve, 1000 / EVENTS_PER_SEC));
  }
  await post({ kind: 'session.end', sessionId, cwd });
}

const health = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.error(`[soak] collector not reachable at ${BASE}`);
  process.exit(1);
}

console.log(`[soak] ${SESSIONS} sessions × ${SECONDS}s × ${EVENTS_PER_SEC} ev/s → ${BASE}`);
const controller = new AbortController();
const ssePromise = sseCounter(controller.signal);
const until = Date.now() + SECONDS * 1000;
await Promise.all(Array.from({ length: SESSIONS }, (_, i) => runSession(i, until)));
await new Promise((resolve) => setTimeout(resolve, 500));
controller.abort();
await ssePromise.catch(() => undefined);

const stateStart = performance.now();
const snapshot = (await (await fetch(`${BASE}/state`)).json()) as {
  counters: Record<string, number>;
};
const stateMs = performance.now() - stateStart;

latencies.sort((a, b) => a - b);
const pct = (p: number): string => (latencies[Math.floor((latencies.length - 1) * p)] ?? 0).toFixed(1);
console.log(`[soak] posted=${posted} sseReceived=${received} errors=${errors}`);
console.log(`[soak] POST latency ms p50=${pct(0.5)} p95=${pct(0.95)} p99=${pct(0.99)}`);
console.log(`[soak] GET /state ${stateMs.toFixed(1)}ms · counters=${JSON.stringify(snapshot.counters)}`);

const p95 = latencies[Math.floor((latencies.length - 1) * 0.95)] ?? 0;
const ok = errors === 0 && p95 < 50 && stateMs < 100 && received >= posted * 0.98;
console.log(ok ? '[soak] PASS' : '[soak] FAIL');
process.exit(ok ? 0 : 1);
