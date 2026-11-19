// Builds vendor/ from the exact versions in package-lock.json, so the pages load no script or font from a CDN.
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

  // Fonts: Google Sans for Thai and Latin text (weights 400-700), Google Sans Code for IDs and numbers.
  // Variable files cover every weight in one download per script.
  const FONTS = [
    { family: 'Google Sans', pkg: '@fontsource-variable/google-sans', file: 'google-sans-latin-wght-normal.woff2', weight: '400 700' },
    { family: 'Google Sans', pkg: '@fontsource-variable/google-sans', file: 'google-sans-latin-ext-wght-normal.woff2', weight: '400 700' },
    { family: 'Google Sans', pkg: '@fontsource-variable/google-sans', file: 'google-sans-thai-wght-normal.woff2', weight: '400 700' },
    { family: 'Google Sans Code', pkg: '@fontsource-variable/google-sans-code', file: 'google-sans-code-latin-wght-normal.woff2', weight: '300 800' },
    { family: 'Google Sans Code', pkg: '@fontsource-variable/google-sans-code', file: 'google-sans-code-latin-ext-wght-normal.woff2', weight: '300 800' },
  ];
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  const faces = FONTS.map((f) => {
    // take the unicode-range from the package's own CSS, so each file is only downloaded for the characters it has
    const css = fs.readdirSync(mod(f.pkg)).filter((n) => n.endsWith('.css')).map((n) => fs.readFileSync(mod(`${f.pkg}/${n}`), 'utf8')).join('\n');
    const block = css.split('@font-face').find((b) => b.includes(`/${f.file}`));
    const range = block && /unicode-range:\s*([^;]+);/.exec(block);
    if (!range) throw new Error(`no @font-face for ${f.file} in ${f.pkg}`);
    const name = `${f.file.replace('.woff2', '')}-${version(f.pkg)}.woff2`;
    fs.copyFileSync(mod(`${f.pkg}/files/${f.file}`), path.join(OUT, 'fonts', name));
    made.push(`fonts/${name}`);
    return `@font-face {\n  font-family: '${f.family}';\n  font-style: normal;\n  font-display: swap;\n  font-weight: ${f.weight};\n  src: url('${name}') format('woff2');\n  unicode-range: ${range[1].trim()};\n}`;
  });
  fs.writeFileSync(path.join(OUT, 'fonts', 'fonts.css'),
    '/* Built by scripts/build-vendor.js from Fontsource packages (same font files as Google Fonts). Do not edit. */\n' + faces.join('\n') + '\n');
  made.push('fonts/fonts.css');

  for (const [pkg, file] of [['@supabase/supabase-js', 'LICENSE'], ['lucide', 'LICENSE'], ['html5-qrcode', 'LICENSE'], ['qrcodejs', 'LICENSE'],
    ['@fontsource-variable/google-sans', 'LICENSE'], ['@fontsource-variable/google-sans-code', 'LICENSE']]) {
    const src = mod(`${pkg}/${file}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, 'licenses', `${pkg.replace('/', '__')}.txt`));
  }
  console.log('vendor/:\n  ' + made.join('\n  '));
})().catch((e) => { console.error(e); process.exit(1); });
