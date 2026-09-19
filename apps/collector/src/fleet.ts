/**
 * De wagenpark-CSV's, uitgerekend door @ara/shared.
 *
 * Leest `vehicles.csv` en `drivers.csv` uit `data/sources/blex/` — dezelfde
 * bestanden die de bronnenregistry kent, dus één plek en één regel.
 * Ontbreekt een bestand, dan staat die bron gewoon niet aangesloten — en dat
 * wordt zo gezegd, niet met een lege lijst die op "alles in orde" lijkt.
 */
import fs from 'node:fs';
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
import { sourcePath } from './sources.ts';

export const VEHICLES_FILE = sourcePath('blex', 'vehicles.csv');
export const DRIVERS_FILE = sourcePath('blex', 'drivers.csv');

const CACHE_MS = 60_000;

export interface FleetSource<T> extends ParsedTable<T> {
  file: string;
  present: boolean;
  updatedAt?: number;
}

export interface FleetReport {
  vehicles: FleetSource<Vehicle>;
  drivers: FleetSource<Driver>;
  deadlines: Deadline[];
  summary: FleetSummary;
  now: number;
}

function readFile<T>(file: string, parse: (text: string) => ParsedTable<T>): FleetSource<T> {
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
  const vehicles = readFile(VEHICLES_FILE, readVehicles);
  const drivers = readFile(DRIVERS_FILE, readDrivers);
  const deadlines = fleetDeadlines(vehicles.rows, drivers.rows, now);
  const report: FleetReport = { vehicles, drivers, deadlines, summary: summarizeDeadlines(deadlines), now };
  cached = { at: now, report };
  return report;
}

/** Voor tests en na een verse upload: de volgende lezing gaat weer naar schijf. */
export function forgetFleet(): void {
  cached = undefined;
}
