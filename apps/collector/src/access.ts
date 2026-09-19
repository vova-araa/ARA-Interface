/**
 * Waar is deze collector van buiten te bereiken?
 *
 * De viewer op de Mac weet alleen zijn eigen herkomst (localhost:4747). Het
 * adres voor de telefoon komt van Tailscale: `tailscale status --json` geeft
 * de DNS-naam van deze machine, en `tailscale serve status` zegt of poort 4747
 * daarachter hangt. Dat is precies wat `scripts/expose.sh tailnet` instelt.
 *
 * Geen tailscale (deze container, een Mac zonder Tailscale) ⇒ `tailnet: null`,
 * en de viewer toont dan het commando in plaats van een adres dat er niet is.
 * Zestig seconden cache: de vraag komt bij elk openen van het paneel, het
 * antwoord verandert vrijwel nooit.
 */
import { execFileSync } from 'node:child_process';
import { COLLECTOR_PORT } from './config.ts';

export interface AccessInfo {
  /** https://<machine>.<tailnet>.ts.net — leeg als Tailscale er niet is. */
  tailnet: string | null;
  /** true als `tailscale serve` deze poort daadwerkelijk doorgeeft. */
  serving: boolean;
  port: number;
}

const CACHE_MS = 60_000;
let cached: { at: number; info: AccessInfo } | undefined;

function run(args: string[]): string | undefined {
  try {
    return execFileSync('tailscale', args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

export function accessInfo(now = Date.now()): AccessInfo {
  if (cached && now - cached.at < CACHE_MS) return cached.info;
  let tailnet: string | null = null;
  let serving = false;
  const status = run(['status', '--json']);
  if (status) {
    try {
      const dns = String((JSON.parse(status) as { Self?: { DNSName?: string } }).Self?.DNSName ?? '').replace(/\.$/, '');
      if (dns) tailnet = `https://${dns}`;
    } catch {
      /* geen bruikbare status: dan geen adres */
    }
  }
  if (tailnet) {
    const serve = run(['serve', 'status']) ?? '';
    serving = serve.includes(`:${COLLECTOR_PORT}`);
  }
  const info: AccessInfo = { tailnet, serving, port: COLLECTOR_PORT };
  cached = { at: now, info };
  return info;
}

/** Voor tests: de volgende lezing vraagt Tailscale opnieuw. */
export function forgetAccess(): void {
  cached = undefined;
}
