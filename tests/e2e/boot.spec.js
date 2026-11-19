// Loading: a page that cannot start must say why and offer a retry instead of spinning forever (boot-guard.js),
// and the store must never show "0 items" when the stock simply has not loaded.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const PAGES = [['store.html', 'guest'], ['pr.html', 'user'], ['print-qr.html', 'guest']];

for (const [file, who] of PAGES) {
  test(`${file} loads the pinned supabase-js and starts`, async ({ page, context }) => {
    const errors = h.watchErrors(page);
    await h.mockBackend(context, { who, role: 'staff' });
    const libs = [];
    page.on('request', (r) => { if (r.url().includes('supabase-js')) libs.push(r.url()); });
    await page.goto(`/${file}`);
    await expect(page.locator('#loadingOverlay')).toBeHidden({ timeout: 15_000 });
    expect(libs.length).toBeGreaterThan(0);
    for (const url of libs) expect(url).toMatch(/supabase-js@\d+\.\d+\.\d+\//);   // exact version, never a range
    expect(await h.noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${file} explains a blocked CDN and offers a retry`, async ({ page, context }) => {
    await h.mockBackend(context, { who, cdn: 'blocked' });
    await page.goto(`/${file}`);
    await expect(page.locator('.boot-fail')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.boot-fail-detail')).toContainText('cdn.jsdelivr.net');
    await expect(page.locator('.boot-fail-step')).toContainText('ขั้นตอนล่าสุด');
    const retry = page.locator('.boot-fail-retry');
    expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await h.noHorizontalScroll(page)).toBe(true);
    await retry.click();
    await expect(page.locator('.boot-fail')).toHaveCount(0);   // reloaded: spinner again
  });
}

test('store: reusing the overlay after boot (CSV import) does not trigger the guard', async ({ page, context }) => {
  await h.mockBackend(context, { who: 'guest' });
  await h.openStore(page);
  await page.waitForTimeout(16_000);   // past the guard's 15 s
  await page.evaluate(() => { document.getElementById('loadingOverlay').style.display = 'flex'; });
  await page.waitForTimeout(1500);
  await expect(page.locator('.boot-fail')).toHaveCount(0);
});

test('store: a database that never answers shows "—", then a retry card that recovers', async ({ page, context }) => {
  const sent = await h.mockBackend(context, { who: 'guest', db: 'hang' });
  await h.openStore(page);
  await expect(page.locator('#homeStats')).toContainText('—');
  await expect(page.locator('#homeStats')).not.toContainText(/\b0\b/);
  await expect(page.locator('#syncText')).toHaveText('กำลังโหลด...');
  await expect(page.locator('.home-stats-fail')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#syncText')).toHaveText('Error');
  expect(await h.noHorizontalScroll(page)).toBe(true);
  sent.state.db = 'ok';
  await page.locator('.home-stats-fail-retry').click();
  await expect(page.locator('#homeStats')).toContainText('3');
  await expect(page.locator('#syncText')).toHaveText('Live');
});

test('store: a database error shows the retry card at once', async ({ page, context }) => {
  await h.mockBackend(context, { who: 'guest', db: 'error' });
  await h.openStore(page);
  await expect(page.locator('.home-stats-fail')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#syncText')).toHaveText('Error');
});

test('login: a blocked CDN makes the buttons say why', async ({ page, context }) => {
  await h.mockBackend(context, { who: 'none', cdn: 'blocked' });
  await page.goto('/login.html');
  await page.waitForTimeout(1000);
  await page.locator('#btnGoogle').click();
  await expect(page.locator('#loadingIndicator')).toBeVisible();
  await expect(page.locator('#loadingIndicator')).toContainText('cdn.jsdelivr.net');
});

test('login: Google sign-in goes to the Supabase authorize page', async ({ page, context }) => {
  await h.mockBackend(context, { who: 'none' });
  await page.goto('/login.html');
  await page.waitForFunction(() => window.__supabaseLoaded === true);
  await page.locator('#btnGoogle').click();
  await page.waitForURL(/\/auth\/v1\/authorize/);
});
