#!/bin/bash
# ARA World event emitter — pipes the raw hook payload (stdin) to the collector.
# Contract: NEVER block the session, ALWAYS exit 0, <20ms on the hot path.
# The collector maps the payload to an AraEvent (see apps/collector/src/hookmap.ts).

HOOK_NAME="${1:-Unknown}"
COLLECTOR="${ARA_COLLECTOR_URL:-http://127.0.0.1:4747}"

# Local collector: 200ms is plenty. Remote collector (cloud session posting to
# the Mac over funnel/tailnet): allow 3s — the curl is backgrounded, so the
# session never waits either way.
case "$COLLECTOR" in
  http://127.*|http://localhost*|http://\[::1\]*) MAX_TIME=0.2 ;;
  *) MAX_TIME=3 ;;
esac

# Cap payload at 240KB (onder de 256KB json-limit van de collector). Let op:
# afknippen levert kapotte JSON op → zo'n zeldzaam reuze-event (Write met
# >240KB bestandsinhoud) gaat bewust verloren i.p.v. de sessie te vertragen.
# ARA_TOKEN is only needed when the collector runs with auth enabled (online).
AUTH_ARGS=()
[ -n "${ARA_TOKEN:-}" ] && AUTH_ARGS=(-H "X-ARA-Token: ${ARA_TOKEN}")

head -c 240000 | curl -s -o /dev/null \
  --max-time "$MAX_TIME" \
  -X POST \
  -H 'Content-Type: application/json' \
  "${AUTH_ARGS[@]}" \
  --data-binary @- \
  "${COLLECTOR}/hook/${HOOK_NAME}" >/dev/null 2>&1 &

exit 0
