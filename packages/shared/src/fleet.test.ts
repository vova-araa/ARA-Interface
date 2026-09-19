import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEADLINE_WINDOWS,
  fleetDeadlines,
  parseCsv,
  parseDate,
  readDrivers,
  readVehicles,
  summarizeDeadlines,
} from './fleet.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19); // 2026-09-19
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString().slice(0, 10);

test('csv: puntkomma én komma, aanhalingstekens, BOM in de kop', () => {
  const semi = parseCsv('﻿Kenteken;Km;APK\n12-ABC-3;120.500;2026-10-01\n');
  assert.deepEqual(semi.header, ['kenteken', 'km', 'apk']);
  assert.equal(semi.records[0]!.kenteken, '12-ABC-3');
  const comma = parseCsv('naam,rijbewijs\n"Jansen, P.",2027-01-01\n');
  assert.equal(comma.records[0]!.naam, 'Jansen, P.');
  const bad = parseCsv('kenteken;apk\n12-ABC-3;2026-10-01;extra\n');
  assert.equal(bad.records.length, 0);
  assert.match(bad.errors[0]!, /regel 2/);
});

test('datum: drie schrijfwijzen, en alles anders is géén datum', () => {
  assert.equal(parseDate('2026-03-14'), Date.UTC(2026, 2, 14));
  assert.equal(parseDate('14-03-2026'), Date.UTC(2026, 2, 14));
  assert.equal(parseDate('14/03/2026'), Date.UTC(2026, 2, 14));
  assert.equal(parseDate(''), undefined);
  assert.equal(parseDate('binnenkort'), undefined);
  assert.equal(parseDate('31-02-2026'), undefined, '31 februari rolt niet stilzwijgend door naar maart');
});

test('voertuigen: kenteken genormaliseerd, km met punt, ontbrekende termijn gemeld', () => {
  const { rows, errors } = readVehicles(
    'kenteken;km;apk;tachograaf\n12-abc-3;120.500;2026-10-01;\n;1;2026-10-01;2026-10-01\n',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kenteken, '12-ABC-3');
  assert.equal(rows[0]!.km, 120500);
  // Alleen een lege cel in een bestaande kolom is een gat; adr en verzekering
  // staan niet in de kop en gelden dus niet voor deze lijst.
  assert.deepEqual(rows[0]!.missing, ['tachograaf']);
  assert.match(errors[0]!, /leeg kenteken/);
  assert.match(readVehicles('nummer;apk\nx;2026-01-01\n').errors[0]!, /"kenteken" ontbreekt/);
});

test('vensters: de grens ligt op de dag zelf en is een getal, geen zin', () => {
  assert.deepEqual(DEADLINE_WINDOWS, { soon: 14, plan: 30, watch: 60 });
  const { rows } = readVehicles(
    `kenteken;apk;tachograaf;adr;verzekering\n` +
      `A;${iso(-1)};${iso(14)};${iso(30)};${iso(60)}\n` +
      `B;${iso(0)};${iso(15)};${iso(31)};${iso(61)}\n`,
  );
  const byKey = new Map(fleetDeadlines(rows, [], NOW).map((d) => [`${d.subject}:${d.term}`, d.window]));
  assert.equal(byKey.get('A:apk'), 'verlopen');
  assert.equal(byKey.get('A:tachograaf'), '14');
  assert.equal(byKey.get('A:adr'), '30');
  assert.equal(byKey.get('A:verzekering'), '60');
  assert.equal(byKey.get('B:apk'), '14', 'vandaag is niet verlopen, wel deze week');
  assert.equal(byKey.get('B:tachograaf'), '30');
  assert.equal(byKey.get('B:adr'), '60');
  assert.equal(byKey.has('B:verzekering'), false, 'dag 61 heeft niets te melden');
});

test('om tien uur is een APK van vandaag nog niet verlopen', () => {
  const { rows } = readVehicles(`kenteken;apk\nA;${iso(0)}\n`);
  const at10 = fleetDeadlines(rows, [], NOW + 10 * 60 * 60 * 1000);
  assert.equal(at10.find((d) => d.term === 'apk')!.window, '14');
  assert.equal(at10.find((d) => d.term === 'apk')!.daysLeft, 0);
  assert.equal(parseDate('2026-09-19T14:30:00Z'), Date.UTC(2026, 8, 19));
  assert.equal(parseDate('2026-09-19T14:30:00.000Z'), Date.UTC(2026, 8, 19));
});

test('een lege datum wordt "ontbreekt", nooit stilzwijgend in orde', () => {
  const { rows } = readVehicles(`kenteken;apk\nA;\n`);
  const found = fleetDeadlines(rows, [], NOW);
  assert.equal(found.length, 1, 'de apk-kolom bestaat en is leeg: één gat; de andere drie kolommen bestaan niet en gelden dus niet');
  assert.ok(found.every((d) => d.window === 'ontbreekt' && d.daysLeft === undefined));
});

test('ergste geval eerst: verlopen, dan op datum, ontbrekend achteraan', () => {
  const { rows } = readVehicles(`kenteken;apk;tachograaf\nZ;${iso(10)};\nA;${iso(-5)};${iso(25)}\n`);
  const drivers = readDrivers(`naam;rijbewijs;code95\nKarapetyan;${iso(-30)};${iso(3)}\n`).rows;
  const order = fleetDeadlines(rows, drivers, NOW).map((d) => `${d.subject}:${d.term}:${d.window}`);
  assert.deepEqual(order, [
    'Karapetyan:rijbewijs:verlopen',
    'A:apk:verlopen',
    'Karapetyan:code95:14',
    'Z:apk:14',
    'A:tachograaf:30',
    // Alleen kolommen die in de kop staan: adr, verzekering en chauffeurskaart
    // zijn hier weggelaten en gelden dus niet.
    'Z:tachograaf:ontbreekt',
  ]);
  assert.deepEqual(summarizeDeadlines(fleetDeadlines(rows, drivers, NOW)), {
    verlopen: 2,
    binnen14: 2,
    binnen30: 1,
    binnen60: 0,
    ontbreekt: 1,
  });
});
