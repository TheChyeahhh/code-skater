/**
 * tests/fxAura.test.ts (fx track): the special aura sits on the skater's body along the auto-oriented
 * up axis and moves along each eye ray in depth: its rim slides toward the camera, so a quarter-pipe
 * wall or the floor inside the glow radius cannot slice it into a hard-edged rectangle (polish round
 * 1), and its core stays behind the body, so the additive glow never bleaches the skater (polish round
 * 2, REQ-FX-02).
 */

import { Mesh, PerspectiveCamera, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/tuning';
import { SpecialAura } from '../src/render/fx/aura';

const RADIUS = 1.3;
const BODY_H = 1.7;

function glowing(aura: SpecialAura, pos: Vector3, up: Vector3, push = 1): void {
  // Two steps: the first eases strength to 1 (fadeS tiny), the second places both quads.
  for (let i = 0; i < 2; i++) {
    aura.update(
      0.1, pos, up, BODY_H, new Quaternion(), 1, 1e-3, RADIUS, 0, push, 0.3, TUNING.FX_AURA_CORE_BACK_M, TUNING.FX_AURA_CORE_R, TUNING.FX_AURA_RIM_R,
      TUNING.FX_AURA_GROUND_CORE_R,
    );
  }
}

function quads(aura: SpecialAura): { glow: Mesh; ground: Mesh } {
  const [glow, ground] = aura.group.children as Mesh[];
  return { glow: glow as Mesh, ground: ground as Mesh };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The vertex shader's depth move, replayed on the CPU for one quad-local point (quad spans [-1, 1]). */
function pushedView(cam: PerspectiveCamera, mesh: Mesh, local: Vector3): Vector3 {
  const u = (mesh.material as ShaderMaterial).uniforms;
  mesh.updateMatrixWorld(true);
  const mv = local.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
  const c = new Vector3().applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
  const d = c.length();
  const push = -(u.uCoreBack!.value as number)
    + ((u.uPush!.value as number) + (u.uCoreBack!.value as number)) * smoothstep(u.uCoreR!.value as number, u.uRimR!.value as number, Math.hypot(local.x, local.y));
  const k = Math.max(d - push, u.uMinView!.value as number) / d;
  return mv.multiplyScalar(k);
}

/** The chase framing of the floor case: skater 0.4 m in front of a wall at z = 0, camera 5 m back. */
function floorCase(): { aura: SpecialAura; cam: PerspectiveCamera } {
  const aura = new SpecialAura('#ffb347');
  glowing(aura, new Vector3(0, 0, 0.4), new Vector3(0, 1, 0));
  const cam = new PerspectiveCamera(60, 16 / 9, 0.05, 500);
  cam.position.set(0, 1.6, 5.4);
  cam.lookAt(0, 0.9, 0.4);
  cam.updateMatrixWorld(true);
  const { glow } = quads(aura);
  glow.quaternion.copy(cam.quaternion);
  glow.updateMatrixWorld(true);
  quads(aura).ground.updateMatrixWorld(true);
  return { aura, cam };
}

/** Pin that both quads' vertex shader really runs the profile pushedView replays. */
function expectShaderProfile(mesh: Mesh): void {
  const vs = ((mesh.material as ShaderMaterial).vertexShader).replace(/\/\/.*$/gm, '');
  expect(vs).toMatch(/float push = mix\(-uCoreBack, uPush, smoothstep\(uCoreR, uRimR, length\(position\.xy\)\)\)/);
  expect(vs).toMatch(/max\(d - push, uMinView\) \/ d/);
  expect(vs).toMatch(/gl_Position = projectionMatrix \* vec4\(mv\.xyz \* k, 1\.0\)/);
}

describe('special aura placement', () => {
  it('on a quarter-pipe wall the glow centres on the body along up, not up the wall', () => {
    const aura = new SpecialAura('#ffb347');
    const feet = new Vector3(20, 2, 0);
    glowing(aura, feet, new Vector3(0, 0, 1));
    const c = aura.glowCenter;
    expect(c.x).toBeCloseTo(20, 6);
    expect(c.y).toBeCloseTo(2, 6);
    expect(c.z).toBeCloseTo(BODY_H * 0.55, 6);
  });

  it('the ground glow lies in the riding surface: its normal is the up axis', () => {
    const aura = new SpecialAura('#ffb347');
    const up = new Vector3(0, 0.6, 0.8);
    glowing(aura, new Vector3(0, 0, 0), up);
    const n = new Vector3(0, 0, 1).applyQuaternion(quads(aura).ground.quaternion);
    expect(n.distanceTo(up)).toBeLessThan(1e-6);
    // Flat ground keeps the old horizontal disc.
    glowing(aura, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    const flat = new Vector3(0, 0, 1).applyQuaternion(quads(aura).ground.quaternion);
    expect(flat.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it('the floor and a wall right behind the skater stay behind the whole visible glow', () => {
    // Raw, the quad (radius 1.3 m, centred 0.94 m up) dips below the floor, so the floor cut a straight
    // bottom edge into it. Each point moves along its own eye ray (same pixel): the rim forward to a
    // point above the floor, the core back but still in front of the wall 0.4 m behind the feet, so the
    // depth test passes across the whole soft falloff.
    const { aura, cam } = floorCase();
    expect(aura.depthPushM).toBeGreaterThanOrEqual(RADIUS);
    const { glow, ground } = quads(aura);
    expectShaderProfile(glow);
    expectShaderProfile(ground);
    let rawBelowFloor = 0;
    const samples: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 0]];
    for (let a = 0; a < 16; a++) for (const r of [0.3, 0.5, 0.6, 0.7, 0.8, 0.9]) samples.push([r * Math.cos(a * Math.PI / 8), r * Math.sin(a * Math.PI / 8)]);
    for (const [x, y] of samples) {
      const raw = new Vector3(x, y, 0).applyMatrix4(glow.matrixWorld);
      if (raw.y < 0) rawBelowFloor++;
      const w = pushedView(cam, glow, new Vector3(x, y, 0)).applyMatrix4(cam.matrixWorld);
      expect(w.y, `above the floor at (${x.toFixed(2)}, ${y.toFixed(2)})`).toBeGreaterThan(0);
      expect(w.z, `in front of the wall at (${x.toFixed(2)}, ${y.toFixed(2)})`).toBeGreaterThan(0);
      // Same pixel: the moved point projects where the raw one did.
      const pr = raw.clone().project(cam);
      const pp = w.clone().project(cam);
      expect(pp.x).toBeCloseTo(pr.x, 5);
      expect(pp.y).toBeCloseTo(pr.y, 5);
    }
    expect(rawBelowFloor).toBeGreaterThan(0); // the scene really reproduces the cut
  });

  it('the glow core stays behind the body, so the skater is never washed out by it', () => {
    // Round 1 slid the whole quad a radius (1.3 m) toward the camera: in front of the body, so the
    // additive glow passed the depth test over every skater pixel (pants (66,88,128) -> (163,128,108)).
    // Now the torso and knees region (under 0.45 of the radius) sits at least 0.2 m behind the body's
    // plane and the head and arms (up to 0.55) at least 0.1 m: behind any body surface facing us.
    const { aura, cam } = floorCase();
    const { glow, ground } = quads(aura);
    const centre = new Vector3().applyMatrix4(glow.matrixWorld).applyMatrix4(cam.matrixWorldInverse).length();
    for (let a = 0; a < 16; a++) {
      for (const r of [0, 0.15, 0.3, 0.45, 0.55]) {
        const clear = r <= 0.45 ? 0.2 : 0.1;
        const eye = pushedView(cam, glow, new Vector3(r * Math.cos(a * Math.PI / 8), r * Math.sin(a * Math.PI / 8), 0)).length();
        const rawEye = new Vector3(r * Math.cos(a * Math.PI / 8), r * Math.sin(a * Math.PI / 8), 0)
          .applyMatrix4(glow.matrixWorld).applyMatrix4(cam.matrixWorldInverse).length();
        // Along one eye ray: farther than the raw point on the body's plane by the clearance.
        expect(eye - rawEye, `glow core at r ${r}, step ${a}`).toBeGreaterThanOrEqual(clear * (rawEye / centre) - 1e-6);
      }
    }
    // The ground glow behind the feet (on screen: over the legs) stays behind the legs wherever it shows
    // (out to 0.75 of its radius; past that it is under 2 percent opacity).
    const feet = new Vector3(0, 0, 0.4).applyMatrix4(cam.matrixWorldInverse).length();
    for (let a = 0; a < 16; a++) {
      for (const r of [0.2, 0.4, 0.6, 0.75]) {
        const local = new Vector3(r * Math.cos(a * Math.PI / 8), r * Math.sin(a * Math.PI / 8), 0);
        const rawEye = local.clone().applyMatrix4(ground.matrixWorld).applyMatrix4(cam.matrixWorldInverse).length();
        // Only the part of the disc that lands over the legs on screen: behind the feet, within a leg width.
        if (rawEye < feet + 0.3 || Math.abs(local.x) * RADIUS * 0.9 > 0.3) continue;
        expect(pushedView(cam, ground, local).length(), `ground at r ${r}, step ${a}`).toBeGreaterThan(feet + 0.15);
      }
    }
  });

  it('the push never brings the glow nearer the eye than FX_AURA_MIN_VIEW_M', () => {
    const aura = new SpecialAura('#ffb347');
    glowing(aura, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 2);
    const cam = new PerspectiveCamera(60, 1, 0.05, 500);
    cam.position.set(0, 0.935, 1.0);
    cam.lookAt(0, 0.935, 0);
    cam.updateMatrixWorld(true);
    const { glow } = quads(aura);
    // The rim is pushed hardest; at 1 m the full push would put it behind the eye.
    const v = pushedView(cam, glow, new Vector3(0, 1, 0));
    expect(-v.z).toBeCloseTo(0.3, 5);
  });
});
