import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * De smoke-suite draait tegen een échte collector, want een viewer zonder
 * collector test niets. Die collector krijgt hier zijn eigen wegwerp-database.
 *
 * Waarom dat uitmaakt: de tests sturen echte events. Zonder eigen datamap
 * landen die in de productie-db op de Mac, en staan er daarna testsessies als
 * pods in de wereld, in de tokentabel en in het overzicht. Een systeem dat je
 * wilt vertrouwen voor cijfers over je bedrijven mag niet vervuild raken door
 * het draaien van zijn eigen tests.
 *
 * Daarom ook geen reuseExistingServer op 4747: die zou de draaiende
 * productiecollector kapen, en dan helpt een eigen datamap niets meer.
 */
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-pw-data-'));

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  // Eén worker. Vijf WebGL-flows tegelijk op een machine zonder GPU
  // (SwiftShader, <1fps) laat ze om de beurt omvallen op een timeout, en dan
  // is een rode run niet meer te onderscheiden van een echte fout. Gemeten:
  // dezelfde test viel om binnen 60s naast vier andere flows en was in 27,4s
  // groen toen hij alleen draaide. Een suite die alleen klopt als de machine
  // toevallig rustig is, leert je om rood te negeren.
  //
  // De hele suite duurt zo ~2 minuten. Dat is de prijs voor een uitkomst
  // waar je iets aan hebt.
  workers: 1,
  use: {
    baseURL: 'http://localhost:4748',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'pnpm --filter @ara/collector start',
      cwd: '../..',
      // Een eigen poort: 4747 is van de draaiende Mac-collector. Twee processen
      // op één poort is ofwel een startfout ofwel — erger — stilzwijgend die
      // andere collector gebruiken.
      port: 4757,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ARA_DATA_DIR: TEST_DATA_DIR,
        ARA_COLLECTOR_PORT: '4757',
        ARA_WORLD_CONFIG: path.join(TEST_DATA_DIR, 'world.config.json'),
        // Een testrun mag nooit de echte projectlijst lezen: dan hangt de
        // uitkomst af van wat er toevallig op deze machine staat.
        ARA_PROJECTS_JSON: path.join(TEST_DATA_DIR, 'projects.json'),
      },
    },
    {
      command: 'pnpm start',
      port: 4748,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ARA_COLLECTOR_URL: 'http://127.0.0.1:4757' },
    },
  ],
});
