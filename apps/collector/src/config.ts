import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PORT is what hosted platforms (Render) inject; ARA_COLLECTOR_PORT wins locally.
export const COLLECTOR_PORT = Number(
  process.env.ARA_COLLECTOR_PORT ?? process.env.PORT ?? 4747,
);
export const VIEWER_PORT = Number(process.env.ARA_VIEWER_PORT ?? 4748);

/** Optional shared secret; when set, every API call must present it. */
export const ARA_TOKEN = process.env.ARA_TOKEN ?? '';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DATA_DIR = process.env.ARA_DATA_DIR ?? path.join(REPO_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'ara-events.db');
export const WORLD_CONFIG_PATH =
  process.env.ARA_WORLD_CONFIG ?? path.join(REPO_ROOT, 'world.config.json');
export const FIXTURE_PATH = path.join(REPO_ROOT, 'apps', 'collector', 'fixtures', 'demo.jsonl');
export const VIEWER_DIST = path.join(REPO_ROOT, 'apps', 'viewer', 'dist');

/**
 * Waar projects.json staat. Claude Code zet gesynchroniseerde skills onder
 * `~/.claude/skills/synced/<uuid>/<skill>/`, dus het vaste pad klopt alleen bij
 * een handmatig geïnstalleerde skill. Zoek beide, nieuwste wint — anders draait
 * de hele wereld op demo-projecten zonder dat iemand ziet waarom.
 */
function findProjectsJson(): string {
  const home = os.homedir();
  const direct = path.join(home, '.claude', 'skills', 'dev-project-manager', 'projects.json');
  const candidates = [direct];
  const syncedRoot = path.join(home, '.claude', 'skills', 'synced');
  try {
    for (const dir of fs.readdirSync(syncedRoot)) {
      candidates.push(path.join(syncedRoot, dir, 'dev-project-manager', 'projects.json'));
    }
  } catch {
    // geen synced-map: prima, dan blijft alleen het directe pad over
  }
  const found = candidates
    .map((file) => {
      try {
        return { file, mtime: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((c): c is { file: string; mtime: number } => c !== null)
    .sort((a, b) => b.mtime - a.mtime);
  // Niets gevonden? Geef het directe pad terug: dan klopt de foutmelding en
  // kan de watcher er alsnog op aanslaan zodra het bestand verschijnt.
  return found[0]?.file ?? direct;
}

export const PROJECTS_JSON_PATH = process.env.ARA_PROJECTS_JSON ?? findProjectsJson();

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7-day ring buffer

export const ORG_JSON_PATH = path.join(REPO_ROOT, 'plugins', 'ara', 'org.json');
