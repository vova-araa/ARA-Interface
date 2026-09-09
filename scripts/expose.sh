#!/bin/bash
# ARA World toegang buiten de Mac — alles via Tailscale, geen externe hosting.
#
#   ./scripts/expose.sh tailnet   → HTTPS binnen je tailnet (telefoon/laptop met Tailscale)
#   ./scripts/expose.sh public    → HTTPS voor overal (Tailscale Funnel) — vereist ARA_TOKEN
#   ./scripts/expose.sh off       → alles weer dicht
#   ./scripts/expose.sh status    → huidige stand + URLs
set -euo pipefail

PORT="${ARA_COLLECTOR_PORT:-4747}"
MODE="${1:-status}"

command -v tailscale >/dev/null || { echo "✗ tailscale CLI niet gevonden"; exit 1; }

host_url() {
  tailscale status --json 2>/dev/null \
    | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1
}

case "$MODE" in
  tailnet)
    tailscale serve --bg "localhost:${PORT}" >/dev/null
    echo "✔ Tailnet HTTPS aan:"
    echo "   https://$(host_url)  (elk apparaat met Tailscale, ook iPhone)"
    ;;
  public)
    if [ -z "${ARA_TOKEN:-}" ]; then
      echo "✗ Weiger: 'public' zonder ARA_TOKEN zet je hele sessiegeschiedenis open."
      echo "  Zet eerst een token (en herinstalleer de launchd agent zodat de collector 'm kent):"
      echo "    export ARA_TOKEN=\"\$(openssl rand -hex 24)\" && ./scripts/install.sh"
      exit 1
    fi
    tailscale funnel --bg "localhost:${PORT}" >/dev/null
    echo "✔ Publieke HTTPS aan (Tailscale Funnel):"
    echo "   https://$(host_url)/?token=${ARA_TOKEN}"
    echo "   (token blijft in de browser hangen na eerste bezoek; PWA: 'Zet op beginscherm')"
    echo "   Cloud Claude Code sessies: ARA_COLLECTOR_URL=https://$(host_url) + ARA_TOKEN in de environment."
    ;;
  off)
    tailscale funnel --https=443 off 2>/dev/null || true
    tailscale serve --https=443 off 2>/dev/null || true
    tailscale funnel reset 2>/dev/null || tailscale serve reset 2>/dev/null || true
    echo "✔ Serve/funnel uit — wereld alleen nog lokaal + tailnet-IP."
    ;;
  status)
    echo "— tailscale serve/funnel status —"
    tailscale serve status 2>/dev/null || true
    tailscale funnel status 2>/dev/null || true
    IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    [ -n "$IP" ] && echo "Tailnet IP: http://${IP}:${PORT}"
    ;;
  *)
    echo "gebruik: $0 [tailnet|public|off|status]"; exit 1 ;;
esac
