import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRetro, formatRetroMessage, RETRO_THRESHOLDS, type RetroTask } from './retro.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const FROM = NOW - 7 * DAY;

let counter = 0;
/**
 * Titels zonder cijfers en allemaal verschillend: `titleKey` haalt cijfers
 * eruit, dus "Taak 1" t/m "Taak 10" zouden als één terugkerende taak tellen en
 * elke test over herhaling vervuilen.
 */
const WORDS = ['alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa'];

function task(patch: Partial<RetroTask> = {}): RetroTask {
  counter += 1;
  return {
    id: `t${counter}`,
    title: `Werk ${WORDS[counter % WORDS.length]}-${WORDS[(counter * 7) % WORDS.length]}`,
    detail: '',
    project: 'blex',
    assignee: 'manager:blex',
    createdBy: 'supervisor',
    status: 'done',
    result: 'klaar',
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - DAY,
    ...patch,
  };
}

/** Genoeg gewoon werk om voorbij de zwijgdrempel te komen. */
function filler(count: number, patch: Partial<RetroTask> = {}): RetroTask[] {
  return Array.from({ length: count }, () => task(patch));
}

test('terugblik: onder de drempel zegt hij niets, in plaats van iets te verzinnen', () => {
  const retro = buildRetro(filler(RETRO_THRESHOLDS.minTotal - 1), FROM, NOW, NOW);
  assert.equal(retro.tooQuiet, true);
  assert.deepEqual(retro.findings, [], 'een stil bord levert geen bevindingen op');
  assert.match(formatRetroMessage(retro), /Te weinig om iets uit te lezen/);
});

test('terugblik: elke bevinding draagt de taken waarop hij rust', () => {
  const failed = [task({ status: 'failed', assignee: 'ara-planner', result: 'kapot' })];
  const retro = buildRetro([...filler(10), ...failed], FROM, NOW, NOW);
  const finding = retro.findings.find((f) => f.kind === 'mislukt');
  assert.ok(finding, 'een mislukte taak hoort opgemerkt te worden');
  assert.deepEqual(
    finding.evidence.map((e) => e.id),
    failed.map((t) => t.id),
    'zonder bewijs is een bevinding een mening',
  );
});

test('terugblik: een rol met te weinig taken krijgt geen percentage om de oren', () => {
  // Twee taken, allebei geëscaleerd. 100% klinkt dramatisch en zegt niets.
  const few = [
    task({ assignee: 'ara-schaars', result: 'ESCALATE: te weinig gegevens' }),
    task({ assignee: 'ara-schaars', result: 'ESCALATE: te weinig gegevens' }),
  ];
  const retro = buildRetro([...filler(10), ...few], FROM, NOW, NOW);
  const row = retro.roles.find((r) => r.who === 'ara-schaars');
  assert.equal(row?.enoughData, false);
  assert.equal(
    retro.findings.some((f) => f.kind === 'escaleert-vaak' && f.who === 'ara-schaars'),
    false,
    'twee taken zijn geen patroon',
  );
});

test('terugblik: een rol die structureel escaleert valt wél op', () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    task({
      assignee: 'ara-krap',
      result: i < 4 ? 'ESCALATE: mag ik niet' : 'gedaan',
    }),
  );
  const retro = buildRetro([...filler(10), ...many], FROM, NOW, NOW);
  const finding = retro.findings.find((f) => f.kind === 'escaleert-vaak' && f.who === 'ara-krap');
  assert.ok(finding, 'vier van zes escalaties is een patroon');
  assert.equal(finding.evidenceTotal, 4);
});

test('terugblik: vastgelopen werk telt ook als het buiten het venster begon', () => {
  // Precies het geval dat een venster mist: drie weken open, dus in de laatste
  // week onzichtbaar — en juist dát is het werk dat blijft liggen.
  const old = task({ status: 'open', result: '', updatedAt: NOW - 21 * DAY, createdAt: NOW - 21 * DAY });
  const retro = buildRetro([...filler(10), old], FROM, NOW, NOW);
  const finding = retro.findings.find((f) => f.kind === 'vastgelopen');
  assert.ok(finding, 'een taak die drie weken stilstaat hoort gezien te worden');
  assert.equal(finding.evidence[0]?.id, old.id);
  assert.match(finding.text, /21 dag/);
});

test('terugblik: werk dat blijft terugkomen wordt als herhaling herkend', () => {
  // Dezelfde taak, andere datum in de titel. Zonder normaliseren is elk
  // exemplaar uniek en zie je het patroon nooit.
  const repeats = [
    task({ title: 'APK-controle 12 maart' }),
    task({ title: 'APK-controle 19 maart' }),
    task({ title: 'APK-controle 26 maart' }),
  ];
  const retro = buildRetro([...filler(10), ...repeats], FROM, NOW, NOW);
  const finding = retro.findings.find((f) => f.kind === 'herhaalt');
  assert.ok(finding, 'drie keer dezelfde taak is een terugkerend probleem');
  assert.equal(finding.evidenceTotal, 3);
});

test('terugblik: terugkerend werk uit het playbook geldt niet als probleem', () => {
  // Een dagelijkse plicht staat zeven keer per week op het bord. Dat is het
  // ritme dat werkt, niet een oorzaak die niemand wegneemt — en een bevinding
  // die elke week waar is, leest niemand nog.
  const duty = Array.from({ length: 7 }, () =>
    task({ title: 'Dagelijks: ritten van vandaag nalopen op gaten' }),
  );
  const retro = buildRetro([...filler(10), ...duty], FROM, NOW, NOW);
  assert.equal(
    retro.findings.some((f) => f.kind === 'herhaalt'),
    false,
    'ritme-taken horen terug te komen',
  );
});

test('terugblik: afgerond zonder resultaat is niet na te trekken', () => {
  const silent = [
    task({ assignee: 'ara-stil', result: '' }),
    task({ assignee: 'ara-stil', result: '   ' }),
  ];
  const retro = buildRetro([...filler(10), ...silent], FROM, NOW, NOW);
  const finding = retro.findings.find((f) => f.kind === 'geen-resultaat');
  assert.ok(finding);
  assert.equal(finding.evidenceTotal, 2, 'witruimte is geen resultaat');
});

test('terugblik: de doorlooptijd is een mediaan, zodat één uitschieter hem niet wegtrekt', () => {
  const quick = Array.from({ length: 4 }, () =>
    task({ assignee: 'ara-vlot', createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY + 60_000 }),
  );
  const slow = task({ assignee: 'ara-vlot', createdAt: NOW - 30 * DAY, updatedAt: NOW - DAY });
  const retro = buildRetro([...filler(10), ...quick, slow], FROM, NOW, NOW);
  const row = retro.roles.find((r) => r.who === 'ara-vlot');
  assert.ok(row?.medianMs !== undefined);
  assert.ok(
    row.medianMs < 2 * 60_000,
    `mediaan moet bij de gewone gang van zaken blijven, was ${row.medianMs}ms`,
  );
});

test('terugblik: een scheve verdeling wordt benoemd', () => {
  const retro = buildRetro(
    [...filler(12, { assignee: 'manager:blex' }), ...filler(2, { assignee: 'ara-planner' })],
    FROM,
    NOW,
    NOW,
  );
  const finding = retro.findings.find((f) => f.kind === 'scheve-verdeling');
  assert.ok(finding, '12 van 14 taken bij één rol is scheef');
  assert.equal(finding.who, 'manager:blex');
});

test('terugblik: één rol alleen is geen scheve verdeling', () => {
  // Een organisatie met één actieve rol is klein, niet scheef. Zonder deze
  // regel meldt het rapport bij elke rustige week hetzelfde valse patroon.
  const retro = buildRetro(filler(12, { assignee: 'manager:blex' }), FROM, NOW, NOW);
  assert.equal(
    retro.findings.some((f) => f.kind === 'scheve-verdeling'),
    false,
  );
});

test('terugblik: het bericht kan niets anders melden dan de cijfers', () => {
  const retro = buildRetro(
    [...filler(10), task({ status: 'failed', assignee: 'ara-planner' })],
    FROM,
    NOW,
    NOW,
  );
  const message = formatRetroMessage(retro);
  for (const finding of retro.findings) {
    assert.ok(message.includes(finding.text), `bevinding ontbreekt in het bericht: ${finding.text}`);
  }
});

test('terugblik: tweemaal dezelfde invoer geeft hetzelfde rapport', () => {
  const tasks = [...filler(10), task({ status: 'failed' }), task({ status: 'open', updatedAt: NOW - 9 * DAY })];
  assert.deepEqual(
    buildRetro(tasks, FROM, NOW, NOW),
    buildRetro(tasks, FROM, NOW, NOW),
    'dit rapport mag nooit van de klok of van toeval afhangen',
  );
});

// ── Kruiscontrole ────────────────────────────────────────────────────────

import { shouldVerify, verificationTask, QA_VERIFY_PREFIX, QA_VERIFIER } from './retro.ts';
import { stableHash } from './hex.ts';

const verifiable = (patch: Partial<Parameters<typeof shouldVerify>[0]> = {}) => ({
  id: 'taak-1',
  title: 'Kosten per kilometer nagelopen',
  status: 'done',
  assignee: 'ara-fleet-cost',
  result: 'drie uitschieters gevonden',
  detail: '',
  ...patch,
});

test('kruiscontrole: uit tenzij je hem aanzet', () => {
  assert.equal(shouldVerify(verifiable(), 0, stableHash), false);
  assert.equal(shouldVerify(verifiable(), 100, stableHash), true);
});

test('kruiscontrole: een controletaak wordt nooit zelf gecontroleerd', () => {
  // Zonder deze regel maakt elke controle een nieuwe controle. Het bord loopt
  // in een dag vol met een keten die nergens over gaat, en elke schakel kost
  // een sessie.
  assert.equal(
    shouldVerify(verifiable({ title: `${QA_VERIFY_PREFIX} iets` }), 100, stableHash),
    false,
    'op titel',
  );
  assert.equal(
    shouldVerify(verifiable({ assignee: QA_VERIFIER }), 100, stableHash),
    false,
    'op assignee — de controleur controleert zichzelf niet',
  );
});

test('kruiscontrole: een escalatie blijft van de mens', () => {
  assert.equal(
    shouldVerify(verifiable({ result: 'ESCALATE: hier mag ik niet bij' }), 100, stableHash),
    false,
  );
});

test('kruiscontrole: alleen afgerond werk, en alleen met een resultaat', () => {
  assert.equal(shouldVerify(verifiable({ status: 'open' }), 100, stableHash), false);
  assert.equal(shouldVerify(verifiable({ status: 'failed' }), 100, stableHash), false);
  assert.equal(shouldVerify(verifiable({ result: '   ' }), 100, stableHash), false);
});

test('kruiscontrole: een gesprek is geen werkstuk', () => {
  assert.equal(shouldVerify(verifiable({ title: 'CHAT: hoe staat het ervoor' }), 100, stableHash), false);
});

test('kruiscontrole: dezelfde taak levert altijd dezelfde keuze', () => {
  const task = verifiable({ id: 'stabiel-42' });
  const once = shouldVerify(task, 30, stableHash);
  for (let i = 0; i < 20; i++) {
    assert.equal(shouldVerify(task, 30, stableHash), once, 'een steekproef moet na te rekenen zijn');
  }
});

test('kruiscontrole: de steekproef zit rond het opgegeven percentage', () => {
  const picked = Array.from({ length: 1000 }, (_, i) =>
    shouldVerify(verifiable({ id: `taak-${i}` }), 25, stableHash),
  ).filter(Boolean).length;
  assert.ok(picked > 150 && picked < 350, `25% van 1000 gaf er ${picked}`);
});

test('kruiscontrole: de opdracht vraagt om een oordeel, niet om het werk over te doen', () => {
  const made = verificationTask(verifiable());
  assert.ok(made.title.startsWith(QA_VERIFY_PREFIX));
  assert.ok(made.detail.includes('drie uitschieters gevonden'), 'het werk zelf hoort erbij');
  assert.match(made.detail, /je doet het werk niet over/);
});
