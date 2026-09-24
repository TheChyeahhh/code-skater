// scripts/check-parody.mjs (integration): fails if dist/ contains any real-mode brand string from
// src/data/brands.ts or any SPEC §1 rule 8 banned name, case-insensitive (REQ-BRD-04, SPEC §19).
// Run after "npm run build" (the parody build). A private build (npm run build:private) is expected
// to fail this check: that is how we know the brand switch works.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { forbiddenTerms, ROOT, scanFiles, walk } from './lib/brandScan.mjs';

const dist = join(ROOT, 'dist');
if (!existsSync(dist)) {
  console.error('check:parody: dist/ not found. Run "npm run build" first.');
  process.exit(1);
}

// Shipped-build only: the classic series' abbreviation. Source comments may cite the lineage, but a
// public player must never see it (polish round 1: the dev panel's preset names carried it).
const DIST_ONLY_TERMS = ['thps'];
const terms = [...forbiddenTerms(), ...DIST_ONLY_TERMS];
const files = walk(dist);
const hits = scanFiles(files, terms);

console.log(`check:parody: scanned ${files.length} files in dist/ for ${terms.length} forbidden terms.`);
if (hits.length > 0) {
  for (const h of hits) console.error(`  FOUND "${h.term}" in ${h.file}: ...${h.context}...`);
  console.error(`check:parody: FAILED with ${hits.length} hit(s).`);
  process.exit(1);
}
console.log('check:parody: OK, no real brand or banned name in dist/.');
