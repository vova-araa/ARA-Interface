---
description: Hand a goal to the ara-orchestrator, which spawns per-project workers (and headless sessions) as needed and reports back one table. Usage - /ara-run <goal>
---

Invoke the `ara-orchestrator` agent with the user's goal: `$ARGUMENTS`

Before invoking, remind the orchestrator of its budget (max 6 concurrent / 12
total agents, 3 headless sessions) and that every SPAWN-REQUEST outside the
goal's scope goes to follow-ups, not to a new agent.

When it returns, relay its table verbatim, then add one line with the viewer
URL so the user can watch the workforce live: `http://localhost:4747`.
