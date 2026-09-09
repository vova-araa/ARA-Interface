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
