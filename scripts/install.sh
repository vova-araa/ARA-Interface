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

mkdir -p "$LOGS" "$AGENTS"

install_agent() {
  local name="$1"
  local plist="$AGENTS/$name.plist"
  sed -e "s|__REPO__|$REPO|g" \
      -e "s|__PNPM__|$PNPM|g" \
      -e "s|__PATH__|$(dirname "$PNPM"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin|g" \
      -e "s|__LOGS__|$LOGS|g" \
      "$REPO/ops/launchd/$name.plist" > "$plist"
  launchctl bootout "gui/$UID_NUM/$name" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$plist"
  launchctl enable "gui/$UID_NUM/$name"
  launchctl kickstart -k "gui/$UID_NUM/$name"
  echo "▸ launchd agent installed: $name"
}

install_agent com.ara.collector
install_agent com.ara.viewer

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
echo "✔ ARA World is live:"
echo "   Mac:    http://localhost:4748"
[ -n "$TAILNET_IP" ] && echo "   iPhone: http://$TAILNET_IP:4748   (Tailscale)"
echo "   Demo:   http://localhost:4748/?demo=1"
echo ""
echo "Everything restarts automatically after reboot (launchd KeepAlive)."
