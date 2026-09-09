---
description: Regenerate world.config.json from projects.json (dev-project-manager skill) so the hex world reflects the current project list.
allowed-tools: Bash(pnpm:*), Bash(curl:*)
---

Regenerate the ARA World map:

1. In the ara-world repo (`$ARA_REPO`, default `~/dev/ara-world`) run: `pnpm map`
   - This reads `~/.claude/skills/dev-project-manager/projects.json` and writes `world.config.json` with deterministic hex placements (positions never shuffle between runs).
2. Tell the running collector to reload: `curl -s -X POST http://127.0.0.1:4747/world/refresh`
3. Report: number of districts and projects placed, and remind that open viewers refresh automatically on the next reload.
