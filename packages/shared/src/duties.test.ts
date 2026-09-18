import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaybook, type Cadence, type Duty, type Playbook } from './org.ts';
import { VENTURES } from './world.ts';

/**
 * Wie doet het terugkerende werk?
 *
 * Tot voor kort niemand behalve de manager: een `Duty` had geen eigenaar, dus
 * elke duty van elke tak kwam bij dezelfde rol terecht. Eén stoel met werk en
 * tien met een functieomschrijving — en dat is precies hoe een vloer leeg
 * blijft terwijl het bord vol lijkt te moeten lopen.
 *
 * Deze vier controles bewaken die verdeling. Ze kosten nul tokens en draaien
 * in CI, want dit is structuur, geen gedrag.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ORG_JSON = path.join(REPO, 'plugins/ara/org.json');

interface OrgFile {
  ops?: {
    specialists?: { agent: string }[];
    duties?: Duty[];
  };
  ventures?: { id: string; playbook?: Partial<Playbook> }[];
}

const org = JSON.parse(fs.readFileSync(ORG_JSON, 'utf8')) as OrgFile;

/**
 * Exact wat `GET /org` teruggeeft: het branche-standaard uit org.ts met de
 * invoer uit org.json eroverheen. Testen op het standaard alleen zou een
 * override in org.json ongemerkt kapot laten gaan.
 *
 * `misc` is verborgen (policy.hiddenVentures) en blijft hier buiten, net als in
 * agents.test.ts. Het generieke standaard-playbook wordt wél getoetst, via een
 * tak die nog niet bestaat — precies de situatie waarin dat standaard telt.
 */
const PLAYBOOKS: { id: string; book: Playbook }[] = [
  ...VENTURES.filter((v) => v.id !== 'misc').map((v) => ({
    id: v.id,
    book: resolvePlaybook(v.id, v.label, org.ventures?.find((o) => o.id === v.id)?.playbook),
  })),
  { id: 'nieuwe-tak (branche-standaard)', book: resolvePlaybook('nieuwe-tak', 'Nieuwe tak') },
];

/** Rollen die vandaag al echt werk kunnen doen: die draaien op git, npm en de
 *  repo zelf en wachten dus op geen enkele databron. Staan ze zonder duty op de
 *  vloer, dan blijft het bord leeg om een reden die niets met data te maken
 *  heeft. */
const NEEDS_NO_DATA_SOURCE = [
  'ara-security-auditor',
  'ara-dependency-warden',
  'ara-doc-writer',
  'ara-qa-verifier',
  'ara-reporter',
];

const CADENCES: Cadence[] = ['dag', 'week', 'maand'];

test('duties: elke specialist in elk playbook heeft eigen werk', () => {
  for (const { id, book } of PLAYBOOKS) {
    const owners = new Set(book.duties.map((d) => d.who).filter(Boolean));
    for (const spec of book.specialists) {
      assert.ok(
        owners.has(spec.agent),
        `${id}: ${spec.agent} (${spec.name}) staat op de vloer maar geen enkele duty noemt hem — een rol zonder duty werkt nooit uit zichzelf`,
      );
    }
  }
});

test('duties: elke who wijst naar een stoel die in diezelfde tak bestaat', () => {
  for (const { id, book } of PLAYBOOKS) {
    const seats = new Set(book.specialists.map((s) => s.agent));
    for (const duty of book.duties) {
      assert.ok(
        CADENCES.includes(duty.every),
        `${id}: "${duty.text.slice(0, 40)}…" heeft cadans ${duty.every}, en die kent de watchdog niet`,
      );
      if (!duty.who) continue; // leeg = de manager van de tak, dat mag
      assert.ok(
        seats.has(duty.who),
        `${id}: duty "${duty.text.slice(0, 40)}…" is van ${duty.who}, maar die staat niet in de specialistenlijst van deze tak — werk dat naar een lege stoel wijst doet niemand`,
      );
    }
  }

  // ops staat los van de venture-playbooks, maar draait op hetzelfde ritme.
  const opsSeats = new Set((org.ops?.specialists ?? []).map((s) => s.agent));
  const opsDuties = org.ops?.duties ?? [];
  assert.ok(opsDuties.length > 0, 'ops hoort terugkerend werk te hebben, niet alleen incidenten');
  for (const duty of opsDuties) {
    assert.ok(
      duty.who && opsSeats.has(duty.who),
      `ops: duty "${duty.text.slice(0, 40)}…" is van ${duty.who ?? '(niemand)'}, maar die staat niet in ops.specialists`,
    );
    assert.ok(CADENCES.includes(duty.every), `ops: onbekende cadans ${duty.every}`);
  }
});

test('duties: geen enkele tak draait volledig op dagelijks werk', () => {
  // Elke duty kost tokens zodra hij vuurt. Acht takken vol dagelijks werk is
  // het dagbudget leeg vóór er iets nuttigs gebeurd is.
  for (const { id, book } of PLAYBOOKS) {
    const daily = book.duties.filter((d) => d.every === 'dag').length;
    assert.ok(
      daily < book.duties.length,
      `${id}: alles staat op dagelijks — dan is er geen ritme meer, alleen budget`,
    );
    assert.ok(
      daily * 2 < book.duties.length,
      `${id}: ${daily} van de ${book.duties.length} duties zijn dagelijks; dagelijks is voor werk dat écht elke dag verandert`,
    );
  }
});

test('duties: de rollen die geen databron nodig hebben, hebben werk', () => {
  // Deze rollen kunnen vandaag draaien. Ze zijn het verschil tussen een bord
  // dat vol loopt en een bord dat wacht op een koppeling die er nog niet is.
  for (const { id, book } of PLAYBOOKS) {
    const owners = new Set(book.duties.map((d) => d.who).filter(Boolean));
    for (const agent of NEEDS_NO_DATA_SOURCE) {
      if (!book.specialists.some((s) => s.agent === agent)) continue;
      assert.ok(
        owners.has(agent),
        `${id}: ${agent} heeft geen databron nodig en kan dus vandaag werken, maar heeft geen duty`,
      );
    }
  }

  // Backupcontrole en organisatie-audit staan alleen in ops; zonder duty
  // draaien ze nooit, en dan is een backup weer een bestand waarvan je hoopt.
  const opsOwners = new Set((org.ops?.duties ?? []).map((d) => d.who));
  for (const agent of ['ara-backup-verifier', 'ara-org-auditor', 'ara-security-auditor']) {
    assert.ok(opsOwners.has(agent), `ops: ${agent} heeft geen terugkerend werk`);
  }
});

test('duties: de spawn-prompt noemt de eigenaar van elke duty', async () => {
  // Zonder de eigenaar in de prompt leest een manager zijn hele playbook als
  // eigen werk, en dan is `who` alleen data die nergens aankomt.
  const { playbookPrompt } = await import('./org.ts');
  const book = PLAYBOOKS.find((p) => p.id === 'blex')!.book;
  const prompt = playbookPrompt(book);
  for (const duty of book.duties) {
    if (!duty.who) continue;
    assert.ok(
      prompt.includes(`(${duty.every}, ${duty.who})`),
      `de prompt noemt ${duty.who} niet bij "${duty.text.slice(0, 40)}…"`,
    );
  }
});
