/**
 * De wagenpark-CSV's van schijf, uitgerekend door @ara/shared.
 *
 * `ARA_FLEET_DIR` (standaard `data/fleet/`) met `vehicles.csv` en `drivers.csv`.
 * Ontbreekt een bestand, dan staat die bron gewoon niet aangesloten — en dat
 * wordt zo gezegd, niet met een lege lijst die op "alles in orde" lijkt.
 * Zestig seconden cache: de lijst verandert wekelijks, de vraag komt elke tick.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  fleetDeadlines,
  readDrivers,
  readVehicles,
  summarizeDeadlines,
  type Deadline,
  type Driver,
  type FleetSummary,
  type ParsedTable,
  type Vehicle,
} from '@ara/shared';
import { DATA_DIR } from './config.ts';

export const FLEET_DIR = process.env.ARA_FLEET_DIR ?? path.join(DATA_DIR, 'fleet');
export const VEHICLES_FILE = path.join(FLEET_DIR, 'vehicles.csv');
export const DRIVERS_FILE = path.join(FLEET_DIR, 'drivers.csv');

const CACHE_MS = 60_000;

export interface FleetSource<T> extends ParsedTable<T> {
  file: string;
  present: boolean;
  /** mtime van het bestand — zo zie je of de lijst nog wel ververst wordt. */
  updatedAt?: number;
}

export interface FleetReport {
  vehicles: FleetSource<Vehicle>;
  drivers: FleetSource<Driver>;
  deadlines: Deadline[];
  summary: FleetSummary;
  now: number;
}

function readSource<T>(file: string, parse: (text: string) => ParsedTable<T>): FleetSource<T> {
  if (!fs.existsSync(file)) return { file, present: false, rows: [], errors: [] };
  try {
    const parsed = parse(fs.readFileSync(file, 'utf8'));
    return { file, present: true, updatedAt: fs.statSync(file).mtimeMs, ...parsed };
  } catch (error) {
    return { file, present: true, rows: [], errors: [String(error).slice(0, 200)] };
  }
}

let cached: { at: number; report: FleetReport } | undefined;

export function fleetReport(now = Date.now()): FleetReport {
  if (cached && now - cached.at < CACHE_MS) return { ...cached.report, now };
  const vehicles = readSource(VEHICLES_FILE, readVehicles);
  const drivers = readSource(DRIVERS_FILE, readDrivers);
  const deadlines = fleetDeadlines(vehicles.rows, drivers.rows, now);
  const report: FleetReport = { vehicles, drivers, deadlines, summary: summarizeDeadlines(deadlines), now };
  cached = { at: now, report };
  return report;
}

/** Voor tests en na een verse upload: de volgende lezing gaat weer naar schijf. */
export function forgetFleet(): void {
  cached = undefined;
}

/**
 * Welke wagenpark-bronnen uit het playbook door deze bestanden gevoed worden.
 * Staat het bestand er, dan is die bron aangesloten — zonder dat iemand
 * `configured: true` in org.json hoeft te zetten en dat weer vergeet.
 */
export const FLEET_SOURCE_FILES: Record<string, string> = {
  'Kenteken, APK-datum, kilometerstand': VEHICLES_FILE,
  'Chauffeurstermijnen (rijbewijs, code 95, chauffeurskaart)': DRIVERS_FILE,
};

export function withFleetSources<T extends { dataSources: { label: string; how: string; configured: boolean }[] }>(
  ventureId: string,
  playbook: T,
): T {
  if (ventureId !== 'blex') return playbook;
  return {
    ...playbook,
    dataSources: playbook.dataSources.map((source) => {
      const file = FLEET_SOURCE_FILES[source.label];
      if (!file) return source;
      const present = fs.existsSync(file);
      return {
        ...source,
        configured: source.configured || present,
        how: present ? `${file} (gelezen door GET /fleet)` : `CSV neerzetten als ${file} — voorbeeld in ops/fleet/`,
      };
    }),
  };
}
