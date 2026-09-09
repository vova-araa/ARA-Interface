#!/usr/bin/env node
/**
 * ARA browse — headless-Chromium website screener voor agents.
 *
 *   pnpm browse <url> [--shot] [--full] [--links N] [--chars N] [--wait ms] [--mobile]
 *
 * Print een compacte JSON-samenvatting (titel, meta, koppen, tekst-preview,
 * links) naar stdout en schrijft volledige tekst + optionele screenshot naar
 * een output-map. Read-only: geen logins, geen formulieren, geen downloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
if (!url || !/^https?:\/\//.test(url)) {
  console.error('gebruik: pnpm browse <https://url> [--shot] [--full] [--links N] [--chars N] [--wait ms] [--mobile]');
  process.exit(1);
}
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const OUT_DIR = process.env.ARA_BROWSE_DIR ?? '/tmp/ara-browse';
const stamp = `${new URL(url).hostname}-${Date.now()}`;
fs.mkdirSync(OUT_DIR, { recursive: true });

const launchOptions = {};
if (process.env.PW_CHROMIUM_PATH) launchOptions.executablePath = process.env.PW_CHROMIUM_PATH;
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) {
  launchOptions.proxy = {
    server: proxy,
    bypass: (process.env.NO_PROXY ?? process.env.no_proxy ?? 'localhost,127.0.0.1').replaceAll(' ', ''),
  };
}

const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext({
    viewport: flag('mobile') ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    userAgent: flag('mobile')
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
    ignoreHTTPSErrors: process.env.ARA_BROWSE_INSECURE === '1',
  });
  const page = await context.newPage();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(opt('wait', 1500));

  const data = await page.evaluate((maxLinks) => {
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content') ?? null;
    const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('h1, h2, h3')]
      .slice(0, 25)
      .map((h) => `${h.tagName.toLowerCase()}: ${clean(h.textContent)}`)
      .filter((h) => h.length > 4);
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => ({ text: clean(a.textContent).slice(0, 80), href: a.href }))
      .filter((l) => l.text && l.href.startsWith('http'))
      .slice(0, maxLinks);
    return {
      title: document.title,
      description: meta('description') ?? meta('og:description'),
      headings,
      links,
      text: clean(document.body?.innerText ?? ''),
    };
  }, opt('links', 30));

  const textFile = path.join(OUT_DIR, `${stamp}.txt`);
  fs.writeFileSync(textFile, data.text);

  let screenshot = null;
  if (flag('shot') || flag('full')) {
    screenshot = path.join(OUT_DIR, `${stamp}.png`);
    await page.screenshot({ path: screenshot, fullPage: flag('full') });
  }

  const maxChars = opt('chars', 2500);
  console.log(
    JSON.stringify(
      {
        url,
        status: response?.status() ?? null,
        title: data.title,
        description: data.description,
        headings: data.headings,
        textPreview: data.text.slice(0, maxChars),
        textChars: data.text.length,
        textFile,
        screenshot,
        links: data.links,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
