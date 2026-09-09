import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
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
      port: 4747,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm start',
      port: 4748,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
