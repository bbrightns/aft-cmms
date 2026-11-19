// The pages import supabase-js as one ES module from jsdelivr's "+esm" bundle. Build the same thing from the
// pinned npm package so the tests run offline and against the exact version the pages use.
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

module.exports = async () => {
  const outDir = path.join(__dirname, '..', '.vendor');
  fs.mkdirSync(outDir, { recursive: true });
  const entry = path.join(outDir, 'supabase-entry.mjs');
  fs.writeFileSync(entry, "export * from '@supabase/supabase-js';\n");
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser',
    outfile: path.join(outDir, 'supabase.esm.js'), logLevel: 'warning',
    nodePaths: [path.join(__dirname, '..', '..', 'node_modules')],
  });
};
