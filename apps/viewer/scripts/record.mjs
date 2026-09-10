// Neemt een demo-video op van de draaiende wereld (Playwright screencast, geen ffmpeg nodig).
// Gebruik: node scripts/record.mjs [seconden] — output in scripts/out/ara-demo.webm
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const seconds = Number(process.argv[2] ?? 30);
const url = process.env.ARA_URL ?? 'http://localhost:4748/?demo=1&time=day&fx=force';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');

// Laat de intro-zoom en het wereldleven zien; halverwege even naar het overzicht.
await page.waitForTimeout(seconds * 500);
await page.keyboard.press('o');
await page.waitForTimeout(2500);
await page.keyboard.press('Escape');
await page.waitForTimeout(seconds * 500 - 2500);

const video = page.video();
await context.close();
const path = await video.path();
await browser.close();
renameSync(path, join(outDir, 'ara-demo.webm'));
// Ruim eventuele oudere opnames op (Playwright genereert random namen).
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.webm') && f !== 'ara-demo.webm') {
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(join(outDir, f)); } catch {}
  }
}
console.log('video:', join(outDir, 'ara-demo.webm'));
