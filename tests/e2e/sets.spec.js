// Set Group: parts used together (sensor + cable + bracket). Each part keeps its own row and stock;
// the page links them, splits a set price over them, offers the rest of the set on withdraw and flags broken sets.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const base = { Department: 'ELEC', Brand: 'KEYENCE', 'Sub Category': 'Sensor', Min: '0', Location: 'STORE', CLASS: 'C', COST_SOURCE: null };
const ROWS = [
  { ...base, id: 's1', 'Part ID': 'SPFL-C-0801', Model: 'FR-S01', Description: 'Level sensor', Actual: '1', Position: 'Z1-01-01', COST: '', 'Set Group': 'FR-S01' },
  { ...base, id: 's2', 'Part ID': 'SPFL-C-0802', Model: 'FR-SB31A', Description: 'SUPPORT LEVEL SENSOR', Actual: '1', Position: 'Z1-01-02', COST: '', 'Set Group': 'fr-s01 ' },
  { ...base, id: 's3', 'Part ID': 'SPFL-C-0804', Model: 'OP-88893', Description: 'สาย LEVEL SENSOR', Actual: '0', Position: 'Z1-01-03', COST: '', 'Set Group': 'FR-S01' },
  { ...base, id: 'x1', 'Part ID': 'SPFL-C-0001', Brand: 'OMRON', Model: 'LY4N', Description: 'Relay', Actual: '5', Position: 'A', COST: '120', 'Set Group': null },
];

async function setup(page, context, rows = ROWS) {
  const errors = h.watchErrors(page);
  const sent = await h.mockBackend(context, { role: 'staff', rows: JSON.parse(JSON.stringify(rows)) });
  const patches = [];
  // updates answer with the row id, the way PostgREST does for .update().select('id')
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

test('set price split: proportional, rounds so the parts add up to the set price', async ({ page, context }) => {
  await setup(page, context);
  const r = await page.evaluate(() => ({
    ratio: setPriceSplit(22000, [{ w: 20000, q: 1 }, { w: 2000, q: 1 }, { w: 1500, q: 1 }]),
    equal: setPriceSplit(100, [{ w: 1, q: 1 }, { w: 1, q: 1 }, { w: 1, q: 1 }]),
    qty: setPriceSplit(1000, [{ w: 300, q: 2 }, { w: 400, q: 1 }]),
    bad: setPriceSplit(1000, [{ w: NaN, q: 1 }]),
  }));
  expect(r.ratio).toEqual([18723.4, 1872.34, 1404.26]);
  expect(r.ratio.reduce((a, b) => a + b, 0)).toBeCloseTo(22000, 2);
  expect(r.equal.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  expect(r.qty[0] * 2 + r.qty[1]).toBeCloseTo(1000, 2);
  expect(r.qty).toEqual([300, 400]);
  expect(r.bad).toBeNull();
});

test('set chip, set dialog and the incomplete-set warning', async ({ page, context }) => {
  const { errors } = await setup(page, context);
  // home: one set has a part out of stock while the others are in stock
  await expect(page.locator('#homeSetAlert')).toBeVisible();
  await expect(page.locator('#homeSetAlert')).toContainText('ชุดไม่ครบ 1 ชุด');
  await expect(page.locator('#homeSetAlert')).toContainText('OP-88893');
  await page.locator('#homeSetAlert').click();
  // the filter keeps the whole set (3 parts), not the unrelated relay
  const view = page.viewportSize().width < 768 ? '#cardList .inv-card' : '#tableBody tr';
  await expect(page.locator(view)).toHaveCount(3);
  const chip = page.locator(`${view} .set-chip`).first();
  await expect(chip).toContainText('FR-S01');
  await expect(chip.locator('.set-chip-n')).toHaveText('3');
  expect(await chip.innerText()).not.toContain('ชุด FR');   // the link icon says "set"; no ชุด prefix
  await expect(chip).toHaveClass(/gap/);
  await chip.click();
  await expect(page.locator('#setModal')).toBeVisible();
  await expect(page.locator('#setModal .set-row')).toHaveCount(3);
  await expect(page.locator('#setModal .set-gap-banner')).toContainText('OP-88893');
  await expect(page.locator('#setModal .set-row.out')).toHaveCount(1);
  expect(await h.noHorizontalScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('ราคาเป็นชุด writes each share with COST_SOURCE = set', async ({ page, context }) => {
  const { errors, patches, sent } = await setup(page, context);
  await page.evaluate(() => openSetGroup('FR-S01'));
  await page.locator('#setModal [data-set-price]').click();
  await expect(page.locator('#setSaveBtn')).toBeDisabled();
  await page.fill('#setTotal', '22,000');
  const w = (id) => page.locator(`#setModal [data-split-row="${id}"] [data-split-w]`);
  await w('s1').fill('20000');
  await w('s2').fill('1500');
  await expect(page.locator('#setSplitSum')).toContainText('SPFL-C-0804');   // missing stand-alone price is named
  await w('s3').fill('2000');
  await expect(page.locator('#setSplitSum')).toHaveClass(/ok/);
  expect(await h.noHorizontalScroll(page)).toBe(true);
  await page.locator('#setSaveBtn').click();
  await expect.poll(() => patches.length).toBe(3);
  const cost = Object.fromEntries(patches.map((p) => [p.id, p.body]));
  expect(cost.s1.COST).toBe('18723.4');
  expect(cost.s2.COST).toBe('1404.26');
  expect(cost.s3.COST).toBe('1872.34');
  for (const p of patches) expect(p.body.COST_SOURCE).toBe('set');
  await expect.poll(() => sent.logPosts.length).toBe(3);
  expect([].concat(sent.logPosts[0])[0].msg).toContain('กรอกราคาจากชุด FR-S01');
  // back on the list, the shares carry the "แบ่งจากชุด" mark
  await expect(page.locator('#setModal .set-cost-mark')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('equal split needs no stand-alone prices', async ({ page, context }) => {
  const { patches } = await setup(page, context);
  await page.evaluate(() => openSetGroup('FR-S01', 'price'));
  await page.fill('#setTotal', '300');
  await page.locator('#setModal [data-set-mode="equal"]').click();
  await expect(page.locator('#setModal [data-split-w]').first()).toBeDisabled();
  await page.locator(`#setModal [data-split-row="s3"] [data-split-inc]`).uncheck();   // the cable was not in this purchase
  await page.locator('#setSaveBtn').click();
  await expect.poll(() => patches.length).toBe(2);
  expect(patches.map((p) => p.body.COST).sort()).toEqual(['150', '150']);
});

test('withdrawing one part offers the rest of the set', async ({ page, context }) => {
  const { sent, errors } = await setup(page, context, ROWS.map((r) => (r.id === 's3' ? { ...r, Actual: '2' } : r)));
  await page.locator('.home-action-card.card-out').click();
  await page.fill('#qaSearch', 'SPFL-C-0801');
  await page.evaluate(() => qaSearchInput());
  await page.locator('.qa-item[data-id="s1"]').click();
  await expect(page.locator('#qaSetHint')).toBeVisible();
  await expect(page.locator('#qaSetHint')).toContainText('ใช้คู่กับ');
  await expect(page.locator('#qaSetHint')).toContainText('FR-SB31A');
  await expect(page.locator('#qaSetHint')).toContainText('OP-88893');
  await page.locator('#qaConfirmBtn').click();
  await page.locator('#confirmFinalBtn').click();
  await expect.poll(() => sent.rpc.length).toBe(1);
  const next = page.locator('#txActions button', { hasText: 'เบิก OP-88893 ต่อ' });
  await expect(next).toBeVisible();
  await next.click();
  await expect(page.locator('#txOverlay')).toBeHidden();
  await expect(page.locator('#qtyPanel')).toHaveClass(/visible/);
  await expect(page.locator('#qtyItemMeta')).toContainText('SPFL-C-0804');
  expect(errors).toEqual([]);
});

test('receive shows no set prompt, and a part outside any set shows no chip', async ({ page, context }) => {
  const { errors } = await setup(page, context);
  await page.evaluate(() => openAdjust('s1', 'in'));
  await expect(page.locator('#adjSetHint')).toBeHidden();
  await page.evaluate(() => setAdjustMode('out'));
  await expect(page.locator('#adjSetHint')).toContainText('ชุดไม่ครบ');
  await page.evaluate(() => closeModal('adjustModal'));
  await page.evaluate(() => openDetail('x1'));
  await expect(page.locator('#detailBody .set-chip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('editing an item keeps a set share unless the price is changed', async ({ page, context }) => {
  const rows = ROWS.map((r) => (r.id === 's2' ? { ...r, COST: '1404.26', COST_SOURCE: 'set' } : r));
  const { patches } = await setup(page, context, rows);
  await page.evaluate(() => openEdit('s2'));
  await expect(page.locator('#f_setgroup')).toHaveValue('FR-S01');
  await expect(page.locator('#f_cost_set_note')).toBeVisible();
  await page.fill('#f_vendor', 'ABC');
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].body.COST_SOURCE).toBe('set');
  expect(patches[0].body['Set Group']).toBe('FR-S01');
});

test('pages work before the Set Group column exists', async ({ page, context }) => {
  const old = h.DEFAULT_ROWS;
  const errors = h.watchErrors(page);
  await h.mockBackend(context, { role: 'staff', rows: old });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  await expect(page.locator('#homeSetAlert')).toBeHidden();
  await page.evaluate(() => openEdit('a1'));
  await expect(page.locator('#f_setgroup_wrap')).toBeHidden();
  expect(errors).toEqual([]);
});

test('edit form: pick the parts used together instead of typing a set name', async ({ page, context }) => {
  // nothing is in a set yet
  const rows = ROWS.map((r) => ({ ...r, 'Set Group': null }));
  const { patches, sent, errors } = await setup(page, context, rows);
  await page.evaluate(() => openEdit('s1'));
  await expect(page.locator('#f_setgroup')).toHaveValue('');
  await page.fill('#f_setlink_q', 'op-888');
  const hits = page.locator('#f_setlink_results .set-link-hit');
  await expect(hits).toHaveCount(1);
  await expect(hits.first()).toContainText('SPFL-C-0804');
  await hits.first().click();
  // the set is named after this part's model, and the picked part waits to be linked on save
  await expect(page.locator('#f_setgroup')).toHaveValue('FR-S01');
  await expect(page.locator('#f_setlink_chips .set-link-chip.new')).toHaveCount(1);
  await page.fill('#f_setlink_q', 'support');   // a second part, found by its description
  await page.keyboard.press('Enter');
  await expect(page.locator('#f_setlink_chips .set-link-chip.new')).toHaveCount(2);
  expect(await h.noHorizontalScroll(page)).toBe(true);
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(3);
  const byId = Object.fromEntries(patches.map((p) => [p.id, p.body['Set Group']]));
  expect(byId).toEqual({ s1: 'FR-S01', s2: 'FR-S01', s3: 'FR-S01' });
  await expect.poll(() => sent.logPosts.length).toBe(3);   // the edit + one "เพิ่มเข้าชุด" per linked part
  expect(errors).toEqual([]);
});

test('picking a part that is already in a set joins that set', async ({ page, context }) => {
  const rows = ROWS.map((r) => (r.id === 's1' ? { ...r, 'Set Group': null } : r));
  const { patches } = await setup(page, context, rows);
  await page.evaluate(() => openEdit('s1'));
  await page.fill('#f_setlink_q', 'SPFL-C-0802');
  await page.locator('#f_setlink_results .set-link-hit').first().click();
  await expect(page.locator('#f_setgroup')).toHaveValue('FR-S01');
  await expect(page.locator('#f_setlink_chips .set-link-chip.new')).toHaveCount(0);   // already in that set
  await expect(page.locator('#f_setlink_chips .set-link-chip')).toHaveCount(2);       // 0802 and 0804
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].body['Set Group']).toBe('FR-S01');
});

test('renaming a set: clearing the name keeps the parts, and the new name goes to all of them', async ({ page, context }) => {
  const { patches, errors } = await setup(page, context);
  await page.evaluate(() => openEdit('s1'));
  await expect(page.locator('#f_setlink_chips .set-link-chip')).toHaveCount(2);
  await page.fill('#f_setgroup', '');                      // cleared to type a new name
  await expect(page.locator('#f_setlink_chips .set-link-chip')).toHaveCount(2);   // nothing lost
  // saving with no name is refused rather than silently dropping the set
  await page.evaluate(() => saveItem());
  await expect(page.locator('#f_setgroup_help')).toContainText('ใส่ชื่อชุด');
  expect(patches.length).toBe(0);
  await page.locator('#f_setgroup').pressSequentially('LEVEL-1');
  await expect(page.locator('#f_setgroup_help')).toContainText('ทั้ง 3 รายการ');
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(3);
  expect(Object.fromEntries(patches.map((p) => [p.id, p.body['Set Group']]))).toEqual({ s1: 'LEVEL-1', s2: 'LEVEL-1', s3: 'LEVEL-1' });
  expect(errors).toEqual([]);
});

test('✕ takes one part out of the set; "เอารายการนี้ออกจากชุด" takes only this part out', async ({ page, context }) => {
  const { patches } = await setup(page, context);
  await page.evaluate(() => openEdit('s1'));
  await page.locator('#f_setlink_chips [data-setlink-drop="s3"]').click();
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(2);
  const a = Object.fromEntries(patches.map((p) => [p.id, p.body['Set Group']]));
  expect(a).toEqual({ s1: 'FR-S01', s3: null });
  await page.evaluate(() => { document.getElementById('txOverlay').hidden = true; });
  patches.length = 0;
  await page.evaluate(() => openEdit('s2'));
  await page.locator('#f_setlink_chips .set-link-leave').click();
  await expect(page.locator('#f_setgroup')).toHaveValue('');
  await page.evaluate(() => saveItem());
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toMatchObject({ id: 's2', body: { 'Set Group': null } });
});

test('inventory page: tick parts and create a set', async ({ page, context }) => {
  const rows = ROWS.map((r) => ({ ...r, 'Set Group': null }));
  const { patches, sent, errors } = await setup(page, context, rows);
  await page.evaluate(() => goInventory());
  await page.locator('#setSelectBtn').click();
  await expect(page.locator('#setSelectBar')).toBeVisible();
  await expect(page.locator('#setSelectGo')).toBeDisabled();
  const phone = page.viewportSize().width < 768;
  const row = (id) => page.locator(phone ? `#cardList [data-set-sel="${id}"]` : `#tableBody [data-set-sel="${id}"]`);
  await row('s1').click();
  await expect(page.locator('#editModal')).toBeHidden();   // a tap ticks, it does not open the part
  await expect(page.locator('#setSelectGo')).toBeDisabled();
  await row('s2').click();
  await row('s3').click();
  await row('x1').click();
  await row('x1').click();                                  // untick
  await expect(page.locator('#setSelectCount')).toContainText('3 รายการ');
  expect(await h.noHorizontalScroll(page)).toBe(true);
  await page.locator('#setSelectGo').click();
  await expect(page.locator('#setCreateName')).toHaveValue('FR-S01');   // first ticked part's model
  await page.locator('#setCreateSave').click();
  await expect.poll(() => patches.length).toBe(3);
  expect(Object.fromEntries(patches.map((p) => [p.id, p.body['Set Group']]))).toEqual({ s1: 'FR-S01', s2: 'FR-S01', s3: 'FR-S01' });
  await expect.poll(() => sent.logPosts.length).toBe(3);
  await expect(page.locator('#setSelectBar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a part in a set has a table row no taller than one outside a set', async ({ page, context }) => {
  test.skip(page.viewportSize().width < 768, 'the table is the desktop view');
  await setup(page, context);
  await page.evaluate(() => goInventory());
  const h1 = await page.locator('#tableBody tr[data-set-sel="s1"]').evaluate((e) => e.getBoundingClientRect().height);
  const h2 = await page.locator('#tableBody tr[data-set-sel="x1"]').evaluate((e) => e.getBoundingClientRect().height);
  await expect(page.locator('#tableBody tr[data-set-sel="s1"] .set-chip.compact')).toBeVisible();
  expect(Math.abs(h1 - h2)).toBeLessThanOrEqual(2);
});

test('a set named ชุด... is not shown as ชุด ชุด...', async ({ page, context }) => {
  const rows = ROWS.map((r) => (r['Set Group'] ? { ...r, 'Set Group': 'ชุดเซ็นเซอร์' } : r));
  await setup(page, context, rows);
  await page.evaluate(() => openSetGroup('ชุดเซ็นเซอร์'));
  await expect(page.locator('#setModalTitle')).toHaveText(/^\s*ชุดเซ็นเซอร์\s*$/);
});
