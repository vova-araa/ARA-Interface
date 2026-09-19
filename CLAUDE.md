# ARA World — repo-gids voor Claude Code sessies

Real-time isometrische 3D hex-wereld (Armenië-thema) die elke Claude Code
sessie, agent en tool-call visualiseert. Gevoed door een Claude Code plugin
met hooks; draait 24/7 lokaal op de Mac van de eigenaar, bereikbaar via
Tailscale op telefoon en laptop.

## Structuur

```
packages/shared/    @ara/shared   — zod-schemas, WorldState-reducer, hex-math, wereldlayout
                    pure rekenmodules (0 tokens, collector én viewer delen ze):
                      trading.ts  — evaluateIntent/routeIntent (de risicogrenzen)
                      tradereview.ts — buildTradeReview + formatReviewMessage
                      retro.ts    — buildRetro (het bord terugleest) + shouldVerify (kruiscontrole)
                      office.ts   — buildOffice, isEscalated, OfficeWork
                      org.ts      — playbooks, Duty (mét eigenaar), playbookPrompt
                      world.ts    — wereldlayout, WORLD_HEX_RADIUS, LAKE_CENTER/lakeKeys
apps/collector/     @ara/collector — Express + better-sqlite3 (poort 4747), serveert ook viewer-dist
apps/viewer/        @ara/viewer   — React Three Fiber (dev-poort 4748); kan via ?api= ook
                                   tegen een collector op een andere host praten
plugins/ara/        Claude Code plugin: hooks, commands, org.json, agents:
                    leiding  — chief, supervisor, manager, ops-manager (mogen spawnen)
                    generiek — worker, web-scout
                    vak (per tak, zie GET /org):
                      tms      — planner, invoice-auditor, dispatch-comms
                      fleet    — fleet-tech, compliance-watch, fleet-cost, trailer-manager
                      handel   — market-analyst, risk-guard, trade-journal, event-scout, bot-maintainer
                      crypto   — + allocation-guard, token-safety, narrative-scout
                      creatief — designer (Elevate), studio-producer (Uprising),
                                 release-manager (Vovara), copywriter, site-watch, booking-watch,
                                 social-scheduler (contentkalender als concept — plaatst nooit)
                      aandelen — equity-analyst (these + breekpunt), earnings-watch
                      uitvoering — execution-trader (dient voorstellen in bij de risicomotor;
                                 gedeeld door handel, crypto en aandelen)
                      data     — data-engineer (migraties; nooit op productie)
                      overal   — reporter (echte kantoorcijfers), qa-verifier (controleert
                                 andermans werk), dependency-warden (bumps op een branch),
                                 doc-writer (docs ↔ code), security-auditor (secrets, deps)
                      ops      — backup-verifier (wekelijks), org-auditor (maandelijks),
                                 security-auditor — staan in org.json onder ops.specialists
scripts/            watchdog.mjs (24/7, 0 LLM-tokens), notify.mjs (Telegram), install.sh,
                    expose.sh (Tailscale), retro.mjs + trade-review.mjs (rapporten, 0 tokens)
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
pnpm test                    # 123 unit tests (shared 74 + collector 49) + de viewer-smoke
pnpm --filter @ara/viewer exec playwright test   # 6 smoke-flows (desktop, iPhone×2, kantoor, acties); workers: 1, want vijf WebGL-flows tegelijk zonder GPU vallen om op timeouts
#   Let op: preview serveert dist/ — draai eerst `pnpm --filter @ara/viewer build`,
#   anders test je een oude build (CI bouwt wél eerst). De suite start zijn eigen
#   collector op :4757 met een wegwerp-ARA_DATA_DIR; :4747 blijft onaangeroerd.
pnpm fixture                 # demo-events in de db laden
pnpm map                     # world.config.json (her)genereren
pnpm soak                    # soak-test tegen draaiende collector (ARA_SOAK_SECONDS=…)
pnpm trade:review [dagen]    # handelsrapport uit het audit-spoor (0 tokens; --json voor ruwe data)
pnpm retro [dagen]           # terugblik op het bord: wie liep waarop vast (0 tokens; --json)
pnpm ara:update              # Mac bijwerken: pull → install → viewer-build → launchd herstart → /health
pnpm --filter @ara/viewer build:artifact   # viewer als losse pagina (dist-artifact/, relatieve
#   paden) om ergens anders te hosten; hij vindt de collector via ?api=https://…
pnpm --filter @ara/collector backup   # db-backup; ara-backup-verifier zet 'm wekelijks terug als proef
pnpm verify:agents           # end-to-end: spawn-keten + kantoorchat + 7 harde rolgrenzen
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
- Wereldlayout leeft in `world.ts`: `WORLD_HEX_RADIUS` (8), de districtring (3,5) en
  Sevan (`LAKE_CENTER`/`LAKE_RADIUS`) horen bij elkaar. Het meer staat in shared en niet
  alleen in de viewer, want de layout moet het als bezet terrein zien: `placeClusterOnFreeHex`
  zoekt eerst binnen de schijf en slaat watertegels over. Een platform op water of buiten
  het terrein tekent `HexGround` niet, en sinds een districttegel de knop naar het kantoor
  is, is dat een knop die je niet kunt indrukken.

De vier regels die niet mogen sneuvelen (elk heeft een test die 'm vastpint):

1. **Een grens staat in een pure functie, nooit in een prompt.** Een instructie is
   een suggestie; `evaluateIntent()`, `shouldVerify()` en `RETRO_THRESHOLDS` zijn
   grenzen. Nieuwe regel ⇒ daar, mét een test die 'm afzonderlijk laat blokkeren.
2. **Een controle wordt nooit zelf gecontroleerd.** `shouldVerify()` weigert alles
   wat met `CONTROLE:` begint of bij `ara-qa-verifier` staat. Zonder die regel maakt
   elke controle een nieuwe controle en betaal je voor elke schakel.
3. **Het dagbudget telt alleen sessies die ARA zelf startte** (`spawned_by`), niet het
   handwerk van de eigenaar. Zie "Dagbudget" hieronder.
4. **Een getal dat niet gemeten is, wordt weggelaten — niet ingevuld.** De Gemeten-tab
   laat de regel weg, de terugblik zwijgt onder zijn drempels, het handelsrapport rekent
   in R. Deterministisch invullen mag alleen mét `simulated: true` in beeld.

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
- **Het kantoor draagt het bord van zijn eigen project** (`OfficeWork` in office.ts):
  `escalations` staan apart van `open`, plus `doneToday` en `truncated` (≥, net als de
  kaart). Je zag wie er zat, niet waar hij mee bezig was.
- **`isEscalated()` is de enige lezing van "dit wacht op een mens"** — gedeeld door het
  kantoor, de actielijst en `shouldVerify()`. Twee lezingen betekent dat een escalatie in
  de ene lijst wel staat en in de andere niet, en dan vertrouw je geen van beide.
- **Elke stoel kent zijn plaats in de keten**: `StaffTier`
  (`chief`/`supervisor`/`manager`/`ops`/`specialist`/`floor`), `reportsTo` (wijst altijd
  naar een lid dat er ook echt staat) en `depth` (0 = chief, afgeleid uit `reportsTo`, niet
  los bedacht). Crypto en aandelen hebben eigen kolommen in plaats van die van de FX-vloer
  te erven. `packages/shared/src/office.test.ts` bewaakt dit.

## Wagenpark (de eerste Blex-bronnen zijn bestanden)

- `packages/shared/src/fleet.ts`: `readVehicles`/`readDrivers` (CSV, `;` of `,`, drie
  datumvormen) en `fleetDeadlines()` — vensters verlopen · ≤14 · ≤30 · ≤60 in
  `DEADLINE_WINDOWS`, ergste geval eerst, lege datum = `ontbreekt` (nooit "in orde").
- Collector `GET /fleet` leest `ARA_FLEET_DIR` (standaard `data/fleet/`) — `vehicles.csv` en
  `drivers.csv`, voorbeeld en kolommen in `ops/fleet/README.md`. Staat het bestand er, dan
  markeert `withFleetSources()` die bron in `/org` en `/actions` als aangesloten; niemand hoeft
  `configured: true` in org.json te zetten. `ara-compliance-watch` leest `/fleet` en telt niet na.

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
- **Rapport**: `GET /trade/review?days=N` en `pnpm trade:review` rekenen het spoor uit in
  `buildTradeReview()` (pure functie). Welke regels blokkeerden, wie waarop stukliep,
  herhaalpogingen na een afwijzing, en de papieren uitkomst **in R** — een resultaat in
  geld zegt niets zonder de inzet erbij. Nooit door een model laten natellen; klopt een
  getal niet, dan is dat een bug in die functie.
- **Maandagochtend stuurt de watchdog het rapport via Telegram** (0 tokens; de tekst komt
  uit `formatReviewMessage()` in dezelfde module, dus het bericht kan nooit iets anders
  melden dan de cijfers). Tussendoor nodig? Draai de watchdog één keer met
  `ARA_TRADE_WEEKLY=now`. Uitzetten: `ARA_TRADE_WEEKLY=0`. Staat de modus op `off`, dan
  gaat er niets; staat hij aan en gebeurde er niets, dán juist wél — een week zonder één
  voorstel is meestal een kapotte koppeling, geen rustige week.
- De caveats staan in de **data**, niet alleen in de tekst eromheen: papieren vullingen
  kennen geen spread of slippage, dus de uitkomst is een bovengrens. `/ara-trade-review`
  geeft nadrukkelijk geen handelsadvies — het beeld is van ARA, het besluit van de eigenaar.

## Actielijst

- `GET /actions` verzamelt alles wat op een mens wacht: handelsakkoorden, stilgelegde
  handel, vastzittende sessies, escalaties, storingen, niet-aangesloten databronnen,
  onbruikbare limieten. Knop ✓ in de balk, toets `a`.
- **Elke actie draagt zijn eigen verzoek** (`method` + `path` + `body`). De viewer weet
  niets over endpoints; een nieuw soort actie kost dus geen UI-wijziging. Zet
  `confirm: true` bij alles wat geld raakt of onomkeerbaar is.

## Terugblik & kruiscontrole (de organisatie kijkt naar zichzelf)

- **`buildRetro()`** in `packages/shared/src/retro.ts` leest het takenbord terug — pure
  functie, 0 LLM-tokens, net als het handelsrapport. `GET /retro?days=N` en `pnpm retro`.
  Per rol: totaal, af, mislukt, geëscaleerd, nog open en de **mediaan** doorlooptijd (geen
  gemiddelde: één taak die drie dagen bleef hangen vertelt anders het hele verhaal).
- **Elke bevinding draagt zijn bewijs** (`evidence`: taak-id én titel, max `EVIDENCE_LIMIT`
  = 5, met `evidenceTotal` erbij). Een voorstel zonder taak-ids is een mening.
- **Onder de drempel zegt het rapport niets** (`RETRO_THRESHOLDS`): <5 taken voor een rol
  ⇒ geen percentage (`enoughData: false`), <8 in het hele venster ⇒ `tooQuiet: true` en
  er draait geen verbeterronde. Eén escalatie op twee taken is geen patroon van 50%.
- Zes soorten bevinding: `vastgelopen` (>48u onaangeraakt — gezocht over *alle* taken, niet
  alleen het venster, want dat werk is juist ouder dan het venster), `escaleert-vaak`,
  `mislukt`, `herhaalt`, `geen-resultaat`, `scheve-verdeling`.
- **Terugkerend playbook-werk is uitgezonderd van "dit blijft terugkomen"**
  (`isRecurringDuty` / `CADENCE_PREFIXES`). Dat werk hóórt terug te komen; zonder deze
  uitzondering meldt de terugblik elke week hetzelfde en leest niemand hem meer.
  Let op: die drie voorvoegsels staan óók in `scripts/watchdog.mjs` sectie 10 — een .mjs
  zonder buildstap kan deze TS-module niet importeren. Wijzig je ze, wijzig ze op beide plekken.
- **Kruiscontrole**: `shouldVerify(task, samplePct, hash)` beslist of een afgeronde taak een
  `CONTROLE:`-taak voor `ara-qa-verifier` krijgt; gewired in `PATCH /tasks/:id`, aan te
  zetten met `ARA_QA_SAMPLE=<percentage>` op de **collector** (0 = uit, standaard). Kost per
  controle een sessie, vandaar een steekproef. Deterministisch (hash op het taak-id, geen
  `Math.random`) zodat dezelfde db na een herstart hetzelfde oordeelt.
  Uitgesloten: controletaken zelf, escalaties (die wachten op een mens), `CHAT:`-taken en
  afgerond werk zonder resultaat (daar valt niets aan na te kijken — de terugblik meldt dat
  apart als `geen-resultaat`).
- **Verbeterronde**: watchdog sectie 12, `ARA_IMPROVE=1` (**standaard uit**),
  `ARA_IMPROVE_DAYS=7`. Spawnt `ara-org-auditor` op de gemeten bevindingen, hoogstens één
  keer per dag, en alleen als er iets te wijzen valt — `tooQuiet` of nul bevindingen ⇒ niets.
  Hij schrijft voorstellen op het bord en wijzigt zelf niets aan code, org.json of het ritme.
- `formatRetroMessage()` staat in dezelfde module als de cijfers, dus een bericht kan nooit
  iets anders melden dan er gemeten is.

## Auth & toegang

- `ARA_TOKEN` gezet ⇒ collector eist Bearer/X-ARA-Token/?token= op alle API-paden; `/health` blijft open.
- `scripts/expose.sh tailnet|public|off|status`; `public` (funnel) weigert zonder `ARA_TOKEN`.
- Eén poort in productie: **:4747** serveert API én de gebouwde viewer. :4748 is
  alleen de vite dev-server (`pnpm dev`) — er draait geen launchd-agent meer voor.
- De watchdog herbouwt `apps/viewer/dist` zodra die ouder is dan `apps/viewer/src`
  of `packages/shared/src`; een verouderde build betekent een andere reducer in de
  browser dan in de collector.
- **De viewer hoeft niet bij de collector te staan**: `?api=https://…` (eenmalig, daarna
  uit localStorage; `?api=` leeg zet 'm terug op dezelfde herkomst) in
  `apps/viewer/src/api.ts`. `sanitizeBase()` laat alleen http/https door — een pagina die
  elk schema slikt laat een geprepareerde link bepalen wat er in jouw sessie draait.
  Daarmee is `build:artifact` te hosten als losse pagina voor de telefoon, met de collector
  op de Mac achter het tailnet. Token gaat langs dezelfde weg (`?token=`).

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
- **Read-only is een garantie, geen belofte**: ruim de helft van de 39 rollen heeft geen Edit/Write;
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
- **Dagbudget telt alleen wat ARA zelf startte.** Elke spawn krijgt `ARA_SPAWNED_ROLE` mee
  in zijn omgeving, `plugins/ara/hooks/usage.mjs` draagt dat als `spawnedBy` naar `/usage`,
  en de db bewaart het als `spawned_by` (leeg = de eigenaar achter zijn Mac). `budgetExceeded()`
  in de watchdog somt alleen `agentTokens` = in + uit + cache-creatie van die sessies.
  Daarvóór zette een dag handwerk van de eigenaar zijn eigen agents stil terwijl die niets
  hadden uitgegeven: gemeten 15,9 miljoen tokens tegen een budget van 2 miljoen, waarvan
  14,1 miljoen cache-creatie uit één ontwikkelsessie. `spawned_by` is een losse migratie
  (`ALTER TABLE` op `usage` én `usage_days`), dus bestaande databases groeien mee.
- **De watchdog maakt de backup zelf** (sectie 7b, `ARA_BACKUP=0` zet uit, standaard aan
  omdat het 0 tokens kost): zodra de nieuwste kopie in `ARA_BACKUP_DIR` (~/Backups/ara)
  ouder is dan `ARA_BACKUP_HOURS` (24). De backup-verifier leest dezelfde map; zijn eerste
  ronde eindigde in ESCALATE omdat die map niet bestond — een controle is niets waard
  zonder iets om te controleren, en de verifier mag zelf niets schrijven.
- `watchdog.mjs` draait via launchd elke 5 min met 0 LLM-tokens; spawnt alléén agents
  bij incidenten, geplande taken, open bordwerk (sectie 11) of de verbeterronde (sectie 12).
  Niet ombouwen naar iets dat continu LLM-calls doet.
- **`ARA_LOCK_DIR` moet bestaan.** Alle kostenremmen van de watchdog wonen daar: de
  eenmalige alarmen, de pogingenteller die na twee keer stopt met spawnen, en het slot tegen
  dubbele spawns. Elke schrijfactie daarvan zit in een lege catch, dus een map die niet
  bestaat zette alle drie stil **zonder één foutmelding** — eindeloos alarmeren en doorspawnen
  tot het budget op is. Sinds de fix is er één `mkdirSync` bij het starten. Voeg nooit een
  rem toe die stilzwijgend faalt als die map wegvalt.
- **Werk van buiten de Mac** loopt via git, want dat is de enige verbinding die er altijd is:
  een `.md` in `ops/inbox/` wordt een bordtaak (frontmatter `title`/`assignee`/`project`),
  en `ARA_AUTO_UPDATE=1` laat de watchdog nieuwe commits zelf ophalen, bouwen en herstarten.
  **Beide standaard uit** — ze draaien werk dat niet vanaf deze Mac gestart is. Auto-update
  is fast-forward-only, blijft van ongecommit werk af, herstart niet na een mislukte build,
  en meldt elke update via Telegram. Een verwerkt inbox-bestand komt nooit twee keer op het
  bord (vingerafdruk op de inhoud in `data/inbox-seen.json`).
- **Terugkerend werk heeft een ritme, anders gebeurt het nooit.** Elke `duty` in het
  playbook draagt zijn cadans (`dag` | `week` | `maand`); de watchdog zet hem op het bord
  zodra hij aan de beurt is, met de cadans in de titel. `ARA_RHYTHM=1` zet het aan
  (**standaard uit** — dit geeft uit zichzelf tokens uit), `ARA_RHYTHM_VENTURES=blex,traject`
  beperkt het tot een paar takken. Het dagbudget gaat vóór het ritme, en een taak die nog
  open staat krijgt nooit een tweede exemplaar (`data/rhythm.json`).
- **Elke duty noemt zijn eigenaar.** `Duty.who` (in `org.ts`) is de agent-id die het werk
  doet; leeg = de manager van de tak. Daarvoor kwam élke duty van élke tak bij dezelfde rol
  terecht: één stoel met werk en tien met een functieomschrijving. `who` moet als `agent` in
  de specialistenlijst van diezelfde tak staan — anders wijst werk naar een stoel die er niet
  is, en `packages/shared/src/duties.test.ts` bewaakt dat (samen met: elke specialist heeft
  werk, geen tak draait grotendeels op dagelijks werk, de rollen die géén databron nodig
  hebben hebben werk, en `playbookPrompt()` noemt de eigenaar bij elke taak).
  Het ritme zet de taak op **`duty.who`** (leeg ⇒ de manager van de tak), en de ops-duties
  uit `org.json` (`ops.duties`) lopen als eigen groep mee. `watchdog.test.ts` pint vast dat
  de assignees in de roster van de tak staan en dat ops-werk geplaatst wordt.
- **Ritme en uitvoering horen bij elkaar.** Sectie 11 (`ARA_DISPATCH=1`, **standaard uit**)
  wekt de rol die open bordwerk op zijn naam heeft: rollen uit `/org` krijgen hun eigen
  agent-bestand, een `manager:<venture>` draait op `ara-manager`. Wie het langst wacht gaat
  eerst, `ARA_DISPATCH_MAX` (2) rollen per tick, en na twee mislukte pogingen op dezelfde
  set taken stopt het spawnen en gaat er een melding uit. Rollen die elders al hun eigen
  spawn hebben (`manager:ops`, `supervisor`, `chief`) en `CHAT:`-taken worden overgeslagen;
  werk bij een rol die niet in de organisatie staat wordt gelógd in plaats van stilzwijgend
  genegeerd. **Alleen het ritme aanzetten geeft een bord dat volloopt zonder dat er iemand
  komt** — precies de stand die de eigenaar terugkreeg van zijn eigen manager.

## Testen vóór elke push

`pnpm -r typecheck && pnpm test` altijd; Playwright-smoke bij viewer-wijzigingen.
CI (`.github/workflows/ci.yml`) draait dezelfde suites + fixture/map + soak.
pnpm-versie komt uit `packageManager` in package.json — niet dupliceren in de workflow.
