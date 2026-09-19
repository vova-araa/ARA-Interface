import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_SPECS, VENTURES, resolvePlaybook } from '@ara/shared';

/**
 * Structurele controles op de agent-organisatie. Nul tokens, draait in CI.
 *
 * De read-only belofte van de handelsrollen is de hoogste inzet in dit hele
 * systeem: "hij zal het niet doen" is geen garantie, "hij kán het niet" wel.
 * Daarom checken we hier het gereedschap in de frontmatter, niet het gedrag.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGENTS_DIR = path.join(REPO, 'plugins/ara/agents');

interface Agent {
  file: string;
  name: string;
  tools: string[];
  body: string;
}

function loadAgents(): Agent[] {
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
      const front = /^---\n([\s\S]*?)\n---/.exec(raw);
      assert.ok(front, `${file} mist frontmatter`);
      const fields = new Map(
        front[1]!.split('\n').map((line) => {
          const idx = line.indexOf(':');
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const;
        }),
      );
      return {
        file,
        name: fields.get('name') ?? '',
        tools: (fields.get('tools') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        body: raw.slice(front[0].length),
      };
    });
}

test('agents: elke rol uit een playbook bestaat echt', () => {
  const agents = new Map(loadAgents().map((a) => [a.name, a]));
  for (const venture of VENTURES) {
    if (venture.id === 'misc') continue;
    const book = resolvePlaybook(venture.id, venture.label);
    for (const spec of book.specialists) {
      // Explore is een ingebouwde agent, geen bestand in deze plugin.
      if (spec.agent === 'Explore') continue;
      assert.ok(
        agents.has(spec.agent),
        `${venture.id}: playbook noemt ${spec.agent}, maar plugins/ara/agents/${spec.agent}.md bestaat niet`,
      );
    }
  }
});

test('agents: de naam in de frontmatter matcht de bestandsnaam', () => {
  for (const agent of loadAgents()) {
    assert.equal(
      agent.name,
      agent.file.replace(/\.md$/, ''),
      `${agent.file}: --agent <naam> gebruikt de frontmatter-naam; die moet gelijk zijn aan het bestand`,
    );
  }
});

test('agents: read-only rollen hebben geen schrijfgereedschap', () => {
  const agents = new Map(loadAgents().map((a) => [a.name, a]));

  // De marktanalist mag posities lezen en niets veranderen. Zonder Edit/Write
  // kán hij geen orderlogica aanraken, ook niet als een taak erom vraagt.
  const analyst = agents.get('ara-market-analyst')!;
  assert.ok(analyst, 'ara-market-analyst ontbreekt');
  for (const forbidden of ['Edit', 'Write', 'NotebookEdit', 'Agent']) {
    assert.ok(
      !analyst.tools.includes(forbidden),
      `ara-market-analyst mag ${forbidden} niet hebben — read-only is een garantie, geen belofte`,
    );
  }
  assert.match(analyst.body, /ESCALATE/, 'de analist moet een escalatieroute benoemen');

  // De cijferaanvoer leest bronnen en pusht standen; hij verandert geen bronnen.
  const reporter = agents.get('ara-reporter')!;
  for (const forbidden of ['Edit', 'Write']) {
    assert.ok(!reporter.tools.includes(forbidden), `ara-reporter mag ${forbidden} niet hebben`);
  }

  // Ritplanner en facturatie-controleur leveren voorstellen en bevindingen.
  // Zonder Edit/Write kan geen van beiden een rit of factuur aanraken.
  // De hele fleet-vloer leest productie en schrijft er niet in. Eén rol met
  // schrijfrechten ertussen maakt de belofte van de andere vier waardeloos.
  for (const name of [
    'ara-planner',
    'ara-invoice-auditor',
    'ara-fleet-tech',
    'ara-compliance-watch',
    'ara-fleet-cost',
    'ara-trailer-manager',
  ]) {
    const agent = agents.get(name)!;
    assert.ok(agent, `${name} ontbreekt`);
    for (const forbidden of ['Edit', 'Write']) {
      assert.ok(
        !agent.tools.includes(forbidden),
        `${name} mag ${forbidden} niet hebben — alleen voorstellen is een eigenschap, geen belofte`,
      );
    }
  }
});

test('agents: op de handelsvloer mag alleen het bot-onderhoud schrijven', () => {
  const agents = new Map(loadAgents().map((a) => [a.name, a]));

  // Analist, risicobewaker en eventscout lezen en melden. Geen van drieën mag
  // een positie, een limiet of een strategie kunnen aanraken.
  for (const name of [
    'ara-market-analyst',
    'ara-risk-guard',
    'ara-event-scout',
    'ara-allocation-guard',
    'ara-token-safety',
    'ara-narrative-scout',
  ]) {
    const agent = agents.get(name)!;
    assert.ok(agent, `${name} ontbreekt`);
    for (const forbidden of ['Edit', 'Write']) {
      assert.ok(!agent.tools.includes(forbidden), `${name} mag ${forbidden} niet hebben`);
    }
  }

  // Het journaal schrijft wél — maar uitsluitend in journal/, en dat moet in
  // zijn instructies staan, anders is Write een open deur naar de strategie.
  const journal = agents.get('ara-trade-journal')!;
  assert.ok(journal.tools.includes('Write'), 'het journaal moet kunnen schrijven');
  assert.match(journal.body, /journal\//, 'het journaal moet zijn schrijfpad expliciet benoemen');

  // Bot-onderhoud is de enige met volledige schrijfrechten; zijn verboden
  // gebied moet daarom letterlijk in zijn instructies staan.
  const maintainer = agents.get('ara-bot-maintainer')!;
  assert.ok(maintainer.tools.includes('Edit') && maintainer.tools.includes('Write'));
  assert.match(maintainer.body, /orderlogica/i);
  assert.match(maintainer.body, /sleutel/i);
  assert.match(maintainer.body, /ESCALATE/);
});

test('agents: de scoutrollen geven geen advies en voorspellen niet', () => {
  // Een scout die "gaat stijgen" schrijft, is een adviseur geworden. Dat
  // onderscheid moet letterlijk in zijn instructies staan, niet impliciet.
  const agents = new Map(loadAgents().map((a) => [a.name, a]));
  for (const name of ['ara-event-scout', 'ara-narrative-scout', 'ara-token-safety']) {
    const agent = agents.get(name)!;
    assert.ok(agent, `${name} ontbreekt`);
    assert.match(
      agent.body,
      /voorspelt? niet|adviseer|advies/i,
      `${name} moet expliciet benoemen dat hij niet adviseert of voorspelt`,
    );
  }
});

test('agents: wie concepten schrijft, kan het netwerk niet op', () => {
  // Een rol die teksten voor buiten schrijft én het netwerk op kan, kan per
  // ongeluk versturen of publiceren. Zonder Bash en WebFetch is "verstuurt
  // nooit zelf" een feit in plaats van een regel om te onthouden.
  const agents = new Map(loadAgents().map((a) => [a.name, a]));
  for (const name of ['ara-dispatch-comms', 'ara-copywriter']) {
    const agent = agents.get(name)!;
    assert.ok(agent, `${name} ontbreekt`);
    for (const forbidden of ['Bash', 'WebFetch', 'WebSearch', 'Agent']) {
      assert.ok(
        !agent.tools.includes(forbidden),
        `${name} mag ${forbidden} niet hebben — anders kan hij daadwerkelijk publiceren`,
      );
    }
    assert.ok(agent.tools.includes('Write'), `${name} moet wel concepten kunnen wegschrijven`);
  }

  // De sitebewaker kijkt en repareert niet; anders verandert hij dingen die
  // niemand heeft beoordeeld.
  const site = agents.get('ara-site-watch')!;
  for (const forbidden of ['Edit', 'Write']) {
    assert.ok(!site.tools.includes(forbidden), `ara-site-watch mag ${forbidden} niet hebben`);
  }

  // De agendabewaker leest; bevestigen en verzetten doet een mens.
  const booking = agents.get('ara-booking-watch')!;
  for (const forbidden of ['Edit', 'Write']) {
    assert.ok(!booking.tools.includes(forbidden), `ara-booking-watch mag ${forbidden} niet hebben`);
  }
});

test('agents: elke creatieve rol benoemt zijn eigen publicatiegrens', () => {
  // De drie takken hebben bewust verschillende bevoegdheden. Die staan in de
  // instructies van de rol zelf, niet alleen in het playbook — de rol is wat
  // de agent leest.
  const agents = new Map(loadAgents().map((a) => [a.name, a]));

  // Klantwerk: productie van een klant is altijd een escalatie.
  assert.match(agents.get('ara-designer')!.body, /ESCALATE/);
  assert.match(agents.get('ara-designer')!.body, /klant/i);

  // Eigen zaak: mag deployen, behalve de boekingsflow.
  assert.match(agents.get('ara-studio-producer')!.body, /boekingsflow/i);
  assert.match(agents.get('ara-studio-producer')!.body, /staging/i);

  // Onomkeerbaar: een release uitbrengen kan nooit zelf.
  assert.match(agents.get('ara-release-manager')!.body, /distributeur/i);
  assert.match(agents.get('ara-release-manager')!.body, /ESCALATE/);
});

test('agents: elke vakrol benoemt zijn escalatieroute en hoe hij terugmeldt', () => {
  // Leidinggevende rollen zijn zélf het escalatiedoel en rapporteren in hun
  // eigen vorm; elke andere rol moet weten waar hij stopt en hoe hij afsluit.
  // Zonder deze check sloop er telkens een nieuwe rol in zonder grens.
  const leadership = new Set(['ara-chief', 'ara-supervisor', 'ara-manager', 'ara-ops-manager']);
  for (const agent of loadAgents()) {
    if (leadership.has(agent.name)) continue;
    assert.match(
      agent.body,
      /ESCALATE/,
      `${agent.name} benoemt geen escalatieroute — dan pakt hij stil door waar hij zou moeten stoppen`,
    );
    assert.match(
      agent.body,
      /## Terugmelden/,
      `${agent.name} zegt niet hoe hij terugmeldt — een stille rol is een verloren rol`,
    );
    // De keten zoekt letterlijk op het woord ESCALATE. Een rol die alleen
    // vriendelijk uitlegt waarom hij iets niet doet, bereikt niemand: de taak
    // blijft open en hij lijkt gewoon stil. Live vastgesteld met verify:agents.
    assert.match(
      agent.body,
      /## Als je moet escaleren/,
      `${agent.name} mist de escalatievorm — weigeren zonder het woord ESCALATE komt nergens aan`,
    );
  }
});

test('agents: security en data-engineer horen bij elke tak die ze nodig heeft', () => {
  const agents = new Map(loadAgents().map((a) => [a.name, a]));

  // De auditor mag een gevonden sleutel nergens neerzetten — dat moet
  // letterlijk in zijn instructies staan, anders lekt hij hem in het bord.
  const auditor = agents.get('ara-security-auditor')!;
  assert.ok(auditor, 'ara-security-auditor ontbreekt');
  for (const forbidden of ['Edit', 'Write']) {
    assert.ok(!auditor.tools.includes(forbidden), `de auditor mag ${forbidden} niet hebben`);
  }
  assert.match(auditor.body, /waarde \*\*nergens\*\*|nergens neer/i);

  // De data-engineer schrijft wél, maar nooit op productie.
  const data = agents.get('ara-data-engineer')!;
  assert.ok(data.tools.includes('Edit') && data.tools.includes('Write'));
  assert.match(data.body, /productie/i);
  assert.match(data.body, /kopie/i);
});

test('agents: de controlerende rollen kunnen niet repareren', () => {
  // Een controleur die zelf bijwerkt, controleert daarna zijn eigen werk — en
  // dan is de controle weg. Dat moet uit het gereedschap blijken, niet uit een
  // belofte in de tekst.
  const agents = new Map(loadAgents().map((a) => [a.name, a]));
  for (const name of ['ara-qa-verifier', 'ara-backup-verifier', 'ara-org-auditor']) {
    const agent = agents.get(name)!;
    assert.ok(agent, `${name} ontbreekt`);
    for (const forbidden of ['Edit', 'Write']) {
      assert.ok(!agent.tools.includes(forbidden), `${name} mag ${forbidden} niet hebben`);
    }
  }

  // De backupcontrole mag nooit over de echte database heen terugzetten.
  assert.match(agents.get('ara-backup-verifier')!.body, /tijdelijke map/i);

  // De contentplanning schrijft concepten en kan het netwerk niet op.
  const scheduler = agents.get('ara-social-scheduler')!;
  for (const forbidden of ['Bash', 'WebFetch', 'WebSearch']) {
    assert.ok(!scheduler.tools.includes(forbidden), `ara-social-scheduler mag ${forbidden} niet hebben`);
  }
  assert.ok(scheduler.tools.includes('Write'));

  // Wie wél schrijft, moet zijn grens benoemen: niet mergen, niets verzinnen.
  assert.match(agents.get('ara-dependency-warden')!.body, /niet mergen|Niet mergen/);
  assert.match(agents.get('ara-doc-writer')!.body, /verzinnen/i);
});

test('agents: de vaste ops-rollen bestaan en zijn read-only', () => {
  // ops.specialists staat los van de venture-playbooks, dus de invariant die
  // playbook-rollen controleert raakt ze niet. Zonder deze check kan een
  // ops-rol verdwijnen zonder dat iets het merkt.
  const org = JSON.parse(fs.readFileSync(path.join(REPO, 'plugins/ara/org.json'), 'utf8')) as {
    ops?: { specialists?: { agent: string }[] };
  };
  const agents = new Map(loadAgents().map((a) => [a.name, a]));
  const roster = org.ops?.specialists ?? [];
  assert.ok(roster.length > 0, 'ops hoort vaste rollen te hebben, niet alleen incidenten');
  for (const spec of roster) {
    const agent = agents.get(spec.agent);
    assert.ok(agent, `ops noemt ${spec.agent}, maar dat rolbestand bestaat niet`);
    for (const forbidden of ['Edit', 'Write']) {
      assert.ok(
        !agent.tools.includes(forbidden),
        `${spec.agent} draait ongevraagd op schema — die mag niets kunnen wijzigen`,
      );
    }
  }
});

test('agents: alleen de rollen die zelf mogen spawnen hebben de Agent-tool', () => {
  // Subagents hebben geen Agent-tool (bewezen beperking van Claude Code); wie
  // 'm wél heeft, draait als eigen sessie. Dat onderscheid moet expliciet zijn.
  const maySpawn = new Set(['ara-chief', 'ara-supervisor', 'ara-manager', 'ara-ops-manager']);
  for (const agent of loadAgents()) {
    if (agent.tools.includes('Agent')) {
      assert.ok(
        maySpawn.has(agent.name),
        `${agent.name} heeft de Agent-tool maar draait niet als eigen sessie`,
      );
    }
  }
});

/**
 * Geen Edit/Write in de frontmatter is minder hard dan het lijkt. Een rol met
 * Bash schrijft alsnog: `> bestand`, `tee`, `sed -i`, `git checkout`, een
 * scriptje. Empirisch vastgesteld — ara-risk-guard, read-only op papier, zette
 * zonder moeite een bestand neer. De frontmatter kan dat niet dichtzetten
 * zolang de rol Bash nodig heeft om te lezen.
 *
 * Wat dan wél kan: de rol de echte grens laten kennen. "Jij schrijft niet, ook
 * niet via Bash" is een afspraak, geen slot — en precies dát verschil moet in
 * het rolbestand staan. Een rol die zichzelf een garantie toedicht die er niet
 * is, gaat er op het verkeerde moment op vertrouwen.
 */
const BASH_BOUNDARY = /ook niet via Bash/i;
/**
 * Claims die suggereren dat het gereedschap het schrijven onmogelijk maakt:
 * "je kunt het niet", "je kunt geen limiet aanpassen", "geen omissie maar de
 * garantie zelf". Zinnen lopen in deze bestanden over regels heen, dus toetsen
 * we op tekst met de regeleindes eruit — per zin, zodat "kun je een cijfer niet
 * vinden" geen valse treffer wordt.
 */
const FALSE_GUARANTEE =
  /k[uú]n(?:t|nen)?\b[^.]{0,80}\b(?:niet|geen)\b[^.]{0,80}\b(?:schrijv|wijzig|aanpass|verander|muteren|neerzetten)/i;
const OLD_GUARANTEE = /geen omissie maar de garantie/i;
/** "je kunt het niet" — de kaalste vorm van dezelfde onjuiste belofte. */
const IMPOSSIBLE = /k[uú]nt? het niet\b/i;
const flatten = (body: string) => body.replace(/\s+/g, ' ');

test('agents: read-only met Bash benoemt de grens die het gereedschap niet afdwingt', () => {
  for (const agent of loadAgents()) {
    if (agent.tools.includes('Edit') || agent.tools.includes('Write')) continue;
    if (!agent.tools.includes('Bash')) continue;
    assert.match(
      agent.body,
      BASH_BOUNDARY,
      `${agent.name} heeft Bash maar geen Edit/Write: hij kán schrijven. Benoem die grens letterlijk ("ook niet via Bash"), anders belooft het rolbestand iets wat het gereedschap niet waarmaakt`,
    );
    assert.match(
      agent.body,
      /afspraak/i,
      `${agent.name} moet benoemen dat zijn schrijfgrens een afspraak is en geen slot — anders vertrouwt hij op een garantie die er niet is`,
    );
    for (const claim of [FALSE_GUARANTEE, OLD_GUARANTEE, IMPOSSIBLE]) {
      assert.doesNotMatch(
        flatten(agent.body),
        claim,
        `${agent.name} presenteert zijn schrijfgrens als iets wat het gereedschap afdwingt; met Bash kan hij wél schrijven`,
      );
    }
  }
});

test('agents: elke rol verwijst alleen naar rollen die bestaan', () => {
  // `ara-creative` stond nog in de rollentabel van de manager nadat het bestand
  // was gesplitst en verwijderd. Een manager die zo'n rol spawnt, krijgt een
  // fout terug en de taak blijft liggen.
  const agents = loadAgents();
  const known = new Set(agents.map((a) => a.name));
  for (const agent of agents) {
    for (const match of agent.body.matchAll(/`(ara-[a-z0-9-]+)`/g)) {
      const ref = match[1]!;
      assert.ok(
        known.has(ref),
        `${agent.file} verwijst naar \`${ref}\`, maar dat rolbestand bestaat niet`,
      );
    }
  }
});

test('agents: elke uitvoerende rol kan zijn bordtaak afsluiten en zoeken vóór lezen', () => {
  // Een rol zonder TaskUpdate kan zijn eigen escalatie niet op het bord zetten:
  // hij weigert netjes en niemand merkt het. Grep hoort bij dezelfde discipline
  // — wie Read heeft maar niet kan zoeken, leest hele bestanden.
  const leadership = new Set(['ara-chief', 'ara-supervisor', 'ara-manager', 'ara-ops-manager']);
  for (const agent of loadAgents()) {
    if (!leadership.has(agent.name)) {
      assert.ok(
        agent.tools.includes('TaskUpdate'),
        `${agent.name} mist TaskUpdate — dan kan hij zijn taak niet op failed + ESCALATE zetten`,
      );
    }
    if (agent.tools.includes('Read')) {
      assert.ok(
        agent.tools.includes('Grep'),
        `${agent.name} heeft Read maar geen Grep — Grep vóór Read is de token-regel uit org.json`,
      );
    }
  }
});

test('agents: managers delen één rolbestand; tak-specifieke inhoud komt uit /org', () => {
  // Acht managers, één bestand: de tak-inhoud (specialisten, duties, escalate,
  // checks, databronnen) komt bij het starten uit GET /org en kan dus niet uit
  // de pas lopen met org.json. Wat een manager daarnaast nodig heeft, staat in
  // een optionele addendum-map — maar alleen voor een venture die bestaat.
  const raw = fs.readFileSync(path.join(AGENTS_DIR, 'ara-manager.md'), 'utf8');
  assert.match(raw, /\/org/, 'de manager moet zijn playbook uit GET /org halen');
  assert.doesNotMatch(
    raw,
    /^\|\s*(Ritplanner|Marktanalist|Wagenparkbeheer)\b/m,
    'vakrollen per tak horen in het playbook (org.json → GET /org), niet in een tabel in ara-manager.md — twee lijsten lopen uit de pas',
  );

  const dir = path.join(REPO, 'plugins/ara/managers');
  assert.match(raw, /plugins\/ara\/managers/, 'de manager moet weten waar zijn addendum staat');
  if (!fs.existsSync(dir)) return;
  const org = JSON.parse(fs.readFileSync(path.join(REPO, 'plugins/ara/org.json'), 'utf8')) as {
    ventures: { id: string }[];
  };
  const ids = new Set(org.ventures.map((v) => v.id));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    assert.ok(
      ids.has(file.replace(/\.md$/, '')),
      `plugins/ara/managers/${file} hoort bij geen enkele venture uit org.json — een addendum dat niemand leest`,
    );
  }
});

/**
 * Sinds elke databron een bestand is (`SOURCE_SPECS` in @ara/shared), leest een
 * rol hem via `GET /sources/<tak>/<bestand>` en parst hij geen CSV zelf. Welke
 * rol welke bron nodig heeft staat hier expliciet — afgeleid uit de duties in
 * org.ts, maar opgeschreven, zodat de test leesbaar is en niet raadt. Een rol
 * die hier staat maar de bron niet noemt, gaat 'm in een taak zelf verzinnen.
 */
const SOURCE_READS: Record<string, string[]> = {
  'ara-planner': ['traject/ritten.csv'],
  'ara-invoice-auditor': ['traject/ritten.csv', 'traject/facturen.csv'],
  'ara-compliance-watch': ['blex/vehicles.csv', 'blex/drivers.csv'],
  'ara-fleet-tech': ['blex/vehicles.csv', 'blex/garage.csv'],
  'ara-fleet-cost': ['blex/kosten.csv'],
  'ara-trailer-manager': ['blex/trailers.csv'],
  'ara-market-analyst': ['trading/posities.csv', 'crypto/portefeuille.csv'],
  'ara-risk-guard': ['trading/posities.csv', 'crypto/portefeuille.csv', 'equities/portefeuille.csv'],
  'ara-trade-journal': ['trading/trades.csv', 'crypto/trades.csv', 'equities/trades.csv'],
  'ara-event-scout': ['crypto/portefeuille.csv'],
  'ara-execution-trader': ['trading/posities.csv', 'crypto/portefeuille.csv', 'equities/portefeuille.csv'],
  'ara-allocation-guard': [
    'crypto/portefeuille.csv',
    'crypto/allocatie.csv',
    'equities/portefeuille.csv',
    'equities/sectorallocatie.csv',
  ],
  'ara-site-watch': ['elevate/sites.csv'],
  'ara-booking-watch': ['uprising/boekingen.csv', 'uprising/aanvragen.csv'],
  'ara-release-manager': ['vovara/releaseplanning.csv', 'vovara/releases.csv'],
  'ara-equity-analyst': ['equities/portefeuille.csv', 'equities/cijfers.csv'],
  'ara-earnings-watch': ['equities/kwartaalagenda.csv', 'equities/portefeuille.csv'],
};

test('agents: wie een bron nodig heeft, leest hem via GET /sources en escaleert als hij ontbreekt', () => {
  const agents = new Map(loadAgents().map((a) => [a.name, a]));
  const known = new Set(SOURCE_SPECS.map((s) => `${s.venture}/${s.file}`));
  const specialistsOf = new Map(
    VENTURES.filter((v) => v.id !== 'misc').map((v) => [
      v.id,
      new Set(resolvePlaybook(v.id, v.label).specialists.map((s) => s.agent)),
    ]),
  );

  for (const [name, reads] of Object.entries(SOURCE_READS)) {
    const agent = agents.get(name);
    assert.ok(agent, `${name} ontbreekt`);
    assert.match(agent.body, /## Waar je leest/, `${name} zegt niet waar hij leest`);

    // De sectie staat vóór de grenzen: eerst waar de cijfers vandaan komen, dan
    // wat je ermee niet mag. Een rol zonder "Harde grenzen" heeft een andere kop.
    const grenzen = agent.body.indexOf('## Harde grenzen');
    if (grenzen >= 0) {
      assert.ok(
        agent.body.indexOf('## Waar je leest') < grenzen,
        `${name}: "Waar je leest" hoort vóór "Harde grenzen"`,
      );
    }

    for (const src of reads) {
      // De test zelf mag ook niet naar een bron wijzen die de registry niet kent.
      assert.ok(known.has(src), `${name}: ${src} staat niet in SOURCE_SPECS`);
      assert.ok(
        agent.body.includes(`GET /sources/${src}`),
        `${name} noemt \`GET /sources/${src}\` niet — dan leest hij de bron uit zijn taak of parst hij zelf`,
      );
      // Een rol leest alleen bronnen van een tak waar hij ook echt zit.
      const venture = src.split('/')[0]!;
      assert.ok(
        specialistsOf.get(venture)?.has(name),
        `${name} leest ${src}, maar staat niet als specialist in het playbook van ${venture}`,
      );
    }

    // Eén escalatievorm voor "bron ontbreekt of is leeg", met de verwijzing naar
    // de tabel waar de eigenaar het bestand vandaan haalt.
    // Zinnen lopen over regels heen, dus toetsen we op de platgeslagen tekst.
    assert.match(
      flatten(agent.body),
      /ESCALATE: bron [a-z]+\/[a-z.-]+ ontbreekt of is leeg — zie ops\/sources\/README\.md/,
      `${name} mist de escalatievorm voor een ontbrekende of lege bron`,
    );
    assert.match(flatten(agent.body), /parst nooit zelf een CSV/i, `${name} moet benoemen dat hij geen CSV zelf parst`);
  }

  // Wie het overzicht doet, leest de lijst — en geen enkele rol wijst naar een
  // bron die de registry niet kent (een tikfout in een bestandsnaam is een 404
  // die de rol als "ontbreekt" gaat melden).
  assert.match(agents.get('ara-reporter')!.body, /GET \/sources\b/, 'ara-reporter leest GET /sources');
  for (const agent of agents.values()) {
    for (const match of agent.body.matchAll(/\/sources\/([a-z]+)\/([a-z.-]+)/g)) {
      const src = `${match[1]}/${match[2]}`;
      assert.ok(known.has(src), `${agent.file} verwijst naar /sources/${src}, maar die bron bestaat niet in SOURCE_SPECS`);
    }
  }
});
