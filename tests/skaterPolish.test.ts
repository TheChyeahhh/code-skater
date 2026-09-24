// @vitest-environment happy-dom
// tests/skaterPolish.test.ts (skater track): polish-round contracts. The balance lean follows its
// dev-panel sliders (REQ-SKT-03); grabs tilt the board well off flat and a tweak goes further; the
// board is a handful of draws; the Board Lab camera keeps the whole deck in frame at any aspect
// (REQ-LAB-01); pickup glow reads TUNING live (REQ-LVL-08); the crouch drop and grind-align rate
// are live tunables.
import { afterEach, describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import { mockSnapshotAt } from '../src/core/mock';
import { TUNING } from '../src/core/tuning';
import { DEFAULT_BOARD, type SimSnapshot } from '../src/core/types';
import { createLetterProp, createMacGuffinProp } from '../src/render/npc';
import { createBoardModel } from '../src/render/skater/board';
import { fitPreviewDistance, PREVIEW_FIT_MARGIN } from '../src/render/skater/boardPreview';
import { getPose } from '../src/render/skater/poses';
import { createSkaterView } from '../src/render/skater/skaterView';

// happy-dom has no 2D canvas: a do-nothing context is enough for the procedural board textures.
const fake: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 1 : k === 'width' || k === 'height' ? 64 : k === 'data' ? new Uint8ClampedArray(64 * 64 * 4) : fake),
  apply: () => fake,
  set: () => true,
});
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => fake;

const T = TUNING as unknown as Record<string, number>;
const saved: Record<string, number> = {};
function setTuning(key: string, v: number): void {
  if (!(key in saved)) saved[key] = T[key] as number;
  T[key] = v;
}
afterEach(() => {
  for (const k of Object.keys(saved)) T[k] = saved[k] as number;
  for (const k of Object.keys(saved)) delete saved[k];
});

describe('live sliders (REQ-SKT-03, REQ-SKT-05)', () => {
  it('SKATER_LEAN_DEG drives the grind roll and, by its ratio, the lip roll', () => {
    setTuning('SKATER_LEAN_DEG', 10);
    const a = getPose('grind', 'fifty_fifty', 1).root?.roll ?? 0;
    const lipA = getPose('lip', 'axle_stall', 1).root?.roll ?? 0;
    setTuning('SKATER_LEAN_DEG', 30);
    const b = getPose('grind', 'fifty_fifty', 1).root?.roll ?? 0;
    const lipB = getPose('lip', 'axle_stall', 1).root?.roll ?? 0;
    expect(Math.abs(a)).toBeCloseTo(10, 6);
    expect(Math.abs(b)).toBeCloseTo(30, 6);
    expect(Math.abs(lipB)).toBeCloseTo(30 * TUNING.SKATER_LIP_LEAN_RATIO, 6);
    expect(Math.abs(lipA)).toBeCloseTo(10 * TUNING.SKATER_LIP_LEAN_RATIO, 6);
  });

  it('SKATER_CROUCH_DROP_M lowers the hips of a charging linker', () => {
    const view = createSkaterView(DEFAULT_BOARD);
    const base = mockSnapshotAt(0) as SimSnapshot;
    const snap = { ...base, skater: { ...base.skater, pose: 'manual', poseVariant: 'manual', posePhase: 0.5, crouchCharge: 1, grind: null } } as SimSnapshot;
    setTuning('SKATER_CROUCH_DROP_M', 0);
    for (let i = 0; i < 20; i++) view.update(snap, 1 / 60);
    const high = view.rig.bones.hips.position.y;
    setTuning('SKATER_CROUCH_DROP_M', 0.3);
    view.update(snap, 1 / 60);
    const low = view.rig.bones.hips.position.y;
    expect(high - low).toBeCloseTo(0.3, 6);
    view.dispose();
  });
});

describe('grab silhouettes (REQ-SKT-03)', () => {
  const grabs = ['nosegrab', 'tailgrab', 'indy', 'melon', 'japan', 'stalefish', 'benihana', 'crossbone'] as const;
  const tiltDeg = (t: { x: number; y: number; z: number }): number => Math.hypot(t.x, t.z);

  it('every held grab turns the board at least 35 deg off flat, and a tweak turns it further', () => {
    for (const g of grabs) {
      const held = getPose('grab', g, 0.5).board?.tilt ?? { x: 0, y: 0, z: 0 };
      const tweaked = getPose('grab', `tweaked_${g}`, 0.5).board?.tilt ?? { x: 0, y: 0, z: 0 };
      expect(tiltDeg(held), g).toBeGreaterThanOrEqual(35);
      expect(tiltDeg(tweaked), g).toBeGreaterThan(tiltDeg(held));
    }
  });

  it('the grabs read apart: no two held grabs share the same board tilt and free-arm angle', () => {
    const keys = grabs.map((g) => {
      const p = getPose('grab', g, 0.5);
      const t = p.board?.tilt ?? { x: 0, y: 0, z: 0 };
      return `${t.x}|${t.y}|${t.z}`;
    });
    expect(new Set(keys).size).toBe(grabs.length);
  });
});

describe('board draws and the Board Lab frame (REQ-SKT-02, REQ-LAB-01)', () => {
  it('the board is at most 8 draws and 7 shadow casters (deck x3 groups, outline, trucks, axles, wheels, caps)', () => {
    const board = createBoardModel(DEFAULT_BOARD);
    let draws = 0;
    let casters = 0;
    board.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const groups = Array.isArray(o.material) ? Math.max(1, o.geometry.groups.length) : 1;
      draws += groups;
      if (o.castShadow) casters += groups;
    });
    expect(draws).toBeLessThanOrEqual(8);
    expect(casters).toBeLessThanOrEqual(7);
    const a = board.wheelAngle;
    board.roll(0.5);
    expect(board.wheelAngle).not.toBe(a);
    board.dispose();
  });

  it('the preview camera keeps a deck-sized sphere inside the frame at portrait and wide aspects', () => {
    const radius = 0.44;
    for (const aspect of [0.55, 0.7, 1, 1.8, 2.6]) {
      const cam = new PerspectiveCamera(32, aspect, 0.05, 20);
      const d = fitPreviewDistance(radius, cam.fov, aspect);
      const dir = new Vector3(0.45, 0.55, 0.95).normalize();
      cam.position.copy(dir).multiplyScalar(d);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      // Sample the sphere surface: every point projects inside NDC with room to spare.
      let maxNdc = 0;
      for (let i = 0; i < 400; i++) {
        const u = (i * 0.618034) % 1;
        const v = (i + 0.5) / 400;
        const th = u * Math.PI * 2;
        const ph = Math.acos(1 - 2 * v);
        const p = new Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)).multiplyScalar(radius).project(cam);
        maxNdc = Math.max(maxNdc, Math.abs(p.x), Math.abs(p.y));
      }
      expect(maxNdc, `aspect ${aspect}`).toBeLessThan(1);
      expect(maxNdc, `aspect ${aspect}`).toBeGreaterThan(1 / (1 + PREVIEW_FIT_MARGIN * 3));
    }
  });
});

describe('pickup glow (REQ-LVL-08)', () => {
  it('letters and MacGuffins follow RLV_PICKUP_EMISSIVE live', () => {
    const letter = createLetterProp('C');
    const laptop = createMacGuffinProp('secret_laptop');
    const emissives = (g: { traverse(cb: (o: unknown) => void): void }): number[] => {
      const out: number[] = [];
      g.traverse((o) => {
        if (o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.emissive.getHex() !== 0) out.push(o.material.emissiveIntensity);
      });
      return out;
    };
    setTuning('RLV_PICKUP_EMISSIVE', 1);
    letter.update?.(0.016);
    laptop.update?.(0.016);
    const lowL = Math.max(...emissives(letter.group));
    const lowM = Math.max(...emissives(laptop.group));
    setTuning('RLV_PICKUP_EMISSIVE', 4);
    letter.update?.(0.016);
    laptop.update?.(0.016);
    expect(Math.max(...emissives(letter.group))).toBeCloseTo(lowL * 4, 5);
    expect(Math.max(...emissives(laptop.group))).toBeGreaterThan(lowM * 2);
    letter.dispose();
    laptop.dispose();
  });
});
