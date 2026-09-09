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

## Next (vereist de Mac)
- `./scripts/install.sh` op de Mac; echte sessie → pod <1s; iPhone via Tailscale; launchd-reboot-check.
- Phase 2 backlog in README.

## Blockers
- None. (SubagentStart/TaskCompleted/TeammateIdle hooks fire only on Claude Code versions that support them — degrades gracefully.)
