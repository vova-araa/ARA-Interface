#!/usr/bin/env node
/**
 * Terugblik op het werk in de terminal — nul LLM-tokens.
 *
 * De cijfers komen uit `GET /retro`, dus uit `buildRetro()` in @ara/shared. Dit
 * script tekent ze alleen. Net als bij het handelsrapport is dat met opzet: een
 * terugblik die door een model geteld is kun je niet naast die van vorige week
 * leggen, en dan is het geen meting maar een indruk.
 *
 *   pnpm retro            # laatste 7 dagen
 *   pnpm retro 30         # laatste 30 dagen
 *   pnpm retro 30 --json  # ruwe data, inclusief het bewijs per bevinding
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN.
 */
const COLLECTOR = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 7);
const asJson = args.includes('--json');

const headers = {};
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;

const res = await fetch(`${COLLECTOR}/retro?days=${days}`, {
  headers,
  signal: AbortSignal.timeout(15_000),
}).catch((error) => {
  console.error(`✗ collector niet bereikbaar op ${COLLECTOR} (${String(error).slice(0, 80)})`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`✗ /retro → ${res.status}${res.status === 401 ? ' (ARA_TOKEN nodig)' : ''}`);
  process.exit(1);
}
const retro = await res.json();

if (asJson) {
  console.log(JSON.stringify(retro, null, 2));
  process.exit(0);
}

const hours = (ms) => (ms === undefined ? '—' : `${(ms / 3_600_000).toFixed(1)}u`);
const pad = (text, width) => String(text).padEnd(width);

console.log(`\n  ARA — terugblik over ${days} dag(en)`);
console.log(`  ${retro.considered} taak/taken geraakt, ${retro.roles.length} rol(len) actief\n`);

if (retro.tooQuiet) {
  // Geen storing en ook geen "het gaat goed": er is te weinig gebeurd om iets
  // uit te lezen. Dat hardop zeggen is het hele punt van deze stand.
  console.log('  Te weinig werk om patronen uit te lezen.');
  console.log('  Een verbeterronde zou hier iets moeten verzinnen, dus die draait niet.\n');
  process.exit(0);
}

const width = Math.max(12, ...retro.roles.map((r) => r.who.length));
console.log(`  ${pad('rol', width)}  taken  af  mislukt  escal.  open  mediaan`);
console.log(`  ${'─'.repeat(width + 44)}`);
for (const row of retro.roles) {
  // Een rol met te weinig werk krijgt geen oordeel, en dat staat erbij in
  // plaats van dat je het uit de aantallen moet afleiden.
  const thin = row.enoughData ? '' : '  (te weinig om iets van te zeggen)';
  console.log(
    `  ${pad(row.who, width)}  ${pad(row.total, 5)}  ${pad(row.done, 2)}  ${pad(row.failed, 7)}  ` +
      `${pad(row.escalated, 6)}  ${pad(row.pending, 4)}  ${hours(row.medianMs)}${thin}`,
  );
}

if (retro.findings.length === 0) {
  console.log('\n  Geen patronen gevonden die om aandacht vragen.\n');
  process.exit(0);
}

console.log(`\n  Bevindingen (${retro.findings.length})\n`);
for (const finding of retro.findings) {
  console.log(`  • [${finding.kind}] ${finding.text}`);
  for (const item of finding.evidence) {
    console.log(`      ${item.id}  ${item.title.slice(0, 70)}`);
  }
  if (finding.evidenceTotal > finding.evidence.length) {
    console.log(`      … ${finding.evidenceTotal - finding.evidence.length} meer`);
  }
  console.log('');
}
console.log('  Elke bevinding draagt zijn taken: een voorstel hierop is na te trekken.\n');
