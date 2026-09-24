// tests/renderPolish2.test.ts (render track): polish round 2 regressions. Street shade faces must not
// crush to black (grade curve, AO floor, shade skylight), the glowing aberration keeps the centre of
// the frame clean, and the Street skyline reads as buildings (window grid, lit windows, hues, massing).
// Node only: no WebGL.
import { HemisphereLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TUNING } from '../src/core/tuning';
import { createLighting } from '../src/render/lighting';
import { qualitySettings } from '../src/render/quality';
import { softContrast } from '../src/render/lib/softContrast';
import { AO_FLOOR_UNIFORM, patchCompositerShader, patchN8aoPass, type PatchableN8ao } from '../src/render/lib/n8aoPatch';
import { SKYLINE_TINTS, streetSkyline } from '../src/render/lib/backdrop';
import { generate } from '../src/render/textures/generators';

/** Source text without comments, so an explanatory comment can never satisfy a source assert. */
function codeOf(rel: string): string {
  return readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('grade contrast never crushes shadows (polish round 2)', () => {
  it('softContrast pins black and white, keeps dark values alive and still adds midtone contrast', () => {
    const k = TUNING.RPOST_CONTRAST;
    expect(k).toBeGreaterThan(0);
    expect(softContrast(0, k)).toBe(0);
    expect(softContrast(1, k)).toBeCloseTo(1, 6);
    // A shade face at display linear 0.03 (sRGB about 48): the old linear-pivot contrast made it 0.
    expect(softContrast(0.03, k)).toBeGreaterThan(0.015);
    expect(softContrast(0.005, k)).toBeGreaterThan(0);
    // Still an S-curve: darker below the sRGB midpoint, brighter above.
    expect(softContrast(0.1, k)).toBeLessThan(0.1);
    expect(softContrast(0.5, k)).toBeGreaterThan(0.5);
    // Monotonic over the whole range at the top of the tunable range.
    for (const kk of [k, 0.5]) {
      let prev = -1;
      for (let i = 0; i <= 200; i++) {
        const v = softContrast(i / 200, kk);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('the post chain grades with SoftContrastEffect, not the clipping BrightnessContrastEffect', () => {
    const src = codeOf('../src/render/post.ts');
    expect(src).not.toContain('BrightnessContrastEffect');
    expect(src).toMatch(/new SoftContrastEffect\(TUNING\.RPOST_CONTRAST\)/);
  });
});

describe('N8AO darkening floor (polish round 2)', () => {
  const dist = readFileSync(resolve(__dirname, '../node_modules/n8ao/dist/N8AO.js'), 'utf8');

  it('the vendored compositer is rewritten to mix(pow(ao, intensity), 1, floor), once', () => {
    expect(dist).toContain('float finalAo = pow(texel.r, intensity);');
    const patched = patchCompositerShader(dist);
    expect(patched).toContain('float finalAo = mix(pow(texel.r, intensity), 1.0, codeSkaterAoFloor);');
    expect(patched).toContain('uniform float codeSkaterAoFloor;');
    expect(patched).not.toContain('float finalAo = pow(texel.r, intensity);');
    expect(patchCompositerShader(patched)).toBe(patched);
  });

  it('patchN8aoPass patches the compositer material, shares the live floor uniform, and re-patches a rebuilt one', () => {
    const shader = 'uniform float intensity;\nvoid main(){ float finalAo = pow(texel.r, intensity); }';
    const make = () => ({ fragmentShader: shader, needsUpdate: false, userData: {} as Record<string, unknown>, uniforms: {} as Record<string, { value: unknown }> });
    const comp = make();
    const pass: PatchableN8ao = { configuration: { transparencyAware: false }, standardDenoiseMaterial: null, neuralDenoiseMaterial: null, effectCompositerQuad: { material: comp } };
    expect(patchN8aoPass(pass)).toBe(1);
    expect(comp.fragmentShader).toContain('codeSkaterAoFloor');
    expect(comp.uniforms.codeSkaterAoFloor).toBe(AO_FLOOR_UNIFORM);
    expect(comp.needsUpdate).toBe(true);
    expect(patchN8aoPass(pass)).toBe(0);
    pass.effectCompositerQuad = { material: make() };
    expect(patchN8aoPass(pass)).toBe(1);
  });

  it('the floor is on by default and post.ts writes it live each frame', () => {
    expect(TUNING.RPOST_AO_FLOOR).toBeGreaterThanOrEqual(0.2);
    expect(codeOf('../src/render/post.ts')).toMatch(/AO_FLOOR_UNIFORM\.value = TUNING\.RPOST_AO_FLOOR/);
  });
});

describe('Street shade skylight (polish round 2)', () => {
  /** Hemisphere weight of a surface normal: 0.5 dot(n, axis) + 0.5 (three HemisphereLight). */
  const weight = (axis: Vector3, n: Vector3): number => 0.5 * n.dot(axis) + 0.5;

  it('streetAfternoon has a diffuse-only fill from the side away from the sun: walls get most of it, floors little, sunlit faces none', () => {
    const l = createLighting('streetAfternoon', qualitySettings('high'));
    l.update({ x: 40, y: 0, z: 40 });
    const fill = l.group.children.find((c) => c.name === 'skyFill');
    expect(fill).toBeInstanceOf(HemisphereLight);
    if (!(fill instanceof HemisphereLight)) return;
    expect(fill.intensity).toBe(TUNING.RLIT_SKYFILL_INTENSITY);
    expect(fill.intensity).toBeGreaterThanOrEqual(1);
    expect(fill.groundColor.getHex()).toBe(0x000000);
    const axis = fill.position.clone().normalize();
    // Below the horizon and on the far side from the sun.
    expect(axis.y).toBeLessThan(0);
    const sunFlat = new Vector3(l.sunDir.x, 0, l.sunDir.z).normalize();
    expect(new Vector3(axis.x, 0, axis.z).normalize().dot(sunFlat)).toBeLessThan(-0.5);
    // A wall that faces away from the sun gets far more than the floor; a wall facing the sun gets almost nothing.
    const shadeWall = sunFlat.clone().negate();
    expect(weight(axis, shadeWall)).toBeGreaterThan(0.8);
    expect(weight(axis, new Vector3(0, 1, 0))).toBeLessThan(0.35);
    expect(weight(axis, sunFlat)).toBeLessThan(0.2);
    // The north faces the spawn camera looks at (the planters) are well lit by it.
    expect(weight(axis, new Vector3(0, 0, -1))).toBeGreaterThan(0.75);
    l.dispose();
  });

  it('the fill follows the sun azimuth live, and the Woodshed has none', () => {
    const l = createLighting('streetAfternoon', qualitySettings('high'));
    const fill = l.group.children.find((c) => c.name === 'skyFill');
    const before = fill?.position.clone();
    const az = TUNING.RSKY_SUN_AZIMUTH_DEG;
    TUNING.RSKY_SUN_AZIMUTH_DEG = (az + 90) % 360;
    try {
      l.update({ x: 0, y: 0, z: 0 });
      expect(fill?.position.distanceTo(before ?? new Vector3())).toBeGreaterThan(0.5);
    } finally {
      TUNING.RSKY_SUN_AZIMUTH_DEG = az;
    }
    l.dispose();
    const shed = createLighting('woodshedInterior', qualitySettings('high'));
    expect(shed.group.children.some((c) => c.name === 'skyFill')).toBe(false);
    shed.dispose();
  });
});

describe('glowing chromatic aberration stays off the centre of the frame (polish round 2)', () => {
  it('the clear radius is at least half the way to the edge and read live', () => {
    expect(TUNING.RPOST_CA_MODULATION_OFFSET).toBeGreaterThanOrEqual(0.5);
    const src = codeOf('../src/render/post.ts');
    expect(src).toMatch(/modulationOffset: TUNING\.RPOST_CA_MODULATION_OFFSET/);
    expect(src).toMatch(/modulationOffset = TUNING\.RPOST_CA_MODULATION_OFFSET/);
    expect(src).not.toMatch(/modulationOffset: 0\.\d/);
  });
});

describe('Street skyline reads as buildings (polish round 2)', () => {
  it('facade: dark glass against light stone in a window grid, a third of the panes catching the sky', () => {
    const p = generate('skylineFacade', 256, 604);
    let dark = 0;
    let light = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const l = lum(p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0);
      if (l < 90) dark += 1;
      else if (l > 180) light += 1;
    }
    const n = p.width * p.height;
    // Both window and wall take a real share of the facade (the old strip map was mostly one grey).
    expect(dark / n).toBeGreaterThan(0.2);
    expect(light / n).toBeGreaterThan(0.25);
  });

  it('lit windows: a warm-leaning scatter near RMAT_SKYLINE_LIT_RATIO, black between them', () => {
    const p = generate('skylineFacadeLit', 256, 604, { skylineLitRatio: 0.3 });
    let lit = 0;
    let warm = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const r = p.data[i] ?? 0;
      const b = p.data[i + 2] ?? 0;
      if (r + b > 0) {
        lit += 1;
        if (r > b) warm += 1;
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit / (p.width * p.height)).toBeLessThan(0.3);
    expect(warm / lit).toBeGreaterThan(0.5);
    const none = generate('skylineFacadeLit', 64, 604, { skylineLitRatio: 0 });
    expect(Array.from(none.data).every((v, i) => i % 4 === 3 || v === 0)).toBe(true);
    expect(TUNING.RMAT_SKYLINE_LIT_RATIO).toBeGreaterThan(0);
  });

  it('blocks: several distinct hues (warm and cool), dark roofs, setback tiers on the tall ones', () => {
    const { blocks, blockCount } = streetSkyline(120, 120);
    expect(SKYLINE_TINTS.length).toBeGreaterThanOrEqual(5);
    expect(SKYLINE_TINTS.some(([r, , b]) => r > b * 1.4)).toBe(true);
    expect(SKYLINE_TINTS.some(([r, , b]) => b > r * 1.4)).toBe(true);
    const col = blocks.getAttribute('color');
    const nrm = blocks.getAttribute('normal');
    const pos = blocks.getAttribute('position');
    const hues = new Set<string>();
    let roofSum = 0;
    let roofN = 0;
    let wallSum = 0;
    let wallN = 0;
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i);
      const g = col.getY(i);
      const b = col.getZ(i);
      const m = Math.max(r, g, b);
      hues.add(`${(r / m).toFixed(1)},${(g / m).toFixed(1)},${(b / m).toFixed(1)}`);
      if (nrm.getY(i) > 0.5) {
        roofSum += lum(r, g, b);
        roofN += 1;
      } else if (Math.abs(nrm.getY(i)) < 0.5) {
        wallSum += lum(r, g, b);
        wallN += 1;
      }
    }
    expect(hues.size).toBeGreaterThanOrEqual(5);
    expect(roofSum / roofN).toBeLessThan(0.7 * (wallSum / wallN));
    // More boxes than blocks: setback tiers and rooftop plant boxes break the flat-box silhouette.
    const boxes = pos.count / 24;
    // Measured 2.25 boxes a block on the skyline alone; the low-rise near city (graphics overhaul
    // 2026-09-23) has no setback tiers, so the mix sits near 1.9. Without tiers or plant boxes it drops under 1.5.
    expect(boxes).toBeGreaterThan(blockCount * 1.6);
  });
});
