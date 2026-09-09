#!/bin/bash
# Runs on SessionStart: makes sure the ARA collector is up.
# 1. Fast health check (collector already running → exit immediately).
# 2. launchd kickstart (installed via scripts/install.sh).
# 3. Fallback: start the collector directly from the repo.
# Always exits 0 — the session must never be blocked.

COLLECTOR="${ARA_COLLECTOR_URL:-http://127.0.0.1:4747}"
ARA_REPO="${ARA_REPO:-$HOME/dev/ara-world}"

if curl -s -o /dev/null --max-time 0.3 "${COLLECTOR}/health"; then
  exit 0
fi

if command -v launchctl >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/com.ara.collector" >/dev/null 2>&1 && sleep 1
  if curl -s -o /dev/null --max-time 0.3 "${COLLECTOR}/health"; then
    exit 0
  fi
fi

if [ -d "$ARA_REPO/apps/collector" ] && command -v pnpm >/dev/null 2>&1; then
  (cd "$ARA_REPO" && nohup pnpm --filter @ara/collector start >/dev/null 2>&1 &)
fi

exit 0
