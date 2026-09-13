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
