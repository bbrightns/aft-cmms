// Home page: readable Thai subtitles, cards without a dropdown arrow, self-hosted fonts, and on desktop a side
// column with what needs attention and the latest withdrawals / receipts.
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
