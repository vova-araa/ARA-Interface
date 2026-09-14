#!/usr/bin/env node
/**
 * Handelsrapport in de terminal — nul LLM-tokens.
 *
 * De cijfers komen uit `GET /trade/review`, dus uit deterministische code. Dit
 * script tekent ze alleen. Dat is met opzet: een rapport dat door een model
 * geteld is, kun je niet naast dat van vorige week leggen.
 *
 *   pnpm trade:review            # laatste 7 dagen
 *   pnpm trade:review 30         # laatste 30 dagen
 *   pnpm trade:review 30 --json  # ruwe data
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN.
 */
const COLLECTOR = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 7);
const asJson = args.includes('--json');

const headers = {};
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;

const res = await fetch(`${COLLECTOR}/trade/review?days=${days}`, {
  headers,
  signal: AbortSignal.timeout(15_000),
}).catch((error) => {
  console.error(`✗ collector niet bereikbaar op ${COLLECTOR} (${String(error).slice(0, 80)})`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`✗ /trade/review → ${res.status}${res.status === 401 ? ' (ARA_TOKEN nodig)' : ''}`);
  process.exit(1);
}
const r = await res.json();

if (asJson) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

const bar = (share, width = 24) => '█'.repeat(Math.round(share * width)).padEnd(width, '·');
const pct = (n) => `${(n * 100).toFixed(0)}%`;
const money = (n) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`;
const rule = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);

console.log(`\n\x1b[1mHANDELSRAPPORT — laatste ${r.window.days} dagen\x1b[0m`);
console.log(
  `${r.proposals.total} voorstel(len) op ${r.proposals.activeDays} dag(en) · ` +
    `${r.proposals.accepted} door · ${r.proposals.rejected} afgewezen · ${r.proposals.awaiting} wachtend`,
);

if (r.proposals.total === 0) {
  console.log('\nNog geen voorstellen in dit venster. Laat het eerst draaien in paper-modus.');
  process.exit(0);
}

// ── Waarop het stukliep ─────────────────────────────────────────────────────
// De belangrijkste tabel: hij zegt of je limieten te streng staan of je agents
// te ruim denken. Dat onderscheid zie je nergens anders.
if (r.blockers.length > 0) {
  rule('WAAROP HET STUKLIEP');
  for (const b of r.blockers.slice(0, 8)) {
    console.log(`  ${b.key.padEnd(26)} ${String(b.count).padStart(4)}  ${bar(b.share)} ${pct(b.share)}`);
  }
}

// ── Per indiener ────────────────────────────────────────────────────────────
rule('PER INDIENER');
for (const p of r.byProposer) {
  const rate = p.proposals > 0 ? p.accepted / p.proposals : 0;
  console.log(
    `  ${p.who.padEnd(24)} ${String(p.proposals).padStart(4)} voorstel(len) · ${pct(rate)} door` +
      (p.topBlocker ? `  · meest: ${p.topBlocker}` : ''),
  );
}

// ── Papieren uitkomst ───────────────────────────────────────────────────────
rule('PAPIEREN UITKOMST');
if (r.paper.closed === 0) {
  console.log('  nog geen afgeronde posities');
} else {
  console.log(`  afgerond      ${r.paper.closed} (${r.paper.wins} winst, ${r.paper.losses} verlies)`);
  console.log(`  trefkans      ${pct(r.paper.winRate)}`);
  console.log(`  verwachting   ${r.paper.expectancyR.toFixed(2)}R per trade`);
  console.log(`  beste/slechtste ${r.paper.bestR.toFixed(2)}R / ${r.paper.worstR.toFixed(2)}R`);
  console.log(`  papieren p&l  ${money(r.paper.pnl)}`);
}

// ── Discipline ──────────────────────────────────────────────────────────────
if (r.retries.length > 0) {
  rule('HERHAALPOGINGEN NA AFWIJZING');
  console.log('  Dit hoort niet te gebeuren: een afgewezen voorstel bijschaven tot het');
  console.log('  er net doorheen past, is precies wat de limieten moeten voorkomen.');
  for (const t of r.retries.slice(0, 6)) {
    console.log(`  ${t.who} · ${t.instrument} · ${t.minutes} min later (was: ${t.blockedBy.join(', ')})`);
  }
}

// ── Aftekenlijst ────────────────────────────────────────────────────────────
rule('DREMPELS');
for (const c of r.readiness) {
  console.log(`  ${c.met ? '\x1b[32m✓\x1b[0m' : '\x1b[33m✗\x1b[0m'} ${c.criterion.padEnd(44)} ${c.detail}`);
}
const open = r.readiness.filter((c) => !c.met).length;
console.log(
  open === 0
    ? '\n  Alle drempels gehaald. Dat zegt dat je eigen voorwaarden zijn afgevinkt —\n  niet dat je moet gaan handelen. Dat besluit blijft van jou.'
    : `\n  ${open} drempel(s) nog niet gehaald.`,
);

// ── Waarschuwing ────────────────────────────────────────────────────────────
rule('WAT DEZE CIJFERS NIET ZEGGEN');
for (const c of r.caveats) console.log(`  · ${c}`);
console.log('');
