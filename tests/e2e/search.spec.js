// Search: every word must appear somewhere in the part, in any order and any field.
// The inventory page and the เบิก/รับ page use the same rule and the same fields.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const ROWS = [
  { id: 't1', 'Part ID': 'SPFL-C-0789', Department: 'ELEC', Plant: 'RFG', Area: 'SAND BLAST', 'Sub Category': 'SWITCH', Brand: 'TEND',
    Model: 'TZ-93CPG-02', Description: 'Safety Switch, 220VAC, 1A1B (1NO, 1NC)', Location: 'STORE', Actual: '1', VENDOR: 'TKK', CLASS: 'C', 'Set Group': null },
  { id: 't2', 'Part ID': 'SPFL-C-0801', Department: 'ELEC', Plant: 'MIR,RFG', 'Sub Category': 'Sensor', Brand: 'KEYENCE',
    Model: 'FR-S01', Description: 'Level sensor', Location: 'STORE', Actual: '1', VENDOR: 'ABC', CLASS: 'C', 'Set Group': 'LEVEL-SET' },
  { id: 't3', 'Part ID': 'SPFL-C-0001', Department: 'ELEC', Plant: 'MIR', 'Sub Category': 'Relay', Brand: 'OMRON',
    Model: 'LY4N', Description: 'Relay 24VDC', Location: 'STORE', Actual: '2', VENDOR: 'TKK', CLASS: 'B', 'Set Group': null },
];

async function setup(page, context) {
  const errors = h.watchErrors(page);
  await h.mockBackend(context, { role: 'staff', rows: ROWS });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  return errors;
}
async function invSearch(page, q) {
  return page.evaluate((text) => { document.getElementById('searchInput').value = text; applyFilters(); return window.__storeTest.filteredIds; }, q);
}

test('inventory search: words in any order and any field', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.evaluate(() => goInventory());
  expect(await invSearch(page, 'tend safety')).toEqual(['t1']);          // Brand + Description, not next to each other
  expect(await invSearch(page, 'safety tend')).toEqual(['t1']);          // order does not matter
  expect(await invSearch(page, 'switch 220vac')).toEqual(['t1']);
  expect(await invSearch(page, 'tkk')).toEqual(['t1', 't3']);            // vendor
  expect(await invSearch(page, 'tkk relay')).toEqual(['t3']);            // each word narrows
  expect(await invSearch(page, 'level-set')).toEqual(['t2']);            // set group
  expect(await invSearch(page, 'mir')).toEqual(['t2', 't3']);            // plant, shared part included
  expect(await invSearch(page, '  TZ-93   ')).toEqual(['t1']);           // spaces and case ignored
  expect(await invSearch(page, 'tend omron')).toEqual([]);               // every word must match
  // highlighting marks each word on its own
  await invSearch(page, 'tend safety');
  const marks = await page.locator('.search-highlight').allInnerTexts();
  expect(marks.map((m) => m.toLowerCase())).toEqual(expect.arrayContaining(['tend', 'safety']));
  expect(errors).toEqual([]);
});

test('เบิก/รับ search uses the same rule', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.locator('.home-action-card.card-out').click();
  const search = async (q) => { await page.fill('#qaSearch', q); await page.evaluate(() => qaSearchInput()); return page.locator('#qaResults .qa-item').evaluateAll((els) => els.map((e) => e.dataset.id).sort()); };
  expect(await search('tend safety')).toEqual(['t1']);
  expect(await search('tkk')).toEqual(['t1', 't3']);
  expect(await search('mir')).toEqual(['t2', 't3']);
  expect(await search('tend omron')).toEqual([]);
  expect(errors).toEqual([]);
});
