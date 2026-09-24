// scripts/zip.mjs (integration): package dist/ as code-skater-web.zip for an itch.io HTML5 upload
// (REQ-DEP-02, SPEC §12). index.html sits at the zip root, as itch.io requires.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { ROOT } from './lib/brandScan.mjs';

const dist = join(ROOT, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('zip: dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

function allFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

const entries = {};
for (const file of allFiles(dist)) {
  entries[relative(dist, file).replace(/\\/g, '/')] = new Uint8Array(readFileSync(file));
}
const zipped = zipSync(entries, { level: 9 });
const out = join(ROOT, 'code-skater-web.zip');
writeFileSync(out, zipped);
console.log(`zip: wrote ${relative(ROOT, out)} (${Object.keys(entries).length} files, ${(zipped.length / 1024).toFixed(1)} KB)`);
