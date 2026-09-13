import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENTURES, resolvePlaybook } from '@ara/shared';

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
  for (const name of ['ara-market-analyst', 'ara-risk-guard', 'ara-event-scout']) {
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

test('agents: de communicatierol kan het netwerk niet op', () => {
  // Een rol die klantberichten schrijft én kan versturen, kan per ongeluk
  // versturen. Zonder Bash en WebFetch is "verstuurt nooit zelf" een feit.
  const comms = loadAgents().find((a) => a.name === 'ara-dispatch-comms')!;
  assert.ok(comms, 'ara-dispatch-comms ontbreekt');
  for (const forbidden of ['Bash', 'WebFetch', 'WebSearch', 'Agent']) {
    assert.ok(
      !comms.tools.includes(forbidden),
      `ara-dispatch-comms mag ${forbidden} niet hebben — anders kan hij een bericht daadwerkelijk versturen`,
    );
  }
  assert.ok(comms.tools.includes('Write'), 'hij moet wel concepten kunnen wegschrijven');
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
