// scripts/check-size.mjs (integration): gzip every JS chunk in dist/, print each, and fail when the
// total exceeds TUNING.JS_GZIP_MAX_KB (1500 KB, 1 KB = 1024 bytes; REQ-DEP-04, SPEC §12).
// Also reports the entry chunk (what loads before the start gate) separately.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { TUNING } from '../src/core/tuning.ts';
import { ROOT, walk } from './lib/brandScan.mjs';

const dist = join(ROOT, 'dist');
if (!existsSync(dist)) {
  console.error('check:size: dist/ not found. Run "npm run build" first.');
  process.exit(1);
}

const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : '';
const entryMatch = html.match(/<script[^>]+src="\.?\/?([^"]+\.js)"/);
const entry = entryMatch ? entryMatch[1] : null;

const rows = walk(dist)
  .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  .map((file) => {
    const raw = readFileSync(file);
    const gz = gzipSync(raw, { level: 9 }).length;
    return { file: relative(dist, file).replace(/\\/g, '/'), raw: raw.length, gz };
  })
  .sort((a, b) => b.gz - a.gz);

const kb = (n) => (n / 1024).toFixed(1).padStart(8);
let total = 0;
console.log('check:size: gzipped JS per chunk');
console.log('      raw KB   gzip KB  chunk');
for (const r of rows) {
  total += r.gz;
  const mark = entry && r.file === entry ? '  (entry, before the start gate)' : '';
  console.log(`  ${kb(r.raw)}  ${kb(r.gz)}  ${r.file}${mark}`);
}
const limit = TUNING.JS_GZIP_MAX_KB * 1024;
console.log(`  total gzip: ${(total / 1024).toFixed(1)} KB of ${TUNING.JS_GZIP_MAX_KB} KB allowed`);
if (rows.length === 0) {
  console.error('check:size: no JS files found in dist/.');
  process.exit(1);
}
if (total > limit) {
  console.error('check:size: FAILED, over budget.');
  process.exit(1);
}
console.log('check:size: OK');
