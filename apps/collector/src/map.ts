/** Regenerates world.config.json from projects.json (used by /ara-map). */
import fs from 'node:fs';
import { buildWorldConfig } from '@ara/shared';
import { ORG_JSON_PATH, WORLD_CONFIG_PATH } from './config.ts';
import { loadProjects } from './projects.ts';

function hiddenVentures(): string[] {
  try {
    const org = JSON.parse(fs.readFileSync(ORG_JSON_PATH, 'utf8')) as {
      policy?: { hiddenVentures?: string[] };
    };
    return org.policy?.hiddenVentures ?? ['misc'];
  } catch {
    return ['misc'];
  }
}

const projects = loadProjects();
if (projects.length === 0) {
  console.warn('[ara-map] projects.json empty or missing — generating demo world');
  projects.push(
    { name: 'traject-tms' },
    { name: 'blex-logistics' },
    { name: 'elevate-design' },
    { name: 'uprising-studio' },
    { name: 'xauusd-bot' },
    { name: 'vovara-site' },
  );
}
const config = buildWorldConfig(projects, Date.now(), { hiddenVentures: hiddenVentures() });
fs.writeFileSync(WORLD_CONFIG_PATH, JSON.stringify(config, null, 2));
console.log(
  `[ara-map] wrote ${WORLD_CONFIG_PATH}: ${config.districts.length} districts, ` +
    `${config.districts.reduce((n, d) => n + d.projects.length, 0)} projects`,
);
