// tests/grep.test.ts (integration): source-grep rules that a linter cannot express, run on source with
// comments STRIPPED so an explanatory comment can never satisfy or trip a rule (REQ-TST-04).
// REQ-SM-11: the controller never assigns the skater state. REQ-TIM-03: no clocks or Math.random in
// the sim, parser or frame builder. REQ-CTL-01: no rigidbody engine anywhere.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Remove // and block comments, keeping string and template literal contents intact. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          out += src[i] as string;
          i++;
        }
        out += src[i] ?? '';
        i++;
      }
      out += src[i] ?? '';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (f: string): string => relative(ROOT, f).replace(/\\/g, '/');
const code = (f: string): string => stripComments(readFileSync(f, 'utf8'));

function violations(files: readonly string[], rules: readonly (readonly [RegExp, string])[]): string[] {
  const found: string[] = [];
  for (const f of files) {
    const src = code(f);
    for (const [re, why] of rules) if (re.test(src)) found.push(`${rel(f)}: ${why} (${re})`);
  }
  return found;
}

describe('stripComments (self-check)', () => {
  it('removes line and block comments, keeps strings', () => {
    const src = "const a = 1; // state = 'Air'\n/* Math.random() */ const b = '// not a comment';\nconst c = `/* kept */`;";
    const out = stripComments(src);
    expect(out).not.toContain('state =');
    expect(out).not.toContain('Math.random');
    expect(out).toContain("'// not a comment'");
    expect(out).toContain('`/* kept */`');
  });
});

describe('REQ-SM-11: the controller reports events and never sets the skater state', () => {
  const file = join(ROOT, 'src/sim/controller.ts');
  it('src/sim/controller.ts has no state assignment, no state machine import, no state names', () => {
    expect(existsSync(file)).toBe(true);
    expect(violations([file], [
      [/(^|[^\w$.])state\s*=(?!=)/m, 'assigns a variable named state'],
      [/\.state\s*=(?!=)/, 'assigns .state'],
      [/(^|[{,\s])state\s*:/m, 'builds an object with a state field'],
      [/from\s+['"]\.\/stateMachine['"]/, 'imports the state machine'],
      [/\bSkaterStateName\b/, 'uses skater state names (take a MovementMode instead)'],
    ])).toEqual([]);
  });
});

describe('REQ-TIM-03 / REQ-CTL-16: no clocks or unseeded randomness in the sim, parser or frame builder', () => {
  it('src/sim/**, src/input/parser.ts and src/input/frameBuilder.ts read sim time only', () => {
    const files = [...walk(join(ROOT, 'src/sim')), join(ROOT, 'src/input/parser.ts'), join(ROOT, 'src/input/frameBuilder.ts')];
    expect(files.length).toBeGreaterThan(10);
    expect(violations(files, [
      [/\bMath\.random\b/, 'Math.random (use the seeded Rng)'],
      [/\bDate\b/, 'Date'],
      [/\bperformance\b/, 'performance'],
      [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
      [/\bset(Timeout|Interval)\b/, 'timers'],
    ])).toEqual([]);
  });
});

describe('REQ-CTL-01: kinematic controller, no rigidbody engine', () => {
  const ENGINES = /(^|\/)(cannon|cannon-es|ammo|ammo\.js|oimo|oimophysics|@dimforge\/rapier[\w-]*|rapier3d[\w-]*|physx[\w-]*|@enable3d[\w/-]*)$/;
  it('package.json declares no physics engine', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    expect(deps.filter((d) => ENGINES.test(d))).toEqual([]);
  });

  it('no source file imports one', () => {
    const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'dev'))];
    const found: string[] = [];
    for (const f of files) {
      for (const m of code(f).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        if (ENGINES.test(m[1] as string)) found.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });
});
