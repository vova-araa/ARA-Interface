---
name: ara-status
description: Summarize the ARA World in one screen — which sessions need the user, what's running, what finished. Use when the user asks "wat vraagt actie", "status van mijn wereld/sessies", "ara status", or wants a cross-project session overview.
---

# ARA Status

Give a one-screen status of the ARA World (all Claude Code sessions across projects).

## Steps

1. Fetch the snapshot: `curl -s http://127.0.0.1:4747/state`
   - If the collector is down, say so and offer to start it (`launchctl kickstart -k gui/$(id -u)/com.ara.collector`, fallback `pnpm --filter @ara/collector start` in the ara-world repo).
2. Parse `sessions` and `counters`. Consider a session **active** when it has no `endedAt` and `lastSeenAt` is within the last 6 hours.
3. Report in exactly this order, most urgent first:

```
🔴 NEEDS YOU (N)
  <project> — <message or last tool> (<age>)
🟡 RUNNING (N)
  <project> — <activeTool or lastToolSummary> (<age>)
🟢 DONE TODAY (N)
  <project> — <last message> 
⚪ IDLE (N)          ← one line, names only
```

4. Keep it to one screen: max 5 lines per bucket, collapse the rest to "…and X more".
5. End with the viewer URLs: `http://localhost:4747` and the tailnet URL if known (collector log prints it; or run `tailscale ip -4`).

## Rules

- Ages as compact strings: "3m", "2h", "13d".
- Never dump raw JSON at the user.
- If everything is quiet: one line — "World is quiet. Nothing needs you." plus the viewer URL.
