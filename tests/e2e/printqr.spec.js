// print-qr.html: the search uses the store page's rule (every word, any order, any field), and the
// plant filter lists MIR / RFG only, with parts used by both plants (incl. old COMMON rows) under each.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test('print QR: word search and multi-plant filter', async ({ page, context }) => {
  const errors = h.watchErrors(page);
  await h.mockBackend(context, { role: 'staff', rows: [
    { id: 't1', 'Part ID': 'SPFL-C-0789', Brand: 'TEND', Model: 'TZ-93CPG-02', Description: 'Safety Switch', Position: 'Z1-01-01', Plant: 'RFG', VENDOR: 'TKK' },
    { id: 't2', 'Part ID': 'SPFL-C-0801', Brand: 'KEYENCE', Model: 'FR-S01', Description: 'Level sensor', Position: 'Z1-01-02', Plant: 'COMMON' },
    { id: 't3', 'Part ID': 'SPFL-C-0001', Brand: 'OMRON', Model: 'LY4N', Description: 'Relay', Position: 'Z1-01-03', Plant: 'RFG' },
  ] });
  await page.goto('/print-qr.html');
  await expect(page.locator('.label-card')).toHaveCount(3, { timeout: 15000 });
  await page.fill('#searchInput', 'tend safety');
  await expect(page.locator('.label-card')).toHaveCount(1);
  await page.fill('#searchInput', 'tkk');
  await expect(page.locator('.label-card')).toHaveCount(1);
  await page.fill('#searchInput', '');
  expect(await page.locator('#plantFilter option').evaluateAll((o) => o.map((x) => x.value))).toEqual(['', 'MIR', 'RFG']);
  await page.selectOption('#plantFilter', 'MIR');
  await expect(page.locator('.label-card')).toHaveCount(1);
  await page.selectOption('#plantFilter', 'RFG');
  await expect(page.locator('.label-card')).toHaveCount(3);
  expect(errors).toEqual([]);
});
