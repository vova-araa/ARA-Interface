import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const COLLECTOR_PORT = Number(process.env.ARA_COLLECTOR_PORT ?? 4747);
export const VIEWER_PORT = Number(process.env.ARA_VIEWER_PORT ?? 4748);

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DATA_DIR = process.env.ARA_DATA_DIR ?? path.join(REPO_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'ara-events.db');
export const WORLD_CONFIG_PATH = path.join(REPO_ROOT, 'world.config.json');
export const FIXTURE_PATH = path.join(REPO_ROOT, 'apps', 'collector', 'fixtures', 'demo.jsonl');

export const PROJECTS_JSON_PATH =
  process.env.ARA_PROJECTS_JSON ??
  path.join(os.homedir(), '.claude', 'skills', 'dev-project-manager', 'projects.json');

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7-day ring buffer
