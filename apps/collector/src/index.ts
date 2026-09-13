import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { COLLECTOR_PORT, VIEWER_PORT } from './config.ts';
import { openStore } from './db.ts';
import { createCollector } from './server.ts';

const store = openStore();
const { app } = createCollector(store);

// Prune the 7-day ring buffer hourly.
store.prune();
setInterval(() => store.prune(), 60 * 60 * 1000).unref();

function tailnetIp(): string | null {
  try {
    const out = execFileSync('tailscale', ['ip', '-4'], { timeout: 1500 }).toString().trim();
    const first = out.split('\n')[0];
    if (first) return first;
  } catch {
    // tailscale CLI not available — look for a 100.64.0.0/10 interface
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && addr.address.startsWith('100.')) return addr.address;
    }
  }
  return null;
}

// Zonder token alleen loopback: Tailscale serve/funnel proxyt via localhost,
// dus telefoon/laptop-toegang blijft werken — maar een open LAN-poort zonder
// auth bestaat niet meer. ARA_BIND of een gezet ARA_TOKEN opent 0.0.0.0.
const BIND = process.env.ARA_BIND ?? (process.env.ARA_TOKEN ? '0.0.0.0' : '127.0.0.1');
app.listen(COLLECTOR_PORT, BIND, () => {
  const ip = tailnetIp();
  console.log(`[ara-collector] listening on http://${BIND}:${COLLECTOR_PORT}`);
  // Deze poort serveert de gebouwde viewer ook. Het oude :4748 is alleen nog
  // de vite dev-server; die URL hier noemen stuurde mensen naar een poort die
  // in productie niet eens draait.
  console.log(`[ara-collector] local viewer:   http://localhost:${COLLECTOR_PORT}`);
  console.log(`[ara-collector] dev viewer:     http://localhost:${VIEWER_PORT} (alleen bij pnpm dev)`);
  if (ip) {
    console.log(`[ara-collector] tailnet viewer: http://${ip}:${COLLECTOR_PORT}`);
  } else {
    console.log('[ara-collector] no tailnet IP found (is Tailscale up?)');
  }
});
