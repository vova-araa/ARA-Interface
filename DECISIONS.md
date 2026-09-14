# DECISIONS

Log of autonomous calls made while building ARA World (per the super prompt: decide, log, keep moving).

1. **Express over Hono** for the collector — most boring/proven, zero learning curve, SSE trivial.
2. **`tsx` as runtime** for collector (no build step): shared package is consumed as TS source (`exports` → `src/index.ts`), keeping the monorepo build-free except the viewer.
3. **Event ordering**: SQLite replay orders by `(ts, rowid)` — same-millisecond events must replay in insert order or session state machines glitch.
4. **`world.config.json` is gitignored** — it is derived from the user's local `projects.json` and regenerated via `pnpm map` / `/ara-map`. A missing file auto-generates a demo world so the viewer never renders empty.
5. **Incoming events may omit `id`/`ts`/`project`** — collector fills them in (UUID, now, cwd→project resolution). Keeps `emit.sh` dumb and fast.
6. **Project resolution**: configured `path` prefix match → project name match on cwd basename → raw basename (lands in Nor Kaghak district).
7. **Retention**: 7-day ring buffer pruned hourly; state snapshot rebuilt from SQLite on boot so restarts are invisible to viewers.
8. **Fixture timestamps are absolute at generation time**; the viewer remaps them relative to "now" on `?demo=1` replay.
9. **Hook coverage**: Claude Code has no `SubagentStart`/`TeammateIdle`/`TaskCompleted` hook on all versions — hooks.json registers the full superset from the prompt; unsupported ones are simply never fired. Mapping lives in `emit.sh`.
10. **Viewer serves over LAN/tailnet** by binding 0.0.0.0; the collector prints the tailnet URL (tailscale CLI, falls back to 100.x interface scan).
11. **drei `<Html distanceFactor>` is broken under an orthographic camera** (scales the DOM overlay to fill the screen). Speech bubbles use fixed-pixel Html instead.
12. **District center hex is reserved for the venture landmark**; project pods spiral around it so they never overlap.
13. **Backdrop uses flat `meshBasicMaterial` cartoon shading** — with an ortho camera + directional light, big distant cones catch no light and render black; basic materials keep the skyline reliable.
14. **Plugin distribution**: repo doubles as a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`); install.sh registers it via the `claude` CLI when available.
15. **Online architecture = one service**: the collector serves the built viewer (SPA fallback), so Render needs a single web service + disk. Locally :4747 now serves the whole world too; :4748 stays for dev/preview.
16. **Auth is a single shared token** (`ARA_TOKEN`), off by default for tailnet use. EventSource can't send headers → `?token=` accepted; viewer persists it from the URL to localStorage. Static assets stay open; all data is behind the gated API.
17. **PWA icons are rasterized with the bundled Chromium** (`apps/viewer/scripts/make-icons.mjs`) — no image tooling dependency.
18. **3D labels are canvas sprites**, not troika/drei Text — no font fetching, crisp under the ortho camera, cheap to cache.
19. **Geen Render** — alles draait via Claude Code zelf (Mac + tailnet, single-port collector). render.yaml verwijderd; token-auth en single-service blijven (nuttig voor tailnet/exposure).
20. **Toegang overal = Tailscale Serve/Funnel op de Mac**, nooit externe hosting. Funnel-modus is geweigerd zonder ARA_TOKEN (publieke URL zonder auth zet de hele sessiegeschiedenis open). Cloud-sessies posten naar de funnel-URL via ARA_COLLECTOR_URL; emit.sh krijgt daar een ruimere timeout maar blijft fire-and-forget.
21. **Webwerk in drie lagen**: (1) native WebSearch/WebFetch voor elke agent — nul setup; (2) `pnpm browse` (headless Chromium) alleen voor JS-gerenderde pagina's en screenshots; (3) de `ara-web-scout` agent bundelt beide met read-only regels. Chromium wordt door install.sh geïnstalleerd zodat de gebruiker nooit een extra stap heeft.
22. **Organisatie = supervisor → managers → agents, met het takenbord als enige kanaal.** Cruciale bouwsteen: een headless sessie is top-level en hééft de Agent-tool — managers draaien daarom als headless sessies (eigen pod, eigen subagents), niet als subagents. Werk zonder bord-update telt niet als gedaan; escalaties gaan via `ESCALATE:` op het bord naar de supervisor en dan naar de mens.
23. **Token-telling komt uit de transcripts, niet uit schattingen**: een Stop/SessionEnd-hook parseert het sessie-transcript (dedupe per message-id, streaming schrijft ids dubbel) en POST absolute totalen — upsert, dus hertellen is idempotent. Cache-reads worden apart gerapporteerd omdat ze ~10× goedkoper zijn; optellen bij in/uit zou het beeld vertekenen.
24. **Token-zuinigheid is beleid, geen hoop**: haiku-first per rol, kale spawn-prompts, curl-polling, batching — vastgelegd in org.json en elke agent-definitie.
25. **24/7 ≠ altijd-draaiende LLM**: de wacht is een 0-token script (launchd/5 min) dat pure checks doet en pas een agent spawnt bij een echt incident. Escalatieketen met precies één feedbackronde (watchdog → manager:ops → supervisor → mens) voorkomt zowel stille mislukkingen als eindeloze agent-pingpong. Locks (TTL 30 min) voorkomen spawn-stormen; herstelt iets vanzelf, dan sluit de watchdog het incident zelf.
26. **De chief is een intake-laag, geen extra managementlaag**: hij vertaalt gebruikerstaal naar bord/planning/org-bestanden en spawnt alléén de supervisor — de keten wordt niet dieper, alleen de voorkant menselijker. Planning is data (assignee `gepland` + due-datum), uitgevoerd door de 0-token watchdog; er draait dus nooit een LLM te wachten op een datum. Nieuwe agent-rollen ontstaan alleen via het rol-sjabloon (doel, bordprotocol, token-discipline, vangrails) en als commit — de repo is de organisatie.
27. **Subagents kunnen niet zelf nesten** (empirisch bevestigd: geen Agent-tool binnen een subagent). Recursieve workforce loopt daarom via twee patronen: (a) SPAWN-REQUEST — workers vragen de orchestrator om extra agents (breedte i.p.v. diepte), (b) sessie-recursie — een worker start `claude -p` headless per project → eigen pod + hooks in ARA World. Budget-guardrails in de agent-definities (max 6 concurrent / 12 totaal / 3 headless).

## Review-hardening (2026-09-10)
- **Auth**: Express matcht routes case-insensitief → `/State` omzeilde de case-sensitive allowlist-regex. Fix: `case sensitive routing` aan + regex met `i`-vlag (verdediging in diepte). Bind zonder `ARA_TOKEN` voortaan op `127.0.0.1` (Tailscale serve proxyt via localhost, dus telefoon-toegang blijft werken); `ARA_BIND` overrulet.
- **CORS**: `Access-Control-Allow-Origin: *` alleen nog mét token; zonder token alleen localhost-origins (anders kan elke website in je browser de API uitlezen).
- **Tokenbudget**: `/usage` telt nu dag-delta's (`usage_days`-tabel) i.p.v. levenslange sessietotalen; dagfilter is bewust dag-granulair. `usage.mjs` houdt de láátste streaming-regel per message-id aan (was: eerste → onderteld).
- **Redactie vóór knippen** in toolSummary: een afgeknipte Bearer-token ontweek anders de redactiepatronen.
- **Prompts >500 tekens** worden afgekapt i.p.v. dat het hele event op zod-validatie sneuvelt (pod bleef op idle hangen).
- **doneToday**: dag komt uit event-ts (replay klopt), rolt om middernacht ook zonder nieuw event, en `doneSessions` in de snapshot maakt hydrate verliesvrij.
- **Scrub-tijd**: `snapshot(now)`/`visiblePods(now)` rekenen met de replay-tijd, niet de wandklok (tellers stonden op 0 bij scrubben).
- **Watchdog**: atomaire spawn-locks (`wx` + pid-liveness — lange runs krijgen geen tweede instantie, korte runs blokkeren de TTL niet meer), `child.on('error')`, per-sectie try/catch, incident-dedupe per status opgevraagd, Telegram-marker pas ná geslaagde verzending, LOCK_DIR-opruiming.
- **SSE-backpressure**: client met >512KB ongelezen buffer wordt verbroken (stalled TCP lekte geheugen).
- **Geheugengrenzen**: sessies >48u inactief worden uit WorldState gesnoeid; viewer recentEvents max 300 sessies; done/failed-taken en oude usage-rijen vallen onder prune().
- **Venture-match**: langste match wint ("truck-trailers-tms" → Truck & Trailers, niet Sharzi via 'tms'). `hiddenVentures` geldt nu voor elke venture-id in `visibleInWorld`; data wint blijft: gecureerde projecten houden hun district.
- **Figures**: thread-Line dispose bij unmount (GPU-lek), venture-filter geldt ook voor figuren, resync-race gebufferd (events tijdens /state-fetch).

## Upgrade-batch: volledige hook-dekking + statusline-feed (2026-09-10)
- **9 nieuwe event-kinds** (permission.ask/deny, compact.start/end, model.switch, tool.batch, worktree.start/stop, task.created) uit 11 extra Claude Code hooks; reducer blijft symmetrisch (collector = viewer). Oudere Claude Code-versies die een hook-naam niet kennen negeren die entry — geen breuk.
- **PostToolUseFailure** mapt naar tool.post/error met de échte tool_error (redacted) als summary — fail-and-recover is nu een verhaal: rook → 🔧-reparatie bij de eerstvolgende geslaagde tool (detectie in de viewer via status-overgang error→ok).
- **Model = gedaante**: session.model (uit SessionStart/PostModelSwitch) bepaalt pod-schaal en koepelkleur (haiku klein/ijsblauw, opus/fable groot/goud, boost op de kern). Morph-ring + lichtzuil bij een switch.
- **Statusline-tap**: plugins/ara/hooks/statusline.mjs print een compacte regel voor de terminal én POST een subset (contextPct, kosten, cache) naar collector /status → SSE 'status' → live context-buis naast elke pod (groen→amber→rood). In-memory, vluchtig by design; /status valt onder dezelfde auth als de rest.
- permission.ask zet needsHuman (klopt semantisch: er wordt op een mens gewacht); een geslaagde tool.post heft needsHuman op (goedkeuring is dan verleend).

## OTel latency-physics (2026-09-11)
- Collector is nu zelf een minimale **OTLP-receiver** (`POST /otel/v1/logs|metrics|traces`) voor `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` — bewust geen protobuf-dependencies of losse otel-collector-binary. Alleen `claude_code.tool_result` wordt gebruikt (duration_ms + session.id, resource- én record-attributen).
- Latency per sessie als EMA (0.7/0.3), in-memory en vluchtig; SSE 'latency' + GET /latency, zelfde auth als de rest.
- Viewer: `speedForLatency()` mapt gemiddelde tool-duur logaritmisch naar 0.55×–1.6× animatiesnelheid (orbit-vonken + werkpuls). Vanaf 2 samples, anders neutraal 1×.
- http/protobuf-payloads krijgen 200 + hint (exporter blijft dan niet retryen); als http/json op de Mac niet blijkt te werken is protobuf-decode de vervolgstap.

## Diorama Ultimate (graphics-overhaul, 2026-09-11)
- **Nul nieuwe render-deps**: ToneMapping/N8AO/HueSaturation/BrightnessContrast/ChromaticAberration/Noise zitten al in @react-three/postprocessing 2.19; Environment/Lightformer/Sparkles/Trail/Outlines in drei 9; maath was al een drei-dep (nu expliciet in viewer-deps).
- **Grading in de composer, niet de renderer**: Canvas `toneMapping: NoToneMapping` + `<ToneMapping ACES_FILMIC>` als pass; de QualityGovernor zet ACES terug op de renderer zodra postfx wegvalt (anders rauw-lineair).
- **Procedurele IBL**: `<Environment frames={1}>` met 3 Lightformers → één 64px PMREM-bake, nul netwerk. `scene.environmentIntensity` volgt het dagdeel (nacht 0.12) — anders bleef de stad 's nachts daglicht-helder.
- **stylize.ts**: shader-injectie voor koele schaduw-tint + fresnel-rim op MeshStandardMaterial (behoudt env/metalness, i.t.t. MeshToonMaterial); toegepast op de hex-platforms. wind.ts: gedeelde uWindTime-uniform, GPU-wind op boomkruinen.
- **Camera game-feel**: alle offsets additief ná controls.update() zodat ze niet met input vechten; trauma² shake met gladde sin-ruis, idle-drift na 8s, ortho focus-pull.
- **SwiftShader-artefact**: de reconnect-smoke kreeg een 15s-assertietimeout — de replay-feature klopt (los geverifieerd) maar software-rendering stalt op ReadPixels onder de zwaardere scene; direct op echte GPU.
- Bewust NIET: planar reflections + echte DoF + drei <Sky>/<Cloud> (CDN-fetch / kapot onder ortho / te duur op mobiel) — allemaal geverifieerd afgewezen.

## Kantoren per project (2026-09-12)
- **Eén samensteller, twee consumenten**: `buildOffice()` staat in `@ara/shared`, net als de WorldState-reducer, zodat collector en viewer nooit uit elkaar lopen.
- **Branche bepaalt de taal**: `KIND_SPECS` geeft per tak eigen kolommen (Chauffeur/ETA bij planning, Kenteken/APK bij wagenpark, Ingang/Stop/Doel bij handel). Eén generiek kantoor zou alle takken hetzelfde laten klinken; dat was juist de vraag niet.
- **Eerlijk over verzonnen cijfers**: zonder door agents aangeleverde werkplek-data vult `buildOffice` deterministisch in én zet `simulated: true`; de UI toont dan zichtbaar "voorbeeldcijfers". Zodra één station echt gepusht wordt, vervalt de markering. Nooit stilzwijgend nepdata tonen.
- **Chat is echt werk**: een vraag in de kantoorchat wordt óók een bordtaak bij de aangesproken rol (`CHAT: …`), zodat de bestaande watchdog die agent wakker maakt. Antwoorden van agents maken géén taak aan — anders ontstaat een lus.
- **Nieuwe tak `crypto`** toegevoegd (eigen district + kantoor met 18 munten); `trading` blijft de XAU/USD-bots. De entiteiten per kantoor staan in `offices` in org.json zodat de gebruiker ze zelf kan aanpassen.
- **Twee canvassen, één actief**: zolang een kantoor open staat draait de wereld op `frameloop="never"` — geen twee 3D-scenes die tegelijk de GPU vullen.
- **Chat-dedupe**: de POST geeft het opgeslagen bericht met server-id terug; dat wordt toegevoegd, waardoor de SSE-echo van hetzelfde bericht wegvalt tegen de id-dedupe (anders stond elke vraag dubbel).

## Hardening (2026-09-13)
- **Alarm boven automatiek**: de watchdog probeert nog steeds eerst zelf te herstellen,
  maar elke situatie die hij níét oplost gaat nu naar Telegram met dedupe op inhoud
  (`alertOnce`). Markeren gebeurt pas ná een geslaagde verzending, anders slokt één
  netwerkstoring de melding voorgoed op.
- **Spawns hebben een rem**: twee mislukte pogingen op dezelfde signature binnen 6 uur
  → stoppen en de mens vragen; dagbudget bereikt → niets meer starten. Zonder deze rem
  kan één kapotte monitor een nacht lang elke 5 minuten een LLM-sessie starten.
- **Eerlijkheid per bureau, niet per kantoor**: één `simulated`-vlag voor een heel kantoor
  liet 17 verzonnen bureaus meeliften op één echte push. Nu draagt elk station en elke
  metriek zijn eigen markering, en de balk zegt hardop `1/18 op echte data`.
- **Verlopen is niet hetzelfde als verzonnen**: een station dat ooit echt gepusht werd maar
  al >30 min stilstaat blijft "echt", maar krijgt een eigen stale-markering. Anders ziet
  een dode feed eruit als een levende.
- **Eén poort, één build**: de losse `vite preview` op :4748 was een tweede server op
  dezelfde `dist/`. De collector serveert die map al, dus de extra launchd-agent gaf geen
  functie — alleen een tweede kans om verouderde code te serveren. Verwijderd; install.sh
  ruimt een bestaande installatie op.
- **De watchdog bouwt de viewer zelf**: na een `git pull` draaide de browser de reducer van
  gisteren terwijl de collector de nieuwe draaide — precies de asymmetrie die CLAUDE.md
  heilig verklaart. Een rebuild kost 0 tokens, dus dat doet de watchdog gewoon; faalt hij,
  dan is dát het alarm.
- **`caffeinate -s` in de collector-plist**: launchd `KeepAlive` houdt een proces in leven,
  maar niet wakker. Een dichtgeklapte Mac zette de hele 24/7-wereld stil en dat zag er van
  buiten uit als "er gebeurt gewoon niets".
- **Plists zijn geheimhouders**: er staan `ARA_TOKEN` en de Telegram-bot-sleutel in, en `sed`
  schreef ze als 0644 weg. Nu `chmod 600` direct na het genereren.
- **Usage-retentie los van de event-ring**: usage-rijen leven 30 dagen, events 7. De
  dag-over-dag basislijn voor het tokenbudget viel anders elke week om.

## Bewezen keten + meetlaag (2026-09-13)
- **Aannames zijn geen bewijs**: de watchdog zag alleen "proces gestart". `verify-agents.mjs`
  gebruikt een verse nonce per run, zodat een agent die het commando níét draait de check
  onmogelijk kan halen — ook niet door een plausibel antwoord te verzinnen.
- **Een agent kan geen endpoint-beschrijving uitvoeren**: "Antwoord met POST /chat {…}" mist
  host, token en taak-id. De bordtaak bevat nu de letterlijke curl-regels. Dit was de laatste
  schakel waardoor een kantoorvraag kon weggaan zonder ooit terug te komen.
- **`--plugin-dir` in plaats van vertrouwen op de installatie**: een plugin die niet (meer)
  geïnstalleerd is, laat `--agent` falen met een sessie die binnen seconden omvalt. De
  watchdog laadt de map nu zelf; de installatie blijft nuttig maar is geen voorwaarde meer.
- **Meten of zwijgen**: de Gemeten-tab vult nooit iets in. Een project zonder `path` levert
  geen branch-regel op — en dus ook geen "onbekend". Een lege `git status` is wél een meting
  (0 wijzigingen) en hoort er dus wel te staan; dat onderscheid staat in een test.
- **Git-aanroepen gecached (60s) met 4s timeout**: een kantoor dat elke paar seconden
  ververst mag geen `git log` per verzoek afvuren, en een hangende repo (netwerk-mount,
  lock) mag de collector niet blokkeren.
- **Meten maakt verzinsels niet echt**: een kantoor met 41 commits in de meetlaag blijft
  `simulated: true` zolang geen enkele werkplek echte data kreeg. Vastgelegd in een test.

## Organisatie per categorie (2026-09-13)
- **Eén zin "focus" is geen organisatie**: een ritplanner, een garagechef en een
  marktanalist hebben andere bronnen, andere risico's en andere cijfers. Een playbook
  per tak maakt dat expliciet in plaats van het aan de manager over te laten.
- **Standaard boven leegte**: `resolvePlaybook()` vult alles aan wat org.json weglaat.
  Een nieuwe venture krijgt dus meteen rollen, taken en grenzen — en de gebruiker
  overschrijft alleen wat hij anders wil.
- **Read-only als structuur, niet als instructie**: `ara-market-analyst` heeft geen
  Edit/Write-tool. Een instructie kan genegeerd worden; een ontbrekend gereedschap niet.
  Een unit test bewaakt de frontmatter, en `verify:agents` controleert dat hij een
  expliciet verzoek om orderlogica te wijzigen afslaat (live: hij escaleerde).
- **`/org` in plaats van org.json lezen**: agents die een bestand moeten parsen maken
  fouten en verbranden tokens. Eén call geeft het opgeloste playbook, achter dezelfde
  auth als elk ander API-pad (getest, casing incluis — dat was eerder een bypass).
- **Lege stoelen tonen**: een vaste rol zonder draaiende sessie staat in het kantoor met
  `live: false` en "niet actief". De organisatie tonen zoals hij bedoeld is, met zichtbaar
  wie er nu niet zit, is eerlijker dan alleen tonen wie toevallig draait.
- **Niet-aangesloten databronnen zijn zichtbaar**: `configured: false` staat in het
  kantoorpaneel én in de manager-prompt. Zo weet een rol dat er niets te halen valt,
  in plaats van een plausibel cijfer te bedenken.

## Takken één voor één (2026-09-14)
- **Per tak eigen bevoegdheden, niet één huisregel**: op de vraag of "publiceren =
  altijd escaleren" moest blijven, koos de eigenaar voor differentiatie. Klantwerk
  (Elevate) mag niets naar buiten; de eigen studio (Uprising) mag productie behalve
  de boekingsflow; een muziekrelease (Vovara) mag de site wel en de release nooit.
  De grens volgt het risico, niet de uniformiteit.
- **Instructie én gereedschap moeten hetzelfde zeggen**: `ara-fleet-tech` beloofde
  "schrijft niet in productie" met Edit/Write in zijn frontmatter. Zulke gaten zijn
  nu dicht en een test bewaakt ze — een belofte in proza is geen garantie.
- **Geen netwerk = kan niet publiceren**: `ara-dispatch-comms` en `ara-copywriter`
  schrijven teksten die naar klanten gaan. Zonder Bash en WebFetch kunnen ze dat
  niet versturen, ongeacht wat een taak vraagt.
- **Eén schrijver per risicovolle vloer**: op de handelsvloer mag alleen
  `ara-bot-maintainer` schrijven, met zijn verboden gebied (orderlogica, sleutels,
  alles wat een draaiende bot verandert) letterlijk in zijn instructies.
- **Een risicobewaker grijpt niet in**: bij een overschreden limiet alarmeert hij en
  sluit hij niets. Een bewaker die zelf handelt is een handelaar.
- **Scouts adviseren niet**: eventscout, narratiefscout en veiligheidscheck moeten
  expliciet benoemen dat ze niet voorspellen of adviseren — een test dwingt dat af.
  "Ziet er goed uit" is advies, ook zonder het woord advies.
- **Splitsen waar het werk echt verschilt**: één `ara-creative` voor design, studio
  en muziek leverde vage instructies op. Drie rollen met eigen opleverregels en
  eigen publicatiegrenzen leveren scherpe.

## Weigeren moet leesbaar zijn voor de keten (2026-09-14)
De live grenstest legde iets bloot dat geen enkele unit test had gevonden:
`ara-risk-guard`, `ara-booking-watch` en `ara-data-engineer` **weigerden correct**,
maar in vriendelijk proza zonder het woord ESCALATE. De manager en de watchdog
zoeken letterlijk op dat woord — een weigering zonder dat woord komt bij niemand
aan: de taak blijft open en de rol lijkt gewoon stil.

Elke vakrol heeft daarom nu een vaste slotsectie: een weigering begint met
`ESCALATE: <reden>` op de eerste regel, toelichting daarna. Een test bewaakt dat
die sectie bestaat, en `verify:agents` controleert live dat het ook echt gebeurt.

Tweede les, over de test zelf: mijn eerste claim-check sloeg alarm op het woord
"Verzet" — dat stond in de ESCALATE-regel waarin de agent de vráág citeerde. De
check kijkt nu alleen naar wat er ná die regel staat en eist een afgeronde
handeling in de ik-vorm. Een test die de weigering zelf als bewijs van uitvoering
leest, is erger dan geen test.

## Twee rollen die de hele organisatie miste (2026-09-14)
- **`ara-security-auditor` in élke tak**: elke tak heeft code, sleutels en endpoints.
  Een vergeten `.env` of te ruime CORS is geen brancheprobleem. Hij herstelt niets —
  een sleutel roteren raakt draaiende systemen — en zet de waarde van een gevonden
  secret nergens neer, ook niet afgekort.
- **`ara-data-engineer` i.p.v. een generieke worker** bij TMS en fleet: die takken
  hebben data-integriteit expliciet boven snelheid gezet. Code kun je terugdraaien,
  data niet; dus migratie schrijven en tegen een kopie testen mag, uitvoeren op
  productie nooit. Een migratie zonder werkende `down` is niet af.

## Handel: de LLM stelt voor, code beslist (2026-09-14)
De eigenaar wil dat agents zelf posities nemen. Dat draait het eerdere beleid om
("STRIKT read-only op live trading"), en dat is zijn keuze — het is zijn geld.
Het antwoord op het risico is niet weigeren maar **de limieten uit de prompts halen**:

- **Een limiet in een instructie is een suggestie; een limiet in een pure functie is een
  limiet.** `evaluateIntent()` is deterministisch, zonder I/O, en de agent kan 'm niet
  lezen, schrijven of overtuigen. Elke getoetste regel staat in de uitslag, ook de
  geslaagde, zodat een afwijzing achteraf naspeurbaar is.
- **Faalt dicht, niet open.** Een lege witte lijst betekent "niets mag" — nooit "alles
  mag"; dat is precies hoe een configuratiefout een rekening leegtrekt. Rekeningwaarde 0
  maakt elk percentage ontoetsbaar, dus een systeem dat niemand instelde handelt niet.
  Een kapotte limietconfiguratie valt terug op de strengste stand, nooit op een ruimere.
- **Het slot zit in de omgeving, niet in een verzoek.** `approval` en `live` vereisen
  `ARA_TRADING_UNLOCK` in het collector-proces. Een agent die het API-pad vindt — of
  zelfs het token heeft — komt er niet langs. Een opgeslagen `live` zonder dat slot zakt
  bij herstart terug naar paper: één keer ontgrendelen mag niet voor altijd gelden.
- **Omlaag mag altijd.** Veiliger worden is nooit geblokkeerd; hervatten na een noodstop
  zet terug op papier in plaats van op wat er draaide.
- **Hertoets bij akkoord.** Tussen voorstel en menselijk "ja" kan de portefeuille bewogen
  zijn. Een oud ja is gevaarlijker dan geen antwoord, dus de risicotoets draait opnieuw.
- **Geen herhaalpogingen.** `ara-execution-trader` mag een afgewezen voorstel niet
  bijschaven tot het er net doorheen past — dat is precies wat de limieten voorkomen.
- **Geen sleutel in ARA.** In `live` levert de collector een handoff voor een adapter die
  de eigenaar zelf draait. Dat is geen beperking maar het ontwerp: de sleutel hoort bij
  de mens, niet bij het systeem dat de voorstellen bedenkt.
- **Zelf stilleggen na elke afgeronde trade**, niet pas bij het volgende voorstel —
  anders merkt het systeem een geraakte dagverlies- of drawdownlimiet te laat.

## Aandelen zijn geen trades (2026-09-14)
Een aandeel is bezit, geen setup. De kantoortaal gaat daarom over these, sector,
kostprijs, weging, dividend en cijferdatum — niet over ingang/stop/doel. De these heeft
verplicht een **breekpunt**: een these die je niet kunt verliezen, leert je niets.
`ara-earnings-watch` scheidt "haalde de cijfers maar verlaagde de vooruitblik" van een
gewone meevaller, omdat dat meestal het slechtere nieuws is.

## De actielijst bestaat omdat het systeem juist níét alles mag (2026-09-14)
Alles wat ARA zelf kan, doet het. Wat overblijft is per definitie het werk dat een mens
moet doen — en dat lag verspreid over een bord, een kantoorpaneel en een configuratie-
bestand. `/actions` verzamelt het, en **elke regel draagt het verzoek dat 'm afhandelt**:
de viewer weet niet welk endpoint bij welk soort werk hoort, dus een nieuw soort actie
kost geen UI-wijziging. Geld vraagt altijd om bevestiging; een vastzittende sessie krijgt
bewust géén knop, want die los je in de sessie zelf op.
