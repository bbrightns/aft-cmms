// Withdraw / receive / undo: one adjust_stock_v3 call that changes the stock AND writes the log row in the same
// transaction. The page must not send a separate log row, and must not send the user's name (the database records it).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const LOGS = [{
  id: 77, type: 'out', partId: 'SPFL-C-0001', msg: '📤 เบิก 2 pcs', note: '', ts: new Date().toISOString(),
  user: 'Golf', user_email: 'golf@gmail.com', undo_data: { action: 'out', qty: 2, partId: 'SPFL-C-0001', itemId: 'a1' },
}];

async function setup(page, context) {
  const errors = h.watchErrors(page);
  const sent = await h.mockBackend(context, { role: 'staff', logs: LOGS });
  await h.openStore(page);
  await h.waitForStockLoaded(page);
  await expect(page.locator('#profileRole')).toHaveText('Staff');
  return { sent, errors };
}
const closeTx = (page) => page.evaluate(() => { const o = document.getElementById('txOverlay'); if (o) o.hidden = true; window.goHome(); });

test('withdraw from the home card', async ({ page, context }) => {
  const { sent, errors } = await setup(page, context);
  await page.locator('.home-action-card.card-out').click();
  await page.fill('#qaSearch', 'SPFL-C-0001');
  await page.evaluate(() => qaSearchInput());
  await page.locator('.qa-item[data-id="a1"]').click();
  await page.fill('#qaNote', 'งาน PM');
  await page.locator('#qaConfirmBtn').click();
  await page.locator('#confirmFinalBtn').click();
  await expect.poll(() => sent.rpc.length).toBe(1);
  const call = sent.rpc[0];
  expect(call.fn).toBe('adjust_stock_v3');
  expect(call.body).toMatchObject({ item_id: 'a1', qty: 1, mode: 'out', log_type: 'out', log_msg: '📤 เบิก 1 pcs', log_note: 'งาน PM' });
  expect(call.body).not.toHaveProperty('user_name');
  expect(sent.logPosts).toEqual([]);
  expect(errors).toEqual([]);
  await closeTx(page);
});

test('receive from the adjust dialog', async ({ page, context }) => {
  const { sent, errors } = await setup(page, context);
  await page.evaluate(() => openAdjust('a1', 'in'));
  await page.evaluate(() => confirmAdjust());
  await expect.poll(() => sent.rpc.length).toBe(1);
  expect(sent.rpc[0].fn).toBe('adjust_stock_v3');
  expect(sent.rpc[0].body).toMatchObject({ mode: 'in', log_type: 'in', log_msg: 'รับ 1 pcs (คงเหลือ {stock})' });
  expect(sent.logPosts).toEqual([]);
  expect(errors).toEqual([]);
});

test('undo a withdrawal', async ({ page, context }) => {
  const { sent, errors } = await setup(page, context);
  await page.evaluate(() => goTransactionLog());
  await expect(page.locator('.lg-who').first()).toHaveAttribute('title', 'golf@gmail.com');
  await page.evaluate(() => confirmUndoLog('77'));
  await expect(page.getByText('บันทึกโดย: Golf · golf@gmail.com')).toBeVisible();
  await page.evaluate(() => executeUndoLog());
  await expect.poll(() => sent.rpc.length).toBe(1);
  expect(sent.rpc[0].fn).toBe('adjust_stock_v3');
  expect(sent.rpc[0].body).toMatchObject({ mode: 'in', log_type: 'in', qty: 2 });
  expect(sent.rpc[0].body.log_undo.undoOf).toBe('77');
  expect(sent.logPosts).toEqual([]);
  expect(errors).toEqual([]);
});
