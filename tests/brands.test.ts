// tests/brands.test.ts (integration): brand handling (SPEC §11, REQ-BRD-01..04, REQ-NPC-03 / 04).
// The forbidden list is derived from src/data/brands.ts and SPEC.md at run time, so this file never
// spells a real name. The bundle-level proof is scripts/check-parody.mjs on dist/.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND_MODE, BRANDS, stickerSheetLabel } from '../src/data/brands';
import { bannedFranchiseNames, BRANDS_FILE, forbiddenTerms, realNames, ROOT, scanFiles, walk } from '../scripts/lib/brandScan.mjs';

const EM_DASH = String.fromCharCode(0x2014);

describe('brand table', () => {
  it('tests and the default build run in parody mode', () => {
    expect(BRAND_MODE).toBe('parody');
    expect(BRANDS.specialSlideName).toBe('VIDA Slide');
    expect(BRANDS.companies.labA.name).toBe('North Star');
    expect(BRANDS.companies.labB.name).toBe('Canticle');
    expect(BRANDS.companies.chip.name).toBe('Vidia');
    expect(BRANDS.macguffins.secret_laptop.name).toBe('North Star Laptop');
    expect(BRANDS.macguffins.secret_drive.name).toBe('Canticle Weights Drive');
    expect(BRANDS.npcs.sam.title).toBe('Sam, lab director at North Star');
    expect(BRANDS.npcs.dario.title).toBe('Dario, safety lead at Canticle');
    expect(stickerSheetLabel('labA')).toBe('North Star');
  });

  it('REQ-NPC-04: no em dash in any NPC line, toast, splash or name', () => {
    const texts: string[] = [];
    for (const n of Object.values(BRANDS.npcs)) texts.push(n.name, n.title, n.line, n.toast);
    for (const m of Object.values(BRANDS.macguffins)) texts.push(m.name, m.splash);
    for (const t of texts) expect(t.includes(EM_DASH), t).toBe(false);
  });

  it('the scan lists are derived from brands.ts and SPEC.md', () => {
    const real = realNames();
    expect(real.length).toBeGreaterThanOrEqual(10);
    // Shared lines (identical in both modes) are not treated as names.
    expect(real).not.toContain(BRANDS.npcs.sam.line);
    expect(real).not.toContain('Sam');
    expect(bannedFranchiseNames().length).toBe(6);
  });
});

describe('brand mode fallback (brands.ts: anything but the literal "real" is parody)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const modeWith = async (value: string | undefined): Promise<{ mode: string; table: unknown }> => {
    if (value === undefined) vi.stubEnv('VITE_BRAND_MODE', undefined as unknown as string);
    else vi.stubEnv('VITE_BRAND_MODE', value);
    vi.resetModules();
    const m = await import('../src/data/brands');
    return { mode: m.BRAND_MODE, table: m.BRANDS };
  };

  it('unset, empty, "Real" or any other value builds the parody table; only "real" switches', async () => {
    for (const v of [undefined, '', 'Real', 'REAL', 'x', 'parody']) {
      const r = await modeWith(v);
      expect(r.mode, String(v)).toBe('parody');
      expect(r.table, String(v)).toEqual(BRANDS);
    }
    // Control: the stub reaches the module (otherwise the loop above proves nothing).
    const real = await modeWith('real');
    expect(real.mode).toBe('real');
    expect(real.table).not.toEqual(BRANDS);
  });
});

describe('REQ-BRD-01: real names live only in src/data/brands.ts', () => {
  it('no other source, test, harness, script or architecture file contains a forbidden term', () => {
    const dirs = ['src', 'tests', 'dev', 'e2e', 'scripts'].map((d) => join(ROOT, d));
    const files = dirs.flatMap((d) => walk(d)).filter((f) => f !== BRANDS_FILE);
    for (const single of ['index.html', 'ARCHITECTURE.md', 'package.json', '.env', '.env.private']) {
      const p = join(ROOT, single);
      if (existsSync(p)) files.push(p);
    }
    expect(files.length).toBeGreaterThan(40);
    const hits = scanFiles(files, forbiddenTerms());
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});
