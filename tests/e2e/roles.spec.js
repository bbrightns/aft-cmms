// Viewer / Staff / Admin (and Guest): every write entry point must say "no" with the reason before a form opens.
// The database enforces the same rules (tests/db); these tests check what people see.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// try a page action; returns 'open' or the toast text
async function attempt(page, call, modalId) {
  await h.clearToasts(page);
  await page.evaluate((c) => (0, eval)(c), call);
  await page.waitForTimeout(250);
  const target = page.locator(modalId ? `#${modalId}` : '#pageAction');
  const open = await target.isVisible();
  if (modalId) await page.evaluate((id) => { document.getElementById(id).style.display = 'none'; }, modalId);
  await page.evaluate(() => window.goHome && window.goHome());
  return open ? 'open' : await h.toastText(page);
}

const CASES = [
  { name: 'viewer', opts: { role: 'viewer' }, label: 'Viewer', withdraw: /Viewer/, edit: /Viewer/, del: /Viewer/, admin: false },
  { name: 'staff', opts: { role: 'staff' }, label: 'Staff', withdraw: 'open', edit: 'open', del: /Staff จึงลบรายการไม่ได้/, admin: false },
  { name: 'admin', opts: { role: 'admin' }, label: 'Admin', withdraw: 'open', edit: 'open', del: 'open', admin: true },
  { name: 'guest', opts: { who: 'guest' }, label: 'Guest', withdraw: /Guest ดูข้อมูลได้อย่างเดียว/, edit: /Guest/, del: /Guest/, admin: false },
  { name: 'role lookup fails (treated as viewer)', opts: { role: 'admin', roleFails: true }, label: 'Viewer', withdraw: /Viewer/, edit: /Viewer/, del: /Viewer/, admin: false },
];

for (const c of CASES) {
  test(`store as ${c.name}`, async ({ page, context }) => {
    const errors = h.watchErrors(page);
    await h.mockBackend(context, { who: 'user', ...c.opts });
    await h.openStore(page);
    await h.waitForStockLoaded(page);
    await expect(page.locator('#profileRole')).toHaveText(c.label);
    await expect(page.locator('#homeSettingsBtn')).toBeVisible({ visible: c.admin });

    const check = (got, want) => (want === 'open' ? expect(got).toBe('open') : expect(got).toMatch(want));
    check(await attempt(page, "goAction('out')"), c.withdraw);
    check(await attempt(page, "openEdit('a1')", 'editModal'), c.edit);
    check(await attempt(page, "openAddModal()", 'editModal'), c.edit);
    check(await attempt(page, "openDelete('a1')", 'deleteModal'), c.del);
    const settings = await attempt(page, 'openSettings()', 'settingsModal');
    if (c.admin) expect(settings).toBe('open'); else expect(settings).toMatch(/เฉพาะ Admin/);
    expect(await h.noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('admin manages roles in the app', async ({ page, context }) => {
  const sent = await h.mockBackend(context, {
    role: 'admin',
    failRoleFor: 'nid@gmail.com',
    users: [
      { user_email: 'me@gmail.com', user_name: 'Me', last_sign_in: new Date().toISOString(), user_role: 'admin' },
      { user_email: 'somchai@gmail.com', user_name: 'Somchai <b>x</b>', last_sign_in: new Date().toISOString(), user_role: 'viewer' },
      { user_email: 'nid@gmail.com', user_name: '', last_sign_in: null, user_role: 'staff' },
    ],
  });
  await h.openStore(page);
  await expect(page.locator('#profileRole')).toHaveText('Admin');
  await page.evaluate(() => openUsersModal());
  await expect(page.locator('.user-row')).toHaveCount(3);
  await expect(page.locator('.user-role-select[data-email="me@gmail.com"]')).toBeDisabled();   // never your own role
  await expect(page.locator('#usersList b')).toHaveCount(0);   // names are text, not HTML
  // the e-mail must stay readable on a phone: the dropdown may not squeeze it to one letter per line
  const info = await page.locator('.user-row .user-info').first().boundingBox();
  expect(info.width).toBeGreaterThan(120);

  await page.selectOption('.user-role-select[data-email="somchai@gmail.com"]', 'staff');
  await expect.poll(() => sent.rpc.find((x) => x.fn === 'set_user_role')?.body).toEqual({ target_email: 'somchai@gmail.com', new_role: 'staff' });
  await expect(page.locator('#toastContainer')).toContainText('somchai@gmail.com เป็น Staff แล้ว');

  await page.selectOption('.user-role-select[data-email="nid@gmail.com"]', 'admin');   // the server refuses this one
  await expect(page.locator('#toastContainer')).toContainText('เปลี่ยนสิทธิ์ไม่สำเร็จ');
  await expect(page.locator('.user-role-select[data-email="nid@gmail.com"]')).toHaveValue('staff');   // put back

  await page.fill('#usersFilter', 'somchai');
  await expect(page.locator('.user-row')).toHaveCount(1);
  expect(await h.noHorizontalScroll(page)).toBe(true);
});

const PR = [{ id: 'p1', 'PR No.': '1001', 'PR Title': 'Bearings', Status: 'Open', Items: [] }];
const PR_CASES = [
  { role: 'viewer', create: false, importBtn: false, del: false },
  { role: 'staff', create: true, importBtn: false, del: false },
  { role: 'admin', create: true, importBtn: true, del: true },
];
for (const c of PR_CASES) {
  test(`purchase requests as ${c.role}`, async ({ page, context }) => {
    const errors = h.watchErrors(page);
    await h.mockBackend(context, { role: c.role, prs: PR });
    await page.goto('/pr.html');
    await expect(page.locator('#loadingOverlay')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#hdrNew')).toBeVisible({ visible: c.create });
    await expect(page.locator('#hdrImport')).toBeVisible({ visible: c.importBtn });
    await page.evaluate(() => openDetail('p1'));
    await expect(page.locator('#deletePRBtn')).toBeVisible({ visible: c.del });
    await expect(page.locator('#prDuplicateBtn')).toBeVisible({ visible: c.create });
    await page.evaluate(() => closeDetailModal());
    await page.evaluate(() => openCreateModal());
    if (c.create) await expect(page.locator('#createModal')).toBeVisible();
    else await expect(page.locator('#toastContainer')).toContainText(`Your account is ${c.role[0].toUpperCase()}${c.role.slice(1)}`);
    expect(await h.noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

// What a read-only account sees: locked home cards with a note, no write buttons, and no undo it cannot do.
const LOGS = [
  { id: 1, type: 'out', partId: 'SPFL-C-0001', msg: '📤 เบิก 1 pcs', note: '', ts: new Date().toISOString(), user: 'Golf', undo_data: { action: 'out', qty: 1 } },
  { id: 2, type: 'add', partId: 'SPFL-C-0003', msg: '➕ เพิ่มรายการ', note: '', ts: new Date().toISOString(), user: 'Golf', undo_data: { action: 'add', itemId: 'a3' } },
];
const VIEW_CASES = [
  { name: 'viewer', opts: { role: 'viewer' }, locked: true, note: /Viewer ดูข้อมูลได้อย่างเดียว/, adjustBtns: false, delBtns: false, undoOut: false, undoAdd: false },
  { name: 'guest', opts: { who: 'guest' }, locked: true, note: /Guest ดูข้อมูลได้อย่างเดียว/, adjustBtns: false, delBtns: false, undoOut: false, undoAdd: false },
  { name: 'staff', opts: { role: 'staff' }, locked: false, adjustBtns: true, delBtns: false, undoOut: true, undoAdd: false },
  { name: 'admin', opts: { role: 'admin' }, locked: false, adjustBtns: true, delBtns: true, undoOut: true, undoAdd: true },
];
for (const c of VIEW_CASES) {
  test(`what ${c.name} sees: cards, row buttons, undo`, async ({ page, context }, info) => {
    const errors = h.watchErrors(page);
    await h.mockBackend(context, { who: 'user', ...c.opts, logs: LOGS });
    await h.openStore(page);
    await h.waitForStockLoaded(page);
    await expect(page.locator('#profileRole')).toHaveText(c.name === 'guest' ? 'Guest' : c.name[0].toUpperCase() + c.name.slice(1));

    for (const card of await page.locator('.home-action-card').all()) {
      if (c.locked) await expect(card).toHaveClass(/is-locked/); else await expect(card).not.toHaveClass(/is-locked/);
    }
    await expect(page.locator('.home-scan-btn .home-scan-text span')).toHaveText(c.locked ? /เพื่อดูข้อมูล/ : /เลือกเบิกหรือรับ/);
    if (c.note) await expect(page.locator('#homeReadOnlyNote')).toHaveText(c.note);
    else await expect(page.locator('#homeReadOnlyNote')).toBeHidden();

    await page.evaluate(() => goInventory());
    await expect(page.locator('#headerAddBtn')).toBeVisible({ visible: c.adjustBtns });   // staff and admin may add
    const adjustBtns = page.locator('#pageInventory [onclick*="openAdjust("]');
    if (c.adjustBtns) expect(await adjustBtns.count()).toBeGreaterThan(0); else await expect(adjustBtns).toHaveCount(0);
    if (info.project.name === 'desktop') {   // the delete button lives in the desktop table
      const delBtns = page.locator('#pageInventory .btn-icon.del');
      if (c.delBtns) expect(await delBtns.count()).toBeGreaterThan(0); else await expect(delBtns).toHaveCount(0);
    }
    await page.evaluate(() => openDetail('a1'));
    await expect(page.locator('#detailAdjustBtn')).toBeVisible({ visible: c.adjustBtns });
    await expect(page.locator('#detailEditBtn')).toBeVisible({ visible: c.adjustBtns });
    await page.evaluate(() => closeModal('detailModal'));

    await page.evaluate(() => goTransactionLog());
    await expect(page.locator('.lg-row')).toHaveCount(2);
    await expect(page.locator('.lg-undo[data-id="1"]')).toHaveCount(c.undoOut ? 1 : 0);
    await expect(page.locator('.lg-undo[data-id="2"]')).toHaveCount(c.undoAdd ? 1 : 0);   // undoing an add deletes: admin only
    if (c.name === 'staff') {
      await h.clearToasts(page);
      await page.evaluate(() => confirmUndoLog('2'));
      await expect(page.locator('#toastContainer')).toContainText('ทำได้เฉพาะ Admin');
    }
    expect(await h.noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
