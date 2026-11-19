// Builds vendor/ from the exact versions in package-lock.json, so the pages load no script from a CDN.
// Run after changing a library version: npm ci && npm run vendor, then update the <script> paths the page
// prints below. CI rebuilds and fails if vendor/ does not match what is committed.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'vendor');
const mod = (p) => path.join(ROOT, 'node_modules', p);
const version = (pkg) => require(mod(`${pkg}/package.json`)).version;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'licenses'), { recursive: true });
  const made = [];
  const copy = (from, name) => { fs.copyFileSync(mod(from), path.join(OUT, name)); made.push(name); };

  // supabase-js: one browser ES module, like jsdelivr's "+esm" build the pages used before
  const sb = `supabase-js-${version('@supabase/supabase-js')}.esm.js`;
  await esbuild.build({
    stdin: { contents: "export * from '@supabase/supabase-js';", resolveDir: ROOT },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true,
    legalComments: 'eof', outfile: path.join(OUT, sb), logLevel: 'warning',
  });
  made.push(sb);

  copy('lucide/dist/umd/lucide.min.js', `lucide-${version('lucide')}.min.js`);
  copy('html5-qrcode/html5-qrcode.min.js', `html5-qrcode-${version('html5-qrcode')}.min.js`);   // the file unpkg served
  copy('qrcodejs/qrcode.min.js', `qrcodejs-${version('qrcodejs')}.min.js`);

  for (const [pkg, file] of [['@supabase/supabase-js', 'LICENSE'], ['lucide', 'LICENSE'], ['html5-qrcode', 'LICENSE'], ['qrcodejs', 'LICENSE']]) {
    const src = mod(`${pkg}/${file}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, 'licenses', `${pkg.replace('/', '__')}.txt`));
  }
  console.log('vendor/:\n  ' + made.join('\n  '));
})().catch((e) => { console.error(e); process.exit(1); });
