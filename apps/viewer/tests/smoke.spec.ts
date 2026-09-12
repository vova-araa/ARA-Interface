import { test, expect } from '@playwright/test';

// Desktop + iPhone smoke over the built viewer (vite preview on :4748).
// Demo mode is used so the tests don't depend on live Claude Code sessions,
// only on the collector's /fixture + /world endpoints.

test.describe('desktop 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('world renders and demo story populates the thread list', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/?demo=1');
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.locator('.topbar')).toContainText('Needs you');
    await expect(page.locator('.scrubber')).toHaveCount(0); // hidden in demo mode

    // Fixture story starts within seconds: threads appear grouped by project.
    await expect(page.locator('.thread').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.thread-project').first()).toBeVisible();

    // Venture filter chips from world.config.json
    await expect(page.locator('.chip', { hasText: 'All' })).toBeVisible();

    // Click a thread → detail drawer opens with session info.
    await page.locator('.thread').first().click();
    await expect(page.locator('.drawer')).toBeVisible();
    await page.locator('.drawer .btn').click();
    await expect(page.locator('.drawer')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('live mode shows reconnect banner state correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible();

    // Time-scrubber exists in live mode; scrubbing enters replay, LIVE exits.
    // Ruime timeouts: onder software-rendering (CI/container, geen GPU) haalt
    // de async /history + replay-snapshot het niet altijd binnen de 5s-default
    // terwijl de renderer op ReadPixels stalt — op echte hardware is dit direct.
    await expect(page.locator('.scrubber')).toBeVisible();
    await page.locator('.scrubber input').fill('500');
    await expect(page.locator('.topbar-title')).toContainText('replay', { timeout: 15_000 });
    await page.locator('.scrubber .btn').click();
    await expect(page.locator('.topbar-title')).not.toContainText('replay', { timeout: 15_000 });
    // Overzicht: ⊞ opent het venture-dashboard; Esc sluit.
    await page.locator('.topbar-actions .btn[title^="Overzicht"]').click();
    await expect(page.locator('.overview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.overview')).toHaveCount(0);

    // Takenbord: ☷ opent het paneel met het nieuwe-taak formulier.
    await page.locator('.topbar-actions .btn[title^="Takenbord"]').click();
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('.board input').first()).toHaveAttribute('placeholder', /Nieuwe taak/);
    await page.locator('.board-header .btn').click();
    await expect(page.locator('.board')).toHaveCount(0);

    // With the collector proxied and running, no banner; if down, banner shows.
    const health = await page.request.get('/health').then((r) => r.ok()).catch(() => false);
    if (health) {
      await expect(page.locator('.banner')).toHaveCount(0, { timeout: 10_000 });
    } else {
      await expect(page.locator('.banner')).toBeVisible();
    }
  });
});

test.describe('iPhone 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('mobile layout: canvas full-screen, panel as bottom sheet', async ({ page }) => {
    await page.goto('/?demo=1');
    await expect(page.locator('canvas').first()).toBeVisible();

    // Panel starts closed on small screens; hamburger opens the bottom sheet.
    await expect(page.locator('.panel')).toHaveCount(0);
    await page.locator('.topbar-actions .btn').last().click();
    const panel = page.locator('.panel');
    await expect(panel).toBeVisible();

    // Bottom sheet is anchored to the bottom edge and spans the width.
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    expect(box.y + box.height).toBeGreaterThan(830);

    // No horizontal overflow.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});

test.describe('kantoren 1400×900', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('kantoor: werkvloer, detailpaneel en chat', async ({ page }) => {
    await page.goto('/?office=truck-trailers');
    // Het kantoor rendert en toont de branche-naam.
    await expect(page.locator('.office-overlay')).toBeVisible();
    await expect(page.locator('.office-topbar')).toContainText('truck-trailers');
    await expect(page.locator('canvas').first()).toBeVisible();

    // Werkplekken staan in de lijst; klikken opent het detailpaneel.
    const rows = page.locator('.office-row');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await rows.first().click();
    await expect(page.locator('.office-detail')).toBeVisible();
    await expect(page.locator('.office-table')).toBeVisible();

    // Team-tab toont de leiding: chief en manager horen er altijd te zijn.
    await page.locator('.office-tabs button', { hasText: 'Team' }).click();
    await expect(page.locator('.office-list')).toContainText('ARA Chief');

    // Chat: een vraag verschijnt in het gesprek.
    const before = await page.locator('.office-msg').count();
    await page.locator('.office-chat-input input').fill('Is truck 42 al klaar?');
    await page.locator('.office-chat-input button').click();
    await expect(page.locator('.office-msg')).toHaveCount(before + 1, { timeout: 15_000 });

    // Terug naar de kaart.
    await page.locator('.office-topbar .btn').click();
    await expect(page.locator('.office-overlay')).toHaveCount(0);
  });
});
