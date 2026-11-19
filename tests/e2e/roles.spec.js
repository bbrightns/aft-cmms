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
