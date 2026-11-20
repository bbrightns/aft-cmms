// Plant holds one or more plants ("MIR", "RFG", "MIR,RFG"). The old value COMMON reads as both.
// Filtering MIR must also find parts shared with RFG; Stock Value shows shared parts as their own group.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const base = { Department: 'ELEC', Brand: 'OMRON', 'Sub Category': 'Relay', Min: '0', Location: 'STORE', Position: 'Z1-01-01', CLASS: 'C' };
const ROWS = [
  { ...base, id: 'p1', 'Part ID': 'SPFL-C-0001', Model: 'AAA1', Plant: 'MIR', Actual: '1', COST: '100' },
  { ...base, id: 'p2', 'Part ID': 'SPFL-C-0002', Model: 'BBB2', Plant: 'RFG', Actual: '1', COST: '200' },
  { ...base, id: 'p3', 'Part ID': 'SPFL-C-0003', Model: 'CCC3', Plant: 'MIR,RFG', Actual: '1', COST: '300' },
  { ...base, id: 'p4', 'Part ID': 'SPFL-C-0004', Model: 'DDD4', Plant: 'COMMON', Actual: '1', COST: '400' },   // not migrated yet
  { ...base, id: 'p5', 'Part ID': 'SPFL-C-0005', Model: 'EEE5', Plant: '', Actual: '1', COST: '500' },
];

async function setup(page, context) {
  const errors = h.watchErrors(page);
  const sent = await h.mockBackend(context, { role: 'staff', rows: JSON.parse(JSON.stringify(ROWS)) });
  const patches = [];
  await context.route('**/*.supabase.co/rest/v1/inventory**', (r) => {
    const req = r.request();
    if (req.method() !== 'PATCH') return r.fallback();
    const id = (new URL(req.url()).searchParams.get('id') || '').replace(/^eq\./, '');
    patches.push({ id, body: req.postDataJSON() });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id }]) });
  });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  await expect(page.locator('#profileRole')).toHaveText('Staff');
  return { sent, errors, patches };
}
const shownIds = (page) => page.evaluate(() => window.__storeTest.filteredIds);

test('plant values: COMMON and free-form spellings read as both plants', async ({ page, context }) => {
  await setup(page, context);
  const r = await page.evaluate(() => {
    const { plantValue, plantLabel } = window.__storeTest;
    return { common: plantValue('COMMON'), slash: plantValue('rfg/mir'), plus: plantLabel('MIR + RFG'),
      one: plantValue(' mir '), none: plantValue(''), list: plantValue(['RFG', 'MIR']) };
  });
  expect(r).toEqual({ common: 'MIR,RFG', slash: 'MIR,RFG', plus: 'MIR + RFG', one: 'MIR', none: '', list: 'MIR,RFG' });
});

test('filtering MIR also finds parts shared with RFG', async ({ page, context }) => {
  const { errors } = await setup(page, context);
  await page.evaluate(() => goInventory());
  // the plant select in the filter bar
  await page.evaluate(() => { document.getElementById('plantFilter').value = 'MIR'; applyFilters(); });
  expect(await shownIds(page)).toEqual(['p1', 'p3', 'p4']);
  await page.evaluate(() => { document.getElementById('plantFilter').value = 'RFG'; applyFilters(); });
  expect(await shownIds(page)).toEqual(['p2', 'p3', 'p4']);
  // the multi-value filter: MIR, and the shared-only option
  await page.evaluate(() => { document.getElementById('plantFilter').value = ''; window.__storeTest.advSel.plant.add('MIR'); applyFilters(); });
  expect(await shownIds(page)).toEqual(['p1', 'p3', 'p4']);
  await page.evaluate(() => { window.__storeTest.advSel.plant.clear(); window.__storeTest.advSel.plant.add('MIR + RFG'); applyFilters(); });
  expect(await shownIds(page)).toEqual(['p3', 'p4']);
  // free-text search
  await page.evaluate(() => { window.__storeTest.advSel.plant.clear(); document.getElementById('searchInput').value = 'mir'; applyFilters(); });
  expect(await shownIds(page)).toEqual(['p1', 'p3', 'p4']);
  expect(errors).toEqual([]);
});

test('edit form: tick boxes, COMMON opens as both and saves as MIR,RFG', async ({ page, context }) => {
  const { patches, errors } = await setup(page, context);
  await page.evaluate(() => openEdit('p4'));
  await expect(page.locator('#f_plant_mir')).toBeChecked();
  await expect(page.locator('#f_plant_rfg')).toBeChecked();
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].body.Plant).toBe('MIR,RFG');
  await page.evaluate(() => { const o = document.getElementById('txOverlay'); if (o) o.hidden = true; });
  await page.evaluate(() => openEdit('p1'));
  await expect(page.locator('#f_plant_mir')).toBeChecked();
  await expect(page.locator('#f_plant_rfg')).not.toBeChecked();
  await page.locator('#f_plant_rfg').check();
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1].body.Plant).toBe('MIR,RFG');
  expect(await h.noHorizontalScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('Stock Value by Plant: shared parts are one "MIR + RFG" group, never counted twice', async ({ page, context }) => {
  await setup(page, context);
  const g = await page.evaluate(() => Object.fromEntries(window.__storeTest.valGroups('Plant').map((x) => [x.key, x.value])));
  expect(g).toEqual({ MIR: 100, RFG: 200, 'MIR + RFG': 700, '(ไม่ระบุ)': 500 });
  expect(Object.values(g).reduce((a, b) => a + b, 0)).toBe(1500);
});
