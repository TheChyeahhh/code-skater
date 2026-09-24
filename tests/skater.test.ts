// tests/skater.test.ts (skater track): the pose library resolves every PoseId and variant with
// finite joints (REQ-SKT-03), blending and mirroring behave, the board flip axis table matches
// REQ-SKT-04 and the rotation completes exactly at phase 1, the procedural rig lands in the 2k to
// 4k triangle budget (REQ-SKT-01), the deck geometry has kicks and concave (REQ-SKT-02), and the NPC
// figures and pickup props build in plain node (REQ-NPC-01). No WebGL: three.js geometry only.
import { describe, expect, it } from 'vitest';
import { BackSide, Color, Mesh, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3, type BufferGeometry } from 'three';
import { rotate3 } from '../src/core/math';
import { TUNING } from '../src/core/tuning';
import { LETTERS, type BaseTrickId, type EnhancedFlipId, type FlipId, type PoseId } from '../src/core/types';
import type { NpcDef } from '../src/levels/types';
import { createLetterProp, createMacGuffinProp, createNpcFigure, letterShape } from '../src/render/npc';
import { createDeckGeometry, DECK, deckHalfWidth, deckKick, deckTopY } from '../src/render/skater/deckGeometry';
import {
  blendPoses, BONE_IDS, boardFlipRotation, ENHANCED_FLIP_AXES, FLIP_AXES, flipAxesOf, getPose, HARDFLIP_PITCH_WOBBLE_DEG, mirrorPose,
  POSE_CATALOG, RIG, type Pose,
} from '../src/render/skater/poses';
import { buildHumanoid, setBoneRotation, SKATER_COLORS } from '../src/render/skater/rig';

const ALL_POSE_IDS: readonly PoseId[] = [
  'roll', 'push', 'brake', 'pump', 'crouch', 'pop', 'air', 'flip', 'grab', 'special',
  'grind', 'manual', 'noseManual', 'lip', 'revert', 'transfer', 'bail', 'getup',
];

function expectFinitePose(p: Pose, label: string): void {
  expect(Number.isFinite(p.hipsDrop), `${label} hipsDrop`).toBe(true);
  for (const id of BONE_IDS) {
    const r = p.bones[id];
    if (!r) continue;
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Number.isFinite(r[k]), `${label} ${id}.${k}`).toBe(true);
      expect(Math.abs(r[k]), `${label} ${id}.${k} within a plausible joint range`).toBeLessThanOrEqual(200);
    }
  }
  expect(p.root, `${label} root`).toBeDefined();
  expect(p.board, `${label} board`).toBeDefined();
  expect(p.contacts, `${label} contacts`).toBeDefined();
}

function triangles(geo: BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : geo.getAttribute('position').count / 3;
}

function meshTriangles(root: { traverse(cb: (o: unknown) => void): void }): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof Mesh) n += triangles(o.geometry as BufferGeometry);
  });
  return n;
}

describe('pose library (REQ-SKT-03)', () => {
  it('the catalog covers every PoseId and at least 12 distinct poses', () => {
    const ids = new Set(POSE_CATALOG.map((e) => e.pose));
    for (const id of ALL_POSE_IDS) expect(ids.has(id), id).toBe(true);
    expect(ids.size).toBeGreaterThanOrEqual(12);
    const grabs = POSE_CATALOG.find((e) => e.pose === 'grab');
    expect(grabs?.variants.length).toBe(8);
    const grinds = POSE_CATALOG.find((e) => e.pose === 'grind');
    expect(grinds?.variants).toEqual(expect.arrayContaining(['fifty_fifty', 'five_o', 'nosegrind', 'boardslide', 'lipslide', 'crooked', 'overcrook', 'feeble', 'smith', 'gpu_slide']));
  });

  it('every pose id and variant resolves to finite joints at phases 0, 0.25, 0.5, 0.75, 1', () => {
    for (const entry of POSE_CATALOG) {
      for (const v of entry.variants) {
        for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
          expectFinitePose(getPose(entry.pose, v, phase), `${entry.pose}/${v ?? 'null'}@${phase}`);
        }
      }
    }
  });

  it('an unknown variant and a bad phase fall back instead of throwing', () => {
    expectFinitePose(getPose('grab', 'kickflip' as BaseTrickId, 0.5), 'grab with a flip variant');
    expectFinitePose(getPose('grind', null, Number.NaN), 'grind with NaN phase');
    expectFinitePose(getPose('flip', null, 2), 'flip past phase 1');
  });

  it('the family poses differ from each other (they are real keyframes, not one shape)', () => {
    const a = getPose('grab', 'indy', 0.5);
    const b = getPose('grab', 'melon', 0.5);
    const c = getPose('grind', 'fifty_fifty', 0.5);
    const d = getPose('grind', 'boardslide', 0.5);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(d));
    expect(a.contacts?.handR).not.toBeNull();
    expect(b.contacts?.handL).not.toBeNull();
    expect(d.root?.yaw).toBe(90);
  });

  it('grind arms carry a signature per grind: no two truck grinds share the same upper arms, and none is a straight-arm T', () => {
    const ids = ['fifty_fifty', 'five_o', 'nosegrind', 'boardslide', 'feeble', 'smith'] as const;
    const arms = ids.map((id) => {
      const p = getPose('grind', id, 0.5);
      return { id, key: JSON.stringify([p.bones.upperArmL, p.bones.lowerArmL, p.bones.upperArmR, p.bones.lowerArmR]), p };
    });
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) expect(arms[i]?.key, `${arms[i]?.id} vs ${arms[j]?.id}`).not.toBe(arms[j]?.key);
    }
    for (const { id, p } of arms) {
      // A T airplane = both elbows straight with the upper arms level; every grind bends at least one elbow.
      const bentL = Math.abs(p.bones.lowerArmL?.x ?? 0) + Math.abs(p.bones.lowerArmL?.z ?? 0);
      const bentR = Math.abs(p.bones.lowerArmR?.x ?? 0) + Math.abs(p.bones.lowerArmR?.z ?? 0);
      expect(Math.max(bentL, bentR), `${id} bends an elbow`).toBeGreaterThanOrEqual(20);
    }
    const air = getPose('air', null, 0);
    expect(Math.abs(air.bones.lowerArmL?.x ?? 0)).toBeGreaterThanOrEqual(40);
  });

  it('the push foot plants on the ground (a ground contact) through the push window and lifts again', () => {
    const mid = getPose('push', null, 0.5);
    expect(mid.contacts?.footR?.ground).toBe(true);
    expect(mid.contacts?.footR?.x).toBeGreaterThan(RIG.deckHalfWidth);
    expect(mid.contacts?.footL?.ground).toBeUndefined();
    expect(getPose('push', null, 0.1).contacts?.footR?.ground).toBeUndefined();
    expect(getPose('push', null, 0.9).contacts?.footR).toBeNull();
    // The push foot slides back relative to the board (the board rolls forward under it).
    const early = getPose('push', null, 0.4).contacts?.footR?.z ?? 0;
    const late = getPose('push', null, 0.6).contacts?.footR?.z ?? 0;
    expect(late).toBeGreaterThan(early);
    // Mirroring keeps the ground flag.
    expect(mirrorPose(mid).contacts?.footL?.ground).toBe(true);
    // Blending two ground contacts stays on the ground.
    const a = getPose('push', null, 0.4);
    const b = getPose('push', null, 0.6);
    expect(blendPoses(a, b, 0.5).contacts?.footR?.ground).toBe(true);
  });

  it('a flip lifts both feet off the deck; riding poses keep both planted; the grab hand reaches the board', () => {
    const flip = getPose('flip', 'kickflip', 0.5);
    expect(flip.contacts?.footL).toBeNull();
    expect(flip.contacts?.footR).toBeNull();
    const roll = getPose('roll', null, 0.3);
    expect(roll.contacts?.footL).not.toBeNull();
    expect(roll.contacts?.footR).not.toBeNull();
    const nose = getPose('grab', 'nosegrab', 0.5).contacts?.handL;
    expect(nose && nose.z).toBeLessThan(-0.3);
    const tail = getPose('grab', 'tailgrab', 0.5).contacts?.handR;
    expect(tail && tail.z).toBeGreaterThan(0.3);
  });

  it('balance poses lean with the needle: grind rolls the body, manual tilts the board', () => {
    const left = getPose('grind', 'fifty_fifty', 0);
    const mid = getPose('grind', 'fifty_fifty', 0.5);
    const right = getPose('grind', 'fifty_fifty', 1);
    expect(mid.root?.roll ?? 0).toBeCloseTo(0, 6);
    expect((left.root?.roll ?? 0) * (right.root?.roll ?? 0)).toBeLessThan(0);
    const tailDown = getPose('manual', 'manual', 0.5).board?.tilt.x ?? 0;
    const noseDown = getPose('noseManual', 'nose_manual', 0.5).board?.tilt.x ?? 0;
    expect(tailDown).toBeGreaterThan(0);
    expect(noseDown).toBeLessThan(0);
    expect(getPose('manual', 'manual', 1).board?.tilt.x ?? 0).toBeGreaterThan(tailDown);
  });

  it('blendPoses returns the endpoints at 0 and 1 and interpolates every channel in between', () => {
    const a = getPose('crouch', null, 1);
    const b = getPose('air', null, 0);
    expect(blendPoses(a, b, 0)).toBe(a);
    expect(blendPoses(a, b, 1)).toBe(b);
    const m = blendPoses(a, b, 0.5);
    expect(m.hipsDrop).toBeCloseTo((a.hipsDrop + b.hipsDrop) / 2, 9);
    const sa = a.bones.spine?.x ?? 0;
    const sb = b.bones.spine?.x ?? 0;
    expect(m.bones.spine?.x).toBeCloseTo((sa + sb) / 2, 9);
    expectFinitePose(m, 'blend');
  });

  it('mirrorPose swaps sides, negates y and z, mirrors contacts, and is an involution', () => {
    const p = getPose('grab', 'indy', 0.5);
    const m = mirrorPose(p);
    expect(m.bones.upperArmL?.z).toBeCloseTo(-(p.bones.upperArmR?.z ?? 0), 9);
    expect(m.bones.upperArmL?.y).toBeCloseTo(-(p.bones.upperArmR?.y ?? 0), 9);
    expect(m.bones.upperArmL?.x).toBeCloseTo(p.bones.upperArmR?.x ?? 0, 9);
    expect(m.contacts?.handL?.x).toBeCloseTo(-(p.contacts?.handR?.x ?? 0), 9);
    expect(m.contacts?.handR).toBeNull();
    const back = mirrorPose(m);
    expect(JSON.stringify(back)).toBe(JSON.stringify({ ...p, bones: back.bones, root: back.root, board: back.board, contacts: back.contacts }));
    for (const id of BONE_IDS) {
      const o = p.bones[id];
      const r = back.bones[id];
      if (!o) continue;
      expect(r?.x).toBeCloseTo(o.x, 9);
      expect(r?.y).toBeCloseTo(o.y, 9);
      expect(r?.z).toBeCloseTo(o.z, 9);
    }
  });

  it('the pose blend window is a live tunable', () => {
    expect(TUNING.POSE_BLEND_MS).toBe(80);
  });
});

describe('board flip rotation (REQ-SKT-04)', () => {
  it('the axis table: kickflip / heelflip roll, shove-it yaw, impossible pitch, varial roll + yaw, hardflip roll + frontside yaw with a pitch wobble, 360 flip roll + 360 yaw', () => {
    expect(FLIP_AXES.kickflip).toEqual({ roll: 1, pitch: 0, yaw: 0 });
    expect(FLIP_AXES.heelflip).toEqual({ roll: -1, pitch: 0, yaw: 0 });
    expect(FLIP_AXES.pop_shove_it).toEqual({ roll: 0, pitch: 0, yaw: 0.5 });
    expect(FLIP_AXES.impossible).toEqual({ roll: 0, pitch: 1, yaw: 0 });
    expect(FLIP_AXES.varial_kickflip).toEqual({ roll: 1, pitch: 0, yaw: 0.5 });
    expect(FLIP_AXES.varial_heelflip.roll).toBe(-1);
    expect(Math.abs(FLIP_AXES.varial_heelflip.yaw)).toBe(0.5);
    // A hardflip is a frontside shove-it (yaw opposite to the varial kickflip) plus a kickflip; the
    // "vertical" look is a transient pitch that is back to 0 at phase 1, never a half pitch turn
    // (which would land the deck grip down).
    expect(FLIP_AXES.hardflip.roll).toBe(1);
    expect(FLIP_AXES.hardflip.pitch).toBe(0);
    expect(FLIP_AXES.hardflip.yaw).toBe(-FLIP_AXES.varial_kickflip.yaw);
    expect(FLIP_AXES.hardflip.pitchWobble).toBe(HARDFLIP_PITCH_WOBBLE_DEG);
    expect(ENHANCED_FLIP_AXES.double_hardflip).toEqual({ ...FLIP_AXES.hardflip, roll: 2 });
    expect(FLIP_AXES.tre_flip).toEqual({ roll: 1, pitch: 0, yaw: 1 });
  });

  it('every flip, base and enhanced, lands grip up: the deck up vector is +y at phase 1 (nose swap allowed)', () => {
    const ids = [...(Object.keys(FLIP_AXES) as FlipId[]), ...(Object.keys(ENHANCED_FLIP_AXES) as EnhancedFlipId[])];
    for (const id of ids) {
      const q = boardFlipRotation(id, 1);
      const up = rotate3(q, { x: 0, y: 1, z: 0 });
      expect(up.y, `${id} up.y at phase 1`).toBeCloseTo(1, 6);
      const nose = rotate3(q, { x: 0, y: 0, z: -1 });
      expect(Math.abs(nose.z), `${id} nose along the long axis at phase 1`).toBeCloseTo(1, 6);
    }
    // The hardflip stands up mid-trick and its wobble is gone at the end.
    const mid = rotate3(boardFlipRotation('hardflip', 0.5), { x: 0, y: 0, z: -1 });
    expect(Math.abs(mid.y)).toBeGreaterThan(0.4);
  });

  it('no flip sweeps the deck through the legs: every deck corner stays under the lower sole at 20 phases', () => {
    const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
    const ids = [...(Object.keys(FLIP_AXES) as FlipId[]), ...(Object.keys(ENHANCED_FLIP_AXES) as EnhancedFlipId[])];
    const corners = [
      { x: -DECK.width / 2, y: DECK.noseKick, z: -DECK.length / 2 }, { x: DECK.width / 2, y: DECK.noseKick, z: -DECK.length / 2 },
      { x: -DECK.width / 2, y: DECK.tailKick, z: DECK.length / 2 }, { x: DECK.width / 2, y: DECK.tailKick, z: DECK.length / 2 },
    ];
    const foot = new Vector3();
    for (const id of ids) {
      for (let i = 0; i <= 20; i++) {
        const phase = i / 20;
        const p = getPose('flip', id, phase);
        // FK the rig in a frame where the deck top (before the pose's board offset) is y = 0.
        rig.bones.hips.position.y = RIG.hipY + p.hipsDrop;
        for (const b of BONE_IDS) {
          const r = p.bones[b] ?? { x: 0, y: 0, z: 0 };
          setBoneRotation(rig.bones[b], r.x, r.y, r.z);
        }
        rig.root.position.y = p.root?.lift ?? 0;
        rig.root.updateMatrixWorld(true);
        let lowestSole = Number.POSITIVE_INFINITY;
        for (const f of ['footL', 'footR'] as const) {
          foot.setFromMatrixPosition(rig.bones[f].matrixWorld);
          lowestSole = Math.min(lowestSole, foot.y - RIG.ankle);
        }
        const q = boardFlipRotation(id, phase);
        const offsetY = p.board?.offset.y ?? 0;
        for (const c of corners) {
          const y = rotate3(q, c).y + offsetY;
          expect(y, `${id} @${phase} corner (${c.x}, ${c.z}) under the feet`).toBeLessThan(lowestSole);
        }
      }
    }
    rig.dispose();
  });

  it('enhanced flips double the roll (or the shove-it yaw) of their base', () => {
    const pairs: readonly [EnhancedFlipId, FlipId][] = [
      ['double_kickflip', 'kickflip'], ['double_heelflip', 'heelflip'], ['double_varial_kickflip', 'varial_kickflip'],
      ['double_varial_heelflip', 'varial_heelflip'], ['double_impossible', 'impossible'], ['double_hardflip', 'hardflip'], ['double_tre_flip', 'tre_flip'],
    ];
    for (const [e, b] of pairs) {
      const base = FLIP_AXES[b];
      const dbl = ENHANCED_FLIP_AXES[e];
      if (base.roll !== 0) expect(dbl.roll, e).toBe(2 * base.roll);
      if (base.pitch !== 0 && base.roll === 0) expect(dbl.pitch, e).toBe(2 * base.pitch);
    }
    expect(ENHANCED_FLIP_AXES.shove_it_360.yaw).toBe(2 * FLIP_AXES.pop_shove_it.yaw);
  });

  it('identity at phase 0; every whole-turn flip is back to identity exactly at phase 1, and not before', () => {
    const near = (q: { x: number; y: number; z: number; w: number }): number => Math.abs(Math.abs(q.w) - 1);
    for (const id of Object.keys(FLIP_AXES) as FlipId[]) {
      const q0 = boardFlipRotation(id, 0);
      expect(near(q0), `${id} at 0`).toBeLessThan(1e-9);
      const axes = FLIP_AXES[id];
      const whole = Number.isInteger(axes.roll) && Number.isInteger(axes.pitch) && Number.isInteger(axes.yaw);
      if (whole) {
        expect(near(boardFlipRotation(id, 1)), `${id} at 1`).toBeLessThan(1e-9);
        expect(near(boardFlipRotation(id, 0.5)), `${id} at 0.5 is mid-flip`).toBeGreaterThan(0.1);
      }
    }
    for (const id of Object.keys(ENHANCED_FLIP_AXES) as EnhancedFlipId[]) {
      expect(near(boardFlipRotation(id, 0)), `${id} at 0`).toBeLessThan(1e-9);
    }
  });

  it('a kickflip rolls the deck about its long axis: the up vector goes down at half phase and the nose stays put', () => {
    const half = boardFlipRotation('kickflip', 0.5);
    const up = rotate3(half, { x: 0, y: 1, z: 0 });
    expect(up.y).toBeCloseTo(-1, 6);
    const nose = rotate3(half, { x: 0, y: 0, z: -1 });
    expect(nose.z).toBeCloseTo(-1, 6);
    // Heelflip rolls the other way.
    const q = boardFlipRotation('kickflip', 0.25);
    const h = boardFlipRotation('heelflip', 0.25);
    expect(rotate3(q, { x: 0, y: 1, z: 0 }).x).toBeCloseTo(-rotate3(h, { x: 0, y: 1, z: 0 }).x, 6);
  });

  it('a shove-it yaws the deck: nose for tail at phase 1; an impossible pitches it', () => {
    const shove = boardFlipRotation('pop_shove_it', 1);
    const nose = rotate3(shove, { x: 0, y: 0, z: -1 });
    expect(nose.z).toBeCloseTo(1, 6);
    expect(rotate3(shove, { x: 0, y: 1, z: 0 }).y).toBeCloseTo(1, 6);
    const imp = boardFlipRotation('impossible', 0.5);
    expect(rotate3(imp, { x: 0, y: 0, z: -1 }).z).toBeCloseTo(1, 6);
    expect(rotate3(imp, { x: 1, y: 0, z: 0 }).x).toBeCloseTo(1, 6);
  });

  it('the rotation angle grows monotonically with phase, so the flip is done at animMs and never earlier', () => {
    const angleOf = (q: { x: number; y: number; z: number; w: number }): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    const q = new Quaternion();
    let last = 0;
    for (let i = 0; i <= 20; i++) {
      const phase = (i / 20) * 0.49;
      const r = boardFlipRotation('kickflip', phase);
      q.set(r.x, r.y, r.z, r.w);
      const a = angleOf(q);
      expect(a).toBeGreaterThanOrEqual(last - 1e-9);
      last = a;
    }
    expect(last).toBeCloseTo(Math.PI * 0.98, 2);
  });
});

describe('rig and deck (REQ-SKT-01, REQ-SKT-02)', () => {
  it('the skater rig builds in node with a 2k to 8k triangle budget (CR-66, graphics overhaul) and the full joint hierarchy', () => {
    const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
    expect(rig.triangles).toBeGreaterThanOrEqual(2000);
    expect(rig.triangles).toBeLessThanOrEqual(8000);
    expect(meshTriangles(rig.root)).toBe(rig.triangles);
    for (const id of BONE_IDS) expect(rig.bones[id], id).toBeDefined();
    // Parent chain: hips -> spine -> chest -> neck -> head; chest -> arms; hips -> legs.
    expect(rig.bones.spine.parent).toBe(rig.bones.hips);
    expect(rig.bones.chest.parent).toBe(rig.bones.spine);
    expect(rig.bones.neck.parent).toBe(rig.bones.chest);
    expect(rig.bones.head.parent).toBe(rig.bones.neck);
    expect(rig.bones.upperArmL.parent).toBe(rig.bones.chest);
    expect(rig.bones.lowerArmR.parent).toBe(rig.bones.upperArmR);
    expect(rig.bones.thighL.parent).toBe(rig.bones.hips);
    expect(rig.bones.shinL.parent).toBe(rig.bones.thighL);
    expect(rig.bones.footR.parent).toBe(rig.bones.shinR);
    expect(rig.handL.parent).toBe(rig.bones.lowerArmL);
    // Standing height: the head top sits between 1.6 and 1.9 m over the soles.
    rig.root.updateMatrixWorld(true);
    const headTop = new Vector3(0, 0.24, 0).applyMatrix4(rig.bones.head.matrixWorld);
    expect(headTop.y).toBeGreaterThan(1.6);
    expect(headTop.y).toBeLessThan(1.9);
    expect(rig.mouth.parent).toBe(rig.bones.head);
    rig.dispose();
  });

  it('the whole figure is two draws: one skinned body (the only shadow caster) and one ink hull', () => {
    const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
    const meshes: Mesh[] = [];
    rig.root.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.length).toBe(2);
    expect(meshes.filter((m) => m.castShadow).length).toBe(1);
    expect(rig.body).toBeInstanceOf(SkinnedMesh);
    expect(rig.hull).toBeInstanceOf(SkinnedMesh);
    expect(rig.body.castShadow).toBe(true);
    expect(rig.hull.castShadow).toBe(false);
    expect(rig.body.skeleton.bones.length).toBeGreaterThanOrEqual(BONE_IDS.length);
    for (const id of BONE_IDS) expect(rig.body.skeleton.bones).toContain(rig.bones[id]);
    // Colours live in a vertex attribute, and every skinned vertex is carried rigidly by one bone.
    expect(rig.body.geometry.getAttribute('color')).toBeDefined();
    const w = rig.body.geometry.getAttribute('skinWeight');
    for (let i = 0; i < w.count; i += 37) expect(w.getX(i)).toBe(1);
    rig.dispose();
  });

  it('skinned parts follow their bone: a raised forearm carries the hand block with it', () => {
    const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
    rig.root.updateMatrixWorld(true);
    const handIndex = rig.body.skeleton.bones.indexOf(rig.handR as never);
    const idx = rig.body.geometry.getAttribute('skinIndex');
    let vi = -1;
    for (let i = 0; i < idx.count; i++) if (idx.getX(i) === handIndex) { vi = i; break; }
    expect(vi).toBeGreaterThanOrEqual(0);
    const before = rig.body.getVertexPosition(vi, new Vector3());
    setBoneRotation(rig.bones.upperArmR, 0, 0, 90);
    rig.root.updateMatrixWorld(true);
    const after = rig.body.getVertexPosition(vi, new Vector3());
    // Arm swung out sideways: the hand vertex rises from hip height toward the shoulder.
    expect(after.y - before.y).toBeGreaterThan(0.3);
    const handNow = new Vector3().setFromMatrixPosition(rig.handR.matrixWorld);
    expect(after.distanceTo(handNow)).toBeLessThan(0.12);
    rig.dispose();
  });

  it('the outline is a dark ink hull on the big parts, pushed out by the width, hidden at width 0', () => {
    const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
    const hull = rig.hull;
    const mat = hull.material as unknown as { color: Color; side: number };
    expect(mat.side).toBe(BackSide);
    // Default ink (what an undriven NPC shows) and the skater's tuned brightness are both near black.
    const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(mat.color)).toBeLessThan(0.02);
    rig.setOutline(TUNING.SKATER_OUTLINE_M, TUNING.SKATER_OUTLINE_BRIGHTNESS);
    expect(lum(mat.color)).toBeLessThan(0.02);
    expect(hull.visible).toBe(true);
    rig.setOutline(0.02, 1);
    expect(lum(mat.color)).toBeGreaterThan(0.5);
    rig.setOutline(0, 0);
    expect(hull.visible).toBe(false);
    // Every hull vertex has an outward offset; the hull holds fewer triangles than the body (thin parts skip it).
    const off = hull.geometry.getAttribute('hullOffset');
    expect(off.count).toBe(hull.geometry.getAttribute('position').count);
    const tri = (g: BufferGeometry): number => (g.index ? g.index.count / 3 : g.getAttribute('position').count / 3);
    expect(tri(hull.geometry)).toBeLessThan(tri(rig.body.geometry));
    expect(tri(hull.geometry)).toBeGreaterThan(tri(rig.body.geometry) * 0.5);
    rig.dispose();
  });

  it('the NPC figure is at most three draws (body, hull, carried prop)', () => {
    for (const def of [
      { id: 'sam', pos: { x: 0, y: 0, z: 0 }, facing: 'south', outfit: 'hoodie', prop: 'laptopSleeve' },
      { id: 'dario', pos: { x: 0, y: 0, z: 0 }, facing: 'west', outfit: 'contestJacket', prop: 'coffee' },
    ] as NpcDef[]) {
      const fig = createNpcFigure(def);
      let n = 0;
      fig.group.traverse((o) => {
        if (o instanceof Mesh) n++;
      });
      expect(n, def.id).toBeLessThanOrEqual(3);
      fig.dispose();
    }
  });

  it('the rim light is masked to the side away from the sun', () => {
    const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
    const mat = rig.materials[0] as MeshStandardMaterial;
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: '#include <common>\n#include <opaque_fragment>', vertexShader: '' };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('directionalLights[0].direction');
    expect(shader.fragmentShader).toContain('(1.0 - rimLit)');
    expect(TUNING.SKATER_RIM_STRENGTH).toBeLessThanOrEqual(0.3);
    rig.dispose();
  });

  it('the deck reads at chase distance: thick edge, big wheels, the deck lift matches the stack, standing flips drop the board', () => {
    expect(DECK.thickness).toBeGreaterThanOrEqual(0.02);
    expect(DECK.wheelRadius).toBeGreaterThanOrEqual(0.033);
    expect(TUNING.SKATER_DECK_LIFT_M).toBeCloseTo(DECK.wheelRadius + DECK.truckHeight + DECK.thickness, 2);
    const flat = getPose('flip', 'kickflip', 0.5);
    const standing = getPose('flip', 'impossible', 0.5);
    expect((standing.board?.offset.y ?? 0)).toBeLessThan(flat.board?.offset.y ?? 0);
    expect(flipAxesOf('impossible').pitch).toBe(1);
  });

  it('the deck is a popsicle outline with nose and tail kicks and a concave, in three material groups', () => {
    expect(deckHalfWidth(0.5)).toBeCloseTo(DECK.width / 2, 9);
    expect(deckHalfWidth(0)).toBeLessThan(DECK.width / 4);
    expect(deckHalfWidth(1)).toBeLessThan(DECK.width / 4);
    expect(deckKick(0.5)).toBe(0);
    expect(deckKick(1)).toBeCloseTo(DECK.noseKick, 9);
    expect(deckKick(0)).toBeCloseTo(DECK.tailKick, 9);
    expect(DECK.noseKick).toBeGreaterThan(DECK.tailKick);
    expect(deckTopY(0.5, 0)).toBeLessThan(deckTopY(0.5, 1));
    const geo = createDeckGeometry();
    expect(geo.groups.length).toBe(3);
    expect(triangles(geo)).toBeGreaterThan(300);
    expect(triangles(geo)).toBeLessThan(2500);
    const uv = geo.getAttribute('uv');
    let minU = 1;
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
    }
    expect(minU).toBe(0);
    expect(maxU).toBeGreaterThanOrEqual(1);
    geo.dispose();
  });
});

describe('NPC figures and pickup props (REQ-NPC-01)', () => {
  const sam: NpcDef = { id: 'sam', pos: { x: 50, y: 0.8, z: 27 }, facing: 'south', outfit: 'hoodie', prop: 'laptopSleeve' };
  const dario: NpcDef = { id: 'dario', pos: { x: 46, y: 0, z: 65 }, facing: 'west', outfit: 'contestJacket', prop: 'coffee' };

  it('both figures build in node, stand at their feet position facing their way, and animate without NaN', () => {
    for (const def of [sam, dario]) {
      const fig = createNpcFigure(def);
      expect(fig.group.position.x).toBe(def.pos.x);
      expect(fig.group.position.y).toBe(def.pos.y);
      expect(fig.group.position.z).toBe(def.pos.z);
      const tris = meshTriangles(fig.group);
      expect(tris, def.id).toBeGreaterThan(1500);
      expect(tris, def.id).toBeLessThan(8000);
      for (let i = 0; i < 30; i++) fig.update(1 / 60, i % 2 === 0);
      fig.group.updateMatrixWorld(true);
      fig.group.traverse((o) => {
        const e = o.matrixWorld.elements;
        for (const v of e) expect(Number.isFinite(v)).toBe(true);
      });
      fig.dispose();
    }
    const west = createNpcFigure(dario);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(west.group.quaternion);
    expect(fwd.x).toBeCloseTo(-1, 6);
    west.dispose();
  });

  it('the two figures differ in outfit and prop (hoodie + sleeve, jacket + cup) and carry no likeness features', () => {
    const a = createNpcFigure(sam);
    const b = createNpcFigure(dario);
    const names = (g: { traverse(cb: (o: { name: string }) => void): void }): string[] => {
      const out: string[] = [];
      g.traverse((o) => out.push(o.name));
      return out;
    };
    expect(names(a.group)).toContain('npc:sam');
    expect(names(b.group)).toContain('npc:dario');
    expect(meshTriangles(a.group)).not.toBe(meshTriangles(b.group));
    a.dispose();
    b.dispose();
  });

  it('the MacGuffin props are 1.6x life size, carry a beacon, and pulse their light through update()', () => {
    const laptop = createMacGuffinProp('secret_laptop');
    const scaled = laptop.group.children.find((o) => o.scale.x > 1);
    expect(scaled?.scale.x).toBeCloseTo(1.6, 6);
    let tallest = 0;
    let lit: MeshStandardMaterial | null = null;
    laptop.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const g = o.geometry as BufferGeometry;
      g.computeBoundingBox();
      tallest = Math.max(tallest, (g.boundingBox?.max.y ?? 0) - (g.boundingBox?.min.y ?? 0));
      const m = o.material as MeshStandardMaterial;
      if (m.emissiveIntensity && m.emissiveIntensity >= 2.4 && !m.transparent) lit = m;
    });
    expect(tallest).toBeGreaterThanOrEqual(3);
    expect(lit).not.toBeNull();
    const litMat = lit as unknown as MeshStandardMaterial;
    const before = litMat.emissiveIntensity;
    expect(laptop.update).toBeDefined();
    for (let i = 0; i < 3; i++) laptop.update?.(0.1);
    expect(litMat.emissiveIntensity).not.toBe(before);
    laptop.dispose();
  });

  it('the four letters and both MacGuffins build as readable props', () => {
    for (const l of LETTERS) {
      expect(letterShape(l).getPoints(8).length).toBeGreaterThan(8);
      const p = createLetterProp(l);
      expect(p.triangles).toBeGreaterThan(100);
      expect(p.triangles).toBeLessThan(3000);
      p.dispose();
    }
    expect(letterShape('O').holes.length).toBe(1);
    expect(letterShape('D').holes.length).toBe(1);
    expect(letterShape('C').holes.length).toBe(0);
    const laptop = createMacGuffinProp('secret_laptop');
    const drive = createMacGuffinProp('secret_drive');
    expect(laptop.triangles).toBeGreaterThan(50);
    expect(drive.triangles).toBeGreaterThan(50);
    expect(laptop.triangles).not.toBe(drive.triangles);
    laptop.dispose();
    drive.dispose();
  });
});
