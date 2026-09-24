/**
 * src/core/tuning/skater.ts (skater track): the skater track's own tunables. Only the skater track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:skater").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const SKATER_TUNING = {
  SKATER_RIM_STRENGTH: [0.25, 0, 1.5, 0.01, 'x', 'REQ-SKT-01', 'Skater rim light strength'], // REQ-SKT-01, 0 to 1.5 (mine): the flat-shaded rig's rim term, masked to the side away from the sun; 0 = off. 0.25 since the founder playtest 2026-09-23 (0.55 washed the lit clothes to pastel).
  SKATER_RIM_POWER: [3.0, 1, 6, 0.1, 'x', 'REQ-SKT-01', 'Skater rim light falloff'], // REQ-SKT-01, 1 to 6 (mine): fresnel exponent, higher = thinner rim.
  SKATER_LIGHT_SCALE: [0.7, 0.2, 1.5, 0.01, 'x', 'REQ-SKT-01', 'Skater lit response'], // REQ-SKT-01, 0.2 to 1.5 (mine): scale on the figures' lit result (sun, sky, IBL); under 1 keeps the sunlit clothes out of AgX's desaturating shoulder (founder playtest 2026-09-23: pastel skater).
  SKATER_SELF_LIGHT: [0.12, 0, 0.5, 0.01, 'x', 'REQ-SKT-01', 'Skater albedo self-light'], // REQ-SKT-01, 0 to 0.5 (mine): albedo x this added after the scale, so the shadow side keeps its hue.
  SKATER_OUTLINE_M: [0.012, 0, 0.03, 0.001, 'm', 'REQ-SKT-01', 'Skater outline hull width'], // REQ-SKT-01, 0 to 0.03 m (mine): inverted-hull ink line width on the big parts; 0 = off.
  SKATER_OUTLINE_BRIGHTNESS: [0, 0, 1, 0.01, 'x', 'REQ-SKT-01', 'Skater outline brightness'], // REQ-SKT-01, 0 to 1 (mine): 0 = the blue-black ink (default since the founder playtest 2026-09-23), 1 = the rim colour (a pale hull read as an x-ray inside the silhouette).
  SKATER_DECK_LIFT_M: [0.105, 0, 0.2, 0.005, 'm', 'REQ-SKT-01', 'Deck top above snapshot pos'], // REQ-SKT-01, 0 to 0.2 m (mine): the sim's pos is the wheel contact; the feet and the deck top sit this high above it (wheel 0.033 + truck 0.053 + deck 0.02).
  SKATER_GRIND_ALIGN_MAX_M: [0.3, 0, 0.6, 0.01, 'm', 'REQ-SKT-05', 'Grind contact align clamp'], // REQ-SKT-05, 0 to 0.6 m (mine): the rig is shifted so the grinding part sits on snapshot.grind.contact; the shift is clamped here.
  SKATER_IDLE_BOB_M: [0.012, 0, 0.05, 0.001, 'm', 'REQ-SKT-03', 'Idle sway amplitude'], // REQ-SKT-03, 0 to 0.05 m (mine): roll-pose hips bob per push cycle.
  SKATER_LEAN_DEG: [16, 0, 40, 0.5, 'deg', 'REQ-SKT-03', 'Balance lean at full needle'], // REQ-SKT-03, 0 to 40 deg (mine): grind body roll at |needle| = 1.
  SKATER_LIP_LEAN_RATIO: [0.75, 0, 1.5, 0.05, 'x', 'REQ-SKT-03', 'Lip lean vs grind lean'], // REQ-SKT-03, 0 to 1.5 (mine): the lip stall leans SKATER_LEAN_DEG times this (a stall on the coping sways less than a grind).
  SKATER_CROUCH_DROP_M: [0.18, 0, 0.4, 0.01, 'm', 'REQ-SKT-03', 'Linker crouch depth'], // REQ-SKT-03, 0 to 0.4 m (mine): hips drop at full crouch charge while grinding, manualling or in a lip stall.
  SKATER_GRIND_ALIGN_RATE: [18, 1, 60, 1, '1/s', 'REQ-SKT-05', 'Grind contact align rate'], // REQ-SKT-05, 1 to 60 /s (mine): how fast the grind contact shift follows its target (exponential approach).
  NPC_IDLE_SWAY_DEG: [4, 0, 12, 0.5, 'deg', 'REQ-NPC-01', 'NPC idle sway'], // REQ-NPC-01, 0 to 12 deg (mine): torso sway amplitude while idle.
  NPC_MOUTH_HZ: [6, 1, 12, 0.5, 'Hz', 'REQ-NPC-01', 'NPC mouth rate'], // REQ-NPC-01, 1 to 12 Hz (mine): mouth open / close rate while talking.
  PICKUP_LETTER_GLOW: [0.64, 0, 2, 0.02, 'x', 'REQ-LVL-08', 'Letter face glow vs pickup emissive'], // REQ-LVL-08, 0 to 2 (mine): letter face emissive = RLV_PICKUP_EMISSIVE times this (1.6 at 2.5: a saturated hue that blooms without clipping to white).
  PICKUP_LETTER_RIM_GLOW: [0.32, 0, 2, 0.02, 'x', 'REQ-LVL-08', 'Letter coin rim glow vs pickup emissive'], // REQ-LVL-08, 0 to 2 (mine): the coin's rim ring, RLV_PICKUP_EMISSIVE times this (0.8 at 2.5).
  MACGUFFIN_HALO_GLOW: [0.96, 0, 2, 0.02, 'x', 'REQ-LVL-08', 'MacGuffin halo glow vs pickup emissive'], // REQ-LVL-08, 0 to 2 (mine): halo ring emissive, RLV_PICKUP_EMISSIVE times this (2.4 at 2.5, past the bloom threshold).
  MACGUFFIN_PULSE_GLOW: [0.4, 0, 1, 0.02, 'x', 'REQ-LVL-08', 'MacGuffin light pulse depth'], // REQ-LVL-08, 0 to 1 (mine): screen / LED emissive swings RLV_PICKUP_EMISSIVE x (1 +/- this) (2.5 +/- 1.0 at 2.5).
  MACGUFFIN_PULSE_HZ: [0.64, 0.1, 3, 0.02, 'Hz', 'REQ-LVL-08', 'MacGuffin light pulse rate'], // REQ-LVL-08, 0.1 to 3 Hz (mine): screen / LED pulse rate (4 rad/s = 0.64 Hz).
  MACGUFFIN_BEACON_ALPHA: [0.015, 0, 0.1, 0.001, 'x', 'REQ-LVL-08', 'MacGuffin beacon brightness'], // REQ-LVL-08, 0 to 0.1 (mine): additive beacon base brightness (linear, added twice by the open cylinder's two walls and lifted by AgX, so it stays tiny); fades quadratically to 0 at the top.
  NPC_WAVE_HZ: [1.6, 0.5, 4, 0.1, 'Hz', 'REQ-NPC-01', 'NPC wave rate'], // REQ-NPC-01, 0.5 to 4 Hz (mine): forearm wave while talking.
} satisfies TrackTuningSpec;
