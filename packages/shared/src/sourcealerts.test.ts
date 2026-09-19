import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_THRESHOLDS, sourceAlerts } from './sourcealerts.ts';
import { readTable, sourceSpec } from './sources.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19, 10);
const iso = (d: number) => new Date(Date.UTC(2026, 8, 19) + d * DAY).toISOString().slice(0, 10);
const table = (venture: string, label: string, csv: string) => ({ rows: readTable(csv, sourceSpec(venture, label)!).rows });

test('niets gevuld, niets te melden; en de grenzen zijn getallen', () => {
  assert.deepEqual(sourceAlerts('blex', {}, NOW), []);
  assert.deepEqual(sourceAlerts('misc', {}, NOW), []);
  assert.deepEqual(ALERT_THRESHOLDS, { garageOpenDays: 14, requestOpenDays: 2, deadlineSoonDays: 7 });
});

test('wagenpark: verlopen is blokkerend, binnen 14 dagen snel, ontbrekend één samenvatting, oud garagepunt', () => {
  const alerts = sourceAlerts(
    'blex',
    {
      'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;apk;tachograaf\n12-ABC-3;${iso(-3)};\n45-XYZ-9;${iso(10)};${iso(400)}\n`),
      'drivers.csv': table('blex', 'Chauffeurstermijnen (rijbewijs, code 95, chauffeurskaart)', `naam;rijbewijs;code95\nKarapetyan;${iso(-1)};${iso(500)}\n`),
      'garage.csv': table('blex', 'Openstaande garagepunten', `kenteken;punt;gemeld;afgemeld\n12-ABC-3;remlicht;${iso(-20)};\n12-ABC-3;spiegel;${iso(-3)};\n45-XYZ-9;ruit;${iso(-30)};${iso(-1)}\n`),
    },
    NOW,
  );
  const byTitle = (re: RegExp) => alerts.find((a) => re.test(a.title));
  assert.equal(byTitle(/APK van wagen 12-ABC-3 is 3 dag\(en\) verlopen/)!.urgency, 'blocking');
  assert.equal(byTitle(/APK van wagen 45-XYZ-9 verloopt over 10 dag/)!.urgency, 'soon');
  assert.equal(byTitle(/Rijbewijs van Karapetyan is 1 dag/)!.urgency, 'blocking');
  assert.ok(!byTitle(/Tachograafkeuring van wagen 45-XYZ-9/), 'ver weg = geen actie');
  const missing = byTitle(/termijn\(en\) zonder datum/)!;
  assert.equal(missing.urgency, 'whenever');
  assert.match(missing.title, /^\d+ termijn/);
  assert.equal(alerts.filter((a) => a.id === 'blex-fleet-missing').length, 1, 'ontbrekend is één actie, niet één per termijn');
  assert.ok(byTitle(/Garagepunt "remlicht" van 12-ABC-3 staat 20 dagen open/));
  assert.ok(!byTitle(/spiegel/), 'drie dagen is nog geen storing');
  assert.ok(!byTitle(/ruit/), 'afgemeld is klaar');
  // Ids zijn stabiel per feit: morgen dezelfde APK, dezelfde id.
  assert.ok(alerts.some((a) => a.id === 'blex-vehicles.csv-12-ABC-3-apk'));
});

test('ritten en facturen: vertraagd of over de ETA, en onbetaald na de vervaldatum', () => {
  const alerts = sourceAlerts(
    'traject',
    {
      'ritten.csv': table('traject', 'Ritten en ETA per wagen', `rit;kenteken;van;naar;eta;status\nR1;A;Venlo;Keulen;${iso(0)} 14:30;onderweg\nR2;B;Lille;Venlo;${iso(-1)};onderweg\nR3;C;X;Y;${iso(-5)};geleverd\nR4;D;X;Y;${iso(2)};vertraagd\n`),
      'facturen.csv': table('traject', 'Facturatiestand', `factuur;klant;bedrag;verstuurd;vervalt;betaald\nF-1;Acme;1.250,50;${iso(-40)};${iso(-10)};\nF-2;Acme;10;${iso(-40)};${iso(-10)};${iso(-2)}\nF-3;Acme;10;${iso(-1)};${iso(20)};\n`),
    },
    NOW,
  );
  const titles = alerts.map((a) => a.title);
  assert.ok(titles.some((t) => t.startsWith('Rit R2') && t.includes('over zijn ETA')));
  assert.ok(titles.some((t) => t.startsWith('Rit R4') && t.includes('vertraagd')));
  assert.ok(!titles.some((t) => t.startsWith('Rit R1')), 'vandaag om 14:30 is om 10:00 niet voorbij');
  assert.ok(!titles.some((t) => t.startsWith('Rit R3')), 'geleverd is geleverd');
  const f1 = alerts.find((a) => a.title.startsWith('Factuur F-1'))!;
  assert.match(f1.title, /10 dag\(en\) over de vervaldatum/);
  assert.match(f1.detail, /€ 1\.250,5/);
  assert.ok(!titles.some((t) => t.startsWith('Factuur F-2')), 'betaald');
  assert.ok(!titles.some((t) => t.startsWith('Factuur F-3')), 'nog niet vervallen');
});

test('handel en portefeuilles: zonder stop blokkerend; boven max per munt of per sector', () => {
  const trading = sourceAlerts('trading', { 'posities.csv': table('trading', 'Posities, P&L, stops', 'instrument;richting;inzet;entry;stop\nxauusd;long;500;2410;\nEURUSD;short;200;1.08;1.09\n') }, NOW);
  assert.equal(trading.length, 1);
  assert.equal(trading[0]!.urgency, 'blocking');
  assert.match(trading[0]!.title, /XAUUSD \(long\) heeft geen stop/);

  const crypto = sourceAlerts(
    'crypto',
    {
      'portefeuille.csv': table('crypto', 'Portefeuille en posities', 'munt;aantal;waarde_usd\nBTC;1;70\nETH;1;30\n'),
      'allocatie.csv': table('crypto', 'Streefverdeling en concentratiegrenzen', 'munt_of_sector;doel_pct;max_pct\nBTC;50;60\nETH;30;40\n'),
    },
    NOW,
  );
  assert.equal(crypto.length, 1);
  assert.match(crypto[0]!.title, /^BTC weegt 70\.0% — boven je grens van 60%/);

  const equities = sourceAlerts(
    'equities',
    {
      'portefeuille.csv': table('equities', 'Koersen en portefeuille', 'ticker;aantal;waarde;sector\nASML;1;50;halfgeleiders\nBESI;1;20;halfgeleiders\nINGA;1;30;financials\n'),
      'sectorallocatie.csv': table('equities', 'Streefverdeling per sector', 'sector;doel_pct;max_pct\nhalfgeleiders;40;60\nfinancials;30;40\n'),
    },
    NOW,
  );
  assert.equal(equities.length, 1);
  assert.match(equities[0]!.title, /^Sector halfgeleiders weegt 70\.0%/);
  // Eén positie zonder sector ⇒ de som per sector klopt niet ⇒ geen oordeel.
  const partial = sourceAlerts(
    'equities',
    {
      'portefeuille.csv': table('equities', 'Koersen en portefeuille', 'ticker;aantal;waarde;sector\nASML;1;90;halfgeleiders\nINGA;1;10;\n'),
      'sectorallocatie.csv': table('equities', 'Streefverdeling per sector', 'sector;doel_pct;max_pct\nhalfgeleiders;40;60\n'),
    },
    NOW,
  );
  assert.deepEqual(partial, []);
});

test('opdrachten en studio: deadline binnen een week, aanvraag die te lang stil ligt', () => {
  const design = sourceAlerts('elevate', { 'opdrachten.csv': table('elevate', 'Lopende opdrachten', `klant;opdracht;status;deadline\nAcme;Merkgids;lopend;${iso(3)}\nAcme;Site;af;${iso(-3)}\nBeta;Logo;review;${iso(-2)}\nBeta;Deck;lopend;${iso(30)}\n`) }, NOW);
  assert.deepEqual(design.map((a) => [a.title.split('"')[1], a.urgency]), [['Merkgids', 'soon'], ['Logo', 'blocking']]);
  const studio = sourceAlerts(
    'uprising',
    {
      'aanvragen.csv': table('uprising', 'Openstaande aanvragen', `ontvangen;van;onderwerp;status\n${iso(-5)};Nare;mix;nieuw\n${iso(-1)};Vers;master;nieuw\n${iso(-9)};Oud;podcast;beantwoord\n`),
      'boekingen.csv': table('uprising', 'Agenda en boekingen', `datum;klant;ruimte;status\n${iso(4)};Duo;A;aanvraag\n${iso(5)};Trio;B;bevestigd\n`),
    },
    NOW,
  );
  const titles = studio.map((a) => a.title);
  assert.ok(titles.some((t) => t.startsWith('Aanvraag van Nare') && t.includes('5 dagen')));
  assert.ok(!titles.some((t) => t.startsWith('Aanvraag van Vers')), 'één dag is geen stilte');
  assert.ok(!titles.some((t) => t.startsWith('Aanvraag van Oud')), 'beantwoord');
  assert.ok(titles.some((t) => t.startsWith('Boeking van Duo') && t.includes('niet bevestigd')));
  assert.ok(!titles.some((t) => t.startsWith('Boeking van Trio')));
});

test('ids blijven uniek als hetzelfde feit twee keer in het bestand staat', () => {
  const alerts = sourceAlerts('trading', { 'posities.csv': table('trading', 'Posities, P&L, stops', 'instrument;richting;inzet;entry;stop\nXAUUSD;long;500;2410;\nXAUUSD;long;100;2400;\n') }, NOW);
  assert.deepEqual(alerts.map((a) => a.id), ['trading-nostop-XAUUSD', 'trading-nostop-XAUUSD#2']);
});

test('een weggelaten kolom is geen ontbrekende termijn', () => {
  const alerts = sourceAlerts('blex', { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;apk\nAA-1;${iso(100)}\n`) }, NOW);
  assert.deepEqual(alerts, [], 'geen adr-kolom betekent: adr geldt niet');
});
