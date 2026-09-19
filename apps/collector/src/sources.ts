/**
 * De bronbestanden van schijf, langs de registry in @ara/shared.
 *
 * `ARA_SOURCES_DIR` (standaard `data/sources/`), daaronder één map per tak en
 * daarin de bestanden uit `SOURCE_SPECS`. Drie standen per bron, en ze heten
 * alle drie anders omdat ze alle drie iets anders betekenen:
 *
 *   ontbreekt — het bestand is er niet;
 *   leeg      — alleen een kop, of niets leesbaars: er is niets gemeten;
 *   gevuld    — ten minste één regel, en pas dán is de bron aangesloten.
 *
 * Zestig seconden cache per bestand: de lijsten veranderen wekelijks, de
 * vraag komt elke tick.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readTable, sourceSpecs, type SourceSpec, type SourceTable } from '@ara/shared';
import { DATA_DIR } from './config.ts';
import { limitsPath } from './trading.ts';

export const SOURCES_DIR = process.env.ARA_SOURCES_DIR ?? path.join(DATA_DIR, 'sources');

export type SourceState = 'ontbreekt' | 'leeg' | 'gevuld';

export interface SourceStatus extends SourceTable {
  venture: string;
  label: string;
  file: string;
  path: string;
  state: SourceState;
  /** mtime — zo zie je of de lijst nog wel ververst wordt. */
  updatedAt?: number;
  columns: string[];
  note?: string;
}

export function sourcePath(venture: string, file: string): string {
  // Het limietenbestand woont bij de risicomotor, niet in de bronnenmap: één
  // bestand op één plek, anders bewaakt de motor een ander dan de lijst toont.
  if (file === 'trading-limits.json') return limitsPath();
  return path.join(SOURCES_DIR, venture, file);
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; status: SourceStatus }>();

export function forgetSources(): void {
  cache.clear();
}

export function readSource(spec: SourceSpec, now = Date.now()): SourceStatus {
  const file = sourcePath(spec.venture, spec.file);
  const hit = cache.get(file);
  if (hit && now - hit.at < CACHE_MS) return hit.status;
  const columns = [
    ...spec.required,
    ...(spec.dates ?? []).filter((c) => !spec.required.includes(c)),
    ...(spec.numbers ?? []).filter((c) => !spec.required.includes(c) && !(spec.dates ?? []).includes(c)),
  ];
  const base = { venture: spec.venture, label: spec.label, file: spec.file, path: file, columns, note: spec.note };
  let status: SourceStatus;
  if (!fs.existsSync(file)) {
    status = { ...base, state: 'ontbreekt', rows: [], errors: [] };
  } else if (spec.file.endsWith('.json')) {
    // Het bestand van de risicomotor: aanwezig is genoeg, bruikbaar zegt /actions.
    status = { ...base, state: 'gevuld', updatedAt: fs.statSync(file).mtimeMs, rows: [], errors: [] };
  } else {
    let table: SourceTable;
    try {
      table = readTable(fs.readFileSync(file, 'utf8'), spec);
    } catch (error) {
      table = { rows: [], errors: [String(error).slice(0, 200)] };
    }
    status = {
      ...base,
      state: table.rows.length > 0 ? 'gevuld' : 'leeg',
      updatedAt: fs.statSync(file).mtimeMs,
      ...table,
    };
  }
  cache.set(file, { at: now, status });
  return status;
}

export function ventureSources(venture: string, now = Date.now()): SourceStatus[] {
  return sourceSpecs(venture).map((spec) => readSource(spec, now));
}

/**
 * Het playbook met de werkelijkheid van schijf erin: een gevulde bron is
 * aangesloten, en `how` zegt precies welk bestand — zodat een agent die het
 * playbook leest weet waar hij moet kijken, en de actielijst weet wat hij
 * de eigenaar moet vragen. Niemand hoeft `configured: true` in org.json te
 * zetten en dat weer te vergeten.
 */
export function withFileSources<T extends { dataSources: { label: string; how: string; configured: boolean }[] }>(
  ventureId: string,
  playbook: T,
): T {
  const byLabel = new Map(ventureSources(ventureId).map((s) => [s.label, s]));
  return {
    ...playbook,
    dataSources: playbook.dataSources.map((source) => {
      const status = byLabel.get(source.label);
      if (!status) return source;
      const rel = path.relative(process.cwd(), status.path);
      if (status.state === 'gevuld') {
        return { ...source, configured: true, how: `${rel} (${status.rows.length} regel(s), GET /sources/${ventureId}/${status.file})` };
      }
      const problem = status.errors[0] ? ` — ${status.errors[0]}` : '';
      return {
        ...source,
        how:
          status.state === 'leeg'
            ? `${rel} staat er maar is leeg${problem}; kolommen: ${status.columns.join(', ')}`
            : `CSV neerzetten als ${rel} (kolommen: ${status.columns.join(', ')}) — zie ops/sources/README.md`,
      };
    }),
  };
}
