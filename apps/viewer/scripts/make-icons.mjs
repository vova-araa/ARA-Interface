import { chromium } from '@playwright/test';

const src = process.argv[2];
const outDir = process.argv[3];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto('file://' + src);
const el = page.locator('.icon');
for (const size of [512, 192, 180]) {
  await page.evaluate((s) => {
    const icon = document.querySelector('.icon');
    icon.style.width = icon.style.height = s + 'px';
    const svg = document.querySelector('svg');
    svg.style.width = svg.style.height = Math.round(s * 0.7) + 'px';
  }, size);
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await el.screenshot({ path: `${outDir}/${name}` });
}
await browser.close();
console.log('icons written');
