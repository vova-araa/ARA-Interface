/**
 * Tests voor het kantoormodel (`office.ts`).
 *
 * Het kantoor is de enige plek waar collector en viewer hetzelfde beeld
 * vandaan halen, en tegelijk de plek waar het onderscheid tussen een gemeten
 * cijfer en een ingevuld cijfer wordt gemaakt. Dat onderscheid kun je niet
 * met de hand bewaken: het rot stil weg zodra iemand een filter versoepelt of
 * een gat "netjes" opvult. Daarom pinnen deze tests niet de vorm van het
 * kantoor maar de beloftes eronder:
 *
 *   1. het bord is het bord — escalaties apart, afgerond geteld, ondergrens
 *      als ondergrens, en een leeg bord blijft leeg;
 *   2. een dode koppeling ziet er niet levend uit;
 *   3. hetzelfde kantoor levert hetzelfde beeld, zonder klok en zonder toeval;
 *   4. in de gemeten laag staat nooit iets dat niet gemeten is;
 *   5. de keten chief → supervisor → manager → vloer is te volgen;
 *   6. elke branche praat zijn eigen taal in plaats van die van de buren.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOffice,
  isEscalated,
  officeKindForVenture,
  OFFICE_KIND_BY_VENTURE,
  STATION_STALE_MS,
  type BoardTaskLite,
  type OfficeInput,
  type OfficeKind,
  type OfficeSnapshot,
  type StaffMember,
} from './office.ts';
import { resolvePlaybook } from './org.ts';
import { VENTURES, type VentureStyle } from './world.ts';

const venture = (id: string): VentureStyle => VENTURES.find((v) => v.id === id)!;

/** Middernacht van de dag waarin `ts` valt — dezelfde lezing als het kantoor. */
function midnightOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Middaguur, zodat "vandaag" en "gisteren" niet van de tijdzone afhangen. */
function middayOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

const NOW = middayOf(1_700_000_000_000);
const HOUR = 60 * 60 * 1000;

function task(over: Partial<BoardTaskLite> & { id: string }): BoardTaskLite {
  return {
    title: `taak ${over.id}`,
    detail: 'gewone opdracht',
    status: 'open',
    assignee: 'manager:crypto',
    createdBy: 'supervisor',
    updatedAt: NOW - HOUR,
    ...over,
  };
}

function office(over: Partial<OfficeInput> = {}): OfficeSnapshot {
  return buildOffice({
    project: 'crypto-desk',
    venture: venture('crypto'),
    sessions: [],
    tasks: [],
    now: NOW,
    ...over,
  });
}

/* ───────────────────────────── het bord ───────────────────────────────── */

test('bord: een escalatie staat apart en verdwijnt niet tussen het gewone werk', () => {
  const tasks = [
    task({ id: 'gewoon' }),
    task({ id: 'bezig', status: 'claimed' }),
    // Twee vormen die de keten kent: in het resultaat (een weigering) en in de
    // opdracht zelf (werk dat vooraf al als escalatie is aangemerkt).
    task({ id: 'weigering', result: 'ESCALATE: dit raakt sleutels' }),
    task({ id: 'vooraf', detail: 'ESCALATE: order plaatsen mag hier nooit' }),
    task({ id: 'klaar', status: 'done', updatedAt: NOW - HOUR }),
    task({ id: 'mislukt', status: 'failed' }),
  ];
  const work = office({ tasks }).work;

  assert.deepEqual(
    work.escalations.map((t) => t.id).sort(),
    ['vooraf', 'weigering'],
    'beide vormen van ESCALATE horen in de escalatielijst',
  );
  assert.deepEqual(work.open.map((t) => t.id), ['gewoon', 'bezig'], 'en nergens anders');
  assert.ok(work.escalations.every((t) => t.escalated), 'een escalatie draagt zijn vlag');
  assert.ok(work.open.every((t) => !t.escalated));
  // Afgeronde en mislukte taken zijn geen lopend werk.
  for (const id of ['klaar', 'mislukt']) {
    assert.ok(![...work.open, ...work.escalations].some((t) => t.id === id), `${id} is geen lopend werk`);
  }
  // Het kantoor en de actielijst lezen hetzelfde: één lezing van "wacht op een mens".
  for (const t of tasks) {
    const inEscalations = work.escalations.some((e) => e.id === t.id);
    if (t.status === 'done' || t.status === 'failed') continue;
    assert.equal(inEscalations, isEscalated(t), `${t.id}: kantoor en isEscalated moeten het eens zijn`);
  }
});

test('bord: vandaag afgerond wordt geteld op de klok van het bord, niet geschat', () => {
  const midnight = midnightOf(NOW);
  const work = office({
    tasks: [
      task({ id: 'vanmorgen', status: 'done', updatedAt: NOW - 4 * HOUR }),
      task({ id: 'net', status: 'done', updatedAt: NOW }),
      // Precies middernacht hoort bij vandaag, één milliseconde ervoor niet.
      task({ id: 'grens', status: 'done', updatedAt: midnight }),
      task({ id: 'gisteren-laat', status: 'done', updatedAt: midnight - 1 }),
      task({ id: 'eergisteren', status: 'done', updatedAt: midnight - 40 * HOUR }),
      // Mislukt is niet afgerond, en open werk al helemaal niet.
      task({ id: 'mislukt', status: 'failed', updatedAt: NOW }),
      task({ id: 'open', status: 'open', updatedAt: NOW }),
    ],
  }).work;

  assert.equal(work.doneToday, 3, 'vanmorgen + net + de grens, en verder niets');
});

test('bord: een ondergrens wordt als ondergrens gemeld, niet als getal', () => {
  const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })];

  // Er kwamen er precies zoveel terug als de limiet toeliet ⇒ er kunnen er meer zijn.
  assert.equal(office({ tasks, taskLimit: 3 }).work.truncated, true);
  // Minder dan de limiet ⇒ dit is het hele bord.
  assert.equal(office({ tasks, taskLimit: 4 }).work.truncated, false);
  // Zonder limiet weet het kantoor niet beter en mag het geen ondergrens claimen.
  assert.equal(office({ tasks }).work.truncated, false);
});

test('bord: een leeg bord blijft leeg', () => {
  const work = office({ tasks: [] }).work;
  assert.deepEqual(work.escalations, [], 'geen taken ⇒ geen escalaties');
  assert.deepEqual(work.open, [], 'geen taken ⇒ geen lopend werk');
  assert.equal(work.doneToday, 0, 'geen taken ⇒ nul afgerond, niet "ongeveer"');
  assert.equal(work.truncated, false);
});

test('bord: een taak wijst naar de rol die hem heeft, of naar niemand', () => {
  const playbook = resolvePlaybook('crypto', 'Crypto desk');
  const work = office({
    playbook,
    tasks: [
      task({ id: 'bij-manager', assignee: 'manager:crypto' }),
      task({ id: 'bij-rol', assignee: 'ara-risk-guard' }),
      task({ id: 'onbekend', assignee: 'iemand-anders' }),
      task({
        id: 'met-notitie',
        detail: '\n\nEerste echte regel\ntweede regel',
        result: '',
      }),
      task({ id: 'met-resultaat', result: 'klaar: 3 munten gecontroleerd\nrest volgt' }),
    ],
  }).work;
  const byId = (id: string) => work.open.find((t) => t.id === id)!;

  assert.equal(byId('bij-manager').staffId, 'manager:crypto');
  const risk = byId('bij-rol').staffId;
  assert.ok(risk && risk.includes('ara-risk-guard'), 'een vaste rol is te vinden via zijn agent');
  assert.equal(byId('onbekend').staffId, undefined, 'niet te plaatsen ⇒ geen stoel verzinnen');
  assert.equal(byId('met-notitie').note, 'Eerste echte regel', 'lege regels tellen niet mee');
  assert.equal(byId('met-resultaat').note, 'klaar: 3 munten gecontroleerd', 'het resultaat wint van de opdracht');
});

test('feitenfeed: de nieuwste gebeurtenissen, niet de eerste acht die binnenkwamen', () => {
  // Meer taken dan de feed aankan, met de oudste vooraan: als er vóór het
  // sorteren wordt afgekapt, verdwijnt precies wat er net gebeurd is.
  const tasks = Array.from({ length: 12 }, (_, i) =>
    task({ id: `t${i}`, title: `taak ${i}`, updatedAt: NOW - (12 - i) * HOUR }),
  );
  // Oudste eerst: precies de volgorde waarin afkappen-vóór-sorteren fout gaat.
  const facts = office({ tasks }).facts;

  assert.ok(facts.length > 0);
  for (let i = 1; i < facts.length; i += 1) {
    assert.ok(facts[i - 1]!.ts >= facts[i]!.ts, 'de feed loopt van nieuw naar oud');
  }
  assert.ok(facts.some((f) => f.text.includes('taak 11')), 'de nieuwste gebeurtenis hoort erin te staan');
  assert.ok(!facts.some((f) => f.text.includes('taak 0')), 'de oudste hoort er niet meer in te staan');
});

/* ──────────────────────── echt, ingevuld, stilgevallen ─────────────────── */

test('werkplek: echte data wint, en maakt de buren niet stiekem echt', () => {
  const snap = office({
    overrides: [
      {
        id: 'BTC',
        status: 'alert',
        value: 123.45,
        metrics: [{ label: 'Positie', value: '0.42 BTC' }],
        updatedAt: NOW,
      },
    ],
  });
  const btc = snap.stations.find((s) => s.id === 'BTC')!;
  const eth = snap.stations.find((s) => s.id === 'ETH')!;

  assert.equal(btc.simulated, false);
  assert.equal(btc.value, 123.45);
  assert.deepEqual(btc.metrics, [{ label: 'Positie', value: '0.42 BTC' }], 'aangeleverde cijfers blijven zoals ze zijn');
  assert.ok(!btc.metrics.some((m) => m.estimated), 'en worden niet als voorbeeld gemarkeerd');

  assert.equal(eth.simulated, true, 'zonder eigen bron blijft een werkplek een voorbeeld');
  assert.ok(eth.metrics.every((m) => m.estimated), 'en al zijn cijfers dragen dat');
  assert.equal(snap.realStations, 1);
  assert.equal(snap.simulated, false, 'er is íets echt in dit kantoor');

  // Helemaal zonder bron: het hele kantoor staat als voorbeeld gemarkeerd.
  const leeg = office();
  assert.equal(leeg.simulated, true);
  assert.equal(leeg.realStations, 0);
  assert.equal(leeg.staleStations, 0);
  assert.ok(leeg.stations.every((s) => s.simulated));
});

test('werkplek: een stilgevallen koppeling ziet er niet levend uit', () => {
  // Precies op de grens leeft de koppeling nog; één milliseconde erna niet.
  const nog = office({ overrides: [{ id: 'BTC', value: 1, updatedAt: NOW - STATION_STALE_MS }] });
  const nogBtc = nog.stations.find((s) => s.id === 'BTC')!;
  assert.equal(nogBtc.stale, false, 'op de grens is de koppeling nog in leven');
  assert.equal(nog.staleStations, 0);
  assert.equal(
    nogBtc.detail.kpis.find((k) => k.label === 'Laatste update')!.value,
    'live',
  );

  const dood = office({ overrides: [{ id: 'BTC', value: 1, updatedAt: NOW - STATION_STALE_MS - 1 }] });
  const doodBtc = dood.stations.find((s) => s.id === 'BTC')!;
  assert.equal(doodBtc.stale, true, 'één milliseconde later is hij stilgevallen');
  assert.equal(dood.staleStations, 1);
  assert.equal(
    doodBtc.detail.kpis.find((k) => k.label === 'Laatste update')!.value,
    'stilgevallen',
    'het paneel mag geen "live" tonen boven cijfers van een uur oud',
  );

  // Een push zonder tijdstip kan niet verouderen: dan is er niets om aan af te meten.
  const zonderTijd = office({ overrides: [{ id: 'BTC', value: 1 }] });
  assert.equal(zonderTijd.stations.find((s) => s.id === 'BTC')!.stale, false);
});

/* ─────────────────────────── determinisme ─────────────────────────────── */

test('determinisme: hetzelfde kantoor, zonder klok en zonder toeval', () => {
  const input: OfficeInput = {
    project: 'crypto-desk',
    venture: venture('crypto'),
    sessions: [],
    tasks: [task({ id: 'a' }), task({ id: 'b', result: 'ESCALATE: nee' })],
    playbook: resolvePlaybook('crypto', 'Crypto desk'),
    taskLimit: 50,
    now: NOW,
  };

  // De builder mag de wandklok noch het toeval aanraken: een replay hoort het
  // verleden te reproduceren, niet het heden. `now` komt van de aanroeper.
  const realNow = Date.now;
  const realRandom = Math.random;
  Date.now = () => {
    throw new Error('buildOffice mag Date.now() niet aanroepen — now komt uit de invoer');
  };
  Math.random = () => {
    throw new Error('buildOffice mag Math.random() niet aanroepen — gebruik stableHash');
  };
  let eerste: string;
  let tweede: string;
  try {
    eerste = JSON.stringify(buildOffice(input));
    tweede = JSON.stringify(buildOffice(input));
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
  assert.equal(eerste, tweede, 'dezelfde invoer hoort byte voor byte hetzelfde kantoor te geven');
});

test('determinisme: twee projecten delen geen kantoor', () => {
  const a = office({ project: 'crypto-desk' });
  const b = office({ project: 'crypto-lab' });

  assert.notDeepEqual(
    a.stations.map((s) => s.value),
    b.stations.map((s) => s.value),
    'twee projecten van dezelfde tak mogen niet hetzelfde kantoor krijgen',
  );
  assert.notEqual(a.headline.value, b.headline.value);
  assert.notDeepEqual(a.chart, b.chart);
  // Wel hetzelfde: de entiteiten van de tak. Die horen bij de branche, niet bij het project.
  assert.deepEqual(a.stations.map((s) => s.id), b.stations.map((s) => s.id));
});

/* ───────────────────────────── gemeten laag ───────────────────────────── */

test('gemeten: alleen wat gemeten is, en nooit als schatting', () => {
  const zonder = office();
  assert.deepEqual(zonder.measured, [], 'geen meting ⇒ geen regel, geen nul, geen streepje');
  assert.equal(zonder.pulse, undefined);

  // Een pulse zonder inhoud is nog steeds geen meting.
  assert.deepEqual(office({ pulse: { measuredAt: NOW } }).measured, []);

  const met = office({
    pulse: {
      branch: 'main',
      commitsToday: 0,
      dirtyFiles: 3,
      lastCommitAt: NOW - 5 * 60 * 1000,
      doneTasksToday: 2,
      measuredAt: NOW,
      // commits7d, toolCallsToday, errorsToday, tokensToday en openTasks
      // ontbreken bewust: die zijn niet gemeten.
    },
  });
  const labels = met.measured.map((m) => m.label);
  assert.ok(labels.includes('Branch'));
  assert.ok(labels.includes('Commits vandaag'), '0 commits is een meting, geen gat');
  assert.ok(labels.includes('Onopgeslagen wijzigingen'));
  assert.ok(labels.includes('Laatste commit'));
  for (const afwezig of ['Commits 7 dagen', 'Tool-calls vandaag', 'Fouten vandaag', 'Tokens vandaag', 'Taken open']) {
    assert.ok(!labels.includes(afwezig), `${afwezig} is niet gemeten en hoort er dus niet te staan`);
  }
  assert.ok(met.measured.every((m) => m.estimated === false), 'geen enkele gemeten regel is een schatting');
  assert.equal(met.measured.find((m) => m.label === 'Laatste commit')!.value, '5 min geleden');

  // Gemeten git-cijfers maken een ingevulde muntkoers niet echt.
  assert.equal(met.simulated, true);
  assert.equal(met.realStations, 0);
});

/* ──────────────────────────── de organisatie ──────────────────────────── */

test('bezetting: de keten chief → supervisor → manager → vloer is te volgen', () => {
  const playbook = resolvePlaybook('crypto', 'Crypto desk', { managerName: 'Manager Crypto' });
  const snap = office({
    playbook,
    sessions: [
      {
        sessionId: 's1',
        project: 'crypto-desk',
        cwd: '/x',
        startedAt: NOW,
        lastSeenAt: NOW,
        status: 'working',
        needsHuman: false,
        toolCount: 1,
        errorCount: 0,
        agents: {
          a1: {
            agentId: 'a1',
            agentType: 'ara-web-scout',
            sessionId: 's1',
            startedAt: NOW,
            lastSeenAt: NOW,
            stopped: false,
            lastToolSummary: 'grep orderbook',
          },
        },
      },
    ],
  });
  const staff = snap.staff;
  const byId = new Map(staff.map((m) => [m.id, m]));

  // De chief staat vooraan en aan de top: de viewer zoekt hem als eerste
  // 'supervisor' in de lijst en tekent hem op zijn eigen verhoging.
  assert.equal(staff[0]!.id, 'chief');
  assert.equal(staff[0]!.tier, 'chief');
  assert.equal(staff[0]!.depth, 0);
  assert.equal(staff[0]!.reportsTo, undefined);
  assert.equal(
    staff.filter((m) => m.reportsTo === undefined).length,
    1,
    'er is precies één top in het kantoor',
  );

  const supervisor = staff.find((m) => m.tier === 'supervisor')!;
  assert.ok(supervisor, 'de schakel die het werk verdeelt hoort erin te staan');
  assert.equal(supervisor.reportsTo, 'chief');

  const manager = staff.find((m) => m.tier === 'manager')!;
  assert.equal(manager.name, 'Manager Crypto');
  assert.equal(manager.reportsTo, supervisor.id, 'een manager hangt onder de supervisor, niet onder de chief');

  const specialists = staff.filter((m) => m.tier === 'specialist');
  assert.ok(specialists.length > 0, 'de vaste rollen van de tak staan er ook als er niemand draait');
  assert.ok(specialists.every((m) => m.reportsTo === manager.id));
  assert.ok(specialists.every((m) => m.does && m.does.length > 0), 'elke rol zegt wat hij hier doet');

  const vloer = staff.filter((m) => m.tier === 'floor');
  assert.ok(vloer.some((m) => m.name === 'ara-web-scout' && m.busyWith === 'grep orderbook'));
  assert.ok(vloer.every((m) => m.reportsTo === manager.id));

  // De keten moet te lópen zijn: elke verwijzing bestaat, en de diepte klopt
  // met de plek in de keten. Een dood id maakt het tekenen van de organisatie
  // onmogelijk en dat merk je pas in de 3D-scène.
  for (const m of staff) {
    assert.ok(m.tier, `${m.id} hoort een plaats in de keten te hebben`);
    assert.equal(typeof m.depth, 'number', `${m.id} hoort een diepte te hebben`);
    if (m.reportsTo === undefined) continue;
    const baas: StaffMember | undefined = byId.get(m.reportsTo);
    assert.ok(baas, `${m.id} verwijst naar ${m.reportsTo}, en die staat er niet`);
    assert.equal(m.depth, (baas!.depth ?? 0) + 1, `${m.id} hangt één stap onder zijn leidinggevende`);
  }
});

test('bezetting: ops komt er pas bij als er hier een storing ligt', () => {
  const zonder = office({ tasks: [task({ id: 'gewoon' })] });
  assert.equal(
    zonder.staff.some((m) => m.tier === 'ops'),
    false,
    'geen storing ⇒ geen lege ops-stoel die suggereert dat er meegekeken wordt',
  );

  const met = office({
    tasks: [
      task({ id: 'storing-1', assignee: 'manager:ops', title: 'site offline' }),
      task({ id: 'storing-2', assignee: 'manager:ops' }),
      task({ id: 'oude-storing', assignee: 'manager:ops', status: 'done' }),
    ],
  });
  const ops = met.staff.find((m) => m.tier === 'ops')!;
  assert.ok(ops, 'met een storing op het bord hoort ops er te staan');
  assert.equal(ops.id, 'manager:ops');
  assert.equal(ops.role, 'ops');
  assert.equal(ops.status, '2 storing(en) op dit bord', 'geteld, niet geschat — en afgerond telt niet mee');
  assert.equal(ops.busyWith, 'site offline');
  assert.equal(met.work.open.find((t) => t.id === 'storing-1')!.staffId, 'manager:ops');
});

/* ────────────────────────── de taal per branche ───────────────────────── */

/** Eén kantoor per branche, met de venture die erbij hoort. */
const KIND_SAMPLES: { kind: OfficeKind; ventureId: string; project: string }[] = Object.entries(
  OFFICE_KIND_BY_VENTURE,
).map(([ventureId, kind]) => ({ kind, ventureId, project: `${ventureId}-werk` }));

test('branche: elke tak heeft zijn eigen kolommen, geen geleende', () => {
  const seen = new Map<string, OfficeKind>();
  for (const sample of KIND_SAMPLES) {
    const snap = buildOffice({
      project: sample.project,
      venture: venture(sample.ventureId),
      sessions: [],
      tasks: [],
      now: NOW,
    });
    assert.equal(snap.kind, sample.kind, `${sample.ventureId} hoort bij ${sample.kind}`);
    assert.ok(snap.stations.length > 0, `${sample.kind} heeft werkplekken`);
    for (const station of snap.stations) {
      assert.ok(station.metrics.length > 0, `${sample.kind}: een werkplek zonder cijfers zegt niets`);
      assert.equal(
        new Set(station.metrics.map((m) => m.label)).size,
        station.metrics.length,
        `${sample.kind}: dubbele kolomnamen`,
      );
      assert.ok(
        station.metrics.every((m) => m.value.length > 0),
        `${sample.kind}: een lege waarde onder een kolomnaam is een belofte die niet waargemaakt wordt`,
      );
    }
    // Twee branches met exact dezelfde kolommen zijn één branche die zich
    // voordoet als twee — precies wat crypto en de valutavloer deelden.
    const fingerprint = snap.stations[0]!.metrics.map((m) => m.label).join('|');
    const eerder = seen.get(fingerprint);
    assert.equal(eerder, undefined, `${sample.kind} leent de kolommen van ${eerder}`);
    seen.set(fingerprint, sample.kind);
  }
});

test('branche: crypto, aandelen en de generieke tak praten hun eigen taal', () => {
  const build = (ventureId: string): OfficeSnapshot =>
    buildOffice({
      project: `${ventureId}-werk`,
      venture: venture(ventureId),
      sessions: [],
      tasks: [],
      now: NOW,
    });
  const labelsOf = (snap: OfficeSnapshot): string[] => snap.stations[0]!.metrics.map((m) => m.label);
  const valueOf = (snap: OfficeSnapshot, label: string): string =>
    snap.stations[0]!.metrics.find((m) => m.label === label)!.value;

  // Crypto is geen valutavloer: weging en liquiditeit zijn hier het risico,
  // en een unlock is een gebeurtenis die een valutapaar niet kent.
  const crypto = build('crypto');
  const trading = build('trading');
  assert.notDeepEqual(labelsOf(crypto), labelsOf(trading), 'crypto erft de kolommen van de valutavloer niet');
  for (const eigen of ['Weging', 'Liquiditeit', 'Volgende unlock']) {
    assert.ok(labelsOf(crypto).includes(eigen), `crypto mist zijn eigen kolom ${eigen}`);
  }
  assert.ok(crypto.stations[0]!.sub.length > 0);

  // Aandelen zijn bezit met een these, geen werkstroom van een ontwerpbureau.
  const equities = build('equities');
  assert.ok(labelsOf(equities).includes('These'));
  assert.match(
    valueOf(equities, 'These'),
    /^(intact|onder druk|breekpunt nabij)$/,
    'de kolom These hoort iets over de these te zeggen, niet "schets" of "in bewerking"',
  );
  assert.match(valueOf(equities, 'Kostprijs'), /^€/, 'een kostprijs is een bedrag');
  assert.match(valueOf(equities, 'Stop'), /breekpunt/, 'een aandeel heeft een breekpunt, geen order-stop');

  // Muziek noemt de track bij naam in plaats van een klantveld te lenen.
  const music = build('vovara');
  assert.equal(valueOf(music, 'Titel'), music.stations[0]!.id);

  // De generieke tak was het dunst: acht genummerde werkpakketten. Een tak
  // zonder branche heeft nog steeds echte werkstromen.
  const generic = build('misc');
  assert.equal(generic.kind, 'generic');
  assert.ok(
    generic.stations.every((s) => !/^Werkpakket \d+$/.test(s.id)),
    'genummerde werkpakketten zeggen niets over wat er gebeurt',
  );
  assert.ok(generic.stations.length >= 8);
  assert.match(valueOf(generic, 'Voortgang'), /%$/);
  assert.equal(officeKindForVenture('bestaat-niet'), 'generic', 'een onbekende tak valt terug op generiek');
});
