# PROGRESS

## Done
- [x] **Step 1 — Scaffold**: pnpm monorepo, `@ara/shared` (zod schema, redaction, hex math, deterministic layout, WorldState reducer), `@ara/collector` (SSE, SQLite ring buffer, state rebuild on boot), fixture generator. 16 unit tests. ✅ curl smoke passed.
- [x] **Step 2 — Plugin**: `plugins/ara` hooks (11 events → emit.sh, fire-and-forget), ensure-collector on SessionStart, `POST /hook/:name` payload mapping, ara-status skill, /ara-open, /ara-map, orchestrator skeleton, marketplace.json. ✅ end-to-end emit.sh→SSE verified incl. secret redaction.
- [x] **Step 3 — World**: instanced hex terrain, districts from world.config.json, glowing venture borders, ortho isometric camera, touch controls (pan/pinch/two-finger rotate).
- [x] **Step 4 — Pods+figures**: full status state machine (idle/working/needsHuman/done/error), agents walk in with tool icons + speech bubbles, demo mode `?demo=1` loops the fixture.
- [x] **Step 5 — UI**: top bar counters, thread panel (desktop) / bottom sheet (mobile), venture chips, search, follow-live, detail drawer with timeline, fly-to on click.
- [x] **Step 6 — Armenia dressing**: Ararat backdrop, dawn sky, clouds, Cascade stairs + Mother Armenia hub, khachkar/truck-depot/warehouse/billboard/stage/obelisk/mic-statue landmarks, apricot trees, Sevan lake.
- [x] **Step 7 — Polish**: confetti/flags/beacons/smoke/sparkles, camera nudge + screen pulse + togglable beep, instanced tiles, figure cap 200, SSE reconnect banner + /state replay.
- [x] **Step 8 — Ops**: launchd plists + scripts/install.sh (bootstrap/enable/kickstart, plugin install, tailnet URL print), README with phone instructions.
- [x] **Step 9 — QA**: Playwright smoke — desktop render + demo story + drawer, live reconnect state, iPhone 390×844 bottom sheet + no horizontal overflow. 3/3 green.

## Uitbouw-batch (na eerste oplevering)
- [x] **Time-scrubber**: laatste 24u replay vanuit SQLite, LIVE-knop, replay-chip in topbar (spec §6-gap gedicht).
- [x] **Lichtdraad parent-pod → agent-figuur** (additive blend, verdwijnt bij agent-stop) — spec §8 DoD.
- [x] **Soak-test** `pnpm soak`: 3 sessies × 30s × 10 ev/s → PASS (882/882 events op SSE, POST p95 3.7ms, /state 3.4ms).
- [x] Bugfixes: `doneToday` telt per sessie éénmaal; venture-chips filteren nu ook de threadlijst; detail-drawer live + werkend in demo-mode (in-memory event buffer).
- [x] Wereld auto-remap: fs.watch op projects.json → SSE `world`-event → viewers herladen de map zonder refresh.
- [x] Topbar "Needs you" klikbaar → cyclet/vliegt naar sessies die je nodig hebben.
- [x] Sound/follow-live persistent (localStorage).
- [x] 8 hookmap unit tests + doneToday test (23 unit tests totaal).
- [x] GitHub Actions CI: typecheck, unit tests, build, Playwright smoke (nu ook scrubber-flow), accelerated soak.

## Online-ready batch
- [x] Collector serveert de gebouwde viewer → één deploybare service (lokaal op :4747, Render-ready); SPA-fallback, API-routes uitgezonderd.
- [x] `ARA_TOKEN` auth: Bearer / X-ARA-Token / ?token= (SSE), /health open; emit.sh stuurt token mee; viewer pakt ?token= en bewaart in localStorage. 1 nieuwe auth-testsuite.
- [x] `render.yaml` blueprint: build+start, persistent disk voor SQLite, healthcheck, ARA_TOKEN verplicht via dashboard. PORT-env support in collector.
- [x] PWA: manifest + icons (Chromium-gerasterd) + apple-meta → iPhone Home Screen full-screen.
- [x] 3D-labels: venture-naam boven elk district, projectnaam boven elk cluster (canvas-sprites, geen font-fetch).
- [x] `/stats` endpoint (events/errors per project per uur) + 24u activiteits-sparkline in de detail-drawer.

## Recursieve workforce
- [x] Besluit: geen Render — alles via Claude Code zelf; render.yaml weg, README aangepast (auth + single-port blijven voor tailnet).
- [x] ara-orchestrator Phase 2: dispatch-loop met SPAWN-REQUEST protocol (workers vragen agents aan, orchestrator spawnt), headless `claude -p` sessie-recursie per project, budget-guardrails.
- [x] ara-worker agent + /ara-run command.
- [x] Viewer: parent→child figuurdraden (goud) via parentAgentId; fixture toont geneste agent (c2 → c3).
- [x] Empirisch bevestigd: subagents hebben geen Agent-tool (nesting geblokkeerd) → daarom breedte + sessie-recursie als ontwerp.

## Toegangslaag (telefoon + laptop, alles via Claude Code)
- [x] `scripts/expose.sh`: tailnet (Tailscale Serve HTTPS) / public (Funnel, weigert zonder ARA_TOKEN) / off / status.
- [x] `emit.sh` remote-aware: lokale collector 0.2s, remote 3s — altijd gebackgroundd (gemeten: 3ms exit, sessie wacht nooit).
- [x] `ensure-collector.sh` start niets op een remote host; alleen probe.
- [x] ARA_TOKEN in de launchd plist via install.sh (`export ARA_TOKEN=… && ./scripts/install.sh`).
- [x] Cloud/telefoon Claude Code-sessies: ARA_COLLECTOR_URL + ARA_TOKEN in de environment + plugin → events landen in dezelfde wereld. README-toegangsmatrix.
- [x] `/ara-open` toont nu ook serve/funnel-URLs.

## Web-capability
- [x] `pnpm browse <url>`: headless-Chromium screener (titel/meta/koppen/tekst/links als JSON, volledige tekst + screenshot naar /tmp/ara-browse), proxy- en NO_PROXY-aware, `--mobile`/`--full`/`--wait`. End-to-end geverifieerd tegen lokale site (status 200 + extractie + screenshot).
- [x] `ara-web-scout` agent: WebSearch/WebFetch eerst (native, nul setup), browser alleen voor JS-zware pagina's/screenshots; read-only regels (geen logins/formulieren/downloads).
- [x] Orchestrator + worker kennen de scout (SPAWN-REQUEST type); install.sh installeert Chromium eenmalig automatisch.
- [x] NB: externe sites zijn in déze cloud-container geblokkeerd door netwerkpolicy — op de Mac geldt dat niet; WebSearch/WebFetch werken overal native.

## Organisatie-laag (supervisor → managers → agents)
- [x] **Takenbord** in de collector: POST/PATCH/GET /tasks (open→claimed→done/failed, parentId, assignee-conventie `supervisor` / `manager:<venture>` / `agent:<rol>`), auth-gated, SSE 'tasks'-event. 2 nieuwe testsuites (14 collector-tests).
- [x] **ara-supervisor** (vervangt orchestrator): enige stem naar de gebruiker, zet taken op het bord, start managers als headless sessies, poll't het bord, escaleert i.p.v. gokken. Budget: 3 managers / 6 concurrent / 12 totaal.
- [x] **ara-manager**: draait als eigen sessie (eigen pod!), claimt bord-taken, spawnt zélf workers/scouts (kan dat als top-level sessie), sluit af met bord-updates; `ESCALATE:` protocol. Budget: 4 concurrent / 8 totaal.
- [x] /ara-run → supervisor; /ara-report dagrapport-command met `/loop 24h /ara-report` recept.

## Features-batch 2
- [x] **Day/night cycle**: lucht, fog en licht volgen de lokale tijd (nacht/dageraad/dag/schemer), check per minuut.
- [x] **Minimap** (klikbaar): districten in venture-kleur, pods op status, needs-human ring; klik vliegt naar de sessie. Verborgen op mobiel.
- [x] **Walkcycle**: benen + armen zwaaien tegengesteld tijdens het inlopen.

## Organisatie-beleid (antwoorden gebruiker, verankerd in org.json + agents)
- [x] Managers per venture, **on-demand** (geen staande organisatie zonder werk).
- [x] Autonomie: **branch + rapport** — `ara/*`-branches; mergen/deploy/geld = escalatie.
- [x] Rapportage: **escalaties direct + dagrapport** (`/loop 24h /ara-report`).
- [x] Prioriteit-1 ventures: Traject, Blex, Uprising, Trading (trading: live orderlogica read-only).

## Token-tracking & -discipline
- [x] `usage.sh`/`usage.mjs` hook op Stop+SessionEnd: parseert het transcript (dedupe per message-id), POST absolute totalen naar `/usage`. Kost 0 LLM-tokens, altijd gebackgroundd. End-to-end getest incl. dedupe.
- [x] Collector: usage-tabel (upsert per sessie) + `GET /usage` (per project, vandaag). Auth-gated.
- [x] Viewer: uitklapbare token-tabel onderin het panel (per project: in/uit/cache) + totaalteller; poll 60s.
- [x] `/ara-report`: ⚡ TOKENS VANDAAG sectie (cache apart — ~10× goedkoper).
- [x] Token-discipline verankerd in org.json (`models` + `tokenRules`) en alle agentrollen: haiku-first voor scouts/simpele workers, Grep/Glob vóór Read, fragmenten i.p.v. hele bestanden, bordresultaten ≤5 regels, kale spawn-prompts, poll via curl (0 tokens), batching van subtaken.

## Inrichtingsbesluiten (vragenronde 2)
- [x] Repo-conventie: `~/dev/<projectnaam>` (delegatie: "overzichtelijkst"); in README + org.json (`repoRoot`).
- [x] Validatie: `checks`-veld per project in projects.json, anders autodetect package.json-scripts (delegatie: "wat het beste is"); in ara-worker.
- [x] Tokenbudget: **2M/dag** in org.json; ⚡-teller toont totaal/budget en kleurt amber + ⚠ boven budget; dagrapport opent met waarschuwing bij overschrijding.
- [x] Eerste run na deploy: kleine taak in Traject (audit + top-5 TODO's) — bewijst supervisor→manager→worker→bord.

## 24/7 ops-laag (draait zonder gebruiker)
- [x] **Watchdog** (`scripts/watchdog.mjs`, launchd elke 5 min, 0 tokens): zelfherstel collector/viewer via launchctl, monitors.json-checks, incident-taken met dedupe, auto-sluiten bij herstel, spawnt manager:ops alleen bij open incidenten (lock, TTL 30 min), spawnt supervisor bij escalaties.
- [x] **ara-ops-manager** (manager:ops, vast): claim→diagnose→herstel (operationeel direct, code op `ara/incident-*`)→verificatie tegen dezelfde check→bord-resultaat; na 2 mislukte pogingen escalatie naar supervisor.
- [x] **Supervisor incident-feedbackprotocol**: eerste escalatie = concrete feedback + herkansing voor manager:ops; tweede keer (of onveilig) = needsHuman-notificatie naar de mens + dossier op het bord.
- [x] `monitors.json` met ara-zelfbewaking + placeholders voor eigen sites; org.json `ops`-sectie; watchdog-plist in install.sh.
- [x] Keten end-to-end getest: incident aanmaken → dedupe → auto-herstel-sluiting → escalatie-detectie → juiste spawn-triggers (4 runs, alles klopte).

## Uitbouwlijst-batch (Phase 2 compleet)
- [x] **Takenbord-UI** in de viewer (☷ in topbar): escalaties (amber), actief, afgerond; live via SSE 'tasks' + 60s poll; mobiel als bottom sheet.
- [x] **Tap-to-prompt vanaf telefoon**: "Nieuwe taak voor de supervisor…" formulier → bord (createdBy user) → watchdog spawnt de supervisor binnen ±5 min. Daarmee is het laatste originele Phase-2 punt (prompten vanaf de telefoon) gedekt zonder extra bridge.
- [x] **Telegram-push**: notify.mjs (Bot API, dryrun-modus); watchdog pusht needsHuman-meldingen éénmalig per sessie (lock-dedupe); env vars via install.sh in de watchdog-plist. Getest: correcte payload + dedupe.
- [x] **Token-pilaren in 3D**: gouden muntstapel per project (log-schaal, 1-8 munten) naast het cluster; ververst per minuut.
- [x] **Supervisor run-journal**: RUN-LOG taken (assignee journal) — leest laatste 3 bij start, schrijft er één bij afronden; follow-ups worden meegenomen of expliciet uitgesteld.
- [x] Defensief: /usage-client valt terug op 2M budget bij oudere collector.

## Bouwplan-audit (laatste gaten gedicht)
- [x] **LOD** (spec §6): ver uitgezoomd → tool-icons, speech bubbles en projectlabels uit (venture-labels blijven); schakelt via camera-zoom in de render-loop.
- [x] **Swipe-gestures mobiel** (spec §6): grip in de bottom sheet — omlaag vegen sluit; opener-grip onderaan het scherm — omhoog vegen (of tikken) opent de threadlijst.
- [x] **Duur-soak**: 5 minuten × 3 sessies × 8 ev/s → **PASS**: 7056/7056 events op SSE, 0 fouten, POST p50 2.0ms / p95 3.7ms / p99 13.6ms, /state 3.1ms. Geen degradatie over de duur. 30-min variant op de Mac: `ARA_SOAK_SECONDS=1800 pnpm soak`.

## ARA Chief (super-agent, directe lijn met de gebruiker)
- [x] `ara-chief` agent: intake voor alles (taak nu / gepland / nieuwe agent-rol / org-beleid / monitoring / vraag), zet het op de juiste plek, bevestigt compact. Rol-sjabloon voor nieuwe agents (verplicht: doel, bordprotocol, token-discipline, vangrails). Beschermde regels alleen te versoepelen op expliciet gebruikersverzoek.
- [x] `/ara <bericht>` command — de directe lijn; leeg = compacte briefing.
- [x] **Planning**: taken met assignee `gepland` + `due: <datum>` in detail; watchdog promoveert ze naar de supervisor zodra de datum verstreken is. End-to-end getest (verlopen → gepromoveerd + spawn-trigger; toekomstig → blijft staan).
- [x] Watchdog spawnt supervisor nu ook voor chief-taken; supervisor-instructies en org-chart (README, org.json) bijgewerkt: chief ↔ gebruiker, supervisor operationeel.

## Animatie + overzicht batch
- [x] **Overzicht-dashboard** (⊞ / toets `o`): venture-cards met 24u-sparkline, sessies/bezig/⚠/fouten, tokens, open taken; klik = vlieg naar recentste sessie; Esc sluit. Playwright-gedekt.
- [x] **Live event-ticker** linksonder: laatste 6 betekenisvolle events (start/klaar/tools/agents/⚠), 12s fade, verborgen op mobiel en bij open drawer.
- [x] **Sneltoetsen**: `/` zoeken · `f` follow · `b` bord · `o` overzicht · `Esc` sluit alles.
- [x] **Ambient life**: 2 cirkelende adelaars (klappende vleugels), dobberend zeilbootje op het Sevan-meer, eeuwige vlam bij de hub (flikkerend puntlicht, feller in schemer/nacht).
- [x] **Pod-animaties**: veerkrachtig uit de grond bij spawn (~0.6s), beëindigde sessies dommelen in (kleiner, licht gedimd), koepels gloeien 's nachts.
- [x] **Camera-intro**: 2s fly-in van ver naar de standaard-zoom bij laden.

## Next (vereist de Mac)
- `./scripts/install.sh` op de Mac; echte sessie → pod <1s; iPhone via Tailscale; launchd-reboot-check.
- Phase 2 backlog in README.

## Blockers
- None. (SubagentStart/TaskCompleted/TeammateIdle hooks fire only on Claude Code versions that support them — degrades gracefully.)
