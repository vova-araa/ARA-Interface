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

## Ark + district-leven + zichtbaarheidsconfig
- [x] **Ark van Noach** op een mini-Ararat met sneeuwtop aan de zuidwestrand (altijd in beeld), met cirkelende witte duif en warm raamlicht; grote Ararat blijft verre horizon-decor.
- [x] **District-leven per venture**: Trading — candlestick-bars die live groen/rood bewegen · Elevate — schildersezel met kleurverschuivend doek + bewegende kwast · Traject/TMS — planbord met lopende route-stippen + rondrijdende vrachtwagen · Blex — shuntende truck + geparkeerde trailer · Uprising/Vovara — opstijgende muzieknoten. LOD-aware (verborgen bij ver uitzoomen).
- [x] **hiddenVentures** door de hele stack: org.json (`["misc"]`) → world.config → pods, threads, minimap, overzicht, token-pilaren, chips. Nor Kaghak is uit de interface; onbekende repo's onzichtbaar tenzij expliciet in projects.json. Data wint: een expliciet misc-project houdt zijn district. Unit-getest.

## Super-animatie batch (referentie: drukke platform-look)
- [x] **Ambient bewoners** per district: werkers die lopen→pauzeren→verder scharrelen; dichtheid schaalt eerlijk met echte activiteit (stil district 2, druk district tot 7). LOD-aware.
- [x] **Props-clutter**: rode kratstapels, zonnepanelen, knipperende antennes, vaten, mini-domes — deterministisch verspreid over cluster-ringen (~60% van ring-hexes).
- [x] **Platform-look**: districten als dikke verhoogde platforms (h 0.56) met fellere/dikkere gloeirandjes; basisgrond donkerder voor contrast.
- [x] **Orbit-vonken** in tool-kleur rond werkende pods; **wapperende Armeense driekleur** op de Cascade.
- [x] **`?time=day|night|dawn|dusk`** forceert het palet (demo's/screenshots).
- [x] **QualityGovernor**: meet echte fps eerste 4s; <25fps → schaduwen uit + dpr 1 (oude iPhones). Container (software-rendering): 8→10fps na ingreep; op GPU-hardware n.v.t.

## Batch: geluid, agent-variatie, tests, details (autonome check-in 10/9)
- [x] **Geluidsontwerp** achter de 🔔-toggle: warme twee-noten chime bij taak/sessie-afronding, zachte lage plof bij tool-fouten; één gedeelde AudioContext, rate-limited (max 1 klank/400ms).
- [x] **Figuur-variatie per agentType**: scout/Explore paarse helm + telescoop · Plan blauwe helm + klembord · worker gele bouwhelm + gereedschapsriem · manager/supervisor/chief donker pak + rode stropdas.
- [x] **3 nieuwe endpoint-testsuites** (20 collector-tests totaal): /usage validatie+clamping+upsert+dagfilter, /world+refresh, /stats groepering + /history bereik.
- [x] **Landmark-details**: warehouse roldeur + verlichte raampjes, stage-speakers, billboard-spotjes.
- [x] **2 echte bugs gevonden & gefixt door de nieuwe tests**: (1) `/world/refresh` schreef bij ontbrekende projects.json + hidden misc een wereld met 0 districten (demo-fallback nu ook in de collector-fallback, DEMO_PROJECTS gedeeld); (2) `placementForProject` crashte op een lege districts-array (guard + veilige plek buiten beeld). Plus `ARA_WORLD_CONFIG` env zodat tests nooit het echte world.config.json aanraken.

## Next (vereist de Mac)
- `./scripts/install.sh` op de Mac; echte sessie → pod <1s; iPhone via Tailscale; launchd-reboot-check.
- Phase 2 backlog in README.

## Blockers
- None. (SubagentStart/TaskCompleted/TeammateIdle hooks fire only on Claude Code versions that support them — degrades gracefully.)

## Living City Ultimate (gekozen door gebruiker)
- [x] **Cinematic postprocessing**: tilt-shift scherptediepte, bloom op alle emissives/rims, vignette, SMAA — de diorama-look uit de referentievideo's. Achter `postFxOn`.
- [x] **Bewegende zon**: positie volgt de echte kloktijd (06:00 oost → 22:00 west, elevatieboog), 's nachts een koele maan — schaduwen draaien mee met de dag; update 1×/5s.
- [x] **Juice**: hijskraan bij Truck & Trailers (draaiende arm, zakkende container), 2 bezorgdrones met pakketjes tussen districten (spinnende rotors, boogvlucht), stofwolkjes achter lopende figuren, squash & stretch pod-spawn (volume-behoud), vuurwerk bij afgeronde taken in schemer/nacht.
- [x] **Weer**: wolkschaduwen die traag over de grond glijden (overdag), eeuwige sneeuwval boven de Ararat-piek, schuim op het Sevan-meer.
- [x] **Governor in 2 trappen**: <25fps → schaduwen/postfx uit + dpr 1; <14fps → ook crowd/districtleven/drones/weer uit. Geverifieerd in container (2fps software-rendering → alles netjes uitgeschakeld, geen errors); op GPU-hardware blijft alles aan.

## Slotbatch remote (2026-09-10, avond)
- ✅ **CI op GitHub groen**: dubbele pnpm-versie in workflow gefixt; run #21 doorliep de volledige pipeline op een echte runner.
- ✅ **Adversariële review-hardening**: 2 review-agents, 27 geverifieerde findings gefixt — incl. kritieke auth-bypass (case-insensitieve routing), CORS-aanscherping, loopback-bind zonder token, dag-delta tokenbudget, redact-vóór-knippen, prompt>500-fix, scrub-tijd-fix, watchdog-locks/foutafhandeling, SSE-backpressure, geheugengrenzen, GPU-lek. Zie DECISIONS.md.
- ✅ **CLAUDE.md**: repo-gids voor elke toekomstige Claude-sessie op de Mac.
- ✅ **Demo-video**: `apps/viewer/scripts/record.mjs` (Playwright screencast); 30s opname naar gebruiker gestuurd.
- Hiermee is het remote bouwwerk afgerond; rest staat onder "Mac-installatie" hierboven.

## Upgrade-batch 1+2 (2026-09-10, nacht)
- ✅ 11 extra hooks in de plugin + 9 nieuwe event-kinds end-to-end (schema → reducer → hookmap → viewer).
- ✅ Nieuwe animaties: poortwachter (permissie), rode slagboom (denial), 🔧-reparatie na error, context-storm (compaction), model-morph + pod-gedaante per model, parallel-waaier (tool-batch), worktree-eiland met bruggetje, 📋-papiertje van hub naar pod (taak aangemaakt).
- ✅ Statusline-feed: /status endpoint + SSE + live context-buis naast elke pod; script `plugins/ara/hooks/statusline.mjs`.
- **Extra Mac-stap**: statusline activeren in `~/.claude/settings.json`:
  `"statusLine": { "type": "command", "command": "node <repo>/plugins/ara/hooks/statusline.mjs", "refreshInterval": 5 }`
  (met `ARA_TOKEN` in de omgeving als de collector met auth draait).

## OTel latency-physics (2026-09-11)
- ✅ OTLP-receiver in de collector + latency-EMA per sessie + SSE/GET; pods bewegen op échte tool-latency (snelle sessies hyperactief, trage zwoegen).
- **Extra Mac-stap** — telemetrie aanzetten in `~/.claude/settings.json` onder `"env"`:
  `"CLAUDE_CODE_ENABLE_TELEMETRY": "1", "OTEL_LOGS_EXPORTER": "otlp", "OTEL_METRICS_EXPORTER": "otlp", "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json", "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4747/otel", "OTEL_LOG_USER_PROMPTS": "0"`
  (draait de collector met token: ook `"OTEL_EXPORTER_OTLP_HEADERS": "X-ARA-Token=<token>"`.)

## Diorama Ultimate — graphics-overhaul (2026-09-11)
- ✅ Stap 1: filmic ACES-grade + procedurele Environment-IBL + N8AO + rijkere composer.
- ✅ Stap 2: maath-damping camera, camera game-feel (shake/idle-drift/focus-pull), GPU-wind op bomen, fireflies (Sparkles), drone-trails.
- ✅ Stap 3: Monument-Valley-shading (koele schaduw-tint + fresnel-rim via stylize.ts) op de platforms, ink-outlines op de pods.
- ✅ Stap 4: abrikozenbloesem-petals (1 instanced draw), crowd-kopjes die tijdens pauze rondkijken.
- Alles achter de QualityGovernor, nul nieuwe render-deps, nul externe assets. Op je Mac (echte GPU) draait dit op 60fps met alle lagen aan.

## Kantoren per project (2026-09-12)
- ✅ Elk huisje op de kaart heeft een eigen 3D-kantoor: klik het projectlabel (of `?office=<project>`).
- ✅ Per branche geperfectioneerd: Sharzi TMS (ritplanning), Truck & Trailers (wagenpark + garage), handelsvloer, crypto-vloer (18 munten), design/studio/muziek, generiek.
- ✅ Bureaurijen met werkende agents, naamplaatjes, zwevend resultaat, muurscherm met portefeuille + live grafiek, feitenfeed, glazen vergaderruimte, manager én chief in beeld.
- ✅ Klik op een bureau → detailpaneel met alle cijfers, belofte × geleverd en verloopcurve.
- ✅ Chat met agent/manager/chief; de vraag landt als bordtaak zodat de watchdog die rol wakker maakt.
- ✅ 36 unit tests + 4 Playwright-flows groen.
- **Mac-stap**: niets extra's nodig. Wil je andere munten/wagens/routes in een kantoor? Pas `offices` aan in `plugins/ara/org.json`.

## Hardening-batch (2026-09-13)
Vier geteste commits, alles wat remote te fixen was uit de eigen audit.

- ✅ **Watchdog ziet wat hij eerst miste**: collector-down gaat nu ook naar Telegram
  (met dedupe op inhoud); een headless agent die binnen 30s omvalt meldt zichzelf;
  na twee mislukte pogingen op dezelfde situatie stopt het spawnen; het dagbudget
  uit org.json blokkeert nieuwe spawns; kantoorchat-vragen (`CHAT: …`) worden nu
  écht opgepakt — die stonden op `manager:<venture>` en werden nooit uitgelezen;
  één keer per dag een levensteken, zodat stilte zelf het alarm is.
- ✅ **Kantoren zijn per bureau eerlijk**: `simulated` was een vlag per kantoor, nu
  telt elk bureau apart (`X/Y op echte data` in de balk). Cijfers zonder push
  krijgen `≈` en een gedempte kleur, een station waar >30 min niets binnenkwam
  wordt als verlopen gemarkeerd.
- ✅ **Dataveiligheid**: tool-input wordt afgekapt (`capValue`), gestopte subagents
  verdwijnen na een uur uit `/state`, usage-rijen blijven 30 dagen (de 7-daagse
  event-ring wiste de dag-basislijn), WAL-checkpoint + dagelijkse VACUUM,
  timing-safe tokenvergelijking, `/health` meldt `lastEventAgeSec`, en
  `pnpm --filter @ara/collector backup` maakt een consistente kopie (14 bewaard).
- ✅ **Ops**: de losse viewer-agent op :4748 is weg — de collector serveert dezelfde
  `dist/` al op :4747, en twee servers op één build betekende alleen maar twee
  kansen op verouderde code. De collector draait nu onder `caffeinate -s` (een
  slapende Mac stopte de hele wereld), de plists worden `chmod 600` geschreven
  (er staan `ARA_TOKEN` en de Telegram-sleutel in), de watchdog herbouwt
  `apps/viewer/dist` zodra die ouder is dan de broncode (anders draait de browser
  na een `git pull` een andere reducer dan de collector) en roteert launchd-logs
  boven 20 MB.
- **Mac-stap**: draai `./scripts/install.sh` opnieuw — die bootout't de oude
  `com.ara.viewer` zelf en zet de nieuwe plists goed. Daarna is `http://localhost:4747`
  het enige adres dat je nodig hebt.

## Uitbouw: bewezen keten + gemeten cijfers (2026-09-13)
- ✅ **De spawn-keten is nu bewezen, niet aangenomen**: `pnpm verify:agents` maakt een
  bordtaak, start een echte headless `claude -p --agent ara-worker`, laat die een
  commando draaien en controleert dat de échte uitvoer op het bord staat — met een
  verse nonce die hij onmogelijk kan verzinnen. Deel 2 doet hetzelfde voor de
  kantoorchat: vraag → bordtaak → `ara-manager` → antwoord terug in dezelfde ruimte →
  taak gesloten. Beide delen PASS.
- ✅ **Chat-taken zijn nu uitvoerbaar**: de bordtaak bevat twee plakbare curl-commando's
  (host, token en taak-id ingevuld) in plaats van een beschrijving. Zonder dat kon een
  headless agent een vraag simpelweg niet beantwoorden.
- ✅ **`--plugin-dir` bij elke spawn**: `--agent` hing aan de marketplace-installatie;
  was die niet gedaan of stuk, dan bestond de rol niet en viel de sessie meteen om.
- ✅ **Gemeten-tab in elk kantoor**: git leest de repo (branch, commits vandaag/7 dagen,
  laatste commit, onopgeslagen wijzigingen), het bord telt taken, de usage-tabel telt
  tokens. Niet meetbaar = regel staat er niet. Geverifieerd tegen deze repo.
- **Mac-stap**: zet een `path` bij elk project in `projects.json` — dan leest de
  Gemeten-tab die repo automatisch uit. Draai daarna één keer `pnpm verify:agents`
  om de hele keten op jouw Mac hard te maken (kost één korte haiku-sessie).

## Organisatie per categorie (2026-09-13)
- ✅ **Playbook per tak**: managernaam, vaste rollen, terugkerend werk, harde escalaties,
  validatiechecks en databronnen. Wat je niet invult in `org.json` komt uit het
  branche-standaard, dus een nieuwe venture start nooit met een leeg kantoor.
- ✅ **Vijf vakrollen erbij**: ritplanner (TMS), wagenparkbeheer (fleet), marktanalist
  (handel/crypto — strikt read-only), creatieve uitvoering (design/studio/muziek) en
  cijferaanvoer (zet echte standen in het kantoor).
- ✅ **`GET /org`**: de organisatie als data, achter dezelfde auth als de rest.
  Supervisor en manager halen hun playbook daar op in plaats van org.json te lezen.
- ✅ **Kantoor toont de structuur**: chief → manager → vaste rollen → wie er nú draait.
  Een rol zonder sessie is zichtbaar een lege stoel, geen bezette. Terugkerend werk,
  escalatieregels en niet-aangesloten databronnen staan op het paneel.
- ✅ **Read-only hard vastgezet**: `ara-market-analyst` en `ara-reporter` hebben geen
  Edit/Write. Vier structurele tests (0 tokens, in CI) bewaken dat, plus dat elke
  playbook-rol echt bestaat en alleen leidinggevenden mogen spawnen.
- ✅ **`pnpm verify:agents` deel 3**: de analist krijgt de opdracht orderlogica te
  wijzigen en weigert met ESCALATE. Live geverifieerd.
- **Mac-stap**: vul per tak de `dataSources` in `org.json` (`how` + `configured: true`)
  zodra je weet waar de echte cijfers vandaan komen. Tot die tijd melden de rollen het
  als open punt in plaats van iets te verzinnen.

## Alle 7 takken één voor één goedgezet (2026-09-14)
Per tak met de eigenaar doorgenomen: rollen, bevoegdheden en databronnen.
Van 11 naar 28 agentdefinities; van 4 naar 10 structurele invarianten in CI.

| Tak | Rollen | Bijzonder |
|---|---|---|
| Sharzi TMS | planner · facturatie · chauffeur/klantcontact · integratie · cijfers | planner en facturatie zonder Edit/Write; contactrol zonder Bash/WebFetch |
| Truck & Trailers | wagenpark · keuringen · kosten · trailers · data · cijfers | hele vloer read-only |
| Handelsvloer | analist · risico · journaal · eventscout · bot-onderhoud · cijfers | één schrijver, met verboden gebied |
| Crypto-desk | + allocatie · veiligheidscheck · narratief · on-chain scout | CoinGecko publiek = eerste aangesloten bron |
| Elevate | ontwerper · copywriter · sitebewaker · scout · cijfers | klantproductie = ESCALATE |
| Uprising | productie · agendabewaking · copywriter · sitebewaker · web · cijfers | mag productie, behalve de boekingsflow |
| Vovara | releasebeheer · copywriter · sitebewaker · promo-scout · cijfers | site mag live, release uitbrengen nooit |

- **Publicatiegrenzen verschillen per tak**, op verzoek van de eigenaar: klantwerk
  streng, eigen zaak ruimer, onomkeerbare release het strengst.
- **Read-only is structuur, geen belofte**: 17 van de 28 rollen hebben geen Edit/Write;
  twee rollen die teksten naar buiten schrijven hebben geen Bash/WebFetch en kunnen
  dus niet publiceren.
- **Mac-stap**: vul per tak de resterende `dataSources` in `org.json`
  (`how` + `configured: true`). Alleen de crypto-koersen staan al aangesloten.

## Alle rollen doorgelicht + 2 nieuwe (2026-09-14)
- ✅ **Audit over alle 28 rollen**: 5 misten een escalatieroute, 4 een terugmeld-sectie,
  en `ara-worker` kende de 17 nieuwe rollen niet. Allemaal dicht.
- ✅ **Escalatievorm uniform**: elke vakrol begint een weigering met
  `ESCALATE: <reden>` op de eerste regel. Dit kwam uit een live testfout, niet uit
  een vermoeden — zie hieronder.
- ✅ **`ara-security-auditor`** (elke tak): secrets, kwetsbare dependencies,
  onbeschermde endpoints en te ruime rechten. Noemt locatie en soort van een gevonden
  sleutel, nooit de waarde — anders lekt hij hem een tweede keer in het bord.
- ✅ **`ara-data-engineer`** (TMS + fleet): migraties met een werkende terugweg, getest
  tegen een kopie. Voert nooit uit op productie; code kun je terugdraaien, data niet.
- ✅ **`pnpm verify:agents` test nu 6 rolgrenzen live**: elke risicorol krijgt de
  opdracht die hij juist niet mag uitvoeren. Alle 6 weigeren correct.
- ✅ **10 → 13 structurele invarianten** in CI, waaronder: elke vakrol heeft een
  escalatieroute, een terugmeld-sectie én de machine-leesbare escalatievorm.

## Handelslaag + aandelentak + actielijst (2026-09-14)
Agents kunnen nu zelf posities voorstellen. De limieten zitten in code, niet in prompts.

**De keten**: agent → `POST /trade/intent` → `evaluateIntent()` (12 regels, pure functie)
→ `routeIntent()` (modus + noodstop) → afwijzen · papier · wachten op akkoord · handoff.

- ✅ **Twaalf risicoregels**, elk met een test die 'm afzonderlijk laat blokkeren:
  geldige getallen, stop aan de juiste kant, bron, reden, witte lijst, risico per trade,
  doel/risico, blootstelling, aantal posities, posities per instrument, dagverlies,
  drawdown, afkoeling na verlies, handelsvenster.
- ✅ **Faalt dicht**: lege witte lijst = niets mag; rekeningwaarde 0 = niets toetsbaar.
  Een systeem dat niemand instelde, handelt niet.
- ✅ **Modus-ladder met slot**: `off → paper → approval → live`. Omhoog boven `paper`
  kan alleen met `ARA_TRADING_UNLOCK` in de omgeving van de collector — niet via de API,
  met opzet. Een opgeslagen `live` zonder slot zakt bij herstart terug naar paper.
- ✅ **Noodstop** wint van alles, ook van live. Hervatten zet terug op papier.
- ✅ **Audit-spoor**: elk voorstel met zijn volledige beoordeling, afwijzingen incluis.
- ✅ **Geen broker in deze repo**: in `live` levert de collector een *handoff*.
  ARA houdt nooit een sleutel met handelsrechten vast.
- ✅ **Aandelentak** (`equities`): eigen district, eigen kantoortaal (these, sector,
  kostprijs, weging, dividend, cijferdatum), en drie rollen — fundamenteel analist
  (these met breekpunt), cijferbewaking (agenda + tijdzone + bevestigd/schatting),
  portefeuillebeheer. Plus de gedeelde risicobewaker, journaal en uitvoering.
- ✅ **`ara-execution-trader`**: dient voorstellen in, beslist niets, houdt geen sleutel,
  en mag na een afwijzing niet opnieuw proberen met een aangepast voorstel.
- ✅ **Actielijst** (`/actions`, ✓ in de balk, toets `a`): handelsakkoorden, stilgelegde
  handel, vastzittende sessies, escalaties, storingen, niet-aangesloten databronnen en
  onbruikbare limieten — elk met het verzoek dat 'm afhandelt erin.

### Mac-stappen voor de handel
1. `data/trading-limits.json` aanmaken met `accountValue`, `allowedInstruments` en je
   grenzen. Zonder dat bestand komt er niets doorheen — dat is bedoeld.
2. Laat het eerst dagen in `paper` draaien en lees het audit-spoor terug.
3. Pas daarna: `ARA_TRADING_UNLOCK=yes-i-accept-the-risk` in de collector-plist,
   herstarten, en `approval` kiezen — nog niet `live`.
4. Broker-adapter schrijf je zelf, met je eigen sleutel. ARA krijgt die nooit te zien.

## Handel bewaakt terwijl je slaapt (2026-09-14)
- ✅ **Watchdog-sectie 1d**: noodstop, modus boven papier, onbruikbare limieten, stil
  gewijzigde limieten (vingerafdruk) en voorstellen die >30 min op akkoord wachten.
  Een schone stand blijft stil; live geverifieerd op alle drie de alarmen.
- ✅ **Audit-spoor is prune-vast**: een test bewijst dat een handelsbesluit van 400 dagen
  oud blijft staan terwijl een event van dezelfde leeftijd juist verdwijnt.
- ✅ **`verify:agents` deel 3 → 7 grenzen**: `ara-execution-trader` krijgt "verruim de
  limiet en dien opnieuw in" en weigert met ESCALATE. Alle zeven houden.

## Zes infrastructuurrollen (2026-09-14)
Van 33 naar **39 rollen**; 87 posities over 8 takken plus 3 vaste ops-rollen.
Bewust alleen rollen die **vandaag** werken — zonder dat er eerst een databron aan moet.

| Rol | Waar | Wat het gat was |
|---|---|---|
| `qa-verifier` | elke tak | elke worker keurde zijn eigen werk |
| `dependency-warden` | elke tak | security-auditor *meldt* alleen; niemand bumpte |
| `doc-writer` | elke tak | docs liepen achter zonder dat iemand het zag |
| `social-scheduler` | 3 creatieve takken | copywriter schreef, niemand plande |
| `backup-verifier` | ops, wekelijks | een backup die je nooit terugzette ís er geen |
| `org-auditor` | ops, maandelijks | 39 rollen en niemand die ze doorlicht |

- **Gereedschap volgt de grens**: qa-verifier, backup-verifier en org-auditor hebben geen
  Edit/Write (een controleur die repareert, controleert daarna zichzelf); social-scheduler
  heeft bovendien geen Bash/WebFetch en kán dus niet plaatsen.
- **16 invarianten** in CI (was 13): + de controlerende rollen kunnen niet repareren,
  + de ops-rollen bestaan en zijn read-only, + wie wél schrijft benoemt zijn grens.
- **Niet gebouwd**: 7 rollen die een databron nodig hebben (route-optimizer, claims-handler,
  driver-planner, backtest-runner, seo-analyst, competitor-watch, cashflow-watch) en 3 die
  bestaande rollen zouden overlappen. Zeven rollen die alleen `ESCALATE: geen bron` melden
  is ruis, geen organisatie.

## Handelsrapport (2026-09-14)
- ✅ **`pnpm trade:review [dagen]`** en `GET /trade/review?days=N`: het audit-spoor als
  leesbaar rapport, 0 LLM-tokens. De cijfers komen uit `buildTradeReview()` — een pure
  functie — zodat een rapport van deze week naast dat van vorige week te leggen is.
- ✅ **De belangrijkste tabel is "waarop het stukliep"**: veel afwijzingen op *risico per
  trade* betekent dat het systeem werkt; veel op *bron* of *reden* betekent dat een rol
  geen databron heeft — een gat in de configuratie, niet in zijn oordeel.
- ✅ **Herhaalpogingen** worden apart uitgelicht: een afgewezen voorstel dat binnen het uur
  terugkomt is precies het gedrag waartegen de limieten bestaan.
- ✅ **Uitkomst in R**, niet in euro's, met de verwachtingswaarde vóór de trefkans.
- ✅ **Drempels als aftekenlijst** (30 trades, 20 actieve dagen, positieve verwachting,
  <10% vormfouten, geen herhaalpogingen, niets wachtend) — geen advies over echt geld.
- ✅ **`/ara-trade-review`** slash-command dat het rapport draait en bespreekt, met de
  opdracht niets na te tellen en geen handelsadvies te geven.
- Live geverifieerd tegen een gevuld spoor: 4 voorstellen, 1 door, blokkades correct
  geteld, +2,00R op een winst van 400 bij 200 risico.

## Weekrapport via Telegram (2026-09-14)
- ✅ **Maandagochtend één bericht** met wat de week deed: voorstellen, waarop het stukliep,
  papieren uitkomst in R, herhaalpogingen, en welke drempels nog open staan. 0 LLM-tokens.
- ✅ **De tekst komt uit `formatReviewMessage()`** in dezelfde module als de cijfers, dus
  het bericht kan nooit iets anders melden dan het rapport zegt. Getest op inhoud én lengte
  (< 1500 tekens, leesbaar in één blik op een telefoon).
- ✅ **Een lege week is óók een bericht** zolang de handel niet uit staat: zeven dagen zonder
  één voorstel is meestal een kapotte koppeling, geen rustige week.
- ✅ **`ARA_TRADE_WEEKLY=now`** stuurt het rapport meteen — testhaak én knop voor tussendoor.
  `=0` zet het uit.
- Live geverifieerd met een dryrun-Telegram: de payload bevatte het volledige rapport.

## Elke rol zijn eigen werk, en iemand die het komt halen (2026-09-18)
De vloer stond vol functieomschrijvingen en het bord bleef leeg. Dat is nu dicht,
in twee helften die alleen samen werken.

- ✅ **Elke duty noemt zijn eigenaar**: `Duty.who` in `packages/shared/src/org.ts`.
  Leeg = de manager van de tak, zoals het was; ingevuld = de rol die het werk doet.
  100 duties over de negen branche-standaarden (93 daarvan bij de acht echte takken),
  plus drie ops-duties in `org.json`. `playbookPrompt()` zet de eigenaar achter elke
  taak, zodat een manager zijn playbook niet meer als eigen werk leest.
- ✅ **Vijf structurele controles** in `packages/shared/src/duties.test.ts` (0 tokens,
  in CI): elke specialist heeft werk · elke `who` wijst naar een stoel die in diezelfde
  tak bestaat · geen tak draait grotendeels op dagelijks werk (dat is budget, geen ritme)
  · de rollen die géén databron nodig hebben hébben werk · de spawn-prompt noemt de
  eigenaar. Ops erbij: backupcontrole, organisatie-audit en beveiligingsaudit moeten
  terugkerend werk hebben, anders is een backup weer een bestand waarvan je hoopt.
- ✅ **Watchdog sectie 11 — uitvoering** (`ARA_DISPATCH=1`, standaard uit): wekt de rol
  die open bordwerk op zijn naam heeft. Wie het langst wacht eerst, `ARA_DISPATCH_MAX`
  (2) rollen per tick, na twee mislukte pogingen op dezelfde taken stopt het spawnen met
  een melding. `manager:ops`, `supervisor`, `chief` en `CHAT:`-taken worden overgeslagen
  (die hebben elders hun eigen spawn); werk bij een rol die niet in de organisatie staat
  wordt gelogd in plaats van stilzwijgend genegeerd.
- **Ritme en uitvoering horen bij elkaar.** Alleen `ARA_RHYTHM` aanzetten geeft een bord
  dat volloopt zonder dat er iemand komt — dat was de stand.
- **Mac-stap**: zie `ops/24-7.md` fase 0.3, één commando zet beide schakelaars aan.

## De organisatie leest haar eigen spoor (2026-09-18)
- ✅ **`buildRetro()`** in `packages/shared/src/retro.ts`: het takenbord terug als rapport.
  Pure functie, 0 LLM-tokens, net als het handelsrapport. `GET /retro?days=N`, `pnpm retro`
  (`--json` voor ruwe data). Per rol: totaal, af, mislukt, geëscaleerd, open en de mediaan
  doorlooptijd — mediaan en geen gemiddelde, want één taak die drie dagen bleef hangen
  vertelt anders het hele verhaal.
- ✅ **Elke bevinding draagt zijn bewijs**: taak-id én titel (max 5, met het totaal erbij).
  Een voorstel zonder taak-ids is een mening, en die kun je niet natrekken.
- ✅ **Onder de drempel zegt het rapport niets**: <5 taken voor een rol ⇒ geen percentage,
  <8 in het venster ⇒ `tooQuiet` en er draait helemaal geen verbeterronde. Eén escalatie
  op twee taken is geen patroon van 50%.
- ✅ **Terugkerend playbook-werk is uitgezonderd** van "dit blijft terugkomen" — dat werk
  hóórt terug te komen. Zonder die uitzondering meldt de terugblik elke week hetzelfde.
- ✅ **Watchdog sectie 12 — verbeterronde** (`ARA_IMPROVE=1`, standaard uit,
  `ARA_IMPROVE_DAYS=7`): `ara-org-auditor` schrijft per bevinding hoogstens één voorstel
  op het bord, met de taak-ids eronder. Eén ronde per dag, en alleen als er iets gemeten
  is om naar te wijzen. Hij wijzigt zelf niets aan code, org.json of het ritme.
- ✅ **Kruiscontrole**: `shouldVerify()` in dezelfde module, gewired in `PATCH /tasks/:id`,
  aan te zetten met `ARA_QA_SAMPLE=<percentage>` op de collector (0 = uit). Steekproef,
  want elke controle kost een sessie. Deterministisch op het taak-id, dus dezelfde db
  oordeelt na een herstart hetzelfde. **Een controle wordt nooit zelf gecontroleerd** —
  en escalaties evenmin: die wachten op een mens.
- ✅ 23 nieuwe shared-tests (68 totaal), collector op 47.

## Het budget telt alleen zijn eigen agents (2026-09-18)
- ✅ **`ARA_SPAWNED_ROLE`** gaat mee in de omgeving van elke spawn, `plugins/ara/hooks/usage.mjs`
  draagt het als `spawnedBy` naar `/usage`, en de db bewaart het als `spawned_by` (leeg = de
  eigenaar zelf). `/usage` geeft `agentTokens` en `agentCacheCreateTokens` erbij; de watchdog
  toetst het dagbudget alleen daarop.
- Waarom dit moest: een dag eigen ontwikkelwerk zette de agents stil terwijl die niets hadden
  uitgegeven. **Gemeten: 15,9 miljoen tokens tegen een budget van 2 miljoen, waarvan 14,1
  miljoen cache-creatie uit één ontwikkelsessie.**
- ✅ Losse `ALTER TABLE`-migratie op `usage` én `usage_days`, dus een bestaande database
  groeit mee zonder iets te verliezen.
- ✅ **Een ontbrekende `ARA_LOCK_DIR` zette stilzwijgend élke kostenrem uit**: de eenmalige
  alarmen, de pogingenteller en het slot tegen dubbele spawns schrijven alle drie in een
  lege catch. Geen foutmelding, wel eindeloos alarmeren en doorspawnen tot het budget op is.
  Eén `mkdirSync` bij het starten van de watchdog.

## Kantoor met een bord, en een keten die klopt (2026-09-18)
- ✅ **`OfficeWork`** in `packages/shared/src/office.ts`: elk kantoor draagt het bord van
  zijn eigen project — escalaties apart van de rest, `doneToday` geteld op `updatedAt`, en
  `truncated` zodat het kantoor "≥" zegt als de limiet geraakt is. Je zag wie er zat, niet
  waar hij mee bezig was.
- ✅ **`isEscalated()` is nu de enige lezing** van "dit wacht op een mens", gedeeld door het
  kantoor, de actielijst en de kruiscontrole. Twee lezingen betekent dat een escalatie in de
  ene lijst wel staat en in de andere niet.
- ✅ **Iedereen heeft een plaats in de keten**: `StaffTier`, `reportsTo` (wijst altijd naar
  een lid dat er ook echt staat) en `depth` (0 = chief, afgeleid uit `reportsTo`).
- ✅ **Crypto en aandelen hebben eigen kolommen** in plaats van die van de FX-vloer te erven.
- ✅ **`packages/shared/src/office.test.ts`** bestaat: het kantoormodel had als enige grote
  gedeelde module nog geen eigen tests.

## Viewer los van de collector + het meer in shared (2026-09-18)
- ✅ **`?api=https://…`** in `apps/viewer/src/api.ts`: de viewer vindt de collector ook als
  hij er niet naast staat (eenmalig via de URL, daarna localStorage; leeg = terug naar
  dezelfde herkomst). `sanitizeBase()` laat alleen http/https door — een pagina die elk
  schema slikt, laat een geprepareerde link bepalen wat er in jouw sessie draait.
- ✅ **`pnpm --filter @ara/viewer build:artifact`** bouwt hem met relatieve paden naar
  `dist-artifact/`, te hosten als losse pagina voor de telefoon terwijl de collector op de
  Mac blijft draaien.
- ✅ **Sevan staat nu in `world.ts`**, niet alleen in de viewer. De layout zag het water niet
  en zette projectclusters er gewoon op: truck-and-trailer lag met 4 van zijn 7 hexen in het
  meer, en `HexGround` tekent die tegels niet — een kantoorknop die je niet kunt indrukken.
- ✅ **Clusters blijven binnen de terreinschijf**: `placeClusterOnFreeHex` zoekt eerst binnen
  `WORLD_HEX_RADIUS` en pas daarna erbuiten, en toetst het hele cluster in plaats van alleen
  zijn hart. Twee projecten op dezelfde tegel weet niet welk kantoor het moet openen.

## De backup die er nooit was (2026-09-19)

Vier agents draaiden tegelijk (`ARA_DISPATCH_MAX=4`) tegen de demo-collector: org-auditor,
qa-verifier, doc-writer en backup-verifier. Drie leverden; de vierde kwam terug met
`ESCALATE:` — `~/Backups/ara` bestond niet, nul backupbestanden, het commando was hier nog
nooit gedraaid. Hij weigerde terecht zelf een backup te maken: dat is een schrijfactie op
de machine van de eigenaar en zijn rol is nakijken.

- **Watchdog sectie 7b** maakt nu dagelijks de kopie (`pnpm --filter @ara/collector backup`,
  0 tokens) zodra de nieuwste in `ARA_BACKUP_DIR` ouder is dan `ARA_BACKUP_HOURS` (24).
  Niet aan de klok gebonden, dus een slapende Mac haalt het later in. Mislukt hij, dan
  één Telegram-melding per dag. `ARA_BACKUP=0` zet het uit; standaard aan, want het kost
  niets en de verifier had anders elke week hetzelfde te melden.
- `apps/collector/src/watchdog.test.ts` pint vast: uit is uit, lege map krijgt één kopie,
  binnen het venster komt er geen tweede (anders 288 per dag).
- De doc-writer's README-correcties zijn nagelopen op betekenis vóór overname: "Alle drie"
  klopt omdat het diagram erboven drie schakelaars noemt, prioriteit 1 telt in org.json zes
  takken, en het backup-commando bestaat als script in `apps/collector/package.json`.

## Blex: de eerste twee bronnen zijn een bestand (2026-09-19)

Tweeëntwintig van de 23 databronnen staan los, en de eerste twee van het wagenpark —
voertuigen met keuringsdata, chauffeurs met termijnen — zijn rekenwerk op een lijst die
de eigenaar al heeft. Dus geen koppeling maar een CSV.

- `packages/shared/src/fleet.ts`: parser (`;`/`,`, BOM, aanhalingstekens, drie
  datumvormen, `31-02` is geen datum) en `fleetDeadlines()` met `DEADLINE_WINDOWS`
  (14/30/60) als getal — regel 1. Lege datum = `ontbreekt`, achteraan in de lijst maar
  wél in de lijst — regel 4. Zes tests.
- Collector `GET /fleet` (`ARA_FLEET_DIR`, 60s cache) en `withFleetSources()`: een
  aanwezig bestand markeert de bron in `/org` en `/actions` als aangesloten. Endpoint-test
  pint vast: zonder bestand niet aangesloten, met bestand uitgerekend en uit de actielijst.
- `ops/fleet/`: voorbeeldbestanden + README met kolommen. `ara-compliance-watch` leest
  `/fleet` en escaleert met de exacte bestandsnamen als beide ontbreken.

Wat de eigenaar doet: twee bestanden neerzetten. De andere drie Blex-bronnen
(garagepunten, kosten, trailers) blijven in de actielijst tot ze er zijn.

## Alle 22 bronnen hebben een bestand (2026-09-19)

De vraag was "koppel alle nodige bronnen". Koppelen aan een TMS, een broker of een
boekingssysteem kan ARA niet zelf — en een sleutel mag hij niet hebben. Wat wél kan: elke
bron één bestand geven met een kolomlijst, zodat het enige wat de eigenaar nog doet
*neerzetten* is.

- `packages/shared/src/sources.ts`: registry van 22 specs (tak, exact playbook-label,
  bestand, verplichte/datum/getalkolommen). Test: elke niet-aangesloten playbook-bron heeft
  een spec en elke spec hoort bij een playbook-bron — de registry kan niet uit de pas lopen.
- Collector `sources.ts`: `ARA_SOURCES_DIR` (standaard `data/sources/`), standen
  `ontbreekt`/`leeg`/`gevuld`, 60s cache, `withFileSources()` vervangt de blex-only variant.
  `GET /sources`, `GET /sources/:tak/:bestand`. Alleen gevuld = aangesloten: een kop zonder
  regels heeft niets gemeten (regel 4). Endpoint-test loopt de drie standen af, plus een
  verkeerde kop die als fout terugkomt in plaats van als stille lege bron.
- `playbookPrompt()` noemt nu ook de aangesloten bronnen mét pad — een rol wist vroeger wel
  dát er data was, niet waar.
- `pnpm sources:init` maakt alle ontbrekende bestanden aan met alleen de kop;
  `ops/sources/README.md` is de tabel. `ops/fleet/` is daarin opgegaan; het wagenpark leest
  `data/sources/blex/`.

Wat de eigenaar doet: `pnpm sources:init`, bestanden vullen in volgorde van opbrengst
(`ops/24-7.md` fase 2). Wat er níét komt: een broker- of exchange-koppeling.

## De bureaus vullen zichzelf uit de bronnen (2026-09-19)

Een kantoor toonde voorbeeldcijfers tot een reporter-sessie ze kwam vervangen — een sessie
per keer, voor een cijfer dat al in het bestand stond. `stationsFromSources()` in
`packages/shared/src/officefeed.ts` doet dat nu zonder tokens, per branche: wagenpark
(kenteken = bureau, APK ≤14 d = alarm, open garagepunten = waarde), ritten (vertraagd
eerst, ETA voorbij), posities (pnl = waarde, zonder stop = alarm), portefeuilles (weging
alleen als élke regel een waarde heeft; boven `max_pct` = alarm), opdrachten (deadline
<7 d), boekingen (komend eerst, aanvraag = alarm), releases en planning.

- `StationOverride.staleAfterMs`: een weekbestand van drie dagen oud is niet "verouderd";
  de dertig minuten blijven gelden voor een agent-push. Een push over dezelfde werkplek
  wint van het bestand.
- Twee parserfouten gevonden door de tests: kolomnamen met `_` werden platgeslagen
  (`waarde_usd` → `waardeusd`, dus elke registry-kolom met onderstreping was onleesbaar),
  en `120.500` las als 120,5. Nu: één punt met drie cijfers erachter is een NL-duizendtal.
- Endpoint-test: zonder bron voorbeeldcijfers, met `vehicles.csv` echte bureaus,
  agent-push wint. Zeven tests op de voeding zelf.

## Vier agents tegelijk, en een review die vijftien dingen vond (2026-09-19)

Parallel gedraaid in eigen worktrees: viewer-herkomst (`source` op elke werkplek, "uit
vehicles.csv · 3d oud" in het detailpaneel), zeventien rolbestanden met een sectie "Waar je
leest" (`GET /sources/<tak>/<bestand>`, gepind in `agents.test.ts`), watchdog sectie 7c
(onleesbaar bronbestand → één Telegram-melding per dag; levensteken telt "X van Y gevuld"),
en een read-only review van de bronnenlaag. Die review vond één blocker en zeven bugs, alle
verholpen mét test:

- **Blocker**: een lege sleutelcel (`;;` als laatste regel van een Excel-export) gaf een
  TypeError in een async Express-handler zonder catch → proces dood → launchd herstart →
  viewer vraagt opnieuw: crash-lus uit een CSV. Nu: `readTable` slaat de regel over en
  meldt hem; `/office` zit in try/catch en antwoordt 500. Data doodt de collector nooit.
- **Afkappen zonder sortering**: een verlopen APK op regel 13 was onzichtbaar. Elke branche
  sorteert nu op ernst vóór `STATION_CAP`, en `stationsTruncated` zegt hoeveel er afviel.
- **Regel 4**: `pnl ?? 0`, `streams ?? 0`, "0 storingen" zonder garagelijst — verzonnen
  nullen op een echte werkplek. Nu `valueMissing`; de viewer laat het zwevende cijfer weg.
- **Twee getalparsers** op hetzelfde bestand (`120.500` → 120500 óf 120,5): één parser.
- **Daggrens**: `Math.floor` vanaf `now` maakte een APK van vandaag om tien uur "verlopen";
  rekenen vanaf middernacht UTC, ook voor ETA's en boekingen.
- **Caches**: `/fleet` had een eigen cache die `?refresh=1` niet leegde; nu één signaal.
- **`sources:init`** kon een vers geüpload bestand overschrijven (warme cache + `writeFile`):
  nu `?refresh=1`, `flag: 'wx'`, en weigeren als de collector op een andere machine draait.
- Verder: verouderde agent-push wint niet meer van een vers bestand, paden relatief aan de
  repo i.p.v. cwd, `ARA_BACKUP_HOURS=abc` valt terug op 24, `statSync` binnen de try,
  ISO-datums met `Z`/ms, dubbele munten één bureau, `staleAfterMs` per bron (maandexport 40 d).

## Wat in de bronnen ligt, staat in de actielijst (2026-09-19)

Een verlopen APK stond in het Blex-kantoor — een plek waar je toevallig wel of niet in
kijkt. `sourceAlerts()` (`packages/shared/src/sourcealerts.ts`, pure, 0 tokens) leest
dezelfde tabellen als het kantoor en zet in `GET /actions` wat op een mens wacht:
verlopen termijnen van wagens en chauffeurs (blokkerend), termijnen ≤14 d, garagepunten
>14 d open, ritten vertraagd of over hun ETA, onbetaalde facturen na de vervaldatum,
posities zonder stop (blokkerend), munt of sector boven `max_pct` (aandelen per sector,
dus `portefeuille.csv` krijgt een `sector`-kolom; ontbreekt die ergens, dan zwijgt het
oordeel), opdracht-deadlines <7 d, aanvragen >2 d onbeantwoord, onbevestigde boekingen.

- Grenzen als getal: `ALERT_THRESHOLDS` + `DEADLINE_WINDOWS`. Termijnen lopen via
  `fleetDeadlines`, dezelfde functie als `/fleet` — geen tweede lezing die net anders telt.
- Nooit een knop: ARA plant geen keuring en zet geen stop. Ids zijn stabiel per feit.
- Kind `source-alert` in de actielijst ("📋 Uit de bronnen"). Vijf tests op de regels, één
  endpoint-test die een verlopen APK en een positie zonder stop bovenaan de lijst ziet.

## Tweede review, twaalf punten (2026-09-19)

Een tweede read-only review op de bronacties en de herschreven kantoorvoeding. Alles
verholpen, elk met test:

- **Weggelaten kolom ≠ ontbrekende termijn.** De tekst zei "laat de kolom weg als de termijn
  niet geldt", de code telde élke afwezige kolom als gat. Nu geldt: geen kolom = geldt niet;
  lege cel in een bestaande kolom = gat. In `readVehicles`, `fleetRows` én `fleetDeadlines`.
- **Twee lezingen van dezelfde portefeuille**: kantoor dedupte (eerste lot), actielijst
  sommeerde — bureau "in orde", lijst "boven je grens". Nu sommeren beide (twee lots = één
  positie).
- **Studio**: een aanvraag verdween achter een bevestigde boeking van dezelfde klant/ruimte;
  aanvragen sorteren vooraan en de datum zit in het bureau-id. `truncated` telt nu ook wat
  de dedupe wegliet.
- **Actie-ids uniek**: datumfeit in het id (garagepunt, aanvraag, boeking) en een volgnummer
  (`#2`) als hetzelfde feit twee keer in het bestand staat.
- **Onleesbaar ≠ leeg**: `betaald: ja` werd stil `undefined` en dus "onbetaald". `readTable`
  meldt nu een onleesbare cel als fout; sectie 7c pikt dat op. Een `;;;;`-staart is een lege
  regel (geen fout meer), een 0-byte bestand is *leeg*, niet *onleesbaar*.
- **Volgorde**: `createdAt: 0` zette een APK van gisteren bóven een handelsvoorstel dat
  straks verloopt; bronacties zijn nu zo oud als de lijst zelf.
- **Watchdog**: `ARA_DAILY_PING=now` stuurde niets als het dagbericht al weg was (eigen
  sleutel); 7c zegt "onleesbaar" alleen bij een bron zonder bruikbare regels en "N regel(s)
  geweigerd" bij een gevulde bron met fouten.
- **Spec-dekking**: `sector` (aandelen) en `koers` (crypto) stonden niet in de spec, dus
  `sources:init` schreef ze niet in de kop en niemand kreeg ooit een sectoralarm. Nu
  `optional`-kolommen, en een Proxy-test die per tak vastpint dat kantoor en actielijst
  alleen spec-kolommen lezen.
- **Kalenderdag lokaal** (`dayStart` in fleet.ts, één plek): om 00:30 in Amsterdam is
  "vandaag" niet gisteren. `configured: true` uit org.json houdt zijn eigen `how`. `/actions`
  trekt één klok voor alle takken.

## De artifact is een etalage, geen venster (2026-09-19)

De eigenaar opende de artifact op zijn telefoon en kreeg "Geen collector gevonden" met een
adresveld. Dat veld had nooit kunnen werken: een pagina die claude.ai host mag van de
browser geen fetch, SSE of WebSocket naar een andere host doen (CSP, zonder foutmelding),
ook niet naar een Tailscale-adres. `build:artifact` bouwt nu met `--mode showcase`: altijd
de demo-wereld, geen adresvraag, en één keer een kaart (`ShowcaseNote`) die zegt dat dit
de demo is en waar de echte staat — de PWA die de collector zelf serveert via
`expose.sh tailnet`. Geverifieerd op 390 px: demo-chip, kaart, geen verbindingsscherm,
nul externe verzoeken. `?api=` blijft bestaan voor een viewer die je zélf ergens host.

## QR naar de telefoon, en drie routes die open stonden (2026-09-19)

- **📱-knop in de balk** (desktop): `PhonePanel` tekent een QR-code van het Tailscale-adres
  dat de collector via `GET /access` meldt (`tailscale status --json` → DNS-naam; `tailscale
  serve status` → geeft hij poort 4747 door?). Token reist mee in de code. Geen Tailscale
  ⇒ geen lege QR maar het commando `./scripts/expose.sh tailnet`. Op de telefoon zelf is de
  knop verborgen. Dep: `qrcode` (gebundeld, geen CDN — de viewer draait ook offline op het
  tailnet).
- **Auth-gat**: `/sources`, `/fleet` en `/retro` stonden niet in `API_PATHS`; met `ARA_TOKEN`
  gezet waren ze open. Nu erin, samen met `/access`, en een test leest de regex uit de bron
  en eist elke dataroute — een nieuwe route die vergeten wordt valt in CI.
- **`trades.csv` voor crypto en aandelen** (registry 24): zelfde vorm als trading, in R.
  `ara-trade-journal` leest alle drie.
