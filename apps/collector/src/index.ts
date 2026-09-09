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

app.listen(COLLECTOR_PORT, '0.0.0.0', () => {
  const ip = tailnetIp();
  console.log(`[ara-collector] listening on http://0.0.0.0:${COLLECTOR_PORT}`);
  console.log(`[ara-collector] local viewer:   http://localhost:${VIEWER_PORT}`);
  if (ip) {
    console.log(`[ara-collector] tailnet viewer: http://${ip}:${VIEWER_PORT}`);
    console.log(`[ara-collector] tailnet API:    http://${ip}:${COLLECTOR_PORT}`);
  } else {
    console.log('[ara-collector] no tailnet IP found (is Tailscale up?)');
  }
});
