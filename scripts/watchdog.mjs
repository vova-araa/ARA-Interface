#!/usr/bin/env node
/**
 * ARA Watchdog — de 24/7 nul-token bewaker. Draait elke 5 min via launchd.
 *
 * 1. Collector zelf down → launchctl kickstart → pnpm-fallback.
 * 2. Checkt alle enabled monitors (monitors.json). Faalt er één:
 *    - critical met launchdService → eerst zelf restarten en herchecken (0 tokens);
 *    - nog steeds stuk → incident-taak op het bord voor manager:ops (dedupe op titel).
 * 3. Herstelde monitor → nog-onggeclaimde incident-taak auto-sluiten.
 * 4. Open incidenten voor manager:ops → spawn de ops-manager (headless claude,
 *    max 1 tegelijk via lockfile). LLM-tokens alléén bij echte problemen.
 * 5. Escalaties (taken voor supervisor, aangemaakt door manager:ops) → spawn
 *    de supervisor voor één feedback-ronde (eigen lock).
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN, ARA_REPO, ARA_WATCHDOG_NO_SPAWN=1 (test).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.ARA_REPO ?? path.resolve(__dirname, '..');
const COLLECTOR = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const NO_SPAWN = process.env.ARA_WATCHDOG_NO_SPAWN === '1';
const LOCK_DIR = process.env.ARA_LOCK_DIR ?? os.tmpdir();
const LOCK_TTL_MS = 30 * 60 * 1000;

const log = (msg) => console.log(`[watchdog ${new Date().toISOString()}] ${msg}`);

const headers = { 'Content-Type': 'application/json' };
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;

async function api(pathname, options = {}) {
  const res = await fetch(`${COLLECTOR}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status}`);
  return res.json();
}

function kickstart(service) {
  try {
    execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${service}`], {
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomair spawn-lock ('wx' — geen check-then-write race). Het lockbestand
 * bevat de pid van de gespawnde agent: leeft die nog, dan blijft de lock
 * geldig (ook > TTL, geen tweede instantie naast een lange run); is de pid
 * dood of de TTL verstreken, dan is de lock vrij (een korte run blokkeert
 * dus geen nieuwe incidenten meer).
 */
function acquireSpawnLock(name) {
  const file = path.join(LOCK_DIR, `${name}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.closeSync(fd);
      return file;
    } catch {
      let stale = true;
      try {
        const pid = Number(fs.readFileSync(file, 'utf8').trim());
        const age = Date.now() - fs.statSync(file).mtimeMs;
        stale = pidAlive(pid) ? false : age >= LOCK_TTL_MS || pid > 0;
      } catch {
        /* onleesbaar → als verlopen behandelen */
      }
      if (!stale) return null;
      try {
        fs.unlinkSync(file);
      } catch {
        /* iemand anders was ons voor */
      }
    }
  }
  return null;
}

function spawnClaude(name, prompt) {
  if (NO_SPAWN) {
    log(`SPAWN onderdrukt (test): ${name}`);
    return;
  }
  try {
    execFileSync('sh', ['-c', 'command -v claude'], { timeout: 5000 });
  } catch {
    log(`claude CLI niet gevonden — kan ${name} niet spawnen`);
    return;
  }
  const lockFile = acquireSpawnLock(`ara-${name}`);
  if (!lockFile) {
    log(`${name} draait al (lock) — geen nieuwe spawn`);
    return;
  }
  const logFile = fs.openSync(path.join(LOCK_DIR, `ara-${name}.log`), 'a');
  const child = spawn('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], {
    cwd: REPO,
    detached: true,
    stdio: ['ignore', logFile, logFile],
  });
  // Spawn-fouten (EACCES, verdwenen binary) komen asynchroon: zonder listener
  // crasht de watchdog en blijft de lock hangen.
  child.on('error', (error) => {
    log(`spawn ${name} mislukt: ${String(error).slice(0, 120)}`);
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* leeg */
    }
  });
  child.unref();
  try {
    fs.writeFileSync(lockFile, String(child.pid ?? 0));
  } catch {
    /* leeg */
  }
  log(`gespawnd: ${name} (pid ${child.pid})`);
}

async function checkMonitor(monitor) {
  try {
    const res = await fetch(monitor.url, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (res.status >= 400) return `HTTP ${res.status}`;
    if (monitor.bodyContains) {
      const text = await res.text();
      if (!text.includes(monitor.bodyContains)) return `verwachte tekst ontbreekt`;
    }
    return null;
  } catch (error) {
    return String(error?.cause?.code ?? error?.name ?? error).slice(0, 120);
  }
}

// ── 1. Collector zelf ─────────────────────────────────────────────────────
let collectorUp = await checkMonitor({ url: `${COLLECTOR}/health` }).then((e) => e === null);
if (!collectorUp) {
  log('collector down — kickstart');
  kickstart('com.ara.collector');
  await new Promise((r) => setTimeout(r, 3000));
  collectorUp = await checkMonitor({ url: `${COLLECTOR}/health` }).then((e) => e === null);
  if (!collectorUp) {
    log('collector blijft down — pnpm fallback');
    try {
      const child = spawn('sh', ['-c', `cd "${REPO}" && pnpm --filter @ara/collector start`], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch {
      /* leeg */
    }
    process.exit(0); // volgende tick verder
  }
}

// ── 2+3. Monitors ─────────────────────────────────────────────────────────
let monitors = { checks: [] };
try {
  monitors = JSON.parse(fs.readFileSync(path.join(REPO, 'plugins', 'ara', 'monitors.json'), 'utf8'));
} catch {
  log('monitors.json onleesbaar — alleen zelfbewaking actief');
}

// Per status opvragen: één gemengde limit-200 lijst liet oude open incidenten
// uit het venster vallen zodra afgeronde taken zich opstapelden (dubbele
// incidenten elke tick).
const openIncidents = new Map();
try {
  for (const status of ['open', 'claimed']) {
    const board = await api(`/tasks?assignee=manager:ops&status=${status}&limit=200`);
    for (const t of board.tasks) {
      if (t.title.startsWith('INCIDENT: ')) openIncidents.set(t.title, t);
    }
  }
} catch (error) {
  log(`bord onbereikbaar (${String(error).slice(0, 80)}) — incident-dedupe deze tick beperkt`);
}

let failures = 0;
for (const monitor of monitors.checks ?? []) {
  if (!monitor.enabled) continue;
  let error = await checkMonitor(monitor);
  if (error && monitor.critical && monitor.launchdService) {
    log(`${monitor.name} stuk (${error}) — zelf herstarten`);
    kickstart(monitor.launchdService);
    await new Promise((r) => setTimeout(r, 3000));
    error = await checkMonitor(monitor);
  }
  const title = `INCIDENT: ${monitor.name}`;
  const existing = openIncidents.get(title);
  try {
    if (error) {
      failures += 1;
      if (existing) {
        log(`${monitor.name} nog steeds stuk (${error}) — incident bestaat al (${existing.id})`);
      } else {
        const created = await api('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title,
            detail: `URL: ${monitor.url}\nFout: ${error}\nGedetecteerd: ${new Date().toISOString()}\nEerste actie watchdog: ${monitor.critical ? 'restart geprobeerd, hielp niet' : 'geen (niet-critical)'}`,
            project: monitor.name,
            assignee: 'manager:ops',
            createdBy: 'watchdog',
          }),
        });
        log(`${monitor.name} STUK (${error}) → incident ${created.task.id}`);
      }
    } else if (existing && existing.status === 'open') {
      // Hersteld voordat iemand het claimde → zelf sluiten (0 tokens).
      await api(`/tasks/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done', result: 'Vanzelf hersteld — watchdog-check weer groen.' }),
      });
      log(`${monitor.name} hersteld — incident ${existing.id} gesloten`);
    }
  } catch (apiError) {
    // Bord-API stuk mag de overige monitors + secties niet blokkeren.
    log(`bord-actie voor ${monitor.name} mislukt: ${String(apiError).slice(0, 80)}`);
  }
}

// ── 4. Ops-manager spawnen bij open incidenten ────────────────────────────
let incidentsToHandle = [];
try {
  const stillOpen = await api('/tasks?assignee=manager:ops&status=open&limit=50');
  incidentsToHandle = stillOpen.tasks.filter((t) => t.title.startsWith('INCIDENT: '));
} catch (error) {
  log(`ops-stap overgeslagen: ${String(error).slice(0, 80)}`);
}
if (incidentsToHandle.length > 0) {
  spawnClaude(
    'ops-manager',
    `Je bent manager:ops van de ARA-organisatie. Volg strikt je ara-ops-manager agent-instructies (ara plugin). Er staan ${incidentsToHandle.length} open incident-taken op het bord (GET ${COLLECTOR}/tasks?assignee=manager:ops&status=open). Claim ze, diagnosticeer en herstel. Operationele fixes (restart, config terugzetten) mag je direct; codefixes op een ara/*-branch. Kom je er niet uit: maak een bord-taak voor 'supervisor' met result-prefix ESCALATE:. Sluit ALTIJD elke taak af met een resultaat.`,
  );
}

// ── 4b. Geplande taken promoveren zodra hun due-datum verstreken is ───────
try {
  const planned = await api('/tasks?assignee=gepland&status=open&limit=100');
  for (const task of planned.tasks) {
    const due = /^due:\s*(\S+)/m.exec(task.detail ?? '')?.[1];
    if (!due) continue;
    const dueTs = Date.parse(due);
    if (Number.isFinite(dueTs) && dueTs <= Date.now()) {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignee: 'supervisor', status: 'open' }),
      });
      log(`gepland → supervisor: "${task.title}" (due ${due})`);
    }
  }
} catch (error) {
  log(`planning-stap overgeslagen: ${String(error).slice(0, 80)}`);
}

// ── 5. Escalaties + gebruikers-/chief-taken → supervisor ──────────────────
let opsEscalations = [];
let userTasks = [];
try {
  const escalated = await api('/tasks?assignee=supervisor&status=open&limit=50');
  opsEscalations = escalated.tasks.filter((t) => t.createdBy === 'manager:ops');
  userTasks = escalated.tasks.filter((t) => t.createdBy === 'user' || t.createdBy === 'chief');
} catch (error) {
  log(`supervisor-stap overgeslagen: ${String(error).slice(0, 80)}`);
}
if (opsEscalations.length > 0 || userTasks.length > 0) {
  const parts = [];
  if (opsEscalations.length > 0)
    parts.push(
      `manager:ops escaleerde ${opsEscalations.length} incident(en): volg je incident-feedbackprotocol (feedback + 1 herkansing via het bord; daarna pas needsHuman naar de mens via POST ${COLLECTOR}/event, kind "notification", needsHuman true, sessionId "ops-escalatie").`,
    );
  if (userTasks.length > 0)
    parts.push(
      `er staan ${userTasks.length} ta(a)k(en) van de gebruiker/chief op het bord (createdBy "user" of "chief", incl. gepromoveerde geplande taken): claim ze en voer je normale dispatch uit (managers/agents); sluit elke taak af met een resultaat.`,
    );
  spawnClaude(
    'supervisor-ops',
    `Je bent ara-supervisor. Op het bord (GET ${COLLECTOR}/tasks?assignee=supervisor&status=open): ${parts.join(' Daarnaast: ')}`,
  );
}

// ── 6. needsHuman → Telegram-push (eenmalig per sessie, 0 tokens) ─────────
try {
  const { sendTelegram } = await import('./notify.mjs');
  const state = await api('/state');
  const needy = Object.values(state.sessions).filter((s) => s.needsHuman && !s.endedAt);
  for (const session of needy) {
    // Eenmalig per sessie: markeer pas NA een geslaagde verzending, anders
    // onderdrukt een mislukte poging (netwerk down) de melding voorgoed.
    const markFile = path.join(
      LOCK_DIR,
      `ara-tg-${session.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.lock`,
    );
    if (fs.existsSync(markFile)) continue; // al gemeld
    const result = await sendTelegram(
      `🔴 ARA World — actie nodig\n${session.project}: ${session.message ?? 'sessie wacht op jou'}\nViewer: http://localhost:4747`,
    );
    log(`telegram needsHuman ${session.sessionId}: sent=${result.sent} (${result.reason})`);
    if (result.sent) {
      try {
        fs.writeFileSync(markFile, String(Date.now()));
      } catch {
        /* leeg */
      }
    }
  }
  // Oude meld-markers en agent-logs opruimen (anders groeit LOCK_DIR eindeloos).
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOCK_DIR)) {
      if (!/^ara-(tg-.*\.lock|.*\.log)$/.test(f)) continue;
      const full = path.join(LOCK_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* opruimen is best-effort */
  }
} catch (error) {
  log(`telegram-stap overgeslagen: ${String(error).slice(0, 80)}`);
}

log(`klaar — ${failures} monitor(s) stuk, ${incidentsToHandle.length} open incident(en), ${opsEscalations.length} escalatie(s), ${userTasks.length} gebruikerstaak(en)`);
