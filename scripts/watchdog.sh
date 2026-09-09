#!/bin/bash
# launchd-wrapper voor de watchdog: vindt node, draait watchdog.mjs, exit 0.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export ARA_REPO="$REPO"
for candidate in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$candidate" >/dev/null 2>&1; then
    exec "$candidate" "$REPO/scripts/watchdog.mjs"
  fi
done
echo "[watchdog] node niet gevonden" >&2
exit 0
