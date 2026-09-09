import { chromium } from '@playwright/test';

const [url, out, w = '1280', h = '800', waitMs = '6000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 10).join('\n'));
else console.log('no page errors');
await browser.close();
