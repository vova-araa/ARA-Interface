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
 * 5. Escalaties, gebruikerstaken én kantoorchat-vragen → spawn de supervisor.
 * 6. needsHuman → Telegram (dedupe op sessie + inhoud).
 * 7. Eén keer per dag een levensteken, zodat stilte zélf het alarm is.
 *
 * Rem op kosten: elke spawn telt mee. Blijft dezelfde situatie na twee
 * pogingen open, dan stopt het spawnen en wordt de mens gevraagd. Is het
 * dagbudget uit org.json bereikt, dan start er niets meer.
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN, ARA_REPO, ARA_LOCK_DIR,
 *      ARA_WATCHDOG_NO_SPAWN=1 (test), ARA_DAILY_PING=0 (levensteken uit).
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

/**
 * Telegram-alarm met dedupe op inhoud: hetzelfde alarm gaat hooguit één keer
 * per `ttlMs` de deur uit. De markering wordt pas gezet ná een geslaagde
 * verzending, zodat een netwerkstoring een melding niet voorgoed opslokt.
 */
/** Korte, stabiele hash van een tekst — voor dedupe op inhoud. */
function shortHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function alertOnce(key, ttlMs, text) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const file = path.join(LOCK_DIR, `ara-alert-${safe}.mark`);
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < ttlMs) return false;
  } catch {
    /* nog nooit gemeld */
  }
  try {
    const { sendTelegram } = await import('./notify.mjs');
    const result = await sendTelegram(text);
    log(`alarm "${safe}": sent=${result.sent} (${result.reason})`);
    if (result.sent) fs.writeFileSync(file, String(Date.now()));
    return result.sent;
  } catch (error) {
    log(`alarm "${safe}" mislukt: ${String(error).slice(0, 80)}`);
    return false;
  }
}

/**
 * Hoe vaak is er voor deze situatie al een agent gestart? Voorkomt dat een
 * blijvend open incident elke 5 minuten opnieuw een sessie (en dus tokens)
 * kost wanneer de gespawnde agent er niet uit komt.
 */
function spawnAttempts(signature, { increment = false } = {}) {
  const safe = String(signature).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const file = path.join(LOCK_DIR, `ara-try-${safe}.count`);
  let count = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Tellers ouder dan 6 uur zijn een nieuwe ronde, geen doorlopende poging.
    if (Date.now() - raw.ts < 6 * 60 * 60 * 1000) count = raw.count;
  } catch {
    /* nog geen pogingen */
  }
  if (increment) {
    count += 1;
    try {
      fs.writeFileSync(file, JSON.stringify({ count, ts: Date.now() }));
    } catch {
      /* leeg */
    }
  }
  return count;
}

/** Dagbudget uit org.json versus het verbruik van vandaag (0 tokens kosten). */
async function budgetExceeded() {
  try {
    const { usage, budget } = await api('/usage');
    const used = usage.reduce(
      (sum, row) => sum + row.inputTokens + row.outputTokens + row.cacheCreateTokens,
      0,
    );
    if (budget > 0 && used >= budget) {
      log(`dagbudget bereikt (${used}/${budget}) — geen nieuwe agents deze tick`);
      await alertOnce(
        `budget-${new Date().toISOString().slice(0, 10)}`,
        12 * 60 * 60 * 1000,
        `🟠 ARA World — dagbudget bereikt\n${used.toLocaleString('nl-NL')} van ${budget.toLocaleString('nl-NL')} tokens gebruikt. Er worden vandaag geen nieuwe agents meer gestart.`,
      );
      return true;
    }
  } catch (error) {
    // Budget onbekend = niet blokkeren; anders valt de org stil door een
    // kapot endpoint in plaats van door echt verbruik.
    log(`budgetcheck overgeslagen: ${String(error).slice(0, 80)}`);
  }
  return false;
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

function spawnClaude(name, prompt, { agent, tools } = {}) {
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
  // Logrotatie: zonder dit groeit het logbestand maandenlang door.
  const logPath = path.join(LOCK_DIR, `ara-${name}.log`);
  try {
    if (fs.statSync(logPath).size > 5 * 1024 * 1024) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
    /* nog geen log */
  }
  const logFile = fs.openSync(logPath, 'a');
  // --agent laadt de échte rolinstructies (voorheen stond alleen in de prompt
  // "volg je instructies" — die werden nooit geladen). --allowedTools geeft de
  // agent de gereedschappen die hij nodig heeft; acceptEdits dekt alléén edits,
  // dus zonder deze lijst kon een headless agent geen enkel commando draaien.
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits'];
  if (agent) args.push('--agent', agent);
  if (tools) args.push('--allowedTools', tools);
  const child = spawn('claude', args, {
    cwd: REPO,
    detached: true,
    stdio: ['ignore', logFile, logFile],
  });
  // Een sessie die meteen omvalt (niet ingelogd, limiet, onbekende agent) mag
  // niet stil blijven: dat is precies het geval waarin niemand iets merkt.
  const startedAt = Date.now();
  child.on('exit', (code) => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    if (code !== 0 && secs < 30) {
      log(`${name} viel direct om (exit ${code} na ${secs}s) — zie ${logPath}`);
      void alertOnce(
        `spawn-fail-${name}`,
        6 * 60 * 60 * 1000,
        `🔴 ARA World — agent start niet\n"${name}" stopte na ${secs}s met code ${code}.\nLog: ${logPath}`,
      );
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* leeg */
    }
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
    // Dit is de enige storing waarbij álle andere meldwegen óók stuk zijn:
    // incidenten, escalaties en needsHuman lopen allemaal via de collector.
    // Zonder dit alarm is een dode collector maandenlang volledig stil.
    await alertOnce(
      'collector-down',
      60 * 60 * 1000,
      `🔴 ARA World — collector ligt eruit\nHerstart via launchctl én pnpm is mislukt. De wereld, het bord en alle meldingen liggen stil tot dit is opgelost.\nCheck: ${COLLECTOR}/health`,
    );
    process.exit(0); // volgende tick verder
  }
}
// Hersteld na een storing? Dan mag het alarm opnieuw afgaan bij een nieuwe.
try {
  fs.unlinkSync(path.join(LOCK_DIR, 'ara-alert-collector-down.mark'));
} catch {
  /* stond niet aan */
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
const OPS_TOOLS = 'Bash,Read,Write,Edit,Grep,Glob';
if (incidentsToHandle.length > 0) {
  // Signatuur van dít incidentbeeld: blijft het na twee pogingen hetzelfde,
  // dan komt de agent er niet uit en is doorspawnen alleen tokens verbranden.
  const signature = `ops-${incidentsToHandle.map((t) => t.id).sort().join('-')}`;
  const tries = spawnAttempts(signature);
  if (tries >= 2) {
    log(`ops-manager kwam er ${tries}× niet uit — niet opnieuw spawnen, mens vragen`);
    await alertOnce(
      signature,
      6 * 60 * 60 * 1000,
      `🔴 ARA World — ops komt er niet uit\n${incidentsToHandle.length} incident(en) blijven open na ${tries} pogingen:\n${incidentsToHandle.map((t) => `• ${t.title}`).join('\n')}\n\nHier is een mens nodig.`,
    );
  } else if (!(await budgetExceeded())) {
    spawnAttempts(signature, { increment: true });
    spawnClaude(
      'ops-manager',
      `Je bent manager:ops van de ARA-organisatie. Er staan ${incidentsToHandle.length} open incident-taken op het bord (GET ${COLLECTOR}/tasks?assignee=manager:ops&status=open). Claim ze, diagnosticeer en herstel. Operationele fixes (restart, config terugzetten) mag je direct; codefixes op een ara/*-branch. Kom je er niet uit: maak een bord-taak voor 'supervisor' met result-prefix ESCALATE:. Sluit ALTIJD elke taak af met een resultaat.`,
      { agent: 'ara-ops-manager', tools: OPS_TOOLS },
    );
  }
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
let chatTasks = [];
try {
  const escalated = await api('/tasks?assignee=supervisor&status=open&limit=50');
  opsEscalations = escalated.tasks.filter((t) => t.createdBy === 'manager:ops');
  userTasks = escalated.tasks.filter((t) => t.createdBy === 'user' || t.createdBy === 'chief');
  // Vragen uit een kantoorchat staan bij de aangesproken rol (manager:blex,
  // een agent-id, …) — niet bij de supervisor. Die werden daardoor nooit
  // opgepakt: je praatte tegen een muur. Ze horen hier óók opgehaald te worden.
  const all = await api('/tasks?status=open&limit=100');
  chatTasks = all.tasks.filter((t) => t.createdBy === 'user' && t.title.startsWith('CHAT:'));
} catch (error) {
  log(`supervisor-stap overgeslagen: ${String(error).slice(0, 80)}`);
}
if (opsEscalations.length > 0 || userTasks.length > 0 || chatTasks.length > 0) {
  const parts = [];
  if (opsEscalations.length > 0)
    parts.push(
      `manager:ops escaleerde ${opsEscalations.length} incident(en): volg je incident-feedbackprotocol (feedback + 1 herkansing via het bord; daarna pas needsHuman naar de mens via POST ${COLLECTOR}/event, kind "notification", needsHuman true, sessionId "ops-escalatie").`,
    );
  if (userTasks.length > 0)
    parts.push(
      `er staan ${userTasks.length} ta(a)k(en) van de gebruiker/chief op het bord (createdBy "user" of "chief", incl. gepromoveerde geplande taken): claim ze en voer je normale dispatch uit (managers/agents); sluit elke taak af met een resultaat.`,
    );
  if (chatTasks.length > 0)
    parts.push(
      `er staan ${chatTasks.length} vraag/vragen uit een kantoorchat op het bord (titel begint met "CHAT:", elk bij de aangesproken rol als assignee). Lees per taak het detail: daar staan de ruimte (room) en het antwoord-commando. Beantwoord ze zelf of zet ze door naar de juiste manager, POST het antwoord in dezelfde ruimte en sluit de taak af. De gebruiker zit te wachten in dat kantoor.`,
    );
  const signature = `supervisor-${[...opsEscalations, ...userTasks, ...chatTasks].map((t) => t.id).sort().join('-')}`;
  const tries = spawnAttempts(signature);
  if (tries >= 2) {
    log(`supervisor kwam er ${tries}× niet uit — niet opnieuw spawnen`);
    await alertOnce(
      signature,
      6 * 60 * 60 * 1000,
      `🟠 ARA World — supervisor komt er niet uit\n${opsEscalations.length + userTasks.length + chatTasks.length} taak/taken blijven open na ${tries} pogingen. Kijk even mee op het bord.`,
    );
  } else if (!(await budgetExceeded())) {
    spawnAttempts(signature, { increment: true });
    spawnClaude(
      'supervisor-ops',
      `Je bent ara-supervisor. Op het bord (GET ${COLLECTOR}/tasks?status=open): ${parts.join(' Daarnaast: ')}`,
      { agent: 'ara-supervisor', tools: 'Bash,Read,Write,Edit,Grep,Glob,Task' },
    );
  }
}

// ── 6. needsHuman → Telegram-push (eenmalig per sessie, 0 tokens) ─────────
try {
  const { sendTelegram } = await import('./notify.mjs');
  const state = await api('/state');
  const needy = Object.values(state.sessions).filter((s) => s.needsHuman && !s.endedAt);
  for (const session of needy) {
    // Dedupe op sessie ÉN inhoud. Alleen op sessionId was fout: de supervisor
    // escaleert altijd onder dezelfde pseudo-sessie ("ops-escalatie"), dus
    // kwam alleen de eerste melding ooit aan en verdween de rest geruisloos.
    const message = session.message ?? 'sessie wacht op jou';
    await alertOnce(
      `needs-${session.sessionId}-${shortHash(message)}`,
      24 * 60 * 60 * 1000,
      `🔴 ARA World — actie nodig\n${session.project}: ${message}\nViewer: http://localhost:4747`,
    );
  }
  // Oude meld-markers en agent-logs opruimen (anders groeit LOCK_DIR eindeloos).
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOCK_DIR)) {
      if (!/^ara-(tg-.*\.lock|alert-.*\.mark|try-.*\.count|.*\.log(\.1)?)$/.test(f)) continue;
      const full = path.join(LOCK_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* opruimen is best-effort */
  }
} catch (error) {
  log(`telegram-stap overgeslagen: ${String(error).slice(0, 80)}`);
}

// ── 7. Dagelijks levensteken ──────────────────────────────────────────────
// Eén bericht per dag dat zegt dat alles draait. Daarmee is uitblijvende post
// zélf het signaal: geen bericht = de watchdog of de Mac ligt eruit.
if (process.env.ARA_DAILY_PING !== '0') {
  const hour = new Date().getHours();
  if (hour >= 8 && hour < 9) {
    try {
      const state = await api('/state');
      const running = Object.values(state.sessions).filter(
        (s) => !s.endedAt && s.status === 'working',
      ).length;
      const { usage, budget } = await api('/usage').catch(() => ({ usage: [], budget: 0 }));
      const used = usage.reduce(
        (sum, row) => sum + row.inputTokens + row.outputTokens + row.cacheCreateTokens,
        0,
      );
      await alertOnce(
        `heartbeat-${new Date().toISOString().slice(0, 10)}`,
        20 * 60 * 60 * 1000,
        `🟢 ARA World draait\n${running} sessie(s) aan het werk · ${incidentsToHandle.length} open incident(en) · ${failures} monitor(s) stuk\nTokens vandaag: ${used.toLocaleString('nl-NL')}${budget ? ` van ${budget.toLocaleString('nl-NL')}` : ''}`,
      );
    } catch (error) {
      log(`levensteken overgeslagen: ${String(error).slice(0, 80)}`);
    }
  }
}

log(`klaar — ${failures} monitor(s) stuk, ${incidentsToHandle.length} open incident(en), ${opsEscalations.length} escalatie(s), ${userTasks.length} gebruikerstaak(en), ${chatTasks.length} chatvraag/vragen`);
