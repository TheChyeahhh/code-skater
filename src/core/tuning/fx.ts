/**
 * src/core/tuning/fx.ts (fx track): the fx track's own tunables. Only the fx track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:fx").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * The DESIGN M numbers for the camera and FX (CAM_*, HITSTOP_*, FLASH_*, SPARK_RATE_PER_S,
 * DUST_BURST_COUNT) live in the frozen area sections of src/core/tuning.ts; the keys below are the
 * fx track's own look and framing numbers. FXCAM_ = chase camera extras, FX_ = effects.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const FX_TUNING = {
  // --- chase camera extras (src/render/camera.ts) ---------------------------------------------
  FXCAM_TARGET_UP_M: [0.8, 0.3, 1.5, 0.05, 'm', 'REQ-CAM-01', 'Look target height above feet'], // REQ-CAM-01, 0.3 to 1.5 m: camera.lookAhead sits at feet height, the camera looks at the torso.
  FXCAM_ANCHOR_Y_OMEGA: [10, 4, 20, 0.5, '1/s', 'REQ-CAM-01', 'Vertical follow omega'], // REQ-CAM-01, 4 to 20: the anchor follows the skater rigidly in x / z and springs in y, so an ollie lifts the skater in frame instead of the whole frame.
  FXCAM_PIVOT_UP_M: [1.0, 0.5, 1.6, 0.05, 'm', 'REQ-CAM-05', 'Collision ray origin height'], // REQ-CAM-05, 0.5 to 1.6 m: the boom ray starts at hip height so a kerb never shortens it.
  FXCAM_BOOM_RETURN_OMEGA: [3.5, 1, 12, 0.1, '1/s', 'REQ-CAM-05', 'Boom lengthen omega'], // REQ-CAM-05, 1 to 12: a hit shortens the boom at once, the boom grows back at this critically damped rate so a passed pillar never pops the camera.
  FXCAM_BOOM_CLEAR_OMEGA: [7, 2, 14, 0.1, '1/s', 'REQ-CAM-05', 'Boom lengthen omega once clear'], // REQ-CAM-05, 2 to 14: when the ray no longer hits anything the boom grows back at this faster rate (FXCAM_BOOM_RETURN_OMEGA still eases a partial cut), so a cleared ramp never leaves the camera close for a second.
  FXCAM_VERT_HOLD_MAX_S: [1.5, 0, 3, 0.05, 's', 'REQ-CAM-02', 'Vert re-entry yaw hold limit'], // REQ-CAM-02, 0 to 3 s (0 = off): after a vert air re-enters and the heading flips, the boom stays on the open side (in front of the skater) until the boom behind is clear of the ramp, at most this long.
  FXCAM_VERT_HOLD_MIN_DEG: [90, 30, 180, 1, 'deg', 'REQ-CAM-02', 'Vert re-entry hold swing threshold'], // REQ-CAM-02, 30 to 180 deg: the hold only starts when the re-entry would swing the boom by more than this.
  FXCAM_VERT_HOLD_CLEAR: [0.9, 0.5, 1, 0.01, 'ratio', 'REQ-CAM-02', 'Vert re-entry hold release'], // REQ-CAM-02, 0.5 to 1: the hold ends once the boom behind the skater would keep at least this share of its length.
  FXCAM_ORBIT_PITCH_MAX_DEG: [35, 10, 60, 1, 'deg', 'REQ-CAM-03', 'Orbit pitch limit'], // REQ-CAM-03, 10 to 60 deg: stick / mouse y tilts the boom up or down within this.
  FXCAM_ORBIT_RETURN_OMEGA: [6, 2, 12, 0.1, '1/s', 'REQ-CAM-03', 'Orbit spring-back omega'], // REQ-CAM-03, 2 to 12: critically damped return of the orbit angles once CAM_ORBIT_RETURN_S passed.
  FXCAM_GRIND_SIDE_M: [0.7, 0, 1.5, 0.05, 'm', 'REQ-CAM-01', 'Grind framing side offset'], // REQ-CAM-01, 0 to 1.5 m: on a rail the camera slides to the right of travel so the rail reads.
  FXCAM_GRIND_UP_SCALE: [0.85, 0.5, 1, 0.01, 'ratio', 'REQ-CAM-01', 'Grind framing height scale'], // REQ-CAM-01, 0.5 to 1: a lower boom on a rail keeps the wheels and the rail in frame.
  FXCAM_BAIL_BACK_EXTRA_M: [0.8, 0, 2, 0.05, 'm', 'REQ-CAM-06', 'Bail framing extra distance'], // REQ-CAM-06, 0 to 2 m: the tumble is framed a little wider; the heading is frozen at the bail.
  FXCAM_VERT_LOOK_DROP_M: [1.2, 0, 3, 0.05, 'm', 'REQ-CAM-02', 'Vert air look target drop'], // REQ-CAM-02, 0 to 3 m: in vert air the look point sinks toward the coping so the ramp stays in frame.
  FXCAM_VERT_RAMP_BIAS_M: [1.0, 0, 3, 0.05, 'm', 'REQ-CAM-02', 'Vert air look bias toward the ramp'], // REQ-CAM-02, 0 to 3 m: the look point moves against rampNormal so the wall the skater will land on reads.
  FXCAM_KICK_RAMP: [0.06, 0.01, 0.15, 0.005, 'ratio', 'REQ-CAM-04', 'FOV kick and speed lines ramp width'], // REQ-CAM-04, 0.01 to 0.15 of vmax: the kick and the speed lines ramp in from CAM_FOV_KICK_SPEED over this so speed dithering around the threshold never breathes.
  FXCAM_SHAKE_NOISE_HZ: [14, 6, 30, 1, 'Hz', 'REQ-CAM-06', 'Bail shake noise rate'], // REQ-CAM-06, 6 to 30 Hz: 1D value noise at this rate drives the shake (sines at 28 Hz aliased into jitter at 60 fps).
  FXCAM_SHAKE_YAW_DEG: [2.5, 0, 6, 0.1, 'deg', 'REQ-CAM-06', 'Bail shake yaw and pitch'], // REQ-CAM-06, 0 to 6 deg: rotation applied after lookAt so the whole frame jolts, not just the background.
  FXCAM_SHAKE_ROLL_DEG: [1.5, 0, 5, 0.1, 'deg', 'REQ-CAM-06', 'Bail shake roll'], // REQ-CAM-06, 0 to 5 deg.
  FXCAM_LAND_KICK_M: [0.03, 0, 0.1, 0.005, 'm', 'REQ-CAM-06', 'Landing camera kick'], // REQ-CAM-06 (landings have weight), 0 to 0.1 m: a short downward dip on every land event.
  FXCAM_LAND_KICK_S: [0.08, 0.02, 0.3, 0.01, 's', 'REQ-CAM-06', 'Landing camera kick time'], // REQ-CAM-06, 0.02 to 0.3 s.
  FXCAM_FLY_LOOKAHEAD_M: [6, 1, 20, 0.5, 'm', 'REQ-CAM-01', 'Flythrough look-ahead distance'], // REQ-CAM-01 (menu path helper), 1 to 20 m: the flythrough camera looks this far along its path.
  // --- sparks (REQ-FX-01) -----------------------------------------------------------------------
  FX_SPARK_LIFE_S: [0.45, 0.15, 1.2, 0.01, 's', 'REQ-FX-01', 'Spark life'], // REQ-FX-01, 0.15 to 1.2 s: a spark burns out over this, fading linearly.
  FX_SPARK_SPEED_MPS: [5, 1, 8, 0.1, 'm/s', 'REQ-FX-01', 'Spark launch speed'], // REQ-FX-01, 1 to 8 m/s: sprayed backward along the rail with this much spread.
  FX_SPARK_SIZE_M: [0.14, 0.01, 0.25, 0.005, 'm', 'REQ-FX-01', 'Spark point size'], // REQ-FX-01, 0.01 to 0.25 m: world size of one spark streak (attenuated with distance). 0.14 (polish round 2, was 0.1): at chase distance 0.1 drew 1 to 2 px scratches.
  FX_SPARK_STRETCH: [4, 1, 8, 0.5, 'ratio', 'REQ-FX-01', 'Spark streak aspect'], // REQ-FX-01, 1 to 8: each spark is an ellipse stretched along its screen velocity by this much.
  FX_SPARK_HDR: [2.0, 1, 5, 0.1, 'ratio', 'REQ-FX-01', 'Spark HDR gain'], // REQ-FX-01, 1 to 5: the leading head of each streak is written this far above 1 so the render track's bloom catches the sparks on a daylit level; the tail stays at 1 so it keeps its orange.
  FX_SPARK_BODY_GAIN: [1.6, 0.5, 3, 0.05, 'ratio', 'REQ-FX-01', 'Spark body brightness'], // REQ-FX-01, 0.5 to 3: the whole streak's light (tail included), so an orange spark still reads over sunlit red brick; the head gets FX_SPARK_HDR on top.
  FX_SPARK_GRAVITY: [9.8, 0, 20, 0.1, 'm/s^2', 'REQ-FX-01', 'Spark gravity'], // REQ-FX-01, 0 to 20: sparks fall like grit, computed on the GPU.
  FX_SPARK_LEDGE_RATE_MULT: [0.5, 0, 1.5, 0.05, 'ratio', 'REQ-FX-01', 'Ledge spark rate factor'], // REQ-FX-01, 0 to 1.5: concrete throws fewer, darker chips than steel.
  FX_SPARK_COPING_RATE_MULT: [1.3, 0.5, 2, 0.05, 'ratio', 'REQ-FX-01', 'Coping spark rate factor'], // REQ-FX-01, 0.5 to 2: coping is the hottest grind, more and warmer sparks.
  FX_LEDGE_DUST_INTERVAL_S: [0.15, 0.05, 0.5, 0.01, 's', 'REQ-FX-01', 'Ledge grind dust puff interval'], // REQ-FX-01, 0.05 to 0.5 s: a small dust puff at the contact this often while grinding concrete.
  FX_CONTACT_GLOW_M: [0.25, 0.05, 0.6, 0.01, 'm', 'REQ-FX-01', 'Grind contact glow size'], // REQ-FX-01, 0.05 to 0.6 m: an additive hot spot at the contact point pulsing with the spark rate.
  FX_GRIND_FLASH_M: [0.6, 0.2, 1.5, 0.05, 'm', 'REQ-FX-01', 'Grind snap flash size'], // REQ-FX-01, 0.2 to 1.5 m: a one-shot flash disc at the contact on grindStart.
  FX_GRIND_FLASH_S: [0.06, 0.02, 0.2, 0.01, 's', 'REQ-FX-01', 'Grind snap flash time'], // REQ-FX-01, 0.02 to 0.2 s.
  FX_GRIND_FLASH_HDR: [2.5, 1, 5, 0.1, 'ratio', 'REQ-FX-01', 'Grind contact flash HDR gain'], // REQ-FX-01, 1 to 5: written above 1 for the bloom.
  FX_GRIND_FAN_COUNT: [12, 0, 48, 1, 'particles', 'REQ-FX-01', 'Grind snap spark fan'], // REQ-FX-01, 0 to 48: the first fan at the snap so the stream has no gap on the contact frame.
  FX_GRIND_FAN_SPEED_MIN: [1.5, 0, 6, 0.1, 'm/s', 'REQ-FX-01', 'Grind fan radial speed min'], // REQ-FX-01, 0 to 6 m/s.
  FX_GRIND_FAN_SPEED_MAX: [4, 0.5, 10, 0.1, 'm/s', 'REQ-FX-01', 'Grind fan radial speed max'], // REQ-FX-01, 0.5 to 10 m/s.
  FX_GRIND_FAN_UP_MIN: [1.5, 0, 6, 0.1, 'm/s', 'REQ-FX-01', 'Grind fan up speed min'], // REQ-FX-01, 0 to 6 m/s.
  FX_GRIND_FAN_UP_MAX: [3.5, 0.5, 10, 0.1, 'm/s', 'REQ-FX-01', 'Grind fan up speed max'], // REQ-FX-01, 0.5 to 10 m/s.
  FX_CHIP_SIZE_M: [0.05, 0.01, 0.2, 0.005, 'm', 'REQ-FX-01', 'Ledge chip size'], // REQ-FX-01, 0.01 to 0.2 m: the concrete chips a ledge grind throws instead of sparks.
  FX_CHIP_SPIN: [20, 0, 60, 1, 'rad/s', 'REQ-FX-01', 'Ledge chip spin spread'], // REQ-FX-01, 0 to 60 rad/s: each chip tumbles at up to half this either way.
  // --- landing dust (REQ-FX-02) -----------------------------------------------------------------
  FX_DUST_LIFE_S: [0.5, 0.2, 2, 0.05, 's', 'REQ-FX-02', 'Dust puff life'], // REQ-FX-02, 0.2 to 2 s: the puff grows and thins over this.
  FX_DUST_SPEED_MPS: [2.0, 0.5, 5, 0.1, 'm/s', 'REQ-FX-02', 'Dust puff spread speed'], // REQ-FX-02, 0.5 to 5 m/s: outward from the wheels, mostly horizontal.
  FX_DUST_SIZE_M: [0.22, 0.1, 1.5, 0.01, 'm', 'REQ-FX-02', 'Dust puff size'], // REQ-FX-02, 0.1 to 1.5 m: noise-textured puffs that grow to about twice this as they thin.
  FX_DUST_ALPHA: [0.35, 0.05, 1, 0.01, 'ratio', 'REQ-FX-02', 'Dust puff opacity'], // REQ-FX-02, 0.05 to 1: peak opacity of one puff.
  FX_DUST_GRAVITY: [1.5, -2, 5, 0.1, 'm/s^2', 'REQ-FX-02', 'Dust settle rate'], // REQ-FX-02, -2 to 5: light dust settles slowly (negative would rise).
  FX_LAND_RING_M: [1.2, 0.4, 3, 0.05, 'm', 'REQ-FX-02', 'Landing ground ring size'], // REQ-FX-02, 0.4 to 3 m: a one-shot ring expanding from the landing point for the impact read.
  FX_LAND_RING_S: [0.25, 0.1, 0.8, 0.01, 's', 'REQ-FX-02', 'Landing ground ring time'], // REQ-FX-02, 0.1 to 0.8 s.
  // --- speed lines (REQ-FX-02 / REQ-CAM-04) -----------------------------------------------------
  FX_SPEEDLINE_FADE_S: [0.25, 0.05, 1, 0.01, 's', 'REQ-FX-02', 'Speed lines fade time'], // REQ-FX-02, 0.05 to 1 s: fade in and out around the CAM_FOV_KICK_SPEED threshold.
  FX_SPEEDLINE_STRENGTH: [0.3, 0, 1, 0.01, 'ratio', 'REQ-FX-02', 'Speed lines opacity'], // REQ-FX-02, 0 to 1: peak opacity of the radial streaks (edge band only, never over the skater).
  // --- board trail and the special grind ribbon (REQ-FX-02) -------------------------------------
  FX_TRAIL_FADE_S: [0.5, 0.1, 1.5, 0.01, 's', 'REQ-FX-02', 'Board trail fade time'], // REQ-FX-02, 0.1 to 1.5 s: each deck ghost fades out over this during a special.
  FX_TRAIL_DECK_HALF_M: [0.4, 0.2, 0.6, 0.01, 'm', 'REQ-FX-02', 'Board trail half length'], // REQ-FX-02, 0.2 to 0.6 m: the trail spans nose to tail so it reads as a ghost of the deck.
  FX_TRAIL_HDR: [2, 1, 4, 0.1, 'ratio', 'REQ-FX-02', 'Board trail HDR gain'], // REQ-FX-02, 1 to 4: written above 1 for the bloom.
  FX_RIBBON_FADE_S: [1.2, 0.3, 3, 0.05, 's', 'REQ-FX-02', 'Rail ribbon fade time'], // REQ-FX-02, 0.3 to 3 s: the green ribbon lingers on the rail behind the special grind.
  FX_RIBBON_WIDTH_M: [0.3, 0.05, 1, 0.01, 'm', 'REQ-FX-02', 'Rail ribbon width'], // REQ-FX-02, 0.05 to 1 m.
  // --- special glow aura (REQ-FX-02, REQ-SPC-03 glow) -------------------------------------------
  FX_AURA_RADIUS_M: [1.3, 0.5, 3, 0.05, 'm', 'REQ-FX-02', 'Special aura radius'], // REQ-FX-02, 0.5 to 3 m: the billboard glow around the skater while the meter glows.
  FX_AURA_PULSE_HZ: [2.0, 0.2, 6, 0.1, 'Hz', 'REQ-FX-02', 'Special aura pulse rate'], // REQ-FX-02, 0.2 to 6 Hz.
  FX_AURA_FADE_S: [0.3, 0.05, 1, 0.01, 's', 'REQ-FX-02', 'Special aura fade time'], // REQ-FX-02, 0.05 to 1 s: fade in on specialReady, out on specialEmptied.
  FX_AURA_POP: [1.6, 1, 3, 0.05, 'ratio', 'REQ-FX-02', 'Special ready pop'], // REQ-FX-02, 1 to 3: the aura brightens to this on specialReady and eases to 1 so the meter filling is an event.
  FX_AURA_POP_S: [0.15, 0.05, 0.5, 0.01, 's', 'REQ-FX-02', 'Special ready pop time'], // REQ-FX-02, 0.05 to 0.5 s.
  FX_AURA_HEIGHT_M: [1.7, 1, 2.5, 0.05, 'm', 'REQ-FX-02', 'Special aura body height'], // REQ-FX-02, 1 to 2.5 m: the glow centres at 0.55 of this along the skater's up axis.
  FX_AURA_DEPTH_PUSH: [1, 0, 2, 0.05, 'ratio', 'REQ-FX-02', 'Special aura rim depth push'], // REQ-FX-02, 0 to 2: each aura quad's rim is slid toward the camera by this share of its radius, so walls and floor within the soft falloff never slice it into a rectangle (the core stays behind the body, FX_AURA_CORE_*).
  FX_AURA_CORE_BACK_M: [0.25, 0, 0.6, 0.01, 'm', 'REQ-FX-02', 'Special aura core distance behind the body'], // REQ-FX-02, 0 to 0.6 m: the glow's core sits this far behind the torso centre so the skater's own pixels pass the depth test in front of it and the additive glow never bleaches them (polish round 2); more than a wall's clearance behind a skater would cut the core.
  FX_AURA_CORE_R: [0.5, 0.2, 0.9, 0.01, 'ratio', 'REQ-FX-02', 'Special aura core radius'], // REQ-FX-02, 0.2 to 0.9 of the aura radius: inside it the glow stays FX_AURA_CORE_BACK_M behind the body; from it to FX_AURA_RIM_R the depth eases to the full forward push. The torso, knees and arms sit inside 0.5, the head top near 0.6.
  FX_AURA_RIM_R: [0.85, 0.4, 1, 0.01, 'ratio', 'REQ-FX-02', 'Special aura full-push radius'], // REQ-FX-02, 0.4 to 1 of the aura radius (above FX_AURA_CORE_R): from here out the glow has its full forward push. The floor crosses the quad at the feet, about 0.7, so the push has to be well under way there or the floor cuts a faint edge.
  FX_AURA_GROUND_CORE_R: [0.6, 0.2, 0.95, 0.01, 'ratio', 'REQ-FX-02', 'Special aura ground glow core radius'], // REQ-FX-02, 0.2 to 0.95 of the ground glow radius: inside it the floor glow keeps its raw depth, out to the disc's edge its push builds up, so the disc behind the feet (over the legs on screen) never passes in front of the legs.
  FX_AURA_MIN_VIEW_M: [0.3, 0.05, 2, 0.05, 'm', 'REQ-FX-02', 'Special aura closest eye distance'], // REQ-FX-02, 0.05 to 2 m: the depth push never brings the glow nearer the eye than this (stays past the near plane).
  // --- kernel panic blue screen and token overflow stickers (REQ-FX-02, SPEC section 9.1) -------
  FX_FLASH_KERNEL_MS: [150, 60, 400, 5, 'ms', 'REQ-FX-02', 'Kernel Panic screen flash'], // REQ-FX-02, 60 to 400 ms: the blue-screen card holds this long as the deck swaps to the blue-screen texture.
  FX_FLASH_KERNEL_ALPHA: [0.55, 0.1, 1, 0.01, 'ratio', 'REQ-FX-02', 'Kernel Panic flash opacity'], // REQ-FX-02, 0.1 to 1: the blue tint under the card; softer than the MacGuffin white-out.
  FX_KERNEL_CARD_ALPHA: [0.85, 0.2, 1, 0.01, 'ratio', 'REQ-FX-02', 'Kernel Panic card opacity'], // REQ-FX-02, 0.2 to 1: the generated blue-screen card over the frame, with two one-frame black flickers.
  FX_STICKER_BURST_COUNT: [40, 8, 128, 1, 'particles', 'REQ-FX-02', 'Token Overflow sticker burst'], // REQ-FX-02, 8 to 128: stickers peel off the deck at the trick start.
  FX_STICKER_LIFE_S: [1.2, 0.3, 3, 0.05, 's', 'REQ-FX-02', 'Sticker particle life'], // REQ-FX-02, 0.3 to 3 s.
  FX_STICKER_SIZE_M: [0.07, 0.03, 0.4, 0.01, 'm', 'REQ-FX-02', 'Sticker particle size'], // REQ-FX-02, 0.03 to 0.4 m: die-cut shapes (circle, banner, diamond, star) a sticker's size.
  FX_STICKER_SPEED_MPS: [4, 0.5, 8, 0.1, 'm/s', 'REQ-FX-02', 'Sticker peel speed'], // REQ-FX-02, 0.5 to 8 m/s: a fan up and back off the deck.
  FX_STICKER_SPIN_RPS: [12, 0, 30, 0.5, 'rad/s', 'REQ-FX-02', 'Sticker tumble spin'], // REQ-FX-02, 0 to 30 rad/s, plus a flutter in the vertex shader.
  FX_STICKER_GRAVITY_MULT: [0.35, 0, 1, 0.01, 'ratio', 'REQ-FX-02', 'Sticker gravity factor'], // REQ-FX-02, 0 to 1: stickers fall at this share of FX_SPARK_GRAVITY so they flutter rather than drop.
  FX_BURST_GRAVITY: [-0.6, -3, 3, 0.05, 'm/s2', 'REQ-FX-02', 'Pickup glint gravity'], // REQ-FX-02, -3 to 3 m/s2: negative lifts the letter and MacGuffin glints so they rise off the pickup.
  FX_TRAIL_CORE_WIDTH_M: [0.12, 0.02, 0.5, 0.01, 'm', 'REQ-FX-02', 'Board trail core width'], // REQ-FX-02, 0.02 to 0.5 m: the bright line down the middle of the deck ghost.
  FX_TELEPORT_WIPE_M: [20, 2, 100, 1, 'm', 'REQ-FX-02', 'Trail wipe jump distance'], // REQ-FX-02, 2 to 100 m: a skater jump longer than this between frames (respawn, teleport) clears the trails and ribbon.
  // --- 900ms Inference slow-mo look (REQ-FX-02, REQ-SPC-05) -------------------------------------
  FX_SLOWMO_FADE_S: [0.15, 0.03, 0.6, 0.01, 's', 'REQ-FX-02', 'Slow-mo look fade time'], // REQ-FX-02, 0.03 to 0.6 s: the letterbox and the cool vignette fade in while inference_900ms is held.
  FX_SLOWMO_STRENGTH: [0.8, 0, 1, 0.01, 'ratio', 'REQ-FX-02', 'Slow-mo look strength'], // REQ-FX-02, 0 to 1.
  // --- pickups (REQ-FX-02 letters, REQ-FX-03 MacGuffin) -----------------------------------------
  FX_LETTER_BURST_COUNT: [48, 8, 128, 1, 'particles', 'REQ-FX-02', 'Letter pickup burst'], // REQ-FX-02, 8 to 128 gold glints rising from the letter.
  FX_LETTER_LIFE_S: [0.9, 0.3, 2, 0.05, 's', 'REQ-FX-02', 'Letter sparkle life'], // REQ-FX-02, 0.3 to 2 s.
  FX_MACGUFFIN_BURST_COUNT: [96, 16, 256, 1, 'particles', 'REQ-FX-03', 'MacGuffin pickup burst'], // REQ-FX-03, 16 to 256 glints with the flash.
  FX_PICKUP_RING_M: [2.0, 0.5, 4, 0.05, 'm', 'REQ-FX-02', 'Pickup ring size'], // REQ-FX-02, 0.5 to 4 m: a one-shot expanding ring at the pickup so the eye finds the spot before the glints.
  FX_PICKUP_RING_S: [0.3, 0.1, 1, 0.01, 's', 'REQ-FX-02', 'Pickup ring time'], // REQ-FX-02, 0.1 to 1 s.
  // --- quality (REQ-REN-05 presets scale particle counts) ---------------------------------------
  FX_QUALITY_LOW_MULT: [0.5, 0.1, 1, 0.05, 'ratio', 'REQ-FX-01', 'Particle count factor on Low'], // REQ-FX-01, 0.1 to 1: spark rate and burst counts on the Low preset.
  FX_QUALITY_MED_MULT: [0.75, 0.1, 1, 0.05, 'ratio', 'REQ-FX-01', 'Particle count factor on Med'], // REQ-FX-01, 0.1 to 1: on the Med preset; High and Ultra use 1.
} satisfies TrackTuningSpec;
