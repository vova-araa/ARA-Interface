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
