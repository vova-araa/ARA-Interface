# ⬡ ARA World

Real-time isometric 3D world that visualizes every Claude Code session, thread,
agent and tool-call across all projects — set in a cartoon Armenia: Ararat on
the horizon, pink tuff hexes, khachkars, Cascade stairs as the hub and a
Sevan-blue lake.

![architecture](#architecture)

## Quick start (Mac)

```bash
./scripts/install.sh
```

That's everything: installs deps, builds the viewer, installs two launchd
agents (collector + viewer, restart on reboot), registers the `ara` Claude Code
plugin and prints your URLs.

| URL | What |
|---|---|
| `http://localhost:4748` | Live world |
| `http://<tailnet-ip>:4748` | Same, on your iPhone over Tailscale |
| `http://localhost:4748/?demo=1` | 2-minute animated demo story (no live sessions needed) |

### iPhone
1. Make sure Tailscale is connected on both Mac and iPhone.
2. Open `http://<tailnet-ip>:4748` in Safari (`tailscale ip -4` on the Mac, or see the collector log — it prints the URL on start).
3. Pinch to zoom, drag to pan, two fingers to rotate. Tap a pod → detail drawer. ☰ opens the thread bottom-sheet.

## How it works

```
Claude Code session (any repo)
  │  hooks (SessionStart, PreToolUse, …) → plugins/ara/hooks/emit.sh
  ▼    fire-and-forget curl, <20ms, never blocks the session
apps/collector  :4747   POST /hook/:name · POST /event · GET /events (SSE) · GET /state
  │    SQLite 7-day ring buffer · secret redaction · cwd→project resolution
  ▼
apps/viewer     :4748   React Three Fiber isometric hex world + thread UI
packages/shared         event schema (zod) · WorldState reducer · hex math · world layout
plugins/ara             hooks + ara-status skill + /ara-open + /ara-map + ara-orchestrator
```

- **Pod** = session. Idle breathes, working pulses in the tool's color, needs-you gets an amber beacon + ring, done gets a green cap + confetti, errors flicker red.
- **Figure** = agent/subagent. Walks in from the district edge, carries a tool icon (📖 Read, 🔨 Edit, 🔧 Bash, 🔍 Grep, 🔭 WebSearch, 📣 Task, 🔌 MCP), shows a speech bubble with the tool summary.
- **Districts** = ventures (Traject, Blex, Elevate, Uprising, Trading, Vovara). Placement is a deterministic hash of the project name — positions never shuffle. Unknown repos land in **Nor Kaghak**.

## Commands

| Command | Effect |
|---|---|
| `pnpm dev` | Run collector + viewer (dev, HMR) |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | The usual |
| `pnpm fixture` | Regenerate the demo story |
| `pnpm map` | Rebuild `world.config.json` from `projects.json` |
| `pnpm browse <url> [--shot]` | Headless-Chromium screener: tekst, meta, links, screenshot |
| `/ara-open` (in Claude Code) | Print URLs + open the viewer |
| `/ara-run <doel>` (in Claude Code) | Orchestrator verdeelt werk over agents/projecten |
| `/ara-map` (in Claude Code) | Re-map world after editing projects.json |
| `ara-status` skill | One-screen "what needs me" summary |

The project list comes from `~/.claude/skills/dev-project-manager/projects.json`
(entries may set `name`, `path`, `repo`, `venture`, `checks`). Conventies:
repos staan onder **`~/dev/<projectnaam>`** (dan is `path` optioneel), en
`checks` is een array met validatie-commando's die workers vóór "done"
draaien (ontbreekt het veld, dan autodetecteren ze `test`/`typecheck`/`lint`
uit package.json). No file → a demo world is generated so the viewer is
never empty.

## De organisatie

```
JIJ ↔ ara-chief (/ara <bericht>)          — jouw directe lijn: taken, planning,
 │                                          nieuwe agent-rollen, org-wijzigingen
 └─ ara-supervisor (/ara-run <doel>)      — operationele top
     └─ takenbord (collector /tasks)      — al het werk & alle resultaten
         │   assignee "gepland" + due-datum → watchdog promoveert op tijd
         └─ manager:<venture> + manager:ops — headless sessies, eigen pod
             └─ ara-worker / ara-web-scout / Explore
```

Voorbeelden voor de chief: `/ara laat traject de facturen-export fixen` ·
`/ara plan voor vrijdag een dependency-update in alle repos` · `/ara maak een
agent-rol die wekelijks de Supabase-kosten checkt` · `/ara verhoog het
tokenbudget naar 3M` · `/ara houd https://mijnsite.nl in de gaten`.

Beleid (in `plugins/ara/org.json`): managers **on-demand** per venture ·
schrijfwerk alleen op **`ara/*`-branches** (mergen/deployen/geld = escalatie
naar jou) · trading-venture is read-only op live orderlogica · prioriteit 1:
Traject, Blex, Uprising, Trading.

## Tokens

Elke sessie telt zichzelf: een hook parseert het transcript op Stop/SessionEnd
(0 LLM-tokens) en meldt totalen aan de collector. In de viewer: ⚡-teller
onderin het thread-panel (uitklapbaar per project, cache apart). In het
dagrapport: de ⚡ TOKENS VANDAAG-tabel. Zuinigheid is beleid
(`plugins/ara/org.json` → `tokenRules`): haiku-first voor scouts/simpele
workers, Grep vóór Read, kale spawn-prompts, curl-polling, batching.

## 24/7 zonder jou

```
watchdog (launchd, elke 5 min, 0 tokens)
  ├─ collector/viewer down? → zelf herstarten (launchctl)
  ├─ monitors.json checken (jouw sites) → stuk? → INCIDENT-taak op het bord
  ├─ hersteld vóór iemand keek? → taak zelf sluiten
  ├─ open incidenten → spawn manager:ops (vaste storingsdienst, eigen pod)
  └─ escalaties → spawn supervisor (feedback + 1 herkansing) → pas dan needsHuman naar jou
```

- **manager:ops** is de vaste manager: diagnose (logs, processen, `pnpm browse`-screenshots), operationele fixes direct (restart/cleanup), codefixes op `ara/incident-*`-branches, altijd verificatie tegen dezelfde check als de watchdog.
- LLM-tokens worden **alleen** verbrand als er echt iets stuk is; het bewaken zelf is gratis. Locks voorkomen dubbele spawns (max 1 ops-manager tegelijk, TTL 30 min).
- Jouw sites toevoegen: `plugins/ara/monitors.json` → `enabled: true` (optioneel `bodyContains` en `launchdService` voor zelf-herstart).
- Jij ziet alleen: de amber needsHuman-melding bij een echte impasse + alles in het dagrapport.

## Ops

- launchd agents `com.ara.collector` / `com.ara.viewer` (`~/Library/LaunchAgents`), `KeepAlive` — survive reboots, logs in `~/Library/Logs/ara-world/`.
- The plugin's `SessionStart` hook health-checks the collector and kickstarts it via launchd if it's down, so the world is alive the moment a session starts.
- Restart manually: `launchctl kickstart -k gui/$(id -u)/com.ara.collector`.

## QA

```bash
pnpm --filter @ara/viewer exec playwright test   # desktop + iPhone viewport smoke
pnpm -r test                                     # shared + collector unit tests
pnpm soak                                        # load test: 3 sessions × 60s × 10 ev/s
```

CI (GitHub Actions) runs typecheck, unit tests, viewer build, Playwright smoke
and an accelerated soak on every push.

**Time-scrubber**: the pill at the bottom of the live view replays the last 24h
from SQLite — drag to any moment, hit LIVE to return.

## Toegang: telefoon én laptop, alles via Claude Code

Geen externe hosting — de Mac + Tailscale is het platform. De collector
serveert de gebouwde viewer, dus **één poort (4747) is de hele stack**.

| Waar ben je | URL | Hoe |
|---|---|---|
| Mac zelf | `http://localhost:4747` | niets nodig |
| Laptop/telefoon op je tailnet | `http://<tailnet-ip>:4747` | Tailscale-app aan; iPhone: PWA "Zet op beginscherm" |
| Tailnet, maar met HTTPS | `https://<mac>.<tailnet>.ts.net` | `./scripts/expose.sh tailnet` |
| Overal (geen Tailscale op het apparaat) | zelfde HTTPS-URL | `./scripts/expose.sh public` — **vereist ARA_TOKEN**, open eenmalig met `?token=…` |

### Cloud- en telefoon-sessies van Claude Code zelf

Sessies die niet op de Mac draaien (claude.ai/code, de mobiele app) kunnen hun
events in dezelfde wereld laten landen:

1. Zet funnel aan: `./scripts/expose.sh public` (met `ARA_TOKEN` geïnstalleerd).
2. Geef die sessies/environments twee env vars: `ARA_COLLECTOR_URL=https://<mac>.<tailnet>.ts.net` en `ARA_TOKEN=<token>`.
3. Installeer daar de `ara` plugin (deze repo is een plugin-marketplace).

`emit.sh` herkent een remote collector automatisch (ruimere timeout, altijd
fire-and-forget — een sessie wacht nooit), en `ensure-collector.sh` probeert
vanzelfsprekend niets te starten op een remote host.

Token setup op de Mac: `export ARA_TOKEN="$(openssl rand -hex 24)" && ./scripts/install.sh`
(de launchd agent krijgt het token mee; hooks sturen `X-ARA-Token` automatisch).

## Phase 2 — alles gebouwd ✔

- ✔ Telegram-push: `scripts/notify.mjs` — zet `ARA_TELEGRAM_BOT_TOKEN` + `ARA_TELEGRAM_CHAT_ID` vóór `./scripts/install.sh` en de watchdog pusht elke needsHuman-melding naar je telefoon (eenmalig per sessie). Dagrapport: `/loop 24h /ara-report`.
- ✔ Tap-to-prompt vanaf de telefoon: ☷ takenbord in de viewer → "Nieuwe taak voor de supervisor" → binnen ±5 min opgepakt (watchdog spawnt de supervisor).
- ✔ Echte per-venture taakverdeling: supervisor → managers → agents via het bord.
- ✔ Kosten per district: token-muntstapels in de 3D-wereld + ⚡-tabel + dagbudget.
