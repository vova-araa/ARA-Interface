import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_STALE_MS, STATION_CAP, stationsFromSources } from './officefeed.ts';
import { readTable, sourceSpec } from './sources.ts';
import { buildOffice } from './office.ts';
import { VENTURES } from './world.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19);
const iso = (d: number) => new Date(NOW + d * DAY).toISOString().slice(0, 10);
const table = (venture: string, label: string, csv: string, updatedAt = NOW - 2 * DAY) => ({
  rows: readTable(csv, sourceSpec(venture, label)!).rows,
  updatedAt,
});

test('zonder gevulde bron blijft het kantoor bij voorbeeldcijfers', () => {
  assert.equal(stationsFromSources('blex', {}, NOW), undefined);
  assert.equal(stationsFromSources('misc', { 'x.csv': { rows: [{ a: 1 }] } }, NOW), undefined);
});

test('wagenpark: kenteken is de werkplek, APK binnen 14 dagen is alarm, garagepunten tellen', () => {
  const feed = stationsFromSources(
    'blex',
    {
      'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;km;apk\n12-abc-3;120.500;${iso(10)}\n45-XYZ-9;1;${iso(200)}\n`),
      'garage.csv': table('blex', 'Openstaande garagepunten', `kenteken;punt;gemeld;afgemeld\n45-XYZ-9;remlicht;${iso(-3)};\n45-XYZ-9;spiegel;${iso(-9)};${iso(-1)}\n`),
    },
    NOW,
  )!;
  assert.deepEqual(feed.entities, ['12-ABC-3', '45-XYZ-9']);
  const [a, b] = feed.overrides;
  assert.equal(a!.status, 'alert');
  assert.equal(a!.metrics!.find((m) => m.label === 'APK')!.value, '10 d');
  assert.equal(a!.metrics!.find((m) => m.label === 'Km-stand')!.value, '120.500');
  assert.equal(b!.status, 'working', 'één open garagepunt');
  assert.equal(b!.value, 1, 'afgemelde punten tellen niet');
  assert.equal(feed.truncated, 0);
  assert.equal(a!.staleAfterMs, FILE_STALE_MS);
});

test('een kolom die ontbreekt levert geen metric op — en APK zonder datum heet "ontbreekt"', () => {
  const feed = stationsFromSources(
    'blex',
    { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', 'kenteken\nAA-11-BB\n') },
    NOW,
  )!;
  const labels = feed.overrides[0]!.metrics!.map((m) => m.label);
  assert.ok(!labels.includes('Km-stand'), 'geen km-kolom, geen km-metric');
  assert.ok(!labels.includes('Storingen'), 'geen garagelijst, geen storingencijfer');
  assert.equal(feed.overrides[0]!.value, undefined, 'en geen verzonnen nul als waarde');
  assert.equal(feed.overrides[0]!.sub, 'geen garagelijst');
  assert.equal(feed.overrides[0]!.metrics!.find((m) => m.label === 'APK')!.value, 'ontbreekt');
});

test('handel: pnl is de waarde, een positie zonder stop is alarm', () => {
  const feed = stationsFromSources(
    'trading',
    { 'posities.csv': table('trading', 'Posities, P&L, stops', `instrument;richting;inzet;entry;stop;pnl\nXAUUSD;long;500;2410,5;2390;42,25\nEURUSD;short;200;1.0850;;-3\n`) },
    NOW,
  )!;
  // Zonder stop vooraan: dat is wat de risicobewaker moet zien.
  assert.equal(feed.overrides[0]!.id, 'EURUSD');
  assert.equal(feed.overrides[0]!.status, 'alert');
  assert.equal(feed.overrides[0]!.metrics!.find((m) => m.label === 'Stop')!.value, 'GEEN STOP');
  assert.equal(feed.overrides[1]!.value, 42.25);
  assert.equal(feed.overrides[1]!.status, 'working');
  const noPnl = stationsFromSources('trading', { 'posities.csv': table('trading', 'Posities, P&L, stops', 'instrument;richting;inzet;entry;stop\nXAUUSD;long;500;2410;2390\n') }, NOW)!;
  assert.equal(noPnl.overrides[0]!.value, undefined, 'geen pnl-kolom is geen winst van nul');
});

test('portefeuille: weging alleen als elke regel een waarde heeft, en boven max is alarm', () => {
  const full = stationsFromSources(
    'crypto',
    {
      'portefeuille.csv': table('crypto', 'Portefeuille en posities', 'munt;aantal;waarde_usd\nbtc;0,5;30000\neth;4;10000\n'),
      'allocatie.csv': table('crypto', 'Streefverdeling en concentratiegrenzen', 'munt_of_sector;doel_pct;max_pct\nBTC;50;60\nETH;30;40\n'),
    },
    NOW,
  )!;
  assert.equal(full.overrides[0]!.id, 'BTC');
  assert.equal(full.overrides[0]!.status, 'alert', '75% > max 60%');
  assert.match(full.overrides[0]!.metrics!.find((m) => m.label === 'Weging')!.value, /^75\.0% \(max 60%\)/);
  const partial = stationsFromSources(
    'equities',
    { 'portefeuille.csv': table('equities', 'Koersen en portefeuille', 'ticker;aantal;waarde\nASML;10;7000\nADYEN;5;\n') },
    NOW,
  )!;
  assert.ok(!partial.overrides[0]!.metrics!.some((m) => m.label === 'Weging'), 'één waarde ontbreekt ⇒ geen percentage');
  assert.equal(partial.overrides[0]!.sub, 'positie');
});

test('ritten: vertraagd eerst, ETA in het verleden is voorbij; boekingen: komend eerst', () => {
  const tms = stationsFromSources(
    'traject',
    { 'ritten.csv': table('traject', 'Ritten en ETA per wagen', `rit;kenteken;van;naar;eta;status\nR1;A;Venlo;Keulen;${iso(1)} 14:30;gepland\nR2;B;Lille;Venlo;${iso(-1)};onderweg\nR3;C;Poznań;Venlo;${iso(0)};vertraagd\n`) },
    NOW,
  )!;
  assert.deepEqual(tms.entities, ['R3', 'R2', 'R1']);
  assert.equal(tms.overrides[0]!.status, 'alert');
  assert.match(tms.overrides[1]!.metrics!.find((m) => m.label === 'ETA')!.value, /voorbij/);
  const studio = stationsFromSources(
    'uprising',
    { 'boekingen.csv': table('uprising', 'Agenda en boekingen', `datum;klant;ruimte;status;uren\n${iso(-5)};Oud;A;bevestigd;4\n${iso(3)};Nieuw;B;aanvraag;2\n`) },
    NOW,
  )!;
  assert.match(studio.entities[0]!, /^Nieuw · B · \d{4}-/);
  assert.equal(studio.overrides[0]!.status, 'alert', 'een aanvraag wacht op een antwoord');
});

test('hoogstens twaalf bureaus, en het kantoor toont ze als echt en niet verouderd', () => {
  const rows = Array.from({ length: 20 }, (_, i) => `T-${i};1;${iso(100)}`).join('\n');
  const feed = stationsFromSources(
    'blex',
    { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;km;apk\n${rows}\n`, NOW - 3 * DAY) },
    NOW,
  )!;
  assert.equal(feed.entities.length, STATION_CAP);
  assert.equal(feed.truncated, 8);
  const venture = VENTURES.find((v) => v.id === 'blex')!;
  const office = buildOffice({ project: 'truck-trailers', venture, sessions: [], tasks: [], entities: feed.entities, overrides: feed.overrides, stationsTruncated: feed.truncated, now: NOW });
  assert.equal(office.stations.length, STATION_CAP);
  assert.equal(office.stationsTruncated, 8);
  assert.ok(office.stations.every((s) => !s.simulated), 'uit een bestand = echt');
  assert.ok(office.stations.every((s) => !s.stale), 'drie dagen oud weekbestand is niet verouderd');
  // Een agent-push van dertig minuten geleden is dat wél — die regel blijft.
  const pushed = buildOffice({ project: 'p', venture, sessions: [], tasks: [], entities: ['X'], overrides: [{ id: 'X', value: 1, updatedAt: NOW - 31 * 60_000 }], now: NOW });
  assert.equal(pushed.stations[0]!.stale, true);
});

test('herkomst: een bureau uit een bestand draagt die bestandsnaam, tot in het kantoor', () => {
  const venture = VENTURES.find((v) => v.id === 'blex')!;
  const feed = stationsFromSources(
    'blex',
    { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;km;apk\nT-1;1;${iso(100)}\n`, NOW - 3 * DAY) },
    NOW,
  )!;
  assert.ok(feed.overrides.every((o) => o.source === 'vehicles.csv'), 'de override noemt zijn bestand');
  const office = buildOffice({ project: 'truck-trailers', venture, sessions: [], tasks: [], entities: feed.entities, overrides: feed.overrides, now: NOW });
  const t1 = office.stations.find((s) => s.id === 'T-1')!;
  assert.equal(t1.source, 'vehicles.csv', 'en het station ook — anders weet de viewer niet waar het cijfer vandaan komt');
  assert.equal(t1.updatedAt, NOW - 3 * DAY, 'met de mtime van het bestand als leeftijd');
  // Een agent-push heeft geen bestand; de viewer zegt dan "door agent", niet een verzonnen naam.
  const pushed = buildOffice({ project: 'p', venture, sessions: [], tasks: [], entities: ['X'], overrides: [{ id: 'X', value: 1, updatedAt: NOW }], now: NOW });
  assert.equal(pushed.stations[0]!.source, undefined);
});

test('ergste eerst vóór het afkappen: een verlopen APK op regel dertien staat vooraan', () => {
  const ok = Array.from({ length: 12 }, (_, i) => `OK-${i};1;${iso(300)}`).join('\n');
  const feed = stationsFromSources(
    'blex',
    { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;km;apk\n${ok}\nBAD-13;1;${iso(-2)}\nNODATE;1;\n`) },
    NOW,
  )!;
  assert.equal(feed.entities[0], 'BAD-13');
  assert.equal(feed.overrides[0]!.status, 'alert');
  assert.equal(feed.truncated, 2);
  assert.ok(!feed.entities.includes('NODATE'), 'ontbrekende datum sorteert achteraan en valt af');
});

test('een datum zonder tijd telt vanaf middernacht: om tien uur is vandaag nog niet verlopen', () => {
  const tenAm = NOW + 10 * 60 * 60 * 1000;
  const fleet = stationsFromSources(
    'blex',
    { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;apk\nA;${iso(0)}\n`) },
    tenAm,
  )!;
  assert.equal(fleet.overrides[0]!.metrics!.find((m) => m.label === 'APK')!.value, '0 d');
  const tms = stationsFromSources(
    'traject',
    { 'ritten.csv': table('traject', 'Ritten en ETA per wagen', `rit;kenteken;van;naar;eta;status\nR1;A;X;Y;${iso(0)} 14:30;onderweg\n`) },
    tenAm,
  )!;
  assert.ok(!tms.overrides[0]!.metrics!.find((m) => m.label === 'ETA')!.value.includes('voorbij'));
  const studio = stationsFromSources(
    'uprising',
    { 'boekingen.csv': table('uprising', 'Agenda en boekingen', `datum;klant;ruimte;status\n${iso(3)};Later;B;bevestigd\n${iso(0)};Vandaag;A;bevestigd\n`) },
    tenAm,
  )!;
  assert.match(studio.entities[0]!, /^Vandaag · A/, 'vandaag is niet "geweest"');
});

test('twee lots van dezelfde munt zijn één bureau met de som — dezelfde lezing als de actielijst', () => {
  const feed = stationsFromSources(
    'crypto',
    { 'portefeuille.csv': table('crypto', 'Portefeuille en posities', 'munt;aantal;waarde_usd\nBTC;1;100\nBTC;1;100\nETH;1;100\n') },
    NOW,
  )!;
  assert.deepEqual(feed.entities, ['BTC', 'ETH']);
  assert.match(feed.overrides[0]!.sub!, /^66\.7%/);
  assert.equal(feed.overrides[0]!.metrics!.find((m) => m.label === 'Aantal')!.value, '2');
  assert.equal(feed.overrides[0]!.value, 200);
});

test('studio: een aanvraag verdwijnt niet achter een bevestigde boeking van dezelfde klant', () => {
  const feed = stationsFromSources(
    'uprising',
    { 'boekingen.csv': table('uprising', 'Agenda en boekingen', `datum;klant;ruimte;status\n${iso(3)};Duo;A;bevestigd\n${iso(5)};Duo;A;aanvraag\n`) },
    NOW,
  )!;
  assert.equal(feed.entities.length, 2, 'twee dagen, twee boekingen');
  assert.equal(feed.overrides[0]!.status, 'alert', 'de aanvraag staat vooraan');
  assert.equal(feed.truncated, 0);
});

test('het detailpaneel van een bestand-gevoed bureau noemt het bestand en vult geen resultaat in', () => {
  const feed = stationsFromSources(
    'blex',
    { 'vehicles.csv': table('blex', 'Kenteken, APK-datum, kilometerstand', `kenteken;km;apk\nA;1;${iso(100)}\n`) },
    NOW,
  )!;
  const venture = VENTURES.find((v) => v.id === 'blex')!;
  const office = buildOffice({ project: 'p', venture, sessions: [], tasks: [], entities: feed.entities, overrides: feed.overrides, now: NOW });
  const kpis = office.stations[0]!.detail.kpis;
  assert.equal(kpis.find((k) => k.label === 'Laatste update')!.value, 'uit vehicles.csv');
  // Geen garagelijst ⇒ geen gemeten waarde ⇒ "Resultaat vandaag" is een invulling en zegt dat.
  assert.equal(office.stations[0]!.valueMissing, true);
  assert.equal(kpis.find((k) => k.label === 'Resultaat vandaag')!.estimated, true);
  assert.equal(office.stations[0]!.detail.estimated, true);
});
