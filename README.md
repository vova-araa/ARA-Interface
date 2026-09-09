# ⬡ ARA World

Real-time isometric 3D world that visualizes every Claude Code session, thread,
agent and tool-call across all projects — set in a cartoon Armenia: Ararat on
the horizon, pink tuff hexes, khachkars, Cascade stairs as the hub and a
Sevan-blue lake.

![architecture](#architecture)

## Quick start (Mac)

```bash
./scripts/install.sh
```

That's everything: installs deps, builds the viewer, installs two launchd
agents (collector + viewer, restart on reboot), registers the `ara` Claude Code
plugin and prints your URLs.

| URL | What |
|---|---|
| `http://localhost:4748` | Live world |
| `http://<tailnet-ip>:4748` | Same, on your iPhone over Tailscale |
| `http://localhost:4748/?demo=1` | 2-minute animated demo story (no live sessions needed) |

### iPhone
1. Make sure Tailscale is connected on both Mac and iPhone.
2. Open `http://<tailnet-ip>:4748` in Safari (`tailscale ip -4` on the Mac, or see the collector log — it prints the URL on start).
3. Pinch to zoom, drag to pan, two fingers to rotate. Tap a pod → detail drawer. ☰ opens the thread bottom-sheet.

## How it works

```
Claude Code session (any repo)
  │  hooks (SessionStart, PreToolUse, …) → plugins/ara/hooks/emit.sh
  ▼    fire-and-forget curl, <20ms, never blocks the session
apps/collector  :4747   POST /hook/:name · POST /event · GET /events (SSE) · GET /state
  │    SQLite 7-day ring buffer · secret redaction · cwd→project resolution
  ▼
apps/viewer     :4748   React Three Fiber isometric hex world + thread UI
packages/shared         event schema (zod) · WorldState reducer · hex math · world layout
plugins/ara             hooks + ara-status skill + /ara-open + /ara-map + ara-orchestrator
```

- **Pod** = session. Idle breathes, working pulses in the tool's color, needs-you gets an amber beacon + ring, done gets a green cap + confetti, errors flicker red.
- **Figure** = agent/subagent. Walks in from the district edge, carries a tool icon (📖 Read, 🔨 Edit, 🔧 Bash, 🔍 Grep, 🔭 WebSearch, 📣 Task, 🔌 MCP), shows a speech bubble with the tool summary.
- **Districts** = ventures (Traject, Blex, Elevate, Uprising, Trading, Vovara). Placement is a deterministic hash of the project name — positions never shuffle. Unknown repos land in **Nor Kaghak**.

## Commands

| Command | Effect |
|---|---|
| `pnpm dev` | Run collector + viewer (dev, HMR) |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | The usual |
| `pnpm fixture` | Regenerate the demo story |
| `pnpm map` | Rebuild `world.config.json` from `projects.json` |
| `/ara-open` (in Claude Code) | Print URLs + open the viewer |
| `/ara-map` (in Claude Code) | Re-map world after editing projects.json |
| `ara-status` skill | One-screen "what needs me" summary |

The project list comes from `~/.claude/skills/dev-project-manager/projects.json`
(entries may set `name`, `path`, `repo`, `venture`). No file → a demo world is
generated so the viewer is never empty.

## Ops

- launchd agents `com.ara.collector` / `com.ara.viewer` (`~/Library/LaunchAgents`), `KeepAlive` — survive reboots, logs in `~/Library/Logs/ara-world/`.
- The plugin's `SessionStart` hook health-checks the collector and kickstarts it via launchd if it's down, so the world is alive the moment a session starts.
- Restart manually: `launchctl kickstart -k gui/$(id -u)/com.ara.collector`.

## QA

```bash
pnpm --filter @ara/viewer exec playwright test   # desktop + iPhone viewport smoke
pnpm -r test                                     # shared + collector unit tests
pnpm soak                                        # load test: 3 sessions × 60s × 10 ev/s
```

CI (GitHub Actions) runs typecheck, unit tests, viewer build, Playwright smoke
and an accelerated soak on every push.

**Time-scrubber**: the pill at the bottom of the live view replays the last 24h
from SQLite — drag to any moment, hit LIVE to return.

## Phase 2 backlog (not built — hooks left in place)

- Telegram push for "needs you" + nightly `ara-status` — recipe: `/loop 24h ara-status` piped to the `telegram@claude-plugins-official` channel plugin once installed; the collector's `/state` endpoint is the data source.
- Tap-to-prompt from phone (Remote Control bridge).
- `ara-orchestrator` running real per-venture task queues from `projects.json` (Phase 1 ships the read-only skeleton).
- Cost/usage per district (`/usage` data not exposed yet → top-bar slot hidden).
