/**
 * src/core/tuning/audio.ts (audio track): the audio track's own tunables. Only the audio track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:audio").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * Mix levels and scheduler timing only. The sound design itself (envelopes, partials, patterns) is
 * data in src/audio/voices.ts and src/audio/songs.ts. Tempos are the locked MUSIC_BPM_* keys.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const AUDIO_TUNING = {
  AUDIO_MASTER_GAIN: [0.9, 0, 1, 0.01, 'gain', 'REQ-AUD-01', 'Master gain'], // REQ-AUD-01, 0 to 1: before the limiter.
  AUDIO_MUSIC_BUS_GAIN: [0.25, 0, 1, 0.01, 'gain', 'REQ-AUD-02', 'Music bus level'], // REQ-AUD-02, 0 to 1: music sits under SFX; the Options slider scales it. 0.5 -> 0.25 by the founder playtest 2026-09-23 (DESIGN L CR-46, "music too loud"): with the default slider 0.7 -> 0.5 a new player hears it 12 dB lower, an existing save 6 dB lower.
  AUDIO_SFX_BUS_GAIN: [0.75, 0, 1, 0.01, 'gain', 'REQ-AUD-01', 'SFX bus level'], // REQ-AUD-01, 0 to 1: the Options SFX slider scales it. 0.85 -> 0.75 by the founder playtest 2026-09-23 (DESIGN L CR-46): slightly lower.
  AUDIO_USER_MUSIC_GAIN: [0.8, 0, 1, 0.01, 'gain', 'REQ-AUD-02', 'Player MP3 level'], // REQ-AUD-02, 0 to 1: mastered MP3s are hotter than the synth loop.
  AUDIO_VOLUME_CURVE: [2, 1, 3, 0.1, 'exponent', 'REQ-AUD-02', 'Slider loudness curve'], // REQ-AUD-02, 1 to 3: gain = slider^curve so the slider feels even.
  AUDIO_LIMITER_THRESHOLD_DB: [-6, -24, 0, 0.5, 'dB', 'REQ-AUD-01', 'Limiter threshold'], // REQ-AUD-01, -24 to 0: gentle master limiter.
  AUDIO_LIMITER_RATIO: [8, 1, 20, 0.5, 'ratio', 'REQ-AUD-01', 'Limiter ratio'], // REQ-AUD-01, 1 to 20.
  AUDIO_LOOKAHEAD_S: [0.12, 0.05, 0.4, 0.01, 's', 'REQ-AUD-02', 'Music scheduler lookahead'], // REQ-AUD-02, 0.05 to 0.4: notes are queued this far ahead of the audio clock.
  AUDIO_SCHEDULER_MS: [25, 10, 100, 1, 'ms', 'REQ-AUD-02', 'Music scheduler period'], // REQ-AUD-02, 10 to 100: must stay well under the lookahead.
  AUDIO_SWING_STREET: [0.58, 0.5, 0.75, 0.01, 'ratio', 'REQ-AUD-02', 'Street swing'], // REQ-AUD-02, 0.5 straight to 0.75: MPC style 16th swing for the boom-bap loop.
  AUDIO_SWING_WOODSHED: [0.52, 0.5, 0.75, 0.01, 'ratio', 'REQ-AUD-02', 'Woodshed swing'], // REQ-AUD-02, 0.5 to 0.75: the fast break stays nearly straight.
  AUDIO_CRACKLE_GAIN: [0.06, 0, 0.3, 0.01, 'gain', 'REQ-AUD-02', 'Vinyl crackle level'], // REQ-AUD-02, 0 to 0.3: Street and menu only.
  AUDIO_ROLL_GAIN: [0, 0, 1, 0.01, 'gain', 'REQ-AUD-01', 'Rolling noise at full speed'], // REQ-AUD-01, 0 to 1: scaled by speedRatio. 0.32 -> 0.05 (about 15%) by the founder playtest 2026-09-23 (DESIGN L CR-46, "rolling sound annoying and too loud"). Founder 2026-09-23 again: 0.05 -> 0.012 (way down). Founder 2026-09-23 (third ask, "it should be smooth"): off.
  AUDIO_ROLL_MIN_SPEED: [0.3, 0, 2, 0.05, 'm/s', 'REQ-AUD-01', 'Rolling noise from speed'], // REQ-AUD-01, 0 to 2: below this the wheels are silent.
  AUDIO_PUSH_LEVEL: [0, 0, 1, 0.01, 'ratio', 'REQ-AUD-01', 'Foot-push scuff level'], // REQ-AUD-01, 0 to 1 (founder 2026-09-23: off; with auto-push the scuff played every stroke). Was a fixed 0.7.
  AUDIO_CRACK_SPACING_M: [1.6, 0.5, 4, 0.1, 'm', 'REQ-AUD-01', 'Concrete joint spacing'], // REQ-AUD-01, 0.5 to 4: a soft clack per sidewalk joint on concrete.
  AUDIO_CRACK_LEVEL: [0, 0, 1, 0.01, 'ratio', 'REQ-AUD-01', 'Concrete joint clack level'], // REQ-AUD-01, 0 to 1 (founder playtest 2026-09-23, DESIGN L CR-46): scales the joint clack with the quieter roll (was 1). Founder 2026-09-23 again: 0.25 -> 0.05. Founder 2026-09-23 (third ask, "it should be smooth"): off.
  AUDIO_ROLL_BRIGHT_HZ: [500, 0, 2200, 10, 'Hz', 'REQ-AUD-01', 'Concrete roll brightness sweep'], // REQ-AUD-01, 0 to 2200 Hz (founder playtest 2026-09-23, DESIGN L CR-46): how far the concrete roll band rises with speed (was 2200); lower = softer, less hiss. Founder 2026-09-23 again: 900 -> 500 (darker).
  AUDIO_GRIND_GAIN: [0.42, 0, 1, 0.01, 'gain', 'REQ-AUD-01', 'Grind loop level'], // REQ-AUD-01, 0 to 1.
  MUSIC_BPM_CAMPUS: [104, 80, 160, 1, 'bpm', 'REQ-AUD-02', 'Lab Campus music tempo'], // REQ-AUD-02, 80 to 160 (Lab Campus, 2026-09-23): a slower night groove than the street's.
  AUDIO_WIND_GAIN: [0, 0, 0.5, 0.01, 'gain', 'REQ-AUD-01', 'Wind at full speed'], // REQ-AUD-01, 0 to 0.5: air and fast rolling. Founder 2026-09-23: off (0.1 -> 0), the noise at speed was the wind.
  AUDIO_CLOCK_TICK_FROM_S: [10, 0, 30, 1, 's', 'REQ-AUD-01', 'Clock ticks below'], // REQ-AUD-01, 0 to 30: a tick each second while secondsLeft is under this.
} satisfies TrackTuningSpec;
