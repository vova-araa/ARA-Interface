#!/bin/bash
# ARA World event emitter — pipes the raw hook payload (stdin) to the collector.
# Contract: NEVER block the session, ALWAYS exit 0, <20ms on the hot path.
# The collector maps the payload to an AraEvent (see apps/collector/src/hookmap.ts).

HOOK_NAME="${1:-Unknown}"
COLLECTOR="${ARA_COLLECTOR_URL:-http://127.0.0.1:4747}"

# Cap payload at 100KB, fire-and-forget in the background, swallow all errors.
head -c 100000 | curl -s -o /dev/null \
  --max-time 0.2 \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "${COLLECTOR}/hook/${HOOK_NAME}" >/dev/null 2>&1 &

exit 0
