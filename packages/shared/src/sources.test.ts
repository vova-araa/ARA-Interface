import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_SPECS, readTable, sourceSpec } from './sources.ts';
import { resolvePlaybook } from './org.ts';
import { VENTURES } from './world.ts';
import { parseDate } from './fleet.ts';

test('elke bron uit elk playbook heeft een bestand, behalve wat al zonder bestand werkt', () => {
  for (const v of VENTURES.filter((x) => x.id !== 'misc')) {
    const playbook = resolvePlaybook(v.id, v.label);
    for (const source of playbook.dataSources) {
      if (source.configured) continue; // publiek endpoint zonder sleutel (crypto-koersen)
      assert.ok(sourceSpec(v.id, source.label), `${v.id}: "${source.label}" heeft geen bestandsspec`);
    }
  }
  // En andersom: geen spec voor een bron die het playbook niet kent.
  for (const spec of SOURCE_SPECS) {
    const v = VENTURES.find((x) => x.id === spec.venture)!;
    const labels = resolvePlaybook(v.id, v.label).dataSources.map((d) => d.label);
    assert.ok(labels.includes(spec.label), `${spec.venture}/${spec.file} hoort bij geen playbook-bron`);
  }
});

test('bestandsnamen zijn uniek per tak en kolomnamen zijn genormaliseerd', () => {
  const seen = new Set<string>();
  for (const spec of SOURCE_SPECS) {
    const key = `${spec.venture}/${spec.file}`;
    assert.ok(!seen.has(key), `dubbel: ${key}`);
    seen.add(key);
    for (const col of [...spec.required, ...(spec.dates ?? []), ...(spec.numbers ?? [])]) {
      assert.match(col, /^[a-z0-9_]+$/, `${key}: kolom "${col}" moet klein en zonder spaties zijn`);
    }
  }
  assert.equal(SOURCE_SPECS.length, 22);
});

test('readTable: verplichte kolommen, datums en getallen getypeerd, rest tekst', () => {
  const spec = sourceSpec('traject', 'Facturatiestand')!;
  const ok = readTable(
    'Factuur;Klant;Bedrag;Verstuurd;Vervalt;Betaald;Extra\nF-1;Acme;1.250,50;2026-09-01;2026-10-01;;ja\n',
    spec,
  );
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.rows[0]!.bedrag, 1250.5);
  assert.equal(ok.rows[0]!.verstuurd, Date.UTC(2026, 8, 1));
  assert.equal(ok.rows[0]!.betaald, undefined, 'leeg blijft leeg');
  assert.equal(ok.rows[0]!.extra, 'ja', 'onbekende kolommen blijven staan');
  const bad = readTable('factuur;klant\nF-1;Acme\n', spec);
  assert.equal(bad.rows.length, 0);
  assert.match(bad.errors[0]!, /bedrag, verstuurd, vervalt/);
});

test('kolomnamen met spatie, streepje of onderstreping zijn dezelfde kolom', () => {
  const spec = sourceSpec('crypto', 'Portefeuille en posities')!;
  const t = readTable('Munt;Aantal;Waarde USD\nBTC;1;100\n', spec);
  assert.equal(t.errors.length, 0);
  assert.equal(t.rows[0]!.waarde_usd, 100);
  assert.equal(readTable('munt;aantal;waarde-usd\nBTC;1;100\n', spec).rows[0]!.waarde_usd, 100);
});

test('een ETA met tijd erachter is een datum; 1250.50 en 1,5 zijn getallen', () => {
  assert.equal(parseDate('2026-09-20 14:30'), Date.UTC(2026, 8, 20));
  assert.equal(parseDate('2026-09-20T14:30:00'), Date.UTC(2026, 8, 20));
  const spec = sourceSpec('blex', 'Kosten per voertuig (brandstof, banden, reparatie)')!;
  const t = readTable('kenteken;maand;brandstof;banden;reparatie;km\nA;2026-09;1250.50;1,5;;12\n', spec);
  assert.equal(t.rows[0]!.brandstof, 1250.5);
  assert.equal(t.rows[0]!.banden, 1.5);
  const nl = readTable('kenteken;maand;brandstof;banden;reparatie;km\nA;2026-09;1.250;1.250.000;12.5;120.500\n', spec);
  assert.equal(nl.rows[0]!.brandstof, 1250, 'één punt, drie cijfers: duizendtal');
  assert.equal(nl.rows[0]!.banden, 1250000);
  assert.equal(nl.rows[0]!.reparatie, 12.5, 'twee cijfers achter de punt: decimaal');
  assert.equal(nl.rows[0]!.km, 120500);
  assert.equal(t.rows[0]!.reparatie, undefined);
});
