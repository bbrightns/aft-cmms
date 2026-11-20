// Home page: readable Thai subtitles, cards without a dropdown arrow, self-hosted fonts, and on desktop one wide
// dashboard: stats + actions on one row, the menu as tiles, and the attention / latest-movement cards side by side.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const LOGS = [
  { id: 3, type: 'out', partId: 'SPFL-C-0001', msg: '📤 เบิก 2 pcs', ts: new Date().toISOString(), user: 'Golf', undo_data: { action: 'out', qty: 2 } },
  { id: 2, type: 'edit', partId: 'SPFL-C-0002', msg: 'แก้ไข', ts: new Date().toISOString(), user: 'Nid' },
  { id: 1, type: 'in', partId: 'SPFL-C-0003', msg: '📥 รับ 5 pcs', ts: new Date().toISOString(), user: 'Nid', undo_data: { action: 'in', qty: 5 } },
];

test('menu subtitles are Thai sentences, cards have no dropdown arrow, fonts come from vendor/', async ({ page, context }) => {
  const errors = h.watchErrors(page);
  const sent = await h.mockBackend(context, { role: 'staff', logs: LOGS });
  const fontFiles = [];
  page.on('request', (r) => { if (r.resourceType() === 'font') fontFiles.push(new URL(r.url()).pathname); });
  await h.openStore(page);
  await h.waitForStockLoaded(page);

  const subs = await page.locator('.home-sec-sub').allInnerTexts();
  expect(subs.length).toBe(5);
  for (const t of subs) expect(t).toMatch(/[฀-๿]/);   // Thai, not an English caps label
  await expect(page.locator('.hac-chevron')).toHaveCount(0);

  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
  expect(loaded).toEqual(expect.arrayContaining(['Google Sans']));
  // Thai text really uses Google Sans (its Thai file was downloaded), not a system fallback
  expect(await page.evaluate(() => document.fonts.check('600 16px "Google Sans"', 'เบิกของ'))).toBe(true);
  expect(fontFiles.some((f) => f.includes('google-sans-thai'))).toBe(true);
  expect(fontFiles.length).toBeGreaterThan(0);
  for (const f of fontFiles) expect(f).toMatch(/^\/vendor\/fonts\/.+\.woff2$/);
  expect(sent.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

test('desktop side column: what needs attention and the latest movements', async ({ page, context }, info) => {
  const errors = h.watchErrors(page);
  const sent = await h.mockBackend(context, { role: 'viewer', logs: LOGS });
  await h.openStore(page);
  await h.waitForStockLoaded(page);

  if (info.project.name === 'phone') {   // phones keep one column and never download the logs for it
    await expect(page.locator('#homeSide')).toBeHidden();
    await page.waitForTimeout(500);
    expect(sent.logGets).toBe(0);
    return;
  }
  await expect(page.locator('#homeSide')).toBeVisible();
  // SPFL-C-0002: 1 left, Min 3 (the only item below Min in the test data)
  await expect(page.locator('#sideLowList .side-row')).toHaveCount(1);
  await expect(page.locator('#sideLowList')).toContainText('SPFL-C-0002');
  await expect(page.locator('#sideLowList')).toContainText('เหลือ 1 / Min 3');
  await expect(page.locator('#sideLowCount')).toHaveText('1 รายการ');
  // only withdrawals and receipts, newest first, with who did it
  await expect(page.locator('#sideRecentList .side-row')).toHaveCount(2);
  await expect(page.locator('#sideRecentList .side-row').first()).toContainText('เบิก 2');
  await expect(page.locator('#sideRecentList .side-row').first()).toContainText('Golf');
  await expect(page.locator('#sideRecentList .side-row').nth(1)).toContainText('รับ 5');
  expect(sent.logGets).toBe(1);   // one request, even though the home page renders several times

  await page.locator('#sideLowList .side-row').first().click();
  await expect(page.locator('#detailModal')).toBeVisible();
  expect(await h.noHorizontalScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('desktop side column is never cut off or scrolled inside itself, even when full', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'the side column only exists on wide screens');
  await page.setViewportSize({ width: 1820, height: 885 });   // the size the bug was reported at
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `x${i}`, 'Part ID': `SPFL-C-${String(100 + i).padStart(4, '0')}`, Brand: 'OMADA', Model: `EAP211-BRIDGE KIT ${i}`,
    Actual: '0', Min: '2', Location: 'A', Position: '1',
  }));
  const logs = Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i, type: i % 2 ? 'in' : 'out', partId: rows[i].id && rows[i]['Part ID'], msg: 'x', user: 'Golf',
    ts: new Date(Date.now() - i * 864e5).toISOString(), undo_data: { qty: i + 1 },
  }));
  await h.mockBackend(context, { role: 'staff', rows, logs });
  await h.openStore(page);
  await expect(page.locator('#sideRecentList .side-row')).toHaveCount(8);
  await expect(page.locator('#sideLowList .side-row')).toHaveCount(8);

  for (const scroll of [0, 99999]) {   // top of the page, then scrolled to the bottom
    await page.evaluate((y) => window.scrollTo(0, y), scroll);
    await page.waitForTimeout(200);
    const side = await page.evaluate(() => {
      const el = document.getElementById('homeSide');
      return { inner: el.scrollHeight - el.clientHeight, overflowY: getComputedStyle(el).overflowY };
    });
    expect(side.inner, 'no scrollbar inside the side column').toBeLessThanOrEqual(1);
    // every card is drawn whole: nothing clipped by an ancestor
    for (const card of await page.locator('#homeSide .side-card').all()) {
      const clipped = await card.evaluate((el) => {
        const r = el.getBoundingClientRect();
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.overflowY !== 'visible' || s.overflowX !== 'visible') {
            const pr = p.getBoundingClientRect();
            if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1) return true;
          }
        }
        return false;
      });
      expect(clipped).toBe(false);
    }
  }
  expect(await h.noHorizontalScroll(page)).toBe(true);
});

test('desktop side column: admins see items that share a Model', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'the side column only exists on wide screens');
  const rows = [
    { id: 'd1', 'Part ID': 'SPFL-C-0101', Brand: 'KEYENCE', Model: 'FS-N41P', Plant: 'MIR', Area: 'PAINTING ROOM', Actual: '2', Min: '0' },
    { id: 'd2', 'Part ID': 'SPFL-C-0102', Brand: 'Keyence', Model: 'fs n41p', Plant: 'MIR', Actual: '1', Min: '0' },
    { id: 'd3', 'Part ID': 'SPFL-C-0103', Brand: 'KEYENCE', Model: 'FS-N41P', Plant: 'RFG', Actual: '0', Min: '0' },
    { id: 'd4', 'Part ID': 'SPFL-C-0104', Brand: 'OMRON', Model: 'E3Z-T61', Plant: 'RFG', Actual: '1', Min: '0' },
    { id: 'd5', 'Part ID': 'SPFL-C-0105', Brand: 'IFM', Model: 'E3ZT61', Plant: 'MIR', Actual: '1', Min: '0' },
    { id: 'd6', 'Part ID': 'SPFL-C-0106', Brand: 'WAGO', Model: '-', Actual: '1', Min: '0' },
    { id: 'd7', 'Part ID': 'SPFL-C-0107', Brand: 'WAGO', Model: '-', Actual: '1', Min: '0' },
  ];
  const errors = h.watchErrors(page);
  await h.mockBackend(context, { role: 'admin', rows });
  await h.openStore(page);
  await h.waitForStockLoaded(page);

  await expect(page.locator('#sideDupCard')).toBeVisible();
  await expect(page.locator('#sideDupCount')).toHaveText('2 กลุ่ม');   // "-" is not a model
  const first = page.locator('#sideDupList .side-row').first();
  await expect(first).toContainText('×3');
  await expect(first).toContainText('Plant เดียวกัน');
  await expect(page.locator('#sideDupList .side-row').nth(1)).toContainText('ยี่ห้อไม่ตรง');

  await first.click();
  await expect(page.locator('#dupModal')).toBeVisible();
  await expect(page.locator('#dupModal .side-row')).toHaveCount(3);
  await page.locator('#dupModal .side-row', { hasText: 'SPFL-C-0103' }).click();
  await expect(page.locator('#dupModal')).toBeHidden();
  await expect(page.locator('#detailModal')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the duplicate card is hidden from staff', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'the side column only exists on wide screens');
  const rows = [
    { id: 'd1', 'Part ID': 'SPFL-C-0101', Brand: 'KEYENCE', Model: 'FS-N41P', Actual: '2', Min: '0' },
    { id: 'd2', 'Part ID': 'SPFL-C-0102', Brand: 'KEYENCE', Model: 'FS-N41P', Actual: '1', Min: '0' },
  ];
  await h.mockBackend(context, { role: 'staff', rows });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  await expect(page.locator('#sideLowList')).toBeVisible();
  await expect(page.locator('#sideDupCard')).toBeHidden();
});

test('desktop dashboard: actions on one row, cards side by side, search box opens the filtered list', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'the dashboard layout only exists on wide screens');
  const errors = h.watchErrors(page);
  await h.mockBackend(context, { role: 'admin', logs: LOGS, rows: [
    { id: 'd1', 'Part ID': 'SPFL-C-0101', Brand: 'KEYENCE', Model: 'FS-N41P', Actual: '0', Min: '2' },
    { id: 'd2', 'Part ID': 'SPFL-C-0102', Brand: 'KEYENCE', Model: 'FS-N41P', Actual: '1', Min: '0' },
    { id: 'd3', 'Part ID': 'SPFL-C-0103', Brand: 'OMRON', Model: 'LY4N', Actual: '4', Min: '0' },
  ] });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  await expect(page.locator('#sideRecentList .side-row')).toHaveCount(2);

  const top = async (sel) => Math.round((await page.locator(sel).boundingBox()).y);
  // stats, เบิก/รับ and สแกน share one row
  const rowY = await top('#homeStats');
  expect(Math.abs(await top('.home-main-grid') - rowY)).toBeLessThanOrEqual(1);
  expect(Math.abs(await top('.home-scan-btn') - rowY)).toBeLessThanOrEqual(1);
  // the five menu tiles share one row
  const tiles = await page.locator('#homeLinks .home-sec-btn').all();
  expect(tiles.length).toBe(5);
  const tileY = new Set(await Promise.all(tiles.map(async (t) => Math.round((await t.boundingBox()).y))));
  expect(tileY.size).toBe(1);
  // the three cards start on the same line, inside the first screen
  const cards = await page.locator('#homeSide .side-card:visible').all();
  expect(cards.length).toBe(3);
  const cardY = await Promise.all(cards.map(async (c) => Math.round((await c.boundingBox()).y)));
  expect(new Set(cardY).size).toBe(1);
  expect(cardY[0]).toBeLessThan(page.viewportSize().height);
  expect(await h.noHorizontalScroll(page)).toBe(true);

  await page.fill('#homeSearchInput', 'omron');
  await page.press('#homeSearchInput', 'Enter');
  await expect(page.locator('#pageInventory')).toBeVisible();
  await expect(page.locator('#searchInput')).toHaveValue('omron');
  await expect(page.locator('#homeSearchInput')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('phones keep the menu list and have no dashboard search box', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await h.mockBackend(context, { role: 'staff' });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  await expect(page.locator('#homeSearch')).toBeHidden();
  const tiles = await page.locator('#homeLinks .home-sec-btn').all();
  const ys = await Promise.all(tiles.map(async (t) => (await t.boundingBox()).y));
  for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);   // stacked, one per row
  expect(await h.noHorizontalScroll(page)).toBe(true);
});
