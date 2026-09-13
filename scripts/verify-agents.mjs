#!/usr/bin/env node
/**
 * ARA Agent-verificatie — bewijst de hele keten in één run.
 *
 * De watchdog spawnt agents met `claude -p --agent …`. Tot nu toe was nooit
 * bewezen dat zo'n headless sessie écht start, écht een commando draait en
 * écht terugmeldt op het bord: de watchdog zag alleen "proces gestart".
 * Dit script maakt dat hard.
 *
 *   1. taak op het bord voor de worker
 *   2. headless `claude -p --agent ara-worker` starten
 *   3. de agent moet een commando draaien en de taak zelf sluiten
 *   4. wij pollen het bord en zeggen PASS of FAIL — met wat er misging
 *
 * Kost één korte agent-sessie aan tokens. Draai 'm na installatie en na elke
 * Claude Code-update; dit is het enige stuk dat niet zonder LLM te testen is.
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN, ARA_VERIFY_MODEL (default haiku),
 *      ARA_VERIFY_TIMEOUT_SEC (default 180).
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLLECTOR = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const MODEL = process.env.ARA_VERIFY_MODEL ?? 'haiku';
const TIMEOUT_SEC = Number(process.env.ARA_VERIFY_TIMEOUT_SEC ?? 180);
// Een verse waarde per run: de agent kan 'm onmogelijk uit een oude taak of
// uit zijn eigen geheugen halen, alleen door het commando echt te draaien.
const NONCE = `ara-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;

const step = (msg) => console.log(`▸ ${msg}`);
const fail = (msg, detail) => {
  console.log(`\n✗ FAIL — ${msg}`);
  if (detail) console.log(detail);
  process.exit(1);
};

async function api(pathname, options = {}) {
  const res = await fetch(`${COLLECTOR}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status}`);
  return res.json();
}

// ── 1. Bord bereikbaar? ───────────────────────────────────────────────────
try {
  await api('/health');
} catch (error) {
  fail(`collector niet bereikbaar op ${COLLECTOR}`, String(error));
}
step(`collector bereikbaar: ${COLLECTOR}`);

// ── 2. Taak aanmaken ──────────────────────────────────────────────────────
const { task } = await api('/tasks', {
  method: 'POST',
  body: JSON.stringify({
    title: `VERIFY: keten-check ${NONCE}`,
    assignee: 'worker:verify',
    createdBy: 'verify-agents',
    body: 'Automatische end-to-end verificatie van de spawn-keten.',
  }),
});
step(`taak aangemaakt: ${task.id}`);

// ── 3. Headless agent starten ─────────────────────────────────────────────
// --plugin-dir laadt de plugin voor déze sessie, zodat --agent werkt ook als
// de gebruiker de marketplace-installatie nog niet gedaan heeft.
const prompt = [
  `Dit is een verificatie-run. Doe precies dit, niets meer:`,
  `1. Draai met Bash: echo "${NONCE}" | md5sum | cut -c1-12`,
  `2. Sluit taak ${task.id} met de uitvoer van stap 1 als resultaat:`,
  `   curl -sS -X PATCH ${COLLECTOR}/tasks/${task.id} \\`,
  `     -H 'Content-Type: application/json' \\`,
  process.env.ARA_TOKEN ? `     -H 'X-ARA-Token: ${process.env.ARA_TOKEN}' \\` : null,
  `     -d '{"status":"done","result":"<de 12 tekens uit stap 1>"}'`,
  `3. Antwoord met één regel: KLAAR <die 12 tekens>`,
]
  .filter(Boolean)
  .join('\n');

step(`agent starten (model ${MODEL}, max ${TIMEOUT_SEC}s)…`);
const child = spawn(
  'claude',
  [
    '-p',
    prompt,
    '--agent',
    'ara-worker',
    '--plugin-dir',
    path.join(REPO, 'plugins/ara'),
    '--allowedTools',
    'Bash',
    '--permission-mode',
    'acceptEdits',
    '--model',
    MODEL,
  ],
  { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
);

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));

const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_SEC * 1000);
const code = await new Promise((resolve) => child.on('exit', resolve));
clearTimeout(timer);

if (code !== 0) {
  fail(`agent-sessie stopte met code ${code}`, `${stdout}\n${stderr}`.trim().slice(0, 1500));
}
step(`agent klaar (exit 0)`);

// ── 4. Heeft hij het commando echt gedraaid? ──────────────────────────────
const { createHash } = await import('node:crypto');
// md5sum leest de regel inclusief newline — net als `echo` die schrijft.
const expected = createHash('md5').update(`${NONCE}\n`).digest('hex').slice(0, 12);

const final = await api(`/tasks/${task.id}`).then((r) => r.task);
const checks = [
  ['agent heeft de taak gesloten', final.status === 'done'],
  ['resultaat staat op het bord', Boolean(final.result)],
  ['resultaat bevat de echte commando-uitvoer', String(final.result ?? '').includes(expected)],
  ['antwoord bevat de echte commando-uitvoer', stdout.includes(expected)],
];

console.log('');
for (const [label, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

if (!checks.every(([, ok]) => ok)) {
  fail('de keten is niet compleet', [
    `verwacht: ${expected}`,
    `bord-status: ${final.status}`,
    `bord-resultaat: ${final.result ?? '(leeg)'}`,
    `agent-antwoord: ${stdout.trim().slice(0, 400)}`,
  ].join('\n'));
}

console.log(`\n✔ deel 1 — de spawn-keten werkt: agent gestart, commando gedraaid, bord bijgewerkt.`);

// ══ Deel 2: kantoorchat ═══════════════════════════════════════════════════
// De gebruiker stelt een vraag in een kantoor. Dat moet een bordtaak worden,
// een agent moet die oppakken, en het antwoord moet terugkomen in dezelfde
// ruimte. Tot nu toe was alleen bewezen dat de vraag wéggaat.
if (process.env.ARA_VERIFY_SKIP_CHAT === '1') {
  console.log('\n(kantoorchat-check overgeslagen: ARA_VERIFY_SKIP_CHAT=1)');
  console.log('\n✔ PASS');
  process.exit(0);
}

console.log('');
const ROOM = `office:verify-${NONCE}`;
const QUESTION = `Verificatie ${NONCE}: hoeveel bestanden staan er in de map scripts/? Antwoord met het getal.`;

const posted = await api('/chat', {
  method: 'POST',
  body: JSON.stringify({ room: ROOM, role: 'user', to: 'manager:verify', text: QUESTION }),
});
if (!posted.taskId) fail('een vraag van de gebruiker werd geen bordtaak', JSON.stringify(posted));
step(`vraag gesteld in ${ROOM} → bordtaak ${posted.taskId}`);

const chatTask = await api(`/tasks/${posted.taskId}`).then((r) => r.task);
if (!chatTask.detail.includes('curl') || !chatTask.detail.includes(ROOM)) {
  fail('de bordtaak bevat geen uitvoerbaar antwoord-commando', chatTask.detail);
}
step('bordtaak bevat een plakbaar antwoord-commando');

// De watchdog geeft de supervisor precies deze opdracht; hier draaien we 'm
// rechtstreeks zodat de check niet 5 minuten op een launchd-tik hoeft te wachten.
step(`agent starten voor de chatvraag (max ${TIMEOUT_SEC}s)…`);
const chatChild = spawn(
  'claude',
  [
    '-p',
    `Op het bord staat taak ${posted.taskId} (GET ${COLLECTOR}/tasks/${posted.taskId}). Lees het detail en voer de twee stappen daarin uit: beantwoord de vraag in de kantoorchat en sluit daarna de taak.`,
    '--agent',
    'ara-manager',
    '--plugin-dir',
    path.join(REPO, 'plugins/ara'),
    '--allowedTools',
    'Bash,Read,Glob',
    '--permission-mode',
    'acceptEdits',
    '--model',
    MODEL,
  ],
  { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
);
let chatOut = '';
let chatErr = '';
chatChild.stdout.on('data', (d) => (chatOut += d));
chatChild.stderr.on('data', (d) => (chatErr += d));
const chatTimer = setTimeout(() => chatChild.kill('SIGKILL'), TIMEOUT_SEC * 1000);
const chatCode = await new Promise((resolve) => chatChild.on('exit', resolve));
clearTimeout(chatTimer);
if (chatCode !== 0) {
  fail(`chat-agent stopte met code ${chatCode}`, `${chatOut}\n${chatErr}`.trim().slice(0, 1500));
}

const { messages } = await api(`/chat?room=${encodeURIComponent(ROOM)}`);
const reply = messages.find((m) => m.role !== 'user');
const closed = await api(`/tasks/${posted.taskId}`).then((r) => r.task);

const chatChecks = [
  ['er staat een antwoord in de kantoorruimte', Boolean(reply)],
  ['het antwoord komt niet van de gebruiker zelf', reply?.role !== 'user'],
  ['het antwoord heeft inhoud', (reply?.text ?? '').trim().length > 0],
  ['de chatvraag is afgesloten op het bord', closed.status === 'done'],
];
for (const [label, ok] of chatChecks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

if (!chatChecks.every(([, ok]) => ok)) {
  fail('de kantoorchat komt niet rond', [
    `berichten in ${ROOM}: ${messages.length}`,
    `taakstatus: ${closed.status}`,
    `agent-antwoord: ${chatOut.trim().slice(0, 400)}`,
  ].join('\n'));
}

console.log(`\n  antwoord van ${reply.sender}: ${reply.text.slice(0, 120)}`);
console.log(`\n✔ PASS — spawn-keten én kantoorchat werken end-to-end.`);
