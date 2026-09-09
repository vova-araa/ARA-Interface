# PROGRESS

## Done
- [x] **Step 1 — Scaffold**: pnpm monorepo, `@ara/shared` (zod event schema, secret redaction, hex math, deterministic world layout), `@ara/collector` (POST /event, SSE /events, GET /state|/world|/session/:id|/history|/fixture, SQLite 7-day ring buffer, boot-time state rebuild), fixture generator (55-event demo story). 16 unit tests green. Smoke: `curl POST /event` → appears on `/events` SSE + `/state`. ✅

## Next
- [ ] Step 2 — Plugin `plugins/ara` (hooks → emit.sh, ara-status skill, /ara-open, /ara-map, orchestrator skeleton)
- [ ] Step 3 — Viewer hex world + districts + camera
- [ ] Steps 4-9 per plan

## Blockers
- None.
