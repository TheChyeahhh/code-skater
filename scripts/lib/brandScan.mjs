// scripts/lib/brandScan.mjs (integration): the forbidden-string list, derived at run time so no
// file other than src/data/brands.ts ever has to spell a real name (AGENTS.md, REQ-BRD-01, REQ-BRD-04).
// - Real names: every string literal between "@brand-real-begin" and "@brand-real-end" in
//   src/data/brands.ts that does not also appear in the parody block (shared lines such as the NPC
//   dialog are identical in both modes and therefore not names).
// - Banned franchise names: SPEC.md §1 rule 8, the list after "Never use:" up to "licensed".
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const BRANDS_FILE = join(ROOT, 'src', 'data', 'brands.ts');
const SPEC_FILE = join(ROOT, 'SPEC.md');

const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;

function block(source, name) {
  const begin = source.indexOf(`@brand-${name}-begin`);
  const end = source.indexOf(`@brand-${name}-end`);
  if (begin < 0 || end < 0 || end < begin) throw new Error(`brands.ts: missing @brand-${name}-begin / -end markers`);
  return source.slice(begin, end);
}

function literals(text) {
  const out = new Set();
  for (const m of text.matchAll(STRING_LITERAL)) {
    const value = (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1').trim();
    if (value.length >= 3) out.add(value);
  }
  return out;
}

/** Real-mode strings that must never reach a parody build or any other source file. */
export function realNames() {
  const source = readFileSync(BRANDS_FILE, 'utf8');
  const parody = literals(block(source, 'parody'));
  const real = [...literals(block(source, 'real'))].filter((s) => !parody.has(s));
  if (real.length === 0) throw new Error('brands.ts: no real-mode strings found between the markers');
  return real;
}

/** SPEC §1 rule 8 "Never use:" names. */
export function bannedFranchiseNames() {
  const spec = readFileSync(SPEC_FILE, 'utf8');
  const line = spec.split(/\r?\n/).find((l) => /^8\.\s/.test(l.trim()) && l.includes('Never use:'));
  if (!line) throw new Error('SPEC.md: rule 8 "Never use:" line not found');
  const list = line.slice(line.indexOf('Never use:') + 'Never use:'.length);
  const names = [];
  for (const raw of list.split(',')) {
    const item = raw.trim().replace(/\.$/, '');
    if (!item || /^licensed/i.test(item) || /^or /i.test(item)) break;
    names.push(item);
  }
  if (names.length === 0) throw new Error('SPEC.md: rule 8 list is empty');
  return names;
}

export function forbiddenTerms() {
  return [...new Set([...realNames(), ...bannedFranchiseNames()])];
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.mts', '.cts', '.css', '.html', '.json', '.txt', '.svg', '.map', '.webmanifest', '.ts', '.md', '.xml']);

export function walk(dir, skipDirs = new Set(['node_modules', '.git'])) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!skipDirs.has(name)) out.push(...walk(full, skipDirs));
    } else if (TEXT_EXT.has(extname(name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** Case-insensitive substring hits of `terms` in `files`. */
export function scanFiles(files, terms) {
  const hits = [];
  const lowered = terms.map((t) => [t, t.toLowerCase()]);
  for (const file of files) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const [term, low] of lowered) {
      const at = text.indexOf(low);
      if (at >= 0) {
        const context = text.slice(Math.max(0, at - 40), at + low.length + 40).replace(/\s+/g, ' ');
        hits.push({ file: relative(ROOT, file), term, context });
      }
    }
  }
  return hits;
}
