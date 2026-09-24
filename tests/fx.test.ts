// tests/fx.test.ts (fx track): the FX system's triggers fire on events and read the snapshot
// (REQ-FX-01..04) in plain node: three.js Points / ShaderMaterial construct without WebGL.
import { AdditiveBlending, BufferAttribute, Mesh, NormalBlending, PerspectiveCamera, Points, type ShaderMaterial } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { hitstopTicks, resetTuning, TUNING } from '../src/core/tuning';
import { restSnapshot } from '../src/core/mock';
import { createFxSystem, type FxHooks } from '../src/render/fx/fxSystem';
import { ParticlePool, smokeNoiseTexture } from '../src/render/fx/particles';
import { Ribbon } from '../src/render/fx/ribbon';
import { createRng } from '../src/core/rng';
import { qualitySettings } from '../src/render/quality';
import { tryImplemented } from '../src/core/contract';
import type { QualitySettings } from '../src/render/types';
import type { GrindTypeId, RailKind, SimSnapshot, SpecialId } from '../src/core/types';

afterEach(() => resetTuning());

const DT = 1 / 60;
const POS = { x: 20, y: 0, z: 20 };

function make(hooks: FxHooks = {}) {
  const cam = new PerspectiveCamera(70, 16 / 9, 0.05, 500);
  cam.position.set(20, 1.6, 24.2);
  cam.lookAt(20, 0.8, 20);
  cam.updateMatrixWorld();
  return createFxSystem(cam, 7, hooks);
}

function grinding(kind: RailKind, type: GrindTypeId = 'fifty_fifty', x = 20): SimSnapshot {
  const base = restSnapshot();
  const pos = { x, y: 0.6, z: 20 };
  return {
    ...base,
    skater: {
      ...base.skater, pos, state: 'Grind',
      grind: { type, railId: 'R', railKind: kind, contact: pos, tangent: { x: -1, y: 0, z: 0 }, distanceM: 0 },
    },
  };
}

function withSpecial(activeId: SpecialId | null, glowing = false, timeScale = 1): SimSnapshot {
  const base = restSnapshot();
  return { ...base, timeScale, special: { meter: 1, glowing, activeId, heldS: 0 } };
}

function fast(ratio: number): SimSnapshot {
  const base = restSnapshot();
  return { ...base, skater: { ...base.skater, speedRatio: ratio } };
}

function tick(fx: ReturnType<typeof make>, s: SimSnapshot, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) fx.update(s, DT);
}

describe('REQ-FX-01 grind sparks', () => {
  it('spawns SPARK_RATE_PER_S per second at the contact point while grinding a rail, none otherwise', () => {
    const fx = make();
    tick(fx, restSnapshot(), 1);
    expect(fx.debug.sparksSpawned).toBe(0);
    expect(fx.debug.sparkKind).toBeNull();
    for (let i = 0; i < 60; i++) fx.update(grinding('rail', 'fifty_fifty', 20 - i * 0.1), DT);
    expect(fx.debug.sparkKind).toBe('rail');
    expect(fx.debug.sparksSpawned).toBeGreaterThanOrEqual(TUNING.SPARK_RATE_PER_S - 2);
    expect(fx.debug.sparksSpawned).toBeLessThanOrEqual(TUNING.SPARK_RATE_PER_S + 2);
    expect(fx.debug.sparksAlive).toBeGreaterThan(0);
    // Off the rail the stream stops and the sparks burn out within their life.
    tick(fx, restSnapshot(), TUNING.FX_SPARK_LIFE_S * 1.5 + 0.1);
    expect(fx.debug.sparkKind).toBeNull();
    expect(fx.debug.sparksAlive).toBe(0);
  });

  it('rates differ per rail kind: coping hotter, ledge fewer', () => {
    const rail = make();
    const coping = make();
    const ledge = make();
    tick(rail, grinding('rail'), 1);
    tick(coping, grinding('coping'), 1);
    tick(ledge, grinding('ledge'), 1);
    expect(coping.debug.sparksSpawned).toBeGreaterThan(rail.debug.sparksSpawned);
    expect(ledge.debug.sparksSpawned).toBeLessThan(rail.debug.sparksSpawned);
    expect(ledge.debug.sparksSpawned).toBeCloseTo(TUNING.SPARK_RATE_PER_S * TUNING.FX_SPARK_LEDGE_RATE_MULT, -1);
  });

  it('is seeded: the same seed gives the same particles, a different seed does not', () => {
    const cam = new PerspectiveCamera();
    const a = createFxSystem(cam, 3);
    const b = createFxSystem(cam, 3);
    const c = createFxSystem(cam, 4);
    for (const f of [a, b, c]) tick(f, grinding('rail'), 0.5);
    const pos = (f: typeof a): ArrayLike<number> => (f.group.children[0] as Points).geometry.getAttribute('position').array;
    expect(Array.from(pos(a))).toEqual(Array.from(pos(b)));
    expect(Array.from(pos(a))).not.toEqual(Array.from(pos(c)));
  });

  it('reads SPARK_RATE_PER_S live and scales with the quality preset', () => {
    const fx = make();
    TUNING.SPARK_RATE_PER_S = 480;
    tick(fx, grinding('rail'), 1);
    expect(fx.debug.sparksSpawned).toBeCloseTo(480, -1);
    const low = tryImplemented(() => qualitySettings('low')) ?? ({ id: 'low', pixelRatioCap: 1, shadowMapSize: 1024, ao: false, bloom: false, smaa: false } satisfies QualitySettings);
    const fxLow = make();
    fxLow.setQuality(low);
    expect(fxLow.debug.qualityMult).toBe(TUNING.FX_QUALITY_LOW_MULT);
    tick(fxLow, grinding('rail'), 1);
    expect(fxLow.debug.sparksSpawned).toBeCloseTo(480 * TUNING.FX_QUALITY_LOW_MULT, -1);
  });
});

describe('REQ-FX-02 dust, speed lines, trails, ribbon, specials', () => {
  it('a landing bursts DUST_BURST_COUNT dust particles, a bail half of them', () => {
    const fx = make();
    fx.onEvent({ type: 'land', tick: 1, quality: 'clean', offAxisDeg: 3, tiltDeg: 2, vert: false, speed: 6, pos: POS, linker: 'none' });
    expect(fx.debug.dustSpawned).toBe(TUNING.DUST_BURST_COUNT);
    fx.onEvent({ type: 'bail', tick: 2, reason: 'landing', speed: 6, pos: POS });
    expect(fx.debug.dustSpawned).toBe(TUNING.DUST_BURST_COUNT + Math.round(TUNING.DUST_BURST_COUNT / 2));
  });

  it('speed lines rise above CAM_FOV_KICK_SPEED and fall below it', () => {
    const fx = make();
    tick(fx, fast(TUNING.CAM_FOV_KICK_SPEED - 0.01), 0.5);
    expect(fx.debug.speedLines).toBe(0);
    // Same ramp as the FOV kick: full FXCAM_KICK_RAMP above the threshold, partial in between.
    tick(fx, fast(TUNING.CAM_FOV_KICK_SPEED + TUNING.FXCAM_KICK_RAMP / 2), TUNING.FX_SPEEDLINE_FADE_S + 0.1);
    expect(fx.debug.speedLines).toBeGreaterThan(0.3 * TUNING.FX_SPEEDLINE_STRENGTH);
    expect(fx.debug.speedLines).toBeLessThan(0.7 * TUNING.FX_SPEEDLINE_STRENGTH);
    tick(fx, fast(TUNING.CAM_FOV_KICK_SPEED + TUNING.FXCAM_KICK_RAMP), TUNING.FX_SPEEDLINE_FADE_S + 0.1);
    expect(fx.debug.speedLines).toBeCloseTo(TUNING.FX_SPEEDLINE_STRENGTH, 6);
    tick(fx, fast(0.5), TUNING.FX_SPEEDLINE_FADE_S + 0.1);
    expect(fx.debug.speedLines).toBe(0);
  });

  it('the board trail runs while any special is active and fades out after', () => {
    const fx = make();
    const base = withSpecial('kernel_panic');
    for (let i = 0; i < 30; i++) fx.update({ ...base, skater: { ...base.skater, pos: { x: 20 - i * 0.2, y: 1, z: 20 } } }, DT);
    expect(fx.debug.trailSamples).toBeGreaterThan(10);
    tick(fx, withSpecial(null), TUNING.FX_TRAIL_FADE_S + 0.1);
    expect(fx.debug.trailSamples).toBe(0);
  });

  it('the special grind leaves the green ribbon along the rail; a normal grind does not', () => {
    const fx = make();
    for (let i = 0; i < 30; i++) fx.update(grinding('rail', 'fifty_fifty', 20 - i * 0.2), DT);
    expect(fx.debug.ribbonSamples).toBe(0);
    for (let i = 0; i < 30; i++) fx.update(grinding('rail', 'gpu_slide', 20 - i * 0.2), DT);
    expect(fx.debug.ribbonSamples).toBeGreaterThan(10);
    const ribbon = fx.group.children.find((c) => c.renderOrder === 21) as Mesh;
    const color = (ribbon.material as ShaderMaterial).uniforms.uColor as { value: { r: number; g: number } };
    expect(color.value.g).toBeGreaterThan(color.value.r);
    tick(fx, restSnapshot(), TUNING.FX_RIBBON_FADE_S + 0.1);
    expect(fx.debug.ribbonSamples).toBe(0);
  });

  it('the glow aura fades in while special.glowing and out when it stops', () => {
    const fx = make();
    tick(fx, withSpecial(null, true), TUNING.FX_AURA_FADE_S + 0.1);
    expect(fx.debug.aura).toBe(1);
    tick(fx, withSpecial(null, false), TUNING.FX_AURA_FADE_S + 0.1);
    expect(fx.debug.aura).toBe(0);
  });

  it('Kernel Panic: blue flash and the deck override hook, cleared on landing', () => {
    const modes: string[] = [];
    const fx = make({ setDeckOverride: (m) => modes.push(m) });
    fx.onEvent({ type: 'specialUsed', tick: 1, specialId: 'kernel_panic' });
    expect(fx.debug.deckOverride).toBe('blueScreen');
    expect(fx.debug.flashActive).toBe(true);
    expect(fx.debug.flashAlpha).toBeCloseTo(TUNING.FX_FLASH_KERNEL_ALPHA, 6);
    tick(fx, withSpecial('kernel_panic'), TUNING.FX_FLASH_KERNEL_MS / 1000 + 0.05);
    expect(fx.debug.flashActive).toBe(false);
    fx.onEvent({ type: 'land', tick: 90, quality: 'clean', offAxisDeg: 3, tiltDeg: 2, vert: false, speed: 6, pos: POS, linker: 'none' });
    expect(fx.debug.deckOverride).toBe('none');
    expect(modes).toEqual(['blueScreen', 'none']);
  });

  it('Token Overflow peels FX_STICKER_BURST_COUNT stickers and keeps peeling through the animation', () => {
    const fx = make();
    fx.update(restSnapshot(), DT);
    fx.onEvent({ type: 'specialUsed', tick: 1, specialId: 'token_overflow' });
    expect(fx.debug.stickersSpawned).toBe(TUNING.FX_STICKER_BURST_COUNT);
    tick(fx, withSpecial('token_overflow'), 0.4);
    expect(fx.debug.stickersSpawned).toBeGreaterThan(TUNING.FX_STICKER_BURST_COUNT);
  });

  it('the 900ms Inference slow-mo look follows special.activeId', () => {
    const fx = make();
    tick(fx, withSpecial('inference_900ms', true, TUNING.INFERENCE_TIME_SCALE), TUNING.FX_SLOWMO_FADE_S + 0.1);
    expect(fx.debug.slowMo).toBeCloseTo(TUNING.FX_SLOWMO_STRENGTH, 6);
    tick(fx, withSpecial(null), TUNING.FX_SLOWMO_FADE_S + 0.1);
    expect(fx.debug.slowMo).toBe(0);
  });

  it('a letter pickup bursts FX_LETTER_BURST_COUNT gold glints and fires a pickup ring that ends after FX_PICKUP_RING_S', () => {
    const fx = make();
    fx.onEvent({ type: 'letter', tick: 1, letter: 'C', collected: ['C'], pos: POS });
    expect(fx.debug.burstSpawned).toBe(TUNING.FX_LETTER_BURST_COUNT);
    expect(fx.debug.shotsActive).toBe(1);
    const stars = fx.group.children.find((c) => c instanceof Points && c.renderOrder === 12 && c !== fx.group.children[0]) as Points;
    expect((stars.material as ShaderMaterial).uniforms.uShape?.value).toBe(3); // star glint shape
    const col = stars.geometry.getAttribute('color').array as Float32Array;
    expect(col[0]).toBeGreaterThan(col[2]); // gold: more red than blue
    tick(fx, restSnapshot(), TUNING.FX_PICKUP_RING_S + 0.05);
    expect(fx.debug.shotsActive).toBe(0);
  });

  it('a ledge grind throws dark chips from a normal-blended pool plus dust puffs; steel keeps the additive sparks and a contact glow', () => {
    const ledge = make();
    tick(ledge, grinding('ledge'), 0.5);
    const sparkPool = ledge.group.children[0] as Points;
    const chipPool = ledge.group.children[1] as Points;
    expect(sparkPool.geometry.getAttribute('life').array[0]).toBe(0); // no additive sparks used
    expect((chipPool.geometry.getAttribute('life').array as Float32Array)[0]).toBeGreaterThan(0);
    expect((chipPool.material as ShaderMaterial).blending).toBe(NormalBlending);
    expect((chipPool.material as ShaderMaterial).uniforms.uShape?.value).toBe(4);
    expect(ledge.debug.dustSpawned).toBeGreaterThanOrEqual(Math.floor(0.5 / TUNING.FX_LEDGE_DUST_INTERVAL_S) * 2 - 2);
    expect(ledge.debug.contactGlow).toBe(0);
    const rail = make();
    tick(rail, grinding('rail'), 0.5);
    expect((sparkPool.material as ShaderMaterial).blending).toBe(AdditiveBlending);
    expect(rail.debug.contactGlow).toBeGreaterThan(0.3);
    expect(rail.debug.dustSpawned).toBe(0);
    tick(rail, restSnapshot(), DT);
    expect(rail.debug.contactGlow).toBe(0);
  });

  it('grindStart on steel fires the snap flash for FX_GRIND_FLASH_S', () => {
    const fx = make();
    fx.onEvent({ type: 'grindStart', tick: 1, railId: 'R', railKind: 'rail', grindType: 'fifty_fifty', pos: POS, speed: 6 });
    expect(fx.debug.shotsActive).toBe(1);
    expect(fx.debug.sparksSpawned).toBe(12);
    tick(fx, restSnapshot(), TUNING.FX_GRIND_FLASH_S + 0.05);
    expect(fx.debug.shotsActive).toBe(0);
  });

  it('a landing fires the ground ring and the dust sits on the wheel line', () => {
    const fx = make();
    fx.update(restSnapshot(), DT);
    fx.onEvent({ type: 'land', tick: 1, quality: 'clean', offAxisDeg: 3, tiltDeg: 2, vert: false, speed: 6, pos: POS, linker: 'none' });
    expect(fx.debug.shotsActive).toBe(1);
    const dustPool = fx.group.children[2] as Points;
    const p = dustPool.geometry.getAttribute('position').array as Float32Array;
    const v = dustPool.geometry.getAttribute('vel').array as Float32Array;
    for (let i = 0; i < TUNING.DUST_BURST_COUNT; i++) {
      expect(p[i * 3 + 1]).toBeCloseTo(POS.y + 0.04, 6);
      // Mostly horizontal: the vertical part is small next to the outward spread.
      expect(Math.abs(v[i * 3 + 1] as number)).toBeLessThan(Math.hypot(v[i * 3] as number, v[i * 3 + 2] as number));
    }
    tick(fx, restSnapshot(), TUNING.FX_LAND_RING_S + 0.05);
    expect(fx.debug.shotsActive).toBe(0);
  });

  it('specialReady pops the aura above 1 and it eases back within FX_AURA_POP_S', () => {
    const fx = make();
    tick(fx, withSpecial(null, true), TUNING.FX_AURA_FADE_S + 0.1);
    expect(fx.debug.auraPop).toBe(1);
    fx.onEvent({ type: 'specialReady', tick: 1 });
    fx.update(withSpecial(null, true), DT);
    expect(fx.debug.auraPop).toBeGreaterThan(1.3);
    tick(fx, withSpecial(null, true), TUNING.FX_AURA_POP_S + 0.05);
    expect(fx.debug.auraPop).toBe(1);
    expect(fx.debug.aura).toBe(1);
  });

  it('the board trail is a deck ghost coloured per special', () => {
    const fx = make();
    const trail = fx.group.children.find((c) => c.renderOrder === 20) as Mesh;
    const color = (trail.material as ShaderMaterial).uniforms.uColor as { value: { r: number; g: number; b: number } };
    const base = withSpecial('token_overflow');
    for (let i = 0; i < 20; i++) fx.update({ ...base, skater: { ...base.skater, pos: { x: 20 - i * 0.2, y: 1, z: 20 } } }, DT);
    expect(color.value.r).toBeGreaterThan(color.value.b); // gold
    const pos = trail.geometry.getAttribute('position').array as Float32Array;
    // Nose and tail of the newest sample sit FX_TRAIL_DECK_HALF_M ahead and behind along the heading (-z at rest).
    const n = fx.debug.trailSamples;
    const o = (n - 1) * 6;
    expect(Math.abs((pos[o + 2] as number) - (pos[o + 5] as number))).toBeCloseTo(2 * TUNING.FX_TRAIL_DECK_HALF_M, 4);
    const blue = withSpecial('kernel_panic');
    fx.update(blue, DT);
    expect(color.value.b).toBeGreaterThan(color.value.r);
  });

  it('Kernel Panic shows the blue-screen card for the flash duration', () => {
    const fx = make();
    fx.onEvent({ type: 'specialUsed', tick: 1, specialId: 'kernel_panic' });
    expect(fx.debug.cardActive).toBe(true);
    tick(fx, withSpecial('kernel_panic'), TUNING.FX_FLASH_KERNEL_MS / 1000 + 0.05);
    expect(fx.debug.cardActive).toBe(false);
  });

  it('stickers carry a die-cut shape index in 0..3 and a tumble spin', () => {
    const fx = make();
    fx.update(restSnapshot(), DT);
    fx.onEvent({ type: 'specialUsed', tick: 1, specialId: 'token_overflow' });
    const pool = fx.group.children[3] as Points;
    const kind = pool.geometry.getAttribute('kind').array as Float32Array;
    const spin = pool.geometry.getAttribute('spin').array as Float32Array;
    const kinds = new Set<number>();
    let maxSpin = 0;
    for (let i = 0; i < TUNING.FX_STICKER_BURST_COUNT; i++) {
      kinds.add(kind[i] as number);
      maxSpin = Math.max(maxSpin, Math.abs(spin[i] as number));
    }
    expect([...kinds].every((k) => k >= 0 && k <= 3)).toBe(true);
    expect(kinds.size).toBeGreaterThan(2);
    expect(maxSpin).toBeGreaterThan(TUNING.FX_STICKER_SPIN_RPS * 0.5);
  });
});

describe('REQ-FX-03 MacGuffin pickup', () => {
  it('flashes for FLASH_MACGUFFIN_MS and requests hitstopTicks() through the loop hook', () => {
    const frozen: number[] = [];
    const fx = make({ freeze: (t) => frozen.push(t) });
    fx.onEvent({ type: 'macguffin', tick: 1, id: 'secret_drive', name: 'X', splash: 'X', toast: 'X', hitstopTicks: hitstopTicks(), pos: POS });
    expect(frozen).toEqual([7]);
    expect(fx.debug.flashActive).toBe(true);
    expect(fx.debug.flashAlpha).toBe(1);
    expect(fx.debug.flashRemainingS).toBeCloseTo(TUNING.FLASH_MACGUFFIN_MS / 1000, 6);
    expect(fx.debug.burstSpawned).toBe(TUNING.FX_MACGUFFIN_BURST_COUNT);
    tick(fx, restSnapshot(), TUNING.FLASH_MACGUFFIN_MS / 1000 / 2);
    expect(fx.debug.flashActive).toBe(true);
    tick(fx, restSnapshot(), TUNING.FLASH_MACGUFFIN_MS / 1000 / 2 + 0.05);
    expect(fx.debug.flashActive).toBe(false);
    expect(fx.debug.flashAlpha).toBe(0);
  });
});

describe('REQ-FX-04 bail', () => {
  it('a bail puffs dust (the shake is the camera rig, tests/camera.test.ts) and never throws without hooks', () => {
    const fx = make();
    expect(() => fx.onEvent({ type: 'bail', tick: 1, reason: 'wall', speed: 8, pos: POS })).not.toThrow();
    expect(fx.debug.dustSpawned).toBeGreaterThan(0);
  });
});

describe('pools stay fixed size', () => {
  it('a particle pool wraps round robin instead of growing and clear() kills everything', () => {
    const p = new ParticlePool({ capacity: 8, shape: 'spark', additive: true });
    const rng = createRng(1);
    p.burst(rng, 50, 0, 0, 0, 0, 1, 0, 0.5, 1, 0, 0.05, 0, 1, 1, 1, 0);
    p.update(0.01, 9.8, 720);
    expect(p.spawned).toBe(50);
    expect(p.alive).toBe(8);
    expect(p.capacity).toBe(8);
    p.clear();
    p.update(0.01, 9.8, 720);
    expect(p.alive).toBe(0);
  });

  it('a pool uploads only the slots written since the last frame, two ranges round the wrap', () => {
    const p = new ParticlePool({ capacity: 8, shape: 'spark', additive: true });
    const pos = p.points.geometry.getAttribute('position') as BufferAttribute;
    const consumed = (): void => pos.clearUpdateRanges(); // what the renderer does after an upload
    p.update(0.01, 0, 720); // first upload is the whole pool
    expect(pos.updateRanges).toEqual([{ start: 0, count: 24 }]);
    consumed();
    for (let i = 0; i < 3; i++) p.spawn(i, 0, 0, 0, 0, 0, 1, 0.1, 1, 1, 1);
    expect(p.pendingSlots).toBe(3);
    p.update(0.01, 0, 720);
    expect(pos.updateRanges).toEqual([{ start: 0, count: 9 }]);
    expect(p.pendingSlots).toBe(0);
    consumed();
    for (let i = 0; i < 7; i++) p.spawn(i, 0, 0, 0, 0, 0, 1, 0.1, 1, 1, 1); // slots 3..7 then 0..1
    p.update(0.01, 0, 720);
    expect(pos.updateRanges).toEqual([{ start: 9, count: 15 }, { start: 0, count: 6 }]);
    // Two updates between renders: the earlier ranges survive (never cleared by the pool).
    p.spawn(9, 0, 0, 0, 0, 0, 1, 0.1, 1, 1, 1); // slot 2
    p.update(0.01, 0, 720);
    expect(pos.updateRanges).toEqual([{ start: 9, count: 15 }, { start: 0, count: 6 }, { start: 6, count: 3 }]);
    consumed();
    p.update(0.01, 0, 720); // nothing new: no upload marked
    expect(pos.updateRanges).toEqual([]);
    p.clear();
    expect(p.pendingSlots).toBe(8);
    p.update(0.01, 0, 720);
    expect(pos.updateRanges).toEqual([{ start: 0, count: 24 }]); // full upload
  });

  it('the smoke noise texture is generated once, 128 px, with a radial fade to transparent', () => {
    const tex = smokeNoiseTexture();
    expect(smokeNoiseTexture()).toBe(tex);
    expect(tex.image.width).toBe(128);
    const data = tex.image.data as Uint8Array;
    const alphaAt = (x: number, y: number): number => data[(y * 128 + x) * 4 + 3] as number;
    let centre = 0;
    for (let y = 56; y < 72; y++) for (let x = 56; x < 72; x++) centre += alphaAt(x, y);
    expect(centre / 256).toBeGreaterThan(40);
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(127, 64)).toBe(0);
  });

  it('a ribbon keeps at most its capacity of samples and skips samples closer than minStep', () => {
    const r = new Ribbon(8, '#ffffff');
    for (let i = 0; i < 100; i++) r.push(i * 0.1, 0, 0);
    expect(r.samples).toBe(8);
    r.push(9.9, 0, 0); // same point as the last: skipped
    expect(r.samples).toBe(8);
    r.update(0.01, 0.2, 1, { x: 0, y: 5, z: 5 } as never);
    expect(r.mesh.geometry.drawRange.count).toBe(7 * 6);
    r.clear();
    expect(r.samples).toBe(0);
  });

  it('runStart clears every effect', () => {
    const fx = make();
    tick(fx, grinding('rail', 'gpu_slide'), 0.5);
    fx.onEvent({ type: 'land', tick: 1, quality: 'clean', offAxisDeg: 3, tiltDeg: 2, vert: false, speed: 6, pos: POS, linker: 'none' });
    fx.onEvent({ type: 'runStart', tick: 0, levelId: 'testBox', mode: 'free', lengthS: 120 });
    fx.update(restSnapshot(), DT);
    expect(fx.debug.sparksAlive).toBe(0);
    expect(fx.debug.ribbonSamples).toBe(0);
    fx.dispose();
    expect(fx.group.children.length).toBe(0);
  });
});
