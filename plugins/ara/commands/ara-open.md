---
description: Print alle ARA World URLs (Mac, tailnet, funnel) en open de viewer in de browser.
allowed-tools: Bash(curl:*), Bash(tailscale:*), Bash(open:*), Bash(id:*)
---

Print de ARA World toegangs-URLs en open de viewer:

1. `curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:4747/health` — bij geen `200`: waarschuw dat de collector down is (`launchctl kickstart -k gui/$(id -u)/com.ara.collector`).
2. `tailscale ip -4` (negeer falen) → tailnet-IP.
3. `tailscale serve status; tailscale funnel status` (negeer falen) → staat er een HTTPS-URL (`https://<mac>.<tailnet>.ts.net`)?
4. Print compact:
   - **Laptop/Mac**: `http://localhost:4747`
   - **Telefoon (tailnet)**: `http://<tailnet-ip>:4747` — Tailscale-app aan, PWA via "Zet op beginscherm"
   - **Overal (funnel)**: de https-URL uit stap 3, indien actief; herinner aan `?token=…` als de collector met ARA_TOKEN draait
   - Niets via funnel actief? Noem `./scripts/expose.sh tailnet|public` als optie.
5. `open http://localhost:4747` (macOS); bij falen alleen de URLs printen.
