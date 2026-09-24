// tests/ownership.test.ts (integration): every file in src/, tests/, dev/, e2e/, scripts/ and the root
// config files has exactly one owner per the ARCHITECTURE.md §6 table (exact path beats glob; all
// matching globs must agree). A file outside every glob fails here: move it into your track's globs.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TRACKS = ['integration', 'input', 'logic', 'levels', 'street', 'woodshed', 'sim', 'render', 'skater', 'fx', 'ui', 'audio'];
const ROOT_FILES = [
  'index.html', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js', 'tsconfig.json',
  'package.json', 'package-lock.json', '.env', '.env.private', '.gitignore', 'ARCHITECTURE.md',
  'DESIGN.md', 'SPEC.md', 'AGENTS.md',
];

interface Rule {
  readonly pattern: string;
  readonly owner: string;
  readonly exact: boolean;
  readonly re: RegExp;
}

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function parseTable(): Rule[] {
  const md = readFileSync(join(ROOT, 'ARCHITECTURE.md'), 'utf8');
  const start = md.indexOf('## 6. Ownership table');
  const end = md.indexOf('\n## ', start + 10);
  expect(start, 'ARCHITECTURE.md must have "## 6. Ownership table"').toBeGreaterThanOrEqual(0);
  const rules: Rule[] = [];
  for (const line of md.slice(start, end < 0 ? undefined : end).split(/\r?\n/)) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const patterns = [...(cells[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
    const owner = cells[2] ?? '';
    for (const pattern of patterns) rules.push({ pattern, owner, exact: !pattern.includes('*'), re: globToRegExp(pattern) });
  }
  return rules;
}

function walkAll(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkAll(full));
    else if (name !== '.gitkeep') out.push(relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

describe('ARCHITECTURE.md ownership table', () => {
  const rules = parseTable();

  it('names only known tracks', () => {
    expect(rules.length).toBeGreaterThan(60);
    for (const r of rules) expect(TRACKS, r.pattern).toContain(r.owner);
  });

  it('gives every file exactly one owner', () => {
    const files = [
      ...['src', 'tests', 'dev', 'e2e', 'scripts'].flatMap((d) => walkAll(join(ROOT, d))),
      ...ROOT_FILES.filter((f) => existsSync(join(ROOT, f))),
    ];
    expect(files.length).toBeGreaterThan(70);
    const problems: string[] = [];
    for (const file of files) {
      const matches = rules.filter((r) => r.re.test(file));
      const exact = matches.filter((r) => r.exact);
      const owners = new Set((exact.length > 0 ? exact : matches).map((r) => r.owner));
      if (owners.size === 0) problems.push(`${file}: no owner`);
      else if (owners.size > 1) problems.push(`${file}: several owners (${[...owners].join(', ')})`);
    }
    expect(problems).toEqual([]);
  });

  it('covers every track entry file named in the task split', () => {
    const owner = (file: string): string | undefined => {
      const m = rules.filter((r) => r.re.test(file));
      const e = m.filter((r) => r.exact);
      return (e.length > 0 ? e : m)[0]?.owner;
    };
    expect(owner('src/sim/scoring.ts')).toBe('logic');
    expect(owner('src/sim/world.ts')).toBe('sim');
    expect(owner('src/sim/types.ts')).toBe('integration');
    expect(owner('src/input/parser.ts')).toBe('input');
    expect(owner('src/input/types.ts')).toBe('integration');
    expect(owner('src/levels/marketStreetShops.ts')).toBe('street');
    expect(owner('src/levels/woodshed.ts')).toBe('woodshed');
    expect(owner('src/render/skater/rig.ts')).toBe('skater');
    expect(owner('src/render/camera.ts')).toBe('fx');
    expect(owner('src/save/storage.ts')).toBe('ui');
    expect(owner('tests/simController.test.ts')).toBe('sim');
    expect(owner('tests/stateMachine.test.ts')).toBe('logic');
    expect(owner('src/core/tuning.ts')).toBe('integration');
    expect(owner('src/core/tuning/sim.ts')).toBe('sim');
    expect(owner('src/core/tuning/street.ts')).toBe('street');
    expect(owner('src/render/menuFlythrough.ts')).toBe('render');
    expect(owner('src/ui/results.ts')).toBe('ui');
    // DESIGN suite names (controller.test, grind.test, lip.test, goals.test) resolve to an owner.
    expect(owner('tests/controller.test.ts')).toBe('sim');
    expect(owner('tests/grind.test.ts')).toBe('sim');
    expect(owner('tests/lip.test.ts')).toBe('sim');
    expect(owner('tests/goals.test.ts')).toBe('sim');
    expect(owner('tests/integrationDom.test.ts')).toBe('integration');
    expect(owner('DESIGN.md')).toBe('integration');
  });
});
