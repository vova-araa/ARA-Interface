/**
 * World mapping: projects → ventures → hex districts.
 * `world.config.json` is generated from projects.json via `pnpm map`
 * (or the /ara-map command); this module holds the types + defaults.
 */

import { type Axial, axialKey, hexDisc, placeOnFreeHex, stableHash } from './hex.ts';

export interface VentureStyle {
  id: string;
  label: string;
  /** Hex border glow color. */
  color: string;
  landmark:
    | 'truck-depot'
    | 'warehouse'
    | 'billboard'
    | 'stage'
    | 'obelisk'
    | 'mic-statue'
    | 'khachkar';
  /** Substrings matched (case-insensitive) against project name/repo. */
  match: string[];
}

export const VENTURES: VentureStyle[] = [
  { id: 'traject', label: 'Sharzi TMS', color: '#f5c518', landmark: 'truck-depot', match: ['sharzi', 'traject', 'tms'] },
  { id: 'blex', label: 'Truck & Trailers', color: '#ffd75e', landmark: 'warehouse', match: ['truck', 'trailer', 'blex'] },
  { id: 'elevate', label: 'Elevate Design', color: '#ff3fa4', landmark: 'billboard', match: ['elevate'] },
  { id: 'uprising', label: 'Uprising Studio', color: '#ff8a3d', landmark: 'stage', match: ['uprising', 'studio'] },
  { id: 'trading', label: 'Trading bots', color: '#e6b800', landmark: 'obelisk', match: ['trading', 'xau', 'bot'] },
  { id: 'vovara', label: 'Vovara (music)', color: '#9b5cff', landmark: 'mic-statue', match: ['vovara', 'music'] },
  { id: 'misc', label: 'Nor Kaghak', color: '#9aa5b1', landmark: 'khachkar', match: [] },
];

export function ventureForProject(projectName: string): VentureStyle {
  const name = projectName.toLowerCase();
  for (const venture of VENTURES) {
    if (venture.match.some((m) => name.includes(m))) return venture;
  }
  return VENTURES[VENTURES.length - 1]!;
}

export interface ProjectPlacement {
  name: string;
  venture: string;
  center: Axial;
  /** Hexes belonging to this project's cluster. */
  hexes: Axial[];
}

export interface DistrictPlacement {
  venture: VentureStyle;
  center: Axial;
  projects: ProjectPlacement[];
}

export interface WorldConfig {
  generatedAt: number;
  hubRadius: number;
  districts: DistrictPlacement[];
  /** Ventures die bewust NIET in de interface verschijnen (bv. 'misc'). */
  hiddenVentures?: string[];
}

export interface ProjectEntry {
  name: string;
  repo?: string;
  path?: string;
  venture?: string;
}

const DISTRICT_RING_RADIUS = 7; // distance of district centers from the hub
const PROJECT_CLUSTER_RADIUS = 1; // each project = 7 hexes (center + ring)

/**
 * Deterministic world layout:
 *  - hub at origin (Cascade stairs + statue)
 *  - district centers on a ring, angle from venture id hash
 *  - projects spiral outward from their district center
 */
export function buildWorldConfig(
  projects: ProjectEntry[],
  now = Date.now(),
  opts: { hiddenVentures?: string[] } = {},
): WorldConfig {
  const hidden = new Set(opts.hiddenVentures ?? []);
  const taken = new Set<string>();
  for (const hex of hexDisc({ q: 0, r: 0 }, 2)) taken.add(axialKey(hex)); // reserve hub

  const byVenture = new Map<string, ProjectEntry[]>();
  for (const project of projects) {
    const venture = project.venture
      ? (VENTURES.find((v) => v.id === project.venture) ?? ventureForProject(project.name))
      : ventureForProject(project.name);
    const list = byVenture.get(venture.id) ?? [];
    list.push(project);
    byVenture.set(venture.id, list);
  }

  const districts: DistrictPlacement[] = [];
  // Stable order: declaration order of VENTURES, so angles never shuffle.
  // Een venture met expliciete projecten blijft altijd bestaan (data wint);
  // een leeg 'misc'-district vervalt wanneer het verborgen is.
  const active = VENTURES.filter(
    (v) => byVenture.has(v.id) || (v.id === 'misc' && !hidden.has('misc')),
  );
  active.forEach((venture, index) => {
    const angle = (index / active.length) * Math.PI * 2 + (stableHash(venture.id) % 100) / 500;
    const q = Math.round(Math.cos(angle) * DISTRICT_RING_RADIUS);
    const r = Math.round(Math.sin(angle) * DISTRICT_RING_RADIUS * 0.85);
    const center: Axial = { q, r };
    taken.add(axialKey(center)); // district center hosts the landmark, not a pod

    const placements: ProjectPlacement[] = [];
    for (const project of byVenture.get(venture.id) ?? []) {
      const projectCenter = placeOnFreeHex(project.name, center, taken);
      const hexes = hexDisc(projectCenter, PROJECT_CLUSTER_RADIUS);
      for (const hex of hexes) taken.add(axialKey(hex));
      placements.push({ name: project.name, venture: venture.id, center: projectCenter, hexes });
    }
    districts.push({ venture, center, projects: placements });
  });

  return { generatedAt: now, hubRadius: 2, districts, hiddenVentures: [...hidden] };
}

/** Hoort dit project zichtbaar te zijn in de interface? */
export function visibleInWorld(config: WorldConfig, projectName: string): boolean {
  for (const district of config.districts) {
    if (district.projects.some((p) => p.name === projectName)) return true;
  }
  const ventureId = ventureForProject(projectName).id;
  return config.districts.some((d) => d.venture.id === ventureId);
}

/** Find (or deterministically invent) a placement for a project name. */
export function placementForProject(
  config: WorldConfig,
  projectName: string,
): ProjectPlacement {
  for (const district of config.districts) {
    const found = district.projects.find((p) => p.name === projectName);
    if (found) return found;
  }
  // Unknown project → Nor Kaghak: deterministic slot near the misc district.
  // Lege wereld (0 districten) → vaste plek ver buiten beeld, nooit crashen.
  const misc = config.districts.find((d) => d.venture.id === 'misc') ?? config.districts[0];
  if (!misc) {
    const center: Axial = { q: 24, r: 24 };
    return { name: projectName, venture: 'misc', center, hexes: hexDisc(center, 1) };
  }
  const taken = new Set<string>();
  for (const district of config.districts) {
    taken.add(axialKey(district.center));
    for (const project of district.projects)
      for (const hex of project.hexes) taken.add(axialKey(hex));
  }
  const center = placeOnFreeHex(projectName, misc.center, taken);
  return { name: projectName, venture: 'misc', center, hexes: hexDisc(center, 1) };
}
