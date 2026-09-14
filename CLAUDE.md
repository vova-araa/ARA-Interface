# ARA World — repo-gids voor Claude Code sessies

Real-time isometrische 3D hex-wereld (Armenië-thema) die elke Claude Code
sessie, agent en tool-call visualiseert. Gevoed door een Claude Code plugin
met hooks; draait 24/7 lokaal op de Mac van de eigenaar, bereikbaar via
Tailscale op telefoon en laptop.

## Structuur

```
packages/shared/    @ara/shared   — zod-schemas, WorldState-reducer, hex-math, wereldlayout
apps/collector/     @ara/collector — Express + better-sqlite3 (poort 4747), serveert ook viewer-dist
apps/viewer/        @ara/viewer   — React Three Fiber (dev-poort 4748)
plugins/ara/        Claude Code plugin: hooks, commands, org.json, agents:
                    leiding  — chief, supervisor, manager, ops-manager (mogen spawnen)
                    generiek — worker, web-scout
                    vak (per tak, zie GET /org):
                      tms      — planner, invoice-auditor, dispatch-comms
                      fleet    — fleet-tech, compliance-watch, fleet-cost, trailer-manager
                      handel   — market-analyst, risk-guard, trade-journal, event-scout, bot-maintainer
                      crypto   — + allocation-guard, token-safety, narrative-scout
                      creatief — designer (Elevate), studio-producer (Uprising),
                                 release-manager (Vovara), copywriter, site-watch, booking-watch
                      aandelen — equity-analyst (these + breekpunt), earnings-watch
                      handel    — execution-trader (dient voorstellen in bij de risicomotor)
                      data     — data-engineer (migraties; nooit op productie)
                      overal   — reporter (echte kantoorcijfers),
                                 security-auditor (secrets, deps, blootstelling)
scripts/            watchdog.mjs (24/7, 0 LLM-tokens), notify.mjs (Telegram), install.sh, expose.sh (Tailscale)
ops/                launchd plists (templates; install.sh vult placeholders + chmod 600)
data/               runtime: SQLite db, world.config.json-kopieën, logs (niet committen)
```

Belangrijke leesvolgorde voor context: `PROGRESS.md` (wat af is + Mac-stappen),
`DECISIONS.md` (waarom-keuzes), `plugins/ara/org.json` (org-beleid).

## Commands

```bash
pnpm install                 # workspace
pnpm dev                     # collector (4747) + viewer (4748) parallel
pnpm -r typecheck            # 3 packages
pnpm test                    # 36 unit tests (shared + collector, node:test via tsx)
pnpm --filter @ara/viewer exec playwright test   # 4 smoke-flows (desktop, iPhone, kantoor)
#   Let op: preview serveert dist/ — draai eerst `pnpm --filter @ara/viewer build`,
#   anders test je een oude build (CI bouwt wél eerst).
pnpm fixture                 # demo-events in de db laden
pnpm map                     # world.config.json (her)genereren
pnpm soak                    # soak-test tegen draaiende collector (ARA_SOAK_SECONDS=…)
pnpm verify:agents           # end-to-end: spawn-keten + kantoorchat + 6 harde rolgrenzen
#   Kost één korte haiku-sessie aan tokens — het enige stuk dat niet zonder LLM
#   te testen is. Draai 'm na installatie en na elke Claude Code-update.
```

Container/CI-bijzonderheden:
- Playwright: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` in deze container;
  onbekend/leeg = standaard Playwright-Chromium (CI, Mac). Nooit `playwright install` in de container.
- Geen GPU in de container → SwiftShader ~2–8fps; de QualityGovernor schakelt dan
  postfx/sier-lagen uit. `?fx=force` in de viewer-URL forceert alles aan (screenshots).
- Egress-proxy blokkeert externe sites; npm/GitHub werken wel. `NO_PROXY` staat al goed
  voor localhost-tests.

## Conventies

- TypeScript strict; shared wordt als TS-source geconsumeerd (`exports` → `src/index.ts`), geen build-stap voor shared.
- Reducer-symmetrie is heilig: collector en viewer draaien exact dezelfde
  `WorldState`-reducer uit `@ara/shared`. Statelogica NOOIT in maar één van de twee wijzigen.
- Events replayen op `ORDER BY ts, rowid` (zelfde-ms events!).
- Secrets: alle event-payloads door `redactValue`/`capText` in shared voordat ze de db in gaan.
- Viewer onder ortho-camera: drei `<Html>` NOOIT met `distanceFactor` (schaalt kapot).
- Emoji/labels via canvas-sprites (`emojiTexture`), geen font-fetch.
- Hooks (`plugins/ara/hooks/emit.sh`) zijn fire-and-forget: curl met `--max-time`,
  gebackgroundend, altijd exit 0 — een kapotte collector mag Claude Code nooit blokkeren.
- Commit-berichten: gewone beschrijvende Engelse messages (bestaande stijl volgen).

## Kantoren (per project een interieur)

- Klik op een projectlabel in de wereld → `OfficeOverlay` opent het 3D-kantoor;
  `?office=<project>` is de diep-link (ook vanaf de telefoon).
- Samenstelling gebeurt in `packages/shared/src/office.ts` (`buildOffice`) zodat
  collector én viewer exact hetzelfde kantoor zien — dezelfde symmetrie-regel
  als de WorldState-reducer.
- De branche bepaalt layout en woordenschat (`OFFICE_KIND_BY_VENTURE`):
  tms = ritplanning, fleet = wagenpark/garage, trading + crypto = handelsvloer,
  design/studio/music = productie, generic = de rest.
- Entiteiten per branche (munten, wagens, routes) staan in `offices` in
  `plugins/ara/org.json` — dat is de plek om ze aan te passen.
- Agents leveren echte cijfers via `POST /office/:project/station`; zolang dat
  niet gebeurt vult `buildOffice` deterministisch in en staat `simulated: true`
  (de UI toont dan "voorbeeldcijfers" — nooit stilzwijgend nepdata).
- De **Gemeten-tab** is het tegendeel: `apps/collector/src/pulse.ts` leest git
  (branch, commits, laatste commit, dirty files — 60s cache), het bord telt taken
  en de usage-tabel telt tokens. Niet meetbaar ⇒ de regel ontbreekt; er wordt
  daar nooit iets ingevuld. Een project krijgt git-cijfers zodra het een `path`
  heeft in `projects.json`.
- Kantoorchat: `GET/POST /chat` met `room: "office:<project>"`. Een vraag van de
  gebruiker wordt óók een bordtaak bij de aangesproken rol, zodat de watchdog
  die agent wakker maakt en er echt antwoord komt.

## Handel (agents mogen posities voorstellen)

- Keten: agent → `POST /trade/intent` → `evaluateIntent()` (pure functie in
  `packages/shared/src/trading.ts`, 12 regels) → `routeIntent()` (modus + noodstop)
  → afwijzen · papier · wachten op akkoord · handoff.
- **Nooit een limiet in een prompt zetten.** Een limiet hoort in `evaluateIntent()`;
  een instructie is een suggestie, een pure functie is een grens. Nieuwe regel? Voeg 'm
  daar toe mét een test die 'm afzonderlijk laat blokkeren (`shared.test.ts`).
- **Faalt dicht**: lege `allowedInstruments` = niets mag; `accountValue: 0` = niets
  toetsbaar. Een kapotte `trading-limits.json` valt terug op de strengste stand.
- Modus-ladder `off → paper → approval → live`. Omhoog boven `paper` vereist
  `ARA_TRADING_UNLOCK=yes-i-accept-the-risk` in de omgeving van de collector — dit kan
  niet via de API, met opzet. Een opgeslagen `live` zonder slot zakt bij herstart terug.
- Noodstop (`POST /trade/halt`) wint van alles; `resume` zet terug op papier.
- **Geen broker-koppeling in deze repo, en ARA houdt nooit een sleutel met
  handelsrechten.** In `live` komt er een *handoff* klaar te staan voor een adapter die
  de eigenaar zelf draait.
- Elk voorstel wordt bewaard met zijn volledige beoordeling, afwijzingen incluis
  (`trade_intents`). Die tabel wordt niet meegeprund — een besluit over geld blijft staan.

## Actielijst

- `GET /actions` verzamelt alles wat op een mens wacht: handelsakkoorden, stilgelegde
  handel, vastzittende sessies, escalaties, storingen, niet-aangesloten databronnen,
  onbruikbare limieten. Knop ✓ in de balk, toets `a`.
- **Elke actie draagt zijn eigen verzoek** (`method` + `path` + `body`). De viewer weet
  niets over endpoints; een nieuw soort actie kost dus geen UI-wijziging. Zet
  `confirm: true` bij alles wat geld raakt of onomkeerbaar is.

## Auth & toegang

- `ARA_TOKEN` gezet ⇒ collector eist Bearer/X-ARA-Token/?token= op alle API-paden; `/health` blijft open.
- `scripts/expose.sh tailnet|public|off|status`; `public` (funnel) weigert zonder `ARA_TOKEN`.
- Eén poort in productie: **:4747** serveert API én de gebouwde viewer. :4748 is
  alleen de vite dev-server (`pnpm dev`) — er draait geen launchd-agent meer voor.
- De watchdog herbouwt `apps/viewer/dist` zodra die ouder is dan `apps/viewer/src`
  of `packages/shared/src`; een verouderde build betekent een andere reducer in de
  browser dan in de collector.

## Agent-org (plugins/ara)

- Hiërarchie: **chief** (enige contact met de gebruiker, `/ara`) → **supervisor** →
  **managers** per venture (on-demand) → workers/scouts; vaste **ops-manager** voor storingen.
- Communicatie loopt uitsluitend via het takenbord (collector `/tasks`); spawning via
  SPAWN-REQUEST of headless `claude -p` (subagents hebben zelf géén Agent-tool — bewezen).
- Spawns krijgen altijd `--plugin-dir plugins/ara` mee, zodat `--agent` niet afhangt
  van een geslaagde marketplace-installatie. Chat-taken dragen letterlijke curl-regels
  (host + token + taak-id): een headless agent kan geen endpoint-beschrijving uitvoeren.
- **Playbook per tak** (`packages/shared/src/org.ts` + `playbook` in org.json, samen
  opgehaald via `GET /org`): managernaam, vaste specialistenrollen, terugkerend werk,
  wat ALTIJD escaleert, validatiechecks en welke databronnen nog niet aangesloten zijn.
  Wat org.json weglaat komt uit het branche-standaard — een tak start nooit leeg.
  Supervisor en manager lezen `/org`, niet org.json.
- **Read-only is een garantie, geen belofte**: 17 van de 28 rollen hebben geen Edit/Write;
  `ara-dispatch-comms` en `ara-copywriter` hebben bovendien geen Bash/WebFetch en kunnen
  dus niet publiceren. `apps/collector/src/agents.test.ts` pint dat vast (0 tokens, in CI),
  samen met: elke playbook-rol bestaat als bestand, de frontmatter-naam matcht het bestand,
  alleen leidinggevende rollen hebben de Agent-tool, scouts benoemen dat ze niet adviseren,
  en elke creatieve rol benoemt zijn eigen publicatiegrens.
- **Weigeren begint met `ESCALATE:` op de eerste regel.** De manager en de watchdog
  zoeken letterlijk op dat woord; een weigering in proza komt nergens aan en laat de
  taak open staan. Elke vakrol heeft daarvoor de slotsectie "Als je moet escaleren" —
  nieuwe rol? Neem die sectie over, een test eist 'm.
- **Publicatiegrenzen verschillen per tak** (keuze van de eigenaar): Elevate = klantwerk,
  niets naar buiten; Uprising = eigen zaak, productie mag behalve de boekingsflow;
  Vovara = site mag live, een release uitbrengen nooit. Nieuwe rol erbij? Zet zijn grens
  in zijn eigen instructies, niet alleen in het playbook.
- Token-discipline: haiku-first voor scouts/simpele workers, Grep vóór Read, korte
  bordresultaten; dagbudget in `org.json` (`tokenBudgetDaily`).
- `watchdog.mjs` draait via launchd elke 5 min met 0 LLM-tokens; spawnt alléén agents
  bij incidenten of geplande taken. Niet ombouwen naar iets dat continu LLM-calls doet.

## Testen vóór elke push

`pnpm -r typecheck && pnpm test` altijd; Playwright-smoke bij viewer-wijzigingen.
CI (`.github/workflows/ci.yml`) draait dezelfde suites + fixture/map + soak.
pnpm-versie komt uit `packageManager` in package.json — niet dupliceren in de workflow.
