// Shared test setup: serves the CDN libraries from node_modules and answers the Supabase API from memory.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const file = (p) => fs.readFileSync(path.join(ROOT, p));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = Math.floor(Date.now() / 1000) + 86400;
const USER = {
  id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'me@gmail.com', user_metadata: { display_name: 'Me' },
};
// a stored session supabase-js accepts without calling the network
const SESSION = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: EXP })}.sig`,
  refresh_token: 'r', expires_at: EXP, expires_in: 86400, token_type: 'bearer', user: USER,
};

const DEFAULT_ROWS = [
  { id: 'a1', 'Part ID': 'SPFL-C-0001', Brand: 'OMRON', Model: 'LY4N', Description: 'Relay', Actual: '5', Min: '2', Location: 'A', Position: '1', 'Sub Category': 'Relay', COST: '120' },
  { id: 'a2', 'Part ID': 'SPFL-C-0002', Brand: 'SMC', Model: 'VQ110', Description: 'Valve', Actual: '1', Min: '3', Location: 'B', Position: '2', 'Sub Category': 'Valve', COST: '' },
  { id: 'a3', 'Part ID': 'SPFL-C-0003', Brand: 'FESTO', Model: 'DSNU', Description: 'Cylinder', Actual: '0', Min: '', Location: 'C', Position: '3', 'Sub Category': 'Cyl', COST: '900' },
];

/**
 * Mock everything the pages talk to. Call before page.goto().
 * opts.who:   'user' (signed in) | 'guest' | 'none'
 * opts.role:  what my_role returns ('viewer' | 'staff' | 'admin'); opts.roleFails makes my_role error
 * opts.cdn:   'ok' | 'blocked'  (supabase-js on cdn.jsdelivr.net)
 * opts.db:    'ok' | 'hang' | 'error'  (inventory requests)
 * Returns a log of what the page sent: { rpc: [{fn, body}], logPosts: [] } and a `state` object tests may change.
 */
async function mockBackend(context, opts = {}) {
  const state = { db: 'ok', ...opts };
  const sent = { rpc: [], logPosts: [], state };
  const rows = opts.rows || DEFAULT_ROWS;

  await context.route('**/cdn.jsdelivr.net/**', (r) => (state.cdn === 'blocked'
    ? r.abort('blockedbyclient')
    : r.fulfill({ contentType: 'application/javascript', body: file('tests/.vendor/supabase.esm.js') })));
  await context.route('**/unpkg.com/lucide@*/**', (r) => r.fulfill({ contentType: 'application/javascript', body: file('node_modules/lucide/dist/umd/lucide.js') }));
  await context.route('**/unpkg.com/html5-qrcode@*', (r) => r.fulfill({ contentType: 'application/javascript', body: file('node_modules/html5-qrcode/html5-qrcode.min.js') }));
  await context.route('**/cdnjs.cloudflare.com/ajax/libs/qrcodejs/**', (r) => r.fulfill({ contentType: 'application/javascript', body: file('node_modules/qrcodejs/qrcode.min.js') }));
  await context.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await context.route('**/*.supabase.co/**', (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const method = req.method();
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.split('/').pop();
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { /* no body */ }
      if (fn === 'my_role') return state.roleFails ? json({ message: 'function my_role() does not exist' }, 404) : json(state.role || 'viewer');
      sent.rpc.push({ fn, body });
      if (fn === 'list_app_users') return json(state.users || []);
      if (fn === 'set_user_role') return body.target_email === state.failRoleFor ? json({ message: 'NOT_ALLOWED' }, 400) : json(body.new_role);
      return json(4);
    }
    if (u.pathname === '/rest/v1/inventory' && method === 'GET') {
      if (state.db === 'hang') return undefined;   // never answer
      if (state.db === 'error') return json({ message: 'boom' }, 500);
      const from = Number((req.headers().range || '0-').split('-')[0]) || 0;
      return json(from ? [] : rows);
    }
    if (u.pathname === '/rest/v1/logs' && method === 'POST') { sent.logPosts.push(req.postDataJSON()); return json([], 201); }
    if (u.pathname === '/rest/v1/logs' && method === 'GET') {
      // the plain list gets the logs; a filtered query (e.g. "was log #77 already undone?") finds nothing
      const filtered = [...u.searchParams.keys()].some((k) => !['select', 'order', 'limit', 'offset'].includes(k));
      return json(filtered ? [] : (state.logs || []));
    }
    if (u.pathname === '/rest/v1/pr_records' && method === 'GET') {
      const from = Number((req.headers().range || '0-').split('-')[0]) || 0;
      return json(from ? [] : (state.prs || []));
    }
    if (u.pathname === '/auth/v1/user') return json(USER);
    if (u.pathname.startsWith('/auth/v1/authorize')) return r.fulfill({ contentType: 'text/html', body: '<h1>authorize</h1>' });
    return json(method === 'GET' ? [] : {}, method === 'GET' ? 200 : 201);
  });

  await context.addInitScript(([who, session]) => {
    try {
      localStorage.clear();
      if (who === 'guest') localStorage.setItem('isGuest', 'true');
      if (who === 'user') localStorage.setItem('sb-crlxeaighpfgsduqccdg-auth-token', JSON.stringify(session));
      localStorage.setItem('storeUserName', 'Me');
    } catch (e) { /* storage blocked */ }
  }, [opts.who || 'user', SESSION]);
  return sent;
}

// collect uncaught page errors; tests assert the list stays empty
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function openStore(page) {
  await page.goto('/store.html');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loadingOverlay')).display === 'none');
}

async function waitForStockLoaded(page) {
  await page.waitForFunction(() => /\d/.test(document.querySelector('#homeStats .home-stat-val')?.textContent || ''));
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function toastText(page) {
  return (await page.locator('#toastContainer').innerText()).replace(/\s+/g, ' ').trim();
}

async function clearToasts(page) {
  await page.evaluate(() => { document.getElementById('toastContainer').innerHTML = ''; });
}

module.exports = { mockBackend, watchErrors, openStore, waitForStockLoaded, noHorizontalScroll, toastText, clearToasts, DEFAULT_ROWS, USER };
