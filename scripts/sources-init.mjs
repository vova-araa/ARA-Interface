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

const res = await fetch(`${COLLECTOR}/sources`, { headers, signal: AbortSignal.timeout(15_000) }).catch((error) => {
  console.error(`✗ collector niet bereikbaar op ${COLLECTOR} (${String(error).slice(0, 80)})`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`✗ /sources → ${res.status}${res.status === 401 ? ' (ARA_TOKEN nodig)' : ''}`);
  process.exit(1);
}
const { ventures } = await res.json();

let made = 0;
const open = [];
for (const venture of ventures) {
  for (const source of venture.sources) {
    if (source.state === 'gevuld') continue;
    open.push(`${venture.id}/${source.file}`);
    if (source.state !== 'ontbreekt' || source.file.endsWith('.json')) continue;
    fs.mkdirSync(path.dirname(source.path), { recursive: true });
    fs.writeFileSync(source.path, `${source.columns.join(';')}\n`);
    made += 1;
    console.log(
      `+ ${path.relative(process.cwd(), source.path)}   (${source.columns.join('; ')})${source.note ? `\n    ${source.note}` : ''}`,
    );
  }
}
console.log(`\n${made} bestand(en) aangemaakt · ${open.length} bron(nen) nog te vullen · zie ops/sources/README.md`);
