#!/bin/bash
# ARA World installer (macOS).
# One shot: deps → build → fixture/map → launchd agents → plugin install → URLs.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$HOME/Library/Logs/ara-world"
AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

echo "▸ ARA World installer — repo: $REPO"

command -v node >/dev/null || { echo "✗ node not found (need Node 20+)"; exit 1; }
command -v pnpm >/dev/null || { echo "✗ pnpm not found (npm i -g pnpm)"; exit 1; }
PNPM="$(command -v pnpm)"

echo "▸ Installing dependencies…"
(cd "$REPO" && pnpm install --silent)

echo "▸ Building viewer…"
(cd "$REPO" && pnpm --filter @ara/viewer build >/dev/null)

echo "▸ Generating fixture + world map…"
(cd "$REPO" && pnpm fixture >/dev/null && pnpm map >/dev/null)

echo "▸ Installing headless Chromium for web-scout/QA (one-time, ~120MB)…"
(cd "$REPO" && pnpm --filter @ara/viewer exec playwright install chromium >/dev/null 2>&1) \
  || echo "⚠ Chromium install faalde — 'pnpm browse' werkt pas na: pnpm --filter @ara/viewer exec playwright install chromium"

mkdir -p "$LOGS" "$AGENTS"

install_agent() {
  local name="$1"
  local plist="$AGENTS/$name.plist"
  sed -e "s|__REPO__|$REPO|g" \
      -e "s|__PNPM__|$PNPM|g" \
      -e "s|__PATH__|$(dirname "$PNPM"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin|g" \
      -e "s|__LOGS__|$LOGS|g" \
      -e "s|__ARA_TOKEN__|${ARA_TOKEN:-}|g" \
      -e "s|__TG_TOKEN__|${ARA_TELEGRAM_BOT_TOKEN:-}|g" \
      -e "s|__TG_CHAT__|${ARA_TELEGRAM_CHAT_ID:-}|g" \
      "$REPO/ops/launchd/$name.plist" > "$plist"
  # De plist bevat ARA_TOKEN en de Telegram-sleutel. Standaard schrijft sed 'm
  # als 0644 weg — leesbaar voor elke andere gebruiker en elk proces op de Mac.
  chmod 600 "$plist"
  launchctl bootout "gui/$UID_NUM/$name" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$plist"
  launchctl enable "gui/$UID_NUM/$name"
  launchctl kickstart -k "gui/$UID_NUM/$name"
  echo "▸ launchd agent installed: $name"
}

install_agent com.ara.collector
install_agent com.ara.watchdog

# De losse viewer op :4748 is vervallen: de collector serveert dezelfde
# dist/ al op :4747. Een eerdere installatie draait 'm nog wel door.
if launchctl print "gui/$UID_NUM/com.ara.viewer" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_NUM/com.ara.viewer" 2>/dev/null || true
  rm -f "$AGENTS/com.ara.viewer.plist"
  echo "▸ oude losse viewer-agent (:4748) verwijderd — :4747 serveert de wereld"
fi

# ── Plugin ──────────────────────────────────────────────────────────────
if command -v claude >/dev/null 2>&1; then
  echo "▸ Registering plugin via claude CLI…"
  claude plugin marketplace add "$REPO" 2>/dev/null || true
  claude plugin install ara@ara-world 2>/dev/null \
    && echo "▸ Plugin installed (ara@ara-world)" \
    || echo "⚠ Could not auto-install plugin — run /plugin in Claude Code and add marketplace: $REPO"
else
  echo "⚠ claude CLI not found — run /plugin in Claude Code and add marketplace: $REPO"
fi

# ── URLs ────────────────────────────────────────────────────────────────
sleep 2
TAILNET_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"
echo ""
echo "✔ ARA World is live (collector serveert ook de viewer):"
echo "   Mac:      http://localhost:4747"
[ -n "$TAILNET_IP" ] && echo "   Telefoon: http://$TAILNET_IP:4747   (Tailscale app aan)"
echo "   Demo:     http://localhost:4747/?demo=1"
[ -n "${ARA_TOKEN:-}" ] && echo "   Auth:     ARA_TOKEN actief — open eenmalig met ?token=…"
echo ""
echo "Verder weg dan je tailnet? → ./scripts/expose.sh tailnet|public"
echo "Everything restarts automatically after reboot (launchd KeepAlive)."
