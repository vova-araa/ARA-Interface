#!/usr/bin/env node
/**
 * Maakt voor elke bron die nog ontbreekt het bestand aan — met alleen de
 * kopregel. Daarna weet je precies wat je moet vullen, en de collector telt
 * een lege kop met opzet niet als aangesloten: er is dan nog niets gemeten.
 *
 *   pnpm sources:init
 *
 * Env: ARA_COLLECTOR_URL, ARA_TOKEN.
 */
import fs from 'node:fs';
import path from 'node:path';

const COLLECTOR = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';
const headers = {};
if (process.env.ARA_TOKEN) headers['X-ARA-Token'] = process.env.ARA_TOKEN;

const res = await fetch(`${COLLECTOR}/sources?refresh=1`, { headers, signal: AbortSignal.timeout(15_000) }).catch((error) => {
  console.error(`✗ collector niet bereikbaar op ${COLLECTOR} (${String(error).slice(0, 80)})`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`✗ /sources → ${res.status}${res.status === 401 ? ' (ARA_TOKEN nodig)' : ''}`);
  process.exit(1);
}
const { ventures, dir } = await res.json();
// De collector noemt paden op zíjn schijf. Draait hij ergens anders, dan zou
// dit script hier een lege boom aanmaken die niemand leest.
if (!fs.existsSync(path.dirname(dir))) {
  console.error(`✗ ${path.dirname(dir)} bestaat hier niet — de collector draait op een andere machine; draai dit dáár`);
  process.exit(1);
}

let made = 0;
const open = [];
for (const venture of ventures) {
  for (const source of venture.sources) {
    if (source.state === 'gevuld') continue;
    open.push(`${venture.id}/${source.file}`);
    if (source.state !== 'ontbreekt' || source.file.endsWith('.json')) continue;
    fs.mkdirSync(path.dirname(source.path), { recursive: true });
    try {
      // 'wx': nooit over een bestand heen dat er inmiddels wél staat.
      fs.writeFileSync(source.path, `${source.columns.join(';')}\n`, { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
    made += 1;
    console.log(
      `+ ${path.relative(path.dirname(dir), source.path)}   (${source.columns.join('; ')})${source.note ? `\n    ${source.note}` : ''}`,
    );
  }
}
console.log(`\n${made} bestand(en) aangemaakt · ${open.length} bron(nen) nog te vullen · zie ops/sources/README.md`);
