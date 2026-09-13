/**
 * Maakt een consistente kopie van de database en ruimt oude kopieën op.
 * Draait los van de collector: SQLite in WAL-modus staat lezen naast schrijven
 * toe, dus dit kan veilig terwijl alles doordraait.
 *
 *   pnpm --filter @ara/collector backup
 *   ARA_BACKUP_DIR=~/Backups/ara pnpm --filter @ara/collector backup
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH } from './config.ts';

const KEEP = Number(process.env.ARA_BACKUP_KEEP ?? 14);
const dir = process.env.ARA_BACKUP_DIR ?? path.join(os.homedir(), 'Backups', 'ara');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[backup] geen database op ${DB_PATH} — niets te doen`);
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const target = path.join(dir, `ara-events-${stamp}.db`);

const db = new Database(DB_PATH, { readonly: true });
await db.backup(target);
db.close();

const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`[backup] ${target} (${size} MB)`);

// Oude kopieën opruimen — anders loopt de schijf alsnog vol.
const backups = fs
  .readdirSync(dir)
  .filter((f) => /^ara-events-.*\.db$/.test(f))
  .sort()
  .reverse();
for (const old of backups.slice(KEEP)) {
  fs.unlinkSync(path.join(dir, old));
  console.log(`[backup] opgeruimd: ${old}`);
}
console.log(`[backup] ${Math.min(backups.length, KEEP)} kopie(en) bewaard in ${dir}`);
