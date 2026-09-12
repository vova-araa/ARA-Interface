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
