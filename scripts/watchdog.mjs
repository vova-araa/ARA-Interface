#!/usr/bin/env node
/**
 * ARA Watchdog — de 24/7 nul-token bewaker. Draait elke 5 min via launchd.
 *
 * 1. Collector zelf down → launchctl kickstart → pnpm-fallback.
 * 1d. Handel: noodstop, modus boven papier, onbruikbare of stil gewijzigde
 *     limieten, en voorstellen die te lang op akkoord wachten.
 * 2. Checkt alle enabled monitors (monitors.json). Faalt er één:
 *    - critical met launchdService → eerst zelf restarten en herchecken (0 tokens);
 *    - nog steeds stuk → incident-taak op het bord voor manager:ops (dedupe op titel).
 * 3. Herstelde monitor → nog-onggeclaimde incident-taak auto-sluiten.
 * 4. Open incidenten voor manager:ops → spawn de ops-manager (headless claude,
 *    max 1 tegelijk via lockfile). LLM-tokens alléén bij echte problemen.
 * 5. Escalaties, gebruikerstaken én kantoorchat-vragen → spawn de supervisor.
 * 6. needsHuman → Telegram (dedupe op sessie + inhoud).
 * 6b. Maandag: het handelsrapport van de afgelopen week (0 tokens).
 * 7. Eén keer per dag een levensteken, zodat stilte zélf het alarm is.
 * 7b. Dagelijkse backup van de database (0 tokens), zodat de backup-verifier
 *     iets heeft om terug te zetten.
 * 7c. Bronbestand dat er wél staat maar onleesbaar is (verkeerde kop, verkeerd
 *     aantal velden) → één Telegram-melding per bron per dag. Ontbreekt of
 *     leeg is geen storing: dat staat al in de actielijst.
 * 8. Auto-update: nieuwe commits op de eigen branch ophalen, bouwen, herstarten.
 * 9. Inbox: taken die via git binnenkwamen op het bord zetten.
 * 10. Ritme: terugkerend werk per tak op het bord zetten zodra het aan de
 *     beurt is. Zonder dit staat er een functieomschrijving en geen taak.
 *    8 en 9 staan standaard uit — ze voeren werk uit dat niet vanaf deze Mac
 *    gestart is, en dat hoort een bewuste keuze te zijn.
 *
 * Rem op kosten: elke spawn telt mee. Blijft dezelfde situatie na twee
 * pogingen open, dan stopt het spawnen en wordt de mens gevraagd. Is het
 * dagbudget uit org.json bereikt, dan start er niets meer.
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN, ARA_REPO, ARA_LOCK_DIR,
 *      ARA_WATCHDOG_NO_SPAWN=1 (test), ARA_DAILY_PING=0 (levensteken uit),
 *      ARA_BACKUP=0 (sectie 7b uit), ARA_BACKUP_DIR=~/Backups/ara, ARA_BACKUP_HOURS=24,
 *      ARA_SOURCES_ALERT=0 (sectie 7c uit),
 *      ARA_TRADE_WEEKLY=0 (wekelijks handelsrapport uit) of =now (nu sturen),
 *      ARA_AUTO_UPDATE=1 (sectie 8 aan), ARA_INBOX=1 (sectie 9 aan),
 *      ARA_RHYTHM=1 (sectie 10 aan), ARA_RHYTHM_VENTURES=blex,traject (leeg = alle),
 *      ARA_DISPATCH=1 (sectie 11 aan: rollen wekken voor hun eigen bordwerk),
 *      ARA_DISPATCH_MAX=2 (hoeveel rollen per ronde),
 *      ARA_IMPROVE=1 (sectie 12: dagelijkse verbeterronde op het gemeten spoor),
 *      ARA_IMPROVE_DAYS=7 (venster), ARA_QA_SAMPLE=0 (kruiscontrole, % van
 *      afgerond werk dat de qa-verifier nakijkt — staat in de collector).
 *
 * Ritme en uitvoering horen bij elkaar: ARA_RHYTHM zet het werk op het bord,
 * ARA_DISPATCH haalt het eraf. Alleen het eerste aanzetten geeft een bord dat
 * volloopt zonder dat er iemand komt — precies de stand die de gebruiker zijn
 * eigen manager hoorde beschrijven.
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
// Aanmaken als hij nog niet bestaat. Alle remmen van dit bestand leven hier:
// de eenmalige alarmen, de pogingenteller die na twee keer stopt met spawnen,
// en het slot dat voorkomt dat dezelfde agent twee keer tegelijk draait. Elke
// schrijfactie daarvan zit in een lege catch, dus een map die niet bestaat zet
// ze alle drie stil zónder één foutmelding: dan alarmeert hij eindeloos en
// spawnt hij door tot het budget op is. Eén mkdir scheelt dat.
try {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
} catch (error) {
  console.error(`[watchdog] kan lock-map ${LOCK_DIR} niet maken: ${String(error).slice(0, 80)}`);
}
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
    // Alleen wat ARA zelf startte. Het handwerk van de eigenaar staat in
    // dezelfde tabel, en dat meetellen betekende dat een dag zelf ontwikkelen
    // zijn agents stilzette terwijl die niets hadden uitgegeven. Gemeten op de
    // dag dat dit gebouwd werd: 15,9 miljoen tokens tegen een budget van 2
    // miljoen, waarvan 14,1 miljoen cache-creatie uit één ontwikkelsessie.
    //
    // agentTokens is invoer + uitvoer + cache-creatie van die sessies; het
    // cache-deel staat er apart bij zodat de som te lezen blijft in plaats van
    // als één onverklaarbaar groot getal in het log te staan.
    const used = usage.reduce((sum, row) => sum + (row.agentTokens ?? 0), 0);
    const usedCache = usage.reduce((sum, row) => sum + (row.agentCacheCreateTokens ?? 0), 0);
    if (budget > 0 && used >= budget) {
      log(
        `dagbudget bereikt (${used}/${budget}, waarvan ${usedCache} cache-creatie) — geen nieuwe agents deze tick`,
      );
      await alertOnce(
        `budget-${new Date().toISOString().slice(0, 10)}`,
        12 * 60 * 60 * 1000,
        `🟠 ARA World — dagbudget bereikt\n${used.toLocaleString('nl-NL')} van ${budget.toLocaleString('nl-NL')} tokens door agents gebruikt (waarvan ${usedCache.toLocaleString('nl-NL')} cache-creatie). Er worden vandaag geen nieuwe agents meer gestart.\nJe eigen Claude Code-werk telt hier niet in mee.`,
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

/**
 * De omgeving voor een gespawnde agent — met onze stempel, en zónder de
 * identiteit van de sessie die hem start.
 *
 * Dit was een stille maar grondige fout. `claude -p` erft de omgeving van zijn
 * ouder, en daar staat `CLAUDE_CODE_SESSION_ID` in. De gespawnde agent nam
 * daarmee de sessie-identiteit van de eigenaar over: zijn hooks meldden het
 * sessie-id van de éígenaar, dus het tokenverbruik van de agent werd op diens
 * regel geschreven — en die regel kreeg vervolgens het stempel van de agent.
 * Precies omgekeerd aan wat het dagbudget moet doen. Gemeten: een audit van
 * vier minuten zette 17,7 miljoen tokens op naam van de eigenaar-sessie en
 * blokkeerde daarmee elke volgende agent.
 *
 * In de wereld had het hetzelfde effect: de agent kreeg geen eigen pod maar
 * verdween in de sessie van de eigenaar.
 *
 * De berichtenkanalen gaan om een tweede reden weg: een gespawnde agent hoort
 * via het takenbord te praten, niet rechtstreeks tegen de sessie die hem
 * startte.
 */
const INHERITED_IDENTITY = [
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
];

function childEnv(role) {
  const env = { ...process.env, ARA_SPAWNED_ROLE: role };
  for (const key of INHERITED_IDENTITY) delete env[key];
  return env;
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
  // --plugin-dir laadt plugins/ara voor déze sessie. Zonder dat hangt --agent
  // aan de marketplace-installatie: is die niet gedaan (of stuk na een update),
  // dan bestaat de rol niet en valt de sessie meteen om. Geverifieerd met
  // scripts/verify-agents.mjs.
  const args = [
    '-p',
    prompt,
    '--permission-mode',
    'acceptEdits',
    '--plugin-dir',
    path.join(REPO, 'plugins/ara'),
  ];
  if (agent) args.push('--agent', agent);
  if (tools) args.push('--allowedTools', tools);
  const child = spawn('claude', args, {
    cwd: REPO,
    detached: true,
    stdio: ['ignore', logFile, logFile],
    // Stempel op de sessie die we hier starten. `usage.mjs` geeft hem door aan
    // de collector, en daarmee weet het dagbudget het verschil tussen wat ARA
    // zelf uitgeeft en wat de eigenaar achter zijn eigen Mac verstookt. Zonder
    // dat telde alles mee en zette een dag handwerk de hele organisatie stil.
    env: childEnv(agent ?? name),
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

// ── 1b. Schijfruimte en stilgevallen hooks ────────────────────────────────
// Een volle schijf laat inserts falen en de wereld bevriezen zonder foutmelding;
// stilgevallen hooks (bv. na een Claude Code-update die namen wijzigt) zien er
// precies zo uit als "de baas werkt even niet". Beide horen gemeld te worden.
try {
  const stat = fs.statfsSync(REPO);
  const freeGb = (stat.bavail * stat.bsize) / 1024 ** 3;
  if (freeGb < 2) {
    log(`weinig schijfruimte: ${freeGb.toFixed(1)} GB vrij`);
    await alertOnce(
      'disk-low',
      12 * 60 * 60 * 1000,
      `🟠 ARA World — schijf raakt vol\nNog ${freeGb.toFixed(1)} GB vrij. Bij een volle schijf stopt de collector met opslaan zonder dat er iets zichtbaar misgaat.`,
    );
  }
} catch {
  /* statfs niet beschikbaar — geen reden om te stoppen */
}
try {
  const health = await api('/health');
  const ageHours = (health.lastEventAgeSec ?? 0) / 3600;
  // 24 uur zonder één hook-event terwijl de collector draait: dan is de
  // koppeling met Claude Code stuk, niet de agenda van de eigenaar.
  if (health.lastEventAgeSec !== null && ageHours > 24) {
    log(`geen hook-events in ${ageHours.toFixed(0)} uur`);
    await alertOnce(
      'hooks-stil',
      24 * 60 * 60 * 1000,
      `🟠 ARA World — geen activiteit meer binnengekomen\nAl ${ageHours.toFixed(0)} uur geen enkel hook-event. Waarschijnlijk is de plugin-koppeling stuk (bijvoorbeeld na een Claude Code-update).`,
    );
  }
} catch (error) {
  log(`health-check overgeslagen: ${String(error).slice(0, 80)}`);
}

// ── 1c. Verouderde viewer-build en volgelopen launchd-logs ────────────────
// De collector serveert apps/viewer/dist van schijf. Na een `git pull` staat
// daar nog de build van gisteren: de viewer draait dan een andere reducer dan
// de collector — precies de asymmetrie die de hele wereld verkeerd laat tellen.
// Herbouwen kost 0 tokens, dus dat doet de watchdog gewoon zelf.
function newestMtime(dir) {
  let newest = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  try {
    walk(dir);
  } catch {
    /* map bestaat niet in deze checkout */
  }
  return newest;
}

if (!NO_SPAWN) {
  try {
    const distIndex = path.join(REPO, 'apps/viewer/dist/index.html');
    const built = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
    const source = Math.max(
      newestMtime(path.join(REPO, 'apps/viewer/src')),
      newestMtime(path.join(REPO, 'packages/shared/src')),
    );
    if (source > built) {
      log(built ? 'viewer-build is ouder dan de broncode — herbouwen' : 'viewer-build ontbreekt — bouwen');
      try {
        execFileSync('pnpm', ['--filter', '@ara/viewer', 'build'], {
          cwd: REPO,
          timeout: 10 * 60 * 1000,
          stdio: 'ignore',
        });
        log('viewer herbouwd');
      } catch (error) {
        // Een mislukte build laat de oude dist staan: de wereld blijft draaien,
        // maar op verouderde code. Dat moet een mens weten.
        await alertOnce(
          'viewer-build-faalt',
          6 * 60 * 60 * 1000,
          `🟠 ARA World — viewer herbouwen mislukt\nDe browser draait nog de vorige build. Draai handmatig: pnpm --filter @ara/viewer build\n${String(error).slice(0, 160)}`,
        );
      }
    }
  } catch (error) {
    log(`build-check overgeslagen: ${String(error).slice(0, 80)}`);
  }
}

// launchd schrijft stdout/stderr naar één bestand dat nooit roteert; na maanden
// is dat het grootste bestand op de schijf.
try {
  const logDir = process.env.ARA_LOGS ?? path.join(os.homedir(), 'Library/Logs/ara-world');
  for (const name of fs.readdirSync(logDir)) {
    if (!name.endsWith('.log')) continue;
    const full = path.join(logDir, name);
    if (fs.statSync(full).size > 20 * 1024 * 1024) {
      fs.renameSync(full, `${full}.1`);
      log(`logbestand geroteerd: ${name}`);
    }
  }
} catch {
  /* geen logmap (bv. in de container) — niets te roteren */
}

// ── 1d. Handel: het enige deel dat geld kan kosten terwijl je slaapt ──────
// De collector kent de stand, maar meldt 'm nergens uit zichzelf. Dit is de
// 24/7-schakel: een noodstop, een modus boven papier, onbruikbare limieten,
// stil veranderde limieten of een voorstel dat te lang op akkoord wacht — dat
// zijn allemaal dingen die je wilt weten vóórdat je toevallig gaat kijken.
try {
  const trade = await api('/trade/state');
  const mode = trade.state?.mode ?? 'onbekend';

  if (trade.state?.halted) {
    log(`handel ligt stil: ${trade.state.haltReason}`);
    await alertOnce(
      `trade-halt-${shortHash(String(trade.state.haltReason))}`,
      12 * 60 * 60 * 1000,
      `🔴 ARA World — handel ligt stil\n${trade.state.haltReason}\nHervatten kan in de actielijst; dat zet 'm terug op papier.`,
    );
  }

  // Boven papier is geen alarm maar wel iets waarvan je je bewust hoort te
  // zijn. Eén melding per dag, zodat het niet went.
  if (mode === 'approval' || mode === 'live') {
    await alertOnce(
      `trade-mode-${mode}-${new Date().toISOString().slice(0, 10)}`,
      20 * 60 * 60 * 1000,
      `🟠 ARA World — handel staat op "${mode}"\nGezet door ${trade.state.modeSetBy}. Risico per trade max ${trade.limits?.maxRiskPerTradePct}%, dagverlies max ${trade.limits?.dailyLossLimitPct}%.`,
    );
  }

  // Onbruikbare limieten laten niets door — dat is veilig, maar het betekent
  // ook dat er niets gebeurt terwijl jij denkt van wel.
  if (Array.isArray(trade.problems) && trade.problems.length > 0 && mode !== 'off') {
    await alertOnce(
      `trade-limits-${shortHash(trade.problems.join('|'))}`,
      24 * 60 * 60 * 1000,
      `🟠 ARA World — handelslimieten onbruikbaar\n${trade.problems.join('\n')}\nZolang dit zo staat komt er geen enkel voorstel doorheen.`,
    );
  }

  // Een stil gewijzigd limietenbestand is het soort verandering dat je nooit
  // ziet gebeuren en altijd te laat merkt.
  const markFile = path.join(LOCK_DIR, 'ara-trade-limits.fingerprint');
  const seen = fs.existsSync(markFile) ? fs.readFileSync(markFile, 'utf8').trim() : '';
  const current = String(trade.limitsFingerprint ?? '');
  if (seen && current && seen !== current) {
    await alertOnce(
      `trade-limits-changed-${current}`,
      6 * 60 * 60 * 1000,
      `🟠 ARA World — handelslimieten zijn gewijzigd\nBestand: ${trade.limitsSource}\nRisico/trade ${trade.limits?.maxRiskPerTradePct}%, dagverlies ${trade.limits?.dailyLossLimitPct}%, ${trade.limits?.allowedInstruments?.length ?? 0} instrument(en).\nWas jij dat?`,
    );
  }
  if (current) fs.writeFileSync(markFile, current);

  // Een voorstel dat op akkoord wacht, verloopt: een setup van drie uur
  // geleden is geen setup meer. Stilte is hier een besluit dat niemand nam.
  const waiting = await api('/trade/intents?status=awaiting&limit=20');
  const stale = (waiting.intents ?? []).filter((i) => Date.now() - i.createdAt > 30 * 60 * 1000);
  if (stale.length > 0) {
    const first = stale[0];
    await alertOnce(
      `trade-waiting-${first.id}`,
      6 * 60 * 60 * 1000,
      `🟠 ARA World — ${stale.length} handelsvoorstel(len) wachten op jou\nOudste: ${first.side} ${first.qty} ${first.instrument} op ${first.entry}, ${Math.round((Date.now() - first.createdAt) / 60000)} min oud.\nAkkoord of afwijzen kan in de actielijst.`,
    );
  }
} catch (error) {
  log(`handelscheck overgeslagen: ${String(error).slice(0, 80)}`);
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
let chiefChats = [];
try {
  const escalated = await api('/tasks?assignee=supervisor&status=open&limit=50');
  opsEscalations = escalated.tasks.filter((t) => t.createdBy === 'manager:ops');
  userTasks = escalated.tasks.filter((t) => t.createdBy === 'user' || t.createdBy === 'chief');
  // Vragen uit een kantoorchat staan bij de aangesproken rol (manager:blex,
  // een agent-id, …) — niet bij de supervisor. Die werden daardoor nooit
  // opgepakt: je praatte tegen een muur. Ze horen hier óók opgehaald te worden.
  const all = await api('/tasks?status=open&limit=100');
  chatTasks = all.tasks.filter((t) => t.createdBy === 'user' && t.title.startsWith('CHAT:'));
  // Een vraag die aan de chief gericht is, hoort ook bij de chief te landen.
  // Die ging hier altijd naar de supervisor, en dan antwoordt de verkeerde:
  // volgens org.json is de chief het enige aanspreekpunt van de gebruiker.
  chiefChats = chatTasks.filter((t) => t.assignee === 'chief');
  chatTasks = chatTasks.filter((t) => t.assignee !== 'chief');
} catch (error) {
  log(`supervisor-stap overgeslagen: ${String(error).slice(0, 80)}`);
}
// Vragen aan de chief: die wekt zijn eigen rol, niet de supervisor. De chief
// is volgens org.json het enige aanspreekpunt van de gebruiker, dus een
// antwoord van de supervisor op een vraag aan de chief is geen kleine
// onnauwkeurigheid — het is de verkeerde die terugpraat.
if (chiefChats.length > 0) {
  const signature = `chief-chat-${chiefChats.map((t) => t.id).sort().join('-')}`;
  const tries = spawnAttempts(signature);
  if (tries >= 2) {
    log(`chief kwam er ${tries}× niet uit — niet opnieuw spawnen`);
    await alertOnce(
      signature,
      6 * 60 * 60 * 1000,
      `🟠 ARA World — chief komt er niet uit\n${chiefChats.length} vraag/vragen aan de chief blijven open na ${tries} pogingen. Kijk even mee op het bord.`,
    );
  } else if (!(await budgetExceeded())) {
    spawnAttempts(signature, { increment: true });
    spawnClaude(
      'chief-chat',
      `Je bent ara-chief. Er staan ${chiefChats.length} vraag/vragen van de gebruiker rechtstreeks aan jou op het bord (GET ${COLLECTOR}/tasks?status=open, titel begint met "CHAT:", assignee "chief"). Lees per taak het detail: daar staan de ruimte (room) en de letterlijke curl-regels om te antwoorden en de taak te sluiten. Beantwoord ze zelf of haal eerst op wat je nodig hebt; de gebruiker zit te wachten.`,
      { agent: 'ara-chief', tools: 'Bash,Read,Write,Edit,Grep,Glob,Task' },
    );
  }
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
      `er staan ${chatTasks.length} vraag/vragen uit een kantoorchat op het bord (titel begint met "CHAT:", elk bij de aangesproken rol als assignee; vragen aan de chief gaan apart naar hem). Lees per taak het detail: daar staan de ruimte (room) en het antwoord-commando. Beantwoord ze zelf of zet ze door naar de juiste manager, POST het antwoord in dezelfde ruimte en sluit de taak af. De gebruiker zit te wachten in dat kantoor.`,
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

// ── 6b. Wekelijks handelsrapport ──────────────────────────────────────────
// Maandagochtend één bericht met wat de week deed. De cijfers komen kant-en-
// klaar uit de collector (pure functie), dus dit kost nul tokens en kan nooit
// iets anders melden dan het rapport zelf zegt.
//
// Ook als er niets gebeurde gaat het bericht de deur uit, zolang de handel niet
// uit staat: een week zonder één voorstel is meestal geen rustige week maar een
// kapotte koppeling — en juist dát merk je anders pas veel later.
if (process.env.ARA_TRADE_WEEKLY !== '0') {
  const now = new Date();
  // `now` forceert het bericht ongeacht de dag. Dat is een testhaak én een
  // knop: wil je het rapport tussendoor, dan draai je de watchdog één keer met
  // ARA_TRADE_WEEKLY=now in plaats van tot maandag te wachten.
  const forced = process.env.ARA_TRADE_WEEKLY === 'now';
  if (forced || (now.getDay() === 1 && now.getHours() >= 8 && now.getHours() < 10)) {
    try {
      const state = await api('/trade/state');
      if (state.state?.mode !== 'off') {
        const review = await api('/trade/review?days=7');
        // ISO-weeknummer als sleutel: één bericht per week, ook als de watchdog
        // binnen het venster een paar keer draait.
        const monday = new Date(now);
        monday.setHours(0, 0, 0, 0);
        await alertOnce(
          // Geforceerd = altijd sturen; anders hooguit één keer per maandag.
          forced ? `trade-weekly-forced-${Date.now()}` : `trade-weekly-${monday.toISOString().slice(0, 10)}`,
          5 * 24 * 60 * 60 * 1000,
          review.message,
        );
        log(`weekrapport verstuurd (${review.proposals?.total ?? 0} voorstellen)`);
      }
    } catch (error) {
      log(`weekrapport overgeslagen: ${String(error).slice(0, 80)}`);
    }
  }
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
      // Hoeveel bronnen zijn er echt aangesloten (stand `gevuld`, regel 4:
      // een kop zonder regels telt niet). Is /sources niet bereikbaar, dan
      // valt de regel weg — er wordt geen getal verzonnen.
      let sourcesLine = '';
      try {
        const all = (await api('/sources')).ventures.flatMap((v) => v.sources);
        const filled = all.filter((s) => s.state === 'gevuld').length;
        sourcesLine = `\nBronnen: ${filled} van ${all.length} gevuld`;
      } catch {
        /* geen cijfer = geen regel */
      }
      await alertOnce(
        `heartbeat-${new Date().toISOString().slice(0, 10)}`,
        20 * 60 * 60 * 1000,
        `🟢 ARA World draait\n${running} sessie(s) aan het werk · ${incidentsToHandle.length} open incident(en) · ${failures} monitor(s) stuk\nTokens vandaag: ${used.toLocaleString('nl-NL')}${budget ? ` van ${budget.toLocaleString('nl-NL')}` : ''}${sourcesLine}`,
      );
    } catch (error) {
      log(`levensteken overgeslagen: ${String(error).slice(0, 80)}`);
    }
  }
}

// ── 7b. Dagelijkse backup van de database ────────────────────────────────
// De backup-verifier meldde na een week met ESCALATE dat er niets te
// controleren viel: `~/Backups/ara` bestond niet, het backup-commando was hier
// nog nooit gedraaid. Een rol die een backup nakijkt maakt hem niet zelf — dat
// is een schrijfactie op de machine van de eigenaar — dus dat hoort hier, bij
// de bewaker die toch elke vijf minuten langskomt. Kost 0 tokens.
//
// Draait zodra de nieuwste kopie ouder is dan ARA_BACKUP_HOURS (24). Niet aan
// de klok gebonden: een Mac die om 03:00 sliep haalt het om 09:00 in. Uitzetten
// met ARA_BACKUP=0; de map komt uit ARA_BACKUP_DIR (standaard ~/Backups/ara,
// dezelfde die de verifier leest).
if (process.env.ARA_BACKUP !== '0') {
  const backupDir = process.env.ARA_BACKUP_DIR ?? path.join(os.homedir(), 'Backups', 'ara');
  const everyMs = Number(process.env.ARA_BACKUP_HOURS ?? 24) * 60 * 60 * 1000;
  const dbPath = path.join(process.env.ARA_DATA_DIR ?? path.join(REPO, 'data'), 'ara-events.db');
  let newest = 0;
  try {
    for (const name of fs.readdirSync(backupDir)) {
      if (!/^ara-events-.*\.db$/.test(name)) continue;
      newest = Math.max(newest, fs.statSync(path.join(backupDir, name)).mtimeMs);
    }
  } catch {
    // Geen map = nog nooit een backup. Precies de stand die de verifier aantrof.
  }
  if (fs.existsSync(dbPath) && Date.now() - newest > everyMs) {
    try {
      const out = execFileSync('pnpm', ['--filter', '@ara/collector', 'backup'], {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 5 * 60_000,
        env: { ...process.env, ARA_BACKUP_DIR: backupDir },
      });
      const made = out.split('\n').find((line) => line.includes('ara-events-')) ?? 'gemaakt';
      log(`backup: ${made.replace(/^\[backup\] /, '')}`);
    } catch (error) {
      // Eén melding per dag: een backup die stil mislukt is precies het bestand
      // waarvan je bij een restore hoopt dat het er is.
      const reason = String(error?.stderr ?? error).slice(0, 200);
      log(`backup mislukt: ${reason}`);
      await alertOnce(
        `backup-failed-${new Date().toISOString().slice(0, 10)}`,
        20 * 60 * 60 * 1000,
        `⚠️ Database-backup mislukt\n${reason}\nMap: ${backupDir}`,
      );
    }
  }
}

// ── 7c. Onleesbare bronbestanden ─────────────────────────────────────────
// Een bron die ontbreekt of leeg is staat in de actielijst; dat ziet de
// eigenaar. Een bron die er wél staat maar niet te lezen is (verkeerde kop,
// verkeerd aantal velden na een export uit een ander programma) ziet hij niet:
// het bestand is er, dus hij denkt dat het werkt, terwijl de rol die het leest
// niets krijgt. Dat is een storing en die hoort gemeld — één keer per bron per
// dag, met de eerste foutregel en het pad, zodat het bericht zelf zegt wat er
// te repareren valt. Kost 0 tokens: de collector heeft de fout al gevonden.
if (process.env.ARA_SOURCES_ALERT !== '0') {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const { ventures } = await api('/sources');
    for (const venture of ventures) {
      for (const source of venture.sources) {
        if (source.state === 'ontbreekt' || !source.errors?.length) continue;
        await alertOnce(
          `source-broken-${venture.id}-${source.file}-${day}`,
          20 * 60 * 60 * 1000,
          `⚠️ Bronbestand onleesbaar (${venture.label})\n${source.label}: ${source.errors[0]}\nBestand: ${source.path}`,
        );
      }
    }
  } catch (error) {
    log(`bronnencontrole overgeslagen: ${String(error).slice(0, 80)}`);
  }
}

// ── 8. Auto-update: mijn eigen code bijwerken ────────────────────────────
// Standaard uit. Aan betekent: wat er op de branch gepusht wordt, draait hier
// binnen vijf minuten. Dat is prettig en het is gevaarlijk, dus elke stap
// hieronder mag afhaken zonder iets kapot te maken.
if (process.env.ARA_AUTO_UPDATE === '1') {
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd: REPO, encoding: 'utf8', timeout: 60_000 }).trim();
    // `git merge-base --is-ancestor` antwoordt met zijn exitcode, en
    // execFileSync gooit bij alles wat niet 0 is. Zonder deze wikkel valt het
    // gewone "nee" in de algemene catch en lijkt een herschreven branch op een
    // storing.
    const isAncestor = (a, b) => {
      try {
        git('merge-base', '--is-ancestor', a, b);
        return true;
      } catch {
        return false;
      }
    };

    // Ongecommit werk is werk van een mens. Daar blijven we vanaf — een
    // fast-forward die het zou wegduwen weigert git terecht, maar dan staan we
    // met een halve toestand; liever helemaal niet beginnen.
    const dirty = git('status', '--porcelain');
    if (dirty) {
      log(`auto-update overgeslagen: ${dirty.split('\n').length} bestand(en) ongecommit`);
    } else {
      const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
      git('fetch', 'origin', branch);
      const before = git('rev-parse', 'HEAD');
      const remote = git('rev-parse', `origin/${branch}`);
      if (before === remote) {
        log('auto-update: al bij');
      } else if (isAncestor(before, remote)) {
        // Zit HEAD niet in de remote-historie, dan is de branch herschreven.
        // Stilletjes meebewegen is dan precies het verkeerde: dat hoort een
        // mens te zien, niet een watchdog op te lossen.
        const log_lines = git('log', '--oneline', `${before}..${remote}`);
        git('merge', '--ff-only', `origin/${branch}`);
        log(`auto-update: ${before.slice(0, 7)} → ${remote.slice(0, 7)}`);

        let ok = true;
        try {
          execFileSync('pnpm', ['install', '--silent'], { cwd: REPO, timeout: 10 * 60_000 });
          execFileSync('pnpm', ['--filter', '@ara/viewer', 'build'], { cwd: REPO, timeout: 10 * 60_000 });
        } catch (error) {
          ok = false;
          log(`auto-update: build mislukt, niet herstart — ${String(error).slice(0, 120)}`);
          await alertOnce(
            `autoupdate-fail-${remote.slice(0, 7)}`,
            6 * 60 * 60 * 1000,
            `🔴 ARA auto-update: build mislukt op ${remote.slice(0, 7)}\nDe draaiende versie is niet vervangen. Kijk in ~/Library/Logs/ara-world/`,
          );
        }
        // Alleen herstarten na een geslaagde build: een kapotte build vervangen
        // door een kapotte dienst maakt het erger, niet zichtbaarder.
        if (ok) {
          kickstart('com.ara.collector');
          await alertOnce(
            `autoupdate-${remote.slice(0, 7)}`,
            6 * 60 * 60 * 1000,
            `🔄 ARA bijgewerkt naar ${remote.slice(0, 7)}\n${log_lines.slice(0, 600)}`,
          );
        }
      } else {
        log('auto-update overgeslagen: branch is herschreven, fast-forward kan niet');
        await alertOnce(
          'autoupdate-diverged',
          12 * 60 * 60 * 1000,
          '⚠️ ARA auto-update kan niet: de branch is herschreven. Los het met de hand op.',
        );
      }
    }
  } catch (error) {
    log(`auto-update fout: ${String(error).slice(0, 120)}`);
  }
}

// ── 9. Inbox: taken die via git binnenkwamen ─────────────────────────────
// Ook standaard uit. Zie ops/inbox/README.md voor de vorm.
if (process.env.ARA_INBOX === '1') {
  const inboxDir = path.join(REPO, 'ops', 'inbox');
  const seenFile = path.join(REPO, 'data', 'inbox-seen.json');
  let seen = {};
  try {
    seen = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
  } catch {
    /* nog nooit iets verwerkt */
  }

  let files = [];
  try {
    files = fs.readdirSync(inboxDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    /* geen inbox-map: prima */
  }

  for (const file of files.sort()) {
    const full = path.join(inboxDir, file);
    let raw = '';
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    // Op de inhoud, niet op de naam: een hernoemd bestand met dezelfde tekst
    // is hetzelfde werk, en een gewijzigd bestand is nieuw werk.
    const fingerprint = shortHash(raw);
    if (seen[file] === fingerprint) continue;

    const front = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    const meta = {};
    if (front) {
      for (const line of front[1].split('\n')) {
        const m = /^(\w+):\s*(.+)$/.exec(line.trim());
        if (m) meta[m[1]] = m[2].trim();
      }
    }
    const body = (front ? raw.slice(front[0].length) : raw).trim();
    const title = meta.title ?? file.replace(/\.md$/, '');

    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          detail: body,
          assignee: meta.assignee ?? 'supervisor',
          project: meta.project ?? '',
          status: 'open',
        }),
      });
      seen[file] = fingerprint;
      log(`inbox: "${title}" op het bord voor ${meta.assignee ?? 'supervisor'}`);
      // Werk dat vanzelf begint hoort niet ongezien te beginnen.
      await alertOnce(
        `inbox-${fingerprint}`,
        24 * 60 * 60 * 1000,
        `📥 Nieuwe taak van buiten: ${title}\nVoor: ${meta.assignee ?? 'supervisor'}`,
      );
    } catch (error) {
      log(`inbox "${file}" mislukt: ${String(error).slice(0, 80)}`);
    }
  }

  try {
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    fs.writeFileSync(seenFile, `${JSON.stringify(seen, null, 2)}\n`);
  } catch (error) {
    log(`inbox-geheugen niet opgeslagen: ${String(error).slice(0, 80)}`);
  }
}

// ── 10. Ritme: terugkerend werk op het bord ──────────────────────────────
// Het playbook van elke tak noemt zijn terugkerende werk, maar dat stond
// alleen in de prompt die een manager leest wanneer hij gestart wordt — en
// niets startte hem. Acht managers met een functieomschrijving en nul taken.
// Hier krijgt dat werk zijn ritme.
//
// Standaard uit: dit laat het systeem uit zichzelf tokens uitgeven, elke dag.
if (process.env.ARA_RHYTHM === '1') {
  const MS = { dag: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, maand: 30 * 24 * 60 * 60 * 1000 };
  const only = (process.env.ARA_RHYTHM_VENTURES ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const stateFile = path.join(REPO, 'data', 'rhythm.json');

  let last = {};
  try {
    last = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    /* nog nooit gedraaid */
  }

  try {
    // Het budget gaat vóór het ritme. Is het dagbudget op, dan komt er geen
    // werk bij — anders is een druk etmaal precies het moment waarop het
    // systeem zichzelf extra werk geeft.
    if (await budgetExceeded()) {
      log('ritme overgeslagen: dagbudget bereikt');
    } else {
      const org = await api('/org');
      const open = await api('/tasks?status=open&limit=200').catch(() => ({ tasks: [] }));
      const openTitles = new Set((open.tasks ?? []).map((t) => t.title));
      const now = Date.now();
      let placed = 0;

      // Ops draait mee als een tak zonder tak: hij heeft eigen terugkerend
      // werk (back-ups terugzetten, de org zelf nalopen, sleutels controleren)
      // dat tot nu toe nergens geplaatst werd — deze lus liep alleen over
      // org.ventures, dus die drie rollen stonden in org.json met een ritme dat
      // nooit aanbrak. `ARA_RHYTHM_VENTURES` filtert erop met de naam "ops".
      const rhythmGroups = [
        ...(org.ventures ?? []),
        ...(org.ops?.duties?.length
          ? [{ id: 'ops', label: 'Ops', manager: 'manager:ops', playbook: { duties: org.ops.duties } }]
          : []),
      ];

      for (const venture of rhythmGroups) {
        if (only.length > 0 && !only.includes(venture.id)) continue;
        for (const duty of venture.playbook?.duties ?? []) {
          const key = `${venture.id}:${duty.text}`;
          const interval = MS[duty.every] ?? MS.week;
          if (now - (last[key] ?? 0) < interval) continue;

          // Staat dezelfde taak nog open, dan is hij niet af — en dan is een
          // tweede exemplaar geen ritme maar een stapel.
          // Deze drie voorvoegsels staan óók in CADENCE_PREFIXES in
          // packages/shared/src/retro.ts: de terugblik herkent er terugkerend
          // werk aan en meldt dat niet als een probleem dat blijft terugkomen.
          // Wijzig je ze hier, wijzig ze daar mee.
          const title = `${duty.every === 'dag' ? 'Dagelijks' : duty.every === 'week' ? 'Wekelijks' : 'Maandelijks'}: ${duty.text}`;
          if (openTitles.has(title)) {
            log(`ritme: "${title.slice(0, 50)}…" staat nog open, niet opnieuw`);
            continue;
          }

          await api('/tasks', {
            method: 'POST',
            body: JSON.stringify({
              title,
              detail:
                `Terugkerend werk uit het playbook van ${venture.label ?? venture.id} (${duty.every}).\n\n` +
                `${duty.text}\n\n` +
                'Lever een kort bordresultaat: wat je nagelopen hebt, wat eruit sprong, en wat er ' +
                'niet te meten viel. Valt er niets te melden, zeg dan dát — een lege ronde is ook ' +
                'een uitkomst. Kom je iets tegen dat boven je grens gaat, begin je antwoord met ESCALATE:.',
              // De rol die dit werk doet, en anders de manager van de tak.
              // Dat `who` bestaat is de hele reden dat elke rol eigen werk
              // heeft; het hier negeren zou elke taak alsnog bij één manager
              // neerleggen en die tien rollen weer laten wachten tot iemand
              // ze aanwijst. Staat er geen eigenaar, dan weegt de manager het.
              assignee: duty.who ?? venture.manager ?? `manager:${venture.id}`,
              status: 'open',
            }),
          });
          last[key] = now;
          placed += 1;
          log(`ritme: "${title.slice(0, 60)}" → ${duty.who ?? venture.manager ?? venture.id}`);
        }
      }

      if (placed > 0) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, `${JSON.stringify(last, null, 2)}\n`);
        // Eén bericht per ronde, niet per taak: dertig losse pushjes leest
        // niemand, en dan zet je de meldingen uit en mis je de echte.
        await alertOnce(
          `rhythm-${new Date().toISOString().slice(0, 13)}`,
          6 * 60 * 60 * 1000,
          `🗓️ ${placed} terugkerende ta(a)k(en) op het bord gezet`,
        );
      }
      log(`ritme: ${placed} taak/taken geplaatst`);
    }
  } catch (error) {
    log(`ritme fout: ${String(error).slice(0, 120)}`);
  }
}

// ── 11. Uitvoering: de rol wakker maken die zijn eigen werk heeft ────────
//
// Dit was het ontbrekende stuk. Er stonden drie spawn-plekken in dit bestand —
// ops bij incidenten, de supervisor bij escalaties en gebruikerstaken, de chief
// bij vragen aan hem — en dus werd er nooit iemand gewekt voor gewoon werk.
// Het ritme zette taken op het bord bij `manager:blex` en daar bleven ze staan.
// De gebruiker kreeg dat van zijn eigen manager teruggemeld: niemand pakt uit
// zichzelf routineklussen op.
//
// Standaard uit, net als het ritme: dit geeft uit zichzelf tokens uit terwijl
// er niemand meekijkt. ARA_DISPATCH=1 zet het aan.
if (process.env.ARA_DISPATCH === '1') {
  try {
    // Hoeveel rollen we per ronde wakker maken. De watchdog draait elke vijf
    // minuten; zonder deze grens start één volle bordronde tien sessies naast
    // elkaar en is het dagbudget voor de middag op.
    const maxPerTick = Math.max(1, Number(process.env.ARA_DISPATCH_MAX ?? 2));

    const [board, org] = await Promise.all([api('/tasks?status=open&limit=200'), api('/org')]);

    // Rollen die elders in dit bestand al hun eigen spawn hebben. Twee keer
    // dezelfde rol wekken voor dezelfde taak is niet dubbel werk maar dubbel
    // geld, en twee sessies die dezelfde taak claimen leveren tegenstrijdige
    // resultaten op.
    const alreadyHandled = new Set(['manager:ops', 'supervisor', 'chief', '']);

    // Agent-id per bord-rol. Managers draaien allemaal op ara-manager; een
    // specialist draait op zijn eigen rol-bestand.
    const agentFor = new Map();
    const labelFor = new Map();
    for (const venture of org.ventures ?? []) {
      const manager = venture.manager ?? `manager:${venture.id}`;
      agentFor.set(manager, 'ara-manager');
      labelFor.set(manager, venture.playbook?.managerName ?? `Manager ${venture.label ?? venture.id}`);
      for (const spec of venture.playbook?.specialists ?? []) {
        if (!spec.agent) continue;
        agentFor.set(spec.agent, spec.agent);
        labelFor.set(spec.agent, spec.name ?? spec.agent);
      }
    }
    for (const spec of org.ops?.specialists ?? []) {
      if (spec.agent) {
        agentFor.set(spec.agent, spec.agent);
        labelFor.set(spec.agent, spec.name ?? spec.agent);
      }
    }

    const byRole = new Map();
    for (const task of board.tasks ?? []) {
      const who = task.assignee ?? '';
      if (alreadyHandled.has(who)) continue;
      // CHAT-taken worden door sectie 5 afgehandeld; die wachten op een mens
      // in een gesprek en niet op een routineronde.
      if (task.title.startsWith('CHAT:')) continue;
      if (!agentFor.has(who)) {
        // Werk voor een rol die niet in de organisatie staat. Stilzwijgend
        // overslaan zou betekenen dat die taak nooit opgepakt wordt zonder dat
        // iemand het merkt — dus zeggen we het.
        log(`bord: "${task.title.slice(0, 40)}" staat bij onbekende rol "${who}"`);
        continue;
      }
      const list = byRole.get(who) ?? [];
      list.push(task);
      byRole.set(who, list);
    }

    // Wie het langst wacht, gaat eerst. Zonder die volgorde krijgt dezelfde
    // drukke rol elke ronde de beurt en komt de rest nooit aan bod.
    const queue = [...byRole.entries()]
      .map(([who, tasks]) => ({
        who,
        tasks,
        oldest: Math.min(...tasks.map((t) => t.updatedAt ?? t.createdAt ?? Date.now())),
      }))
      .sort((a, b) => a.oldest - b.oldest);

    let woken = 0;
    for (const { who, tasks } of queue) {
      if (woken >= maxPerTick) {
        log(`bord: ${queue.length - woken} rol(len) wachten tot de volgende ronde`);
        break;
      }
      if (await budgetExceeded()) break;

      const signature = `bord-${who}-${tasks.map((t) => t.id).sort().join('-')}`;
      const tries = spawnAttempts(signature);
      if (tries >= 2) {
        log(`${who} kwam er ${tries}× niet uit — niet opnieuw spawnen`);
        await alertOnce(
          signature,
          6 * 60 * 60 * 1000,
          `🟠 ARA World — ${labelFor.get(who) ?? who} komt er niet uit\n${tasks.length} taak/taken blijven open na ${tries} pogingen. Kijk even mee op het bord.`,
        );
        continue;
      }

      spawnAttempts(signature, { increment: true });
      const agent = agentFor.get(who);
      const titles = tasks.slice(0, 5).map((t) => `• ${t.title}`).join('\n');
      spawnClaude(
        `bord-${who.replace(/[^a-z0-9]+/gi, '-')}`,
        `Je bent ${agent}. Op het bord staan ${tasks.length} open taak/taken voor jou (GET ${COLLECTOR}/tasks?assignee=${encodeURIComponent(who)}&status=open):\n${titles}\n\n` +
          `Claim er één tegelijk (PATCH ${COLLECTOR}/tasks/<id> met {"status":"claimed"}), doe het werk, en sluit af met een resultaat: ` +
          `PATCH ${COLLECTOR}/tasks/<id> met {"status":"done","result":"<wat je nagelopen hebt, wat eruit sprong, en wat er niet te meten viel>"}. ` +
          `Een lege ronde is ook een uitkomst — zeg dán dat er niets te melden was, in plaats van iets te verzinnen. ` +
          `Ontbreekt de databron die je nodig hebt, sluit de taak dan af met precies welke koppeling ontbreekt. ` +
          `Gaat iets boven je grens, begin je resultaat met ESCALATE:.`,
        { agent, tools: OPS_TOOLS },
      );
      woken += 1;
      log(`bord: ${who} gewekt voor ${tasks.length} taak/taken`);
    }
    if (woken === 0 && queue.length === 0) log('bord: niets open dat op een rol wacht');
  } catch (error) {
    log(`bord-uitvoering fout: ${String(error).slice(0, 120)}`);
  }
}

// ── 12. Verbeterronde: de organisatie kijkt naar zichzelf ────────────────
//
// Dit is het stuk waar "agents zoeken zelf verbeterpunten" op neerkomt, en de
// reden dat het pas hier staat: eerst moest er iets meetbaars zijn om naar te
// wijzen. GET /retro leest het bord — puur, nul tokens — en levert bevindingen
// die elk hun eigen taak-ids meedragen. Een voorstel zonder bewijs is een
// mening, en een agent die elke week plausibel klinkende verbeteringen schrijft
// is erger dan geen verbeterronde.
//
// Standaard uit. ARA_IMPROVE=1 zet hem aan; ARA_IMPROVE_DAYS zet het venster.
if (process.env.ARA_IMPROVE === '1') {
  try {
    const days = Math.max(1, Number(process.env.ARA_IMPROVE_DAYS ?? 7));
    const retro = await api(`/retro?days=${days}`);

    if (retro.tooQuiet) {
      // Niet stilzwijgend overslaan: "te stil" is zelf de uitkomst, en zonder
      // dit regeltje lijkt een uitgeschakelde ronde op een kapotte.
      log(`verbeterronde: te weinig gebeurd (${retro.considered} taken) — niets te lezen`);
    } else if (retro.findings.length === 0) {
      log(`verbeterronde: ${retro.considered} taken bekeken, geen patronen`);
    } else {
      // Eén ronde per dag. Vaker heeft geen zin — het bord verandert niet zo
      // snel dat er 's middags andere patronen in staan dan 's ochtends, en
      // elke ronde kost een sessie.
      const stamp = new Date().toISOString().slice(0, 10);
      const signature = `verbeterronde-${stamp}`;
      if (spawnAttempts(signature) >= 1) {
        log('verbeterronde: vandaag al gedraaid');
      } else if (!(await budgetExceeded())) {
        spawnAttempts(signature, { increment: true });
        const summary = retro.findings
          .map((f) => {
            const ids = f.evidence.map((e) => e.id).join(', ');
            return `• [${f.kind}] ${f.text}\n  taken: ${ids}${f.evidenceTotal > f.evidence.length ? ` (+${f.evidenceTotal - f.evidence.length} meer)` : ''}`;
          })
          .join('\n');
        spawnClaude(
          'verbeterronde',
          `Je bent ara-org-auditor. Dit is de gemeten terugblik over ${days} dagen (GET ${COLLECTOR}/retro?days=${days} geeft hem volledig, inclusief de cijfers per rol):\n\n${summary}\n\n` +
            `Schrijf per bevinding die het waard is één concreet voorstel op het bord ` +
            `(POST ${COLLECTOR}/tasks met title, detail, assignee). Regels:\n` +
            `1) Elk voorstel noemt de taak-ids waarop het rust. Kun je die niet noemen, dan is het geen voorstel maar een mening — laat het weg.\n` +
            `2) Eén concrete verandering per voorstel, met wie hem uitvoert. "Beter communiceren" is geen voorstel; "duty X verhuizen van rol Y naar rol Z omdat die drie keer escaleerde" wel.\n` +
            `3) Niet alles hoeft een voorstel te worden. Een bevinding die je niet kunt terugvoeren op een oorzaak laat je staan en benoem je als zodanig.\n` +
            `4) Je wijzigt zelf niets aan code, org.json of het ritme. Je schrijft voorstellen; de eigenaar beslist.\n` +
            `Sluit af met een bordtaak voor 'supervisor' met je samenvatting, en zeg daarin ook wat je bewust hebt laten liggen.`,
          { agent: 'ara-org-auditor', tools: 'Bash,Read,Grep,Glob' },
        );
        log(`verbeterronde: gestart op ${retro.findings.length} bevinding(en)`);
      }
    }
  } catch (error) {
    log(`verbeterronde fout: ${String(error).slice(0, 120)}`);
  }
}

log(`klaar — ${failures} monitor(s) stuk, ${incidentsToHandle.length} open incident(en), ${opsEscalations.length} escalatie(s), ${userTasks.length} gebruikerstaak(en), ${chatTasks.length} chatvraag/vragen`);
