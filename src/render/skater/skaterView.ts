/**
 * src/render/skater/skaterView.ts (skater track): the procedural low-poly skater (2k to 4k tris,
 * capsules / boxes, bone hierarchy hips-spine-head-arms-legs, hoodie + cap + baggy pants, flat
 * shaded with rim light) posed from the interpolated SimSnapshot (REQ-SKT-01, REQ-SKT-03, REQ-SKT-05):
 * root = skater.pos / skater.rot; pose = getPose(skater.pose, skater.poseVariant, skater.posePhase)
 * (PoseId table in src/core/types.ts) blended over POSE_BLEND_MS; board = boardRel x
 * boardFlipRotation(flipId, flipPhase) while flipId is set (flipPhase, not posePhase: the board keeps
 * spinning when a grab or a grind snap takes the pose). Bail tumble
 * and get-up are scripted poses. No likeness of any real person.
 *
 * Scene graph: group (pos, rot) -> bodyRoot (stance yaw, pose root, lean) -> hips -> ... bones
 *                              -> boardMount (deck lift, boardRel x flip) -> pivot (pose tilt) -> board
 * After the FK pose the feet and grabbing hands listed in the pose's contacts are placed on the
 * board by two-bone IK, so limbs never sink into the deck (ik.ts).
 */

import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { TUNING } from '../../core/tuning';
import type { BoardConfig, SimSnapshot } from '../../core/types';
import type { SkaterView } from '../types';
import { createBoardModel, BOARD_CONTACT_Y } from './board';
import { DECK } from './deckGeometry';
import { deckSurfaceAt } from './deckGeometry';
import { positionInFrame, setQuaternionInFrame, solveTwoBone } from './ik';
import { blendPoses, boardFlipRotation, getPose, mirrorPose, RIG, type BoneId, type FootContact, type Pose, BONE_IDS } from './poses';
import { buildHumanoid, RIM_UNIFORMS, setBoneRotation, SKATER_COLORS, type Humanoid } from './rig';

const DEG = Math.PI / 180;
const REGULAR_STANCE_YAW = -90;

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
// IK scratch (no per-frame allocation): board orientation, targets, poles, the foot's old orientation.
const qBoardScratch = new Quaternion();
const qFootScratch = new Quaternion();
const qFootPrev = new Quaternion();
const targetScratch = new Vector3();
const upScratch = new Vector3();
const jointA = new Vector3();
const jointB = new Vector3();
const poleScratch = new Vector3();
const IDENTITY_Q = new Quaternion();
/** Knee pole: this far ahead of the authored knee (body -z), so the IK knee always bends forward. */
const KNEE_POLE_FORWARD_M = 0.25;
/** Elbow pole: past the authored elbow by half the upper arm, then this far outward. */
const ELBOW_POLE_OUT_M = 0.3;
const ELBOW_POLE_EXTEND = 0.5;
const tmpM = new Matrix4();
const tmpInv = new Matrix4();
const UP = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

const SLIDE_GRINDS = new Set(['boardslide', 'lipslide', 'gpu_slide']);

export interface SkaterViewExtras extends SkaterView {
  readonly rig: Humanoid;
  /** Rig triangle count (REQ-SKT-01 budget check). */
  readonly triangles: number;
}

/** Fakie: the head turns over the shoulder toward the tail (the travel direction). */
function fakieLayer(p: Pose, switchStance: boolean): Pose {
  const s = switchStance ? -1 : 1;
  const bones = { ...p.bones };
  const head = bones.head ?? { x: 0, y: 0, z: 0 };
  const chest = bones.chest ?? { x: 0, y: 0, z: 0 };
  bones.head = { x: head.x, y: head.y - 80 * s, z: head.z };
  bones.chest = { x: chest.x, y: chest.y - 24 * s, z: chest.z };
  return { ...p, bones };
}

export function createSkaterView(board: BoardConfig): SkaterViewExtras {
  const group = new Group();
  group.name = 'skater';
  const bodyRoot = new Object3D();
  bodyRoot.name = 'bodyRoot';
  const rig = buildHumanoid({ colors: SKATER_COLORS, head: 'cap', jacket: false });
  bodyRoot.add(rig.root);
  group.add(bodyRoot);

  const boardMount = new Object3D();
  boardMount.name = 'boardMount';
  const boardPivot = new Object3D();
  const boardModel = createBoardModel(board);
  boardPivot.add(boardModel.group);
  boardMount.add(boardPivot);
  group.add(boardMount);

  let displayed: Pose | null = null;
  let blendFrom: Pose | null = null;
  let blendT = 1;
  let lastKey = '';
  let lastStance = 'regular';
  let alignY = 0;
  let idlePhase = 0;

  const boneRot = (p: Pose, id: BoneId): { x: number; y: number; z: number } => p.bones[id] ?? { x: 0, y: 0, z: 0 };

  /** Board-local point -> group frame. */
  const boardToFrame = (x: number, y: number, z: number, out: Vector3): Vector3 => {
    tmpInv.copy(group.matrixWorld).invert();
    tmpM.copy(boardModel.group.matrixWorld);
    return out.set(x, y, z).applyMatrix4(tmpM).applyMatrix4(tmpInv);
  };

  const boardQuatInFrame = (out: Quaternion): Quaternion => {
    boardModel.group.matrixWorld.decompose(tmpV, out, tmpV2);
    group.matrixWorld.decompose(tmpV, tmpQ2, tmpV2);
    return out.premultiply(tmpQ2.invert());
  };

  const plantFoot = (side: 'L' | 'R', contact: FootContact, weight: number): void => {
    const thigh = rig.bones[`thigh${side}`];
    const shin = rig.bones[`shin${side}`];
    const foot = rig.bones[`foot${side}`];
    // Ground contacts (the push foot) sit on the skater-frame ground plane: the group origin is the
    // wheel contact, so that plane is y = 0 in the group frame. Deck contacts follow the board.
    const qBoard = contact.ground ? qBoardScratch.copy(IDENTITY_Q) : boardQuatInFrame(qBoardScratch);
    const up = upScratch.copy(UP).applyQuaternion(qBoard);
    let target: Vector3;
    if (contact.ground) target = targetScratch.set(contact.x, RIG.ankle, contact.z);
    else {
      const surf = deckSurfaceAt(contact.x, contact.z);
      target = boardToFrame(surf.x, surf.y, surf.z, targetScratch).addScaledVector(up, RIG.ankle);
    }
    // Bend toward the authored knee, biased forward (the body's -z).
    const knee = positionInFrame(shin, group, jointA);
    tmpV.set(0, 0, -1).applyQuaternion(bodyRoot.quaternion);
    const pole = poleScratch.copy(knee).addScaledVector(tmpV, KNEE_POLE_FORWARD_M);
    solveTwoBone({ upper: thigh, lower: shin, end: foot, target, pole, frame: group, weight });
    // Foot flat on the deck, toes along the contact yaw (degrees from +x toward the nose).
    const theta = (contact.yaw - 90) * DEG;
    const qFoot = qFootScratch.copy(qBoard).multiply(tmpQ.setFromAxisAngle(AXIS_Y, theta));
    if (weight >= 1) setQuaternionInFrame(foot, group, qFoot);
    else {
      qFootPrev.copy(foot.quaternion);
      setQuaternionInFrame(foot, group, qFoot);
      foot.quaternion.slerp(qFootPrev, 1 - weight);
    }
  };

  const reachHand = (side: 'L' | 'R', at: { x: number; y: number; z: number }, weight: number): void => {
    const upper = rig.bones[`upperArm${side}`];
    const lower = rig.bones[`lowerArm${side}`];
    const hand = side === 'L' ? rig.handL : rig.handR;
    const target = boardToFrame(at.x, at.y - DECK.thickness * 0.5, at.z, targetScratch);
    const shoulder = positionInFrame(upper, group, jointA);
    const elbow = positionInFrame(lower, group, jointB);
    // Elbow bends away from the body: past the authored elbow, plus outward (and a touch forward).
    const outward = tmpV.set(side === 'L' ? -1 : 1, 0, ELBOW_POLE_OUT_M).applyQuaternion(bodyRoot.quaternion);
    const pole = poleScratch.copy(elbow).sub(shoulder).multiplyScalar(ELBOW_POLE_EXTEND).add(elbow).addScaledVector(outward, ELBOW_POLE_OUT_M);
    solveTwoBone({ upper, lower, end: hand, target, pole, frame: group, weight });
  };

  const update = (snapshot: SimSnapshot, dtS: number): void => {
    const dt = Number.isFinite(dtS) ? Math.max(0, Math.min(0.1, dtS)) : 0;
    const k = snapshot.skater;
    RIM_UNIFORMS.uRimStrength.value = TUNING.SKATER_RIM_STRENGTH;
    RIM_UNIFORMS.uRimPower.value = TUNING.SKATER_RIM_POWER;
    RIM_UNIFORMS.uLightScale.value = TUNING.SKATER_LIGHT_SCALE;
    RIM_UNIFORMS.uSelfLight.value = TUNING.SKATER_SELF_LIGHT;
    rig.setOutline(TUNING.SKATER_OUTLINE_M, TUNING.SKATER_OUTLINE_BRIGHTNESS);

    // Root.
    group.position.set(k.pos.x, k.pos.y + alignY, k.pos.z);
    group.quaternion.set(k.rot.x, k.rot.y, k.rot.z, k.rot.w);

    // Target pose and blend.
    const switchStance = k.stance === 'switch';
    // A grab takes skater.grabId (tweaked_ ids included) so the rig can exaggerate a tweak.
    const variant = k.pose === 'grab' && k.grabId ? k.grabId : k.poseVariant;
    let target = getPose(k.pose, variant, k.posePhase);
    if (switchStance) target = mirrorPose(target);
    if (k.fakie && k.pose !== 'bail' && k.pose !== 'getup') target = fakieLayer(target, switchStance);
    const key = `${k.pose}|${variant ?? ''}|${k.stance}|${k.fakie ? 'f' : ''}`;
    if (key !== lastKey || k.stance !== lastStance) {
      blendFrom = displayed;
      blendT = displayed ? 0 : 1;
      lastKey = key;
      lastStance = k.stance;
    }
    const blendS = Math.max(0.001, TUNING.POSE_BLEND_MS / 1000);
    blendT = Math.min(1, blendT + dt / blendS);
    const pose = blendFrom && blendT < 1 ? blendPoses(blendFrom, target, blendT) : target;
    displayed = pose;
    const root = pose.root ?? { yaw: 0, pitch: 0, roll: 0, lift: 0 };
    const boardPose = pose.board ?? { tilt: { x: 0, y: 0, z: 0 }, pivotZ: 0, offset: { x: 0, y: 0, z: 0 } };
    const contacts = pose.contacts ?? { footL: null, footR: null, handL: null, handR: null };

    // Body root: stance yaw + pose yaw about y, then pitch about x, then roll about z (skater axes).
    const deckLift = TUNING.SKATER_DECK_LIFT_M;
    const stanceYaw = switchStance ? -REGULAR_STANCE_YAW : REGULAR_STANCE_YAW;
    bodyRoot.position.set(0, deckLift + root.lift, 0);
    bodyRoot.quaternion.setFromAxisAngle(AXIS_Z, root.roll * DEG);
    bodyRoot.quaternion.multiply(tmpQ.setFromAxisAngle(AXIS_X, root.pitch * DEG));
    bodyRoot.quaternion.multiply(tmpQ.setFromAxisAngle(AXIS_Y, (stanceYaw + root.yaw) * DEG));

    // Bones (FK).
    let hipsDrop = pose.hipsDrop;
    if (k.pose === 'roll') {
      idlePhase = k.posePhase;
      hipsDrop += TUNING.SKATER_IDLE_BOB_M * Math.sin(idlePhase * Math.PI * 2);
    }
    const linker = k.pose === 'grind' || k.pose === 'manual' || k.pose === 'noseManual' || k.pose === 'lip';
    if (linker && k.crouchCharge > 0) hipsDrop -= TUNING.SKATER_CROUCH_DROP_M * Math.min(1, k.crouchCharge);
    rig.bones.hips.position.y = RIG.hipY + hipsDrop;
    for (const id of BONE_IDS) {
      const r = boneRot(pose, id);
      setBoneRotation(rig.bones[id], r.x, r.y, r.z);
    }

    // Board: deck lift + pose offset, boardRel x flip about the deck centre, pose tilt about its pivot.
    boardMount.position.set(boardPose.offset.x, deckLift + boardPose.offset.y, boardPose.offset.z);
    boardMount.quaternion.set(k.boardRel.x, k.boardRel.y, k.boardRel.z, k.boardRel.w);
    if (k.flipId) {
      const f = boardFlipRotation(k.flipId, k.flipPhase);
      boardMount.quaternion.multiply(tmpQ.set(f.x, f.y, f.z, f.w));
    }
    boardPivot.position.set(0, 0, boardPose.pivotZ);
    boardPivot.rotation.set(boardPose.tilt.x * DEG, boardPose.tilt.y * DEG, boardPose.tilt.z * DEG, 'YXZ');
    boardModel.group.position.set(0, 0, -boardPose.pivotZ);
    boardModel.setDeckOverride(snapshot.special.activeId === 'kernel_panic' ? 'blueScreen' : 'none');
    if (k.contactPoint && !k.grind) boardModel.roll(k.speed * dt);

    // Contacts (IK) need current matrices.
    group.updateMatrixWorld(true);
    if (contacts.footL) plantFoot('L', contacts.footL, 1);
    if (contacts.footR) plantFoot('R', contacts.footR, 1);
    if (contacts.handL) reachHand('L', contacts.handL, 1);
    if (contacts.handR) reachHand('R', contacts.handR, 1);

    // Grind contact alignment (REQ-SKT-05): put the grinding part on snapshot.grind.contact.
    let wantAlign = 0;
    if (k.grind) {
      const partY = SLIDE_GRINDS.has(k.grind.type) ? BOARD_CONTACT_Y.deck : BOARD_CONTACT_Y.truck;
      group.updateMatrixWorld(true);
      tmpV.set(0, partY, 0).applyMatrix4(boardModel.group.matrixWorld);
      const max = TUNING.SKATER_GRIND_ALIGN_MAX_M;
      wantAlign = Math.max(-max, Math.min(max, alignY + (k.grind.contact.y - tmpV.y)));
    }
    alignY += (wantAlign - alignY) * Math.min(1, dt * TUNING.SKATER_GRIND_ALIGN_RATE);
    group.position.y = k.pos.y + alignY;
  };

  return {
    group,
    board: boardModel,
    rig,
    get triangles() {
      return rig.triangles;
    },
    update,
    setBoard(config) {
      boardModel.setConfig(config);
    },
    dispose() {
      rig.dispose();
      boardModel.dispose();
    },
  };
}
