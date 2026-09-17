#!/bin/bash
# Eén commando dat de Mac bijwerkt: ophalen, bouwen, herstarten, controleren.
#
# De reden dat dit bestaat: bijwerken was vier commando's, en wie er één
# vergeet (meestal de viewer-build) draait een andere reducer in de browser
# dan in de collector. Dat is geen foutmelding maar afwijkend gedrag, en dat
# kost meer tijd dan het bouwen zelf.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
PORT="${ARA_COLLECTOR_PORT:-4747}"
UID_NUM="$(id -u)"

step() { printf '\n▸ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; exit 1; }

step "Wijzigingen ophalen…"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only origin "$BRANCH" || fail "git pull mislukt — los dat eerst op, dan nog eens"
AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  al bij: $(git log --oneline -1)"
else
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/  /'
fi

step "Dependencies…"
pnpm install --silent || fail "pnpm install mislukt — draai 'pnpm install' los voor de echte melding"

step "Viewer bouwen…"
# Zonder deze stap draait de browser een oudere reducer dan de collector, en
# dan verschilt de wereld die je ziet van de wereld die geteld wordt.
pnpm --filter @ara/viewer build >/dev/null 2>&1 || fail "viewer-build mislukt — draai 'pnpm --filter @ara/viewer build'"

step "Diensten herstarten…"
for agent in com.ara.collector com.ara.watchdog; do
  if launchctl print "gui/$UID_NUM/$agent" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$UID_NUM/$agent" && echo "  $agent herstart"
  else
    echo "  ⚠ $agent draait niet — draai ./scripts/install.sh"
  fi
done

step "Controleren…"
# Herstarten zegt niets; pas een antwoord op /health zegt dat hij er is.
for i in $(seq 1 20); do
  HEALTH="$(curl -fsS -m 2 "http://127.0.0.1:$PORT/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 1
done
[ -n "${HEALTH:-}" ] || fail "collector antwoordt niet op :$PORT — kijk in ~/Library/Logs/ara-world/"

SESSIONS="$(printf '%s' "$HEALTH" | sed -n 's/.*"sessions":\([0-9]*\).*/\1/p')"
echo "  collector leeft · ${SESSIONS:-0} sessie(s) bekend"

# Zwijgen over wat níét werkt is het probleem dat dit script moet oplossen.
command -v claude >/dev/null 2>&1 \
  || echo "  ⚠ 'claude' staat niet in je PATH — zonder de CLI is er geen plugin, en dus geen enkele echte sessie in de wereld"
PROJECTS="$(find "$HOME/.claude" -name projects.json 2>/dev/null | head -1)"
[ -n "$PROJECTS" ] \
  || echo "  ⚠ geen projects.json gevonden — de wereld draait op demo-projecten"

printf '\n✔ Klaar. http://localhost:%s  (hard herladen: ⌘⇧R)\n\n' "$PORT"
