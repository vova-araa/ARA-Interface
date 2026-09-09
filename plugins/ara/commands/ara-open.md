---
description: Print the ARA World viewer URLs (localhost + tailnet) and open the viewer in the browser.
allowed-tools: Bash(curl:*), Bash(tailscale:*), Bash(open:*), Bash(id:*)
---

Print the ARA World viewer URLs and open it:

1. Run `curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:4747/health` — if not `200`, warn that the collector is down and how to start it (`launchctl kickstart -k gui/$(id -u)/com.ara.collector`).
2. Run `tailscale ip -4` (ignore failure) to get the tailnet IP.
3. Print:
   - Local: `http://localhost:4748`
   - Phone (Tailscale): `http://<tailnet-ip>:4748` (omit if no IP)
4. Run `open http://localhost:4748` (macOS) to open the browser. On failure just print the URLs.
