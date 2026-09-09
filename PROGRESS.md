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

## Next
- Verify on real Mac: `./scripts/install.sh`, then start a Claude Code session in any repo → pod should appear <1s.
- Optional: 30-min soak with 3 parallel sessions (needs real sessions).
- Phase 2 backlog in README.

## Blockers
- None. (SubagentStart/TaskCompleted/TeammateIdle hooks fire only on Claude Code versions that support them — degrades gracefully.)
