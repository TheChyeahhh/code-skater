/**
 * src/audio/engine.ts (audio track): the synthesized audio engine (REQ-AUD-01..03).
 * Graph: game SFX + UI -> SFX bus; synth music or the player's MP3s -> music bus -> pause gate;
 * both buses -> master -> gentle limiter -> speakers. Everything is Web Audio synthesis:
 * one-shots in src/audio/voices.ts (from SimEvents via src/audio/eventMap.ts), continuous rolling /
 * grind / wind in src/audio/loops.ts (from the snapshot), park music in src/audio/songs.ts +
 * src/audio/music.ts (lookahead scheduler), the player's own folder in src/audio/userMusic.ts.
 * No audio files in dist. Before init() every method is a silent no-op (node tests, ?autostart).
 */

import type { SimEvent } from '../core/events';
import { TUNING } from '../core/tuning';
import { DEFAULT_OPTIONS, type SimSnapshot, type SkaterStateName } from '../core/types';
import { voicesForEvent } from './eventMap';
import { GrindLoop, RollLoop, WindLoop, type RollSurface } from './loops';
import { MusicPlayer } from './music';
import { SONGS } from './songs';
import { SILENT, clamp01, finite, gain, glide } from './synth';
import type { AudioEngine, AudioVolumes, MusicTrack, UiSound } from './types';
import { UserPlaylist } from './userMusic';
import { playVoice, type VoiceId } from './voices';

/** States in which the wheels are on the ground and roll. */
const ROLL_STATES: readonly SkaterStateName[] = ['Grounded', 'Crouch', 'LandWindow', 'Manual', 'RevertWindow'];
/** A manual rides on two wheels: quieter roll. */
const MANUAL_ROLL_SCALE = 0.55;
const UI_VOICE: Readonly<Record<UiSound, VoiceId>> = {
  move: 'uiMove', confirm: 'uiConfirm', back: 'uiBack', error: 'uiError', toast: 'uiToast',
};
/** Small offset so a voice never starts in the past of the audio clock. */
const START_PAD_S = 0.005;
const PAUSE_FADE_S = 0.03;
const MUSIC_START_PAD_S = 0.06;

interface Graph {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly musicBus: GainNode;
  readonly musicGate: GainNode;
  readonly userGain: GainNode;
  readonly sfxBus: GainNode;
  readonly gameBus: GainNode;
  readonly uiBus: GainNode;
}

/** Surface under the wheels. The snapshot carries no material, so the park decides. */
function surfaceFor(snapshot: SimSnapshot): RollSurface {
  return snapshot.levelId === 'woodshed' ? 'wood' : 'concrete';
}

function curve(v: number): number {
  return Math.pow(clamp01(finite(v, 0)), TUNING.AUDIO_VOLUME_CURVE);
}

class SynthAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private ownsContext = false;
  private graph: Graph | null = null;
  private initPromise: Promise<void> | null = null;
  private volumes: AudioVolumes = { music: DEFAULT_OPTIONS.musicVolume, sfx: DEFAULT_OPTIONS.sfxVolume };
  private paused = false;
  private track: MusicTrack | null = null;
  private player: MusicPlayer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly playlist = new UserPlaylist();
  private userMode = false;
  private roll: RollLoop | null = null;
  private grind: GrindLoop | null = null;
  private wind: WindLoop | null = null;
  private crackDistM = 0;
  private removeUnlock: (() => void) | null = null;
  private lastMix = '';

  get ready(): boolean {
    return this.graph !== null;
  }

  get suspended(): boolean {
    return this.ctx !== null && this.ctx.state === 'suspended';
  }

  init(context?: AudioContext): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit(context);
    return this.initPromise;
  }

  private async doInit(context?: AudioContext): Promise<void> {
    let ctx: AudioContext;
    try {
      ctx = context ?? new AudioContext();
    } catch {
      this.initPromise = null;
      return;
    }
    this.ctx = ctx;
    this.ownsContext = !context;
    this.graph = this.buildGraph(ctx);
    this.applyMix();
    if (ctx.state !== 'running') {
      // Listen for a real gesture first: a resume() without user activation (a pad-only start, or
      // ?autostart) may stay pending until one comes, and awaiting it here would hang the init.
      this.waitForGesture(ctx);
      void ctx.resume().catch(() => undefined);
    }
    if (this.track !== null) this.startMusic();
    this.scheduleTick();
  }

  /** ?autostart: the context was made outside a gesture; resume on the first real one (REQ-AUD-03). */
  private waitForGesture(ctx: AudioContext): void {
    if (typeof window === 'undefined') return;
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const remove = (): void => {
      for (const ev of events) window.removeEventListener(ev, unlock, true);
      this.removeUnlock = null;
    };
    const unlock = (): void => {
      void ctx.resume().then(() => {
        if (ctx.state === 'running') remove();
      }, () => undefined);
    };
    for (const ev of events) window.addEventListener(ev, unlock, true);
    this.removeUnlock = remove;
  }

  private buildGraph(ctx: AudioContext): Graph {
    const limiter = ctx.createDynamicsCompressor();
    limiter.knee.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    const master = gain(ctx, TUNING.AUDIO_MASTER_GAIN);
    master.connect(limiter).connect(ctx.destination);
    const musicGate = gain(ctx, 1);
    const musicBus = gain(ctx, 1);
    musicBus.connect(musicGate).connect(master);
    const userGain = gain(ctx, TUNING.AUDIO_USER_MUSIC_GAIN);
    userGain.connect(musicBus);
    const sfxBus = gain(ctx, 1);
    sfxBus.connect(master);
    const gameBus = gain(ctx, 1);
    gameBus.connect(sfxBus);
    const uiBus = gain(ctx, 1);
    uiBus.connect(sfxBus);
    return { master, limiter, musicBus, musicGate, userGain, sfxBus, gameBus, uiBus };
  }

  /** Push the live TUNING mix levels and the Options volumes into the graph. */
  private applyMix(): void {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const key = `${TUNING.AUDIO_MASTER_GAIN}|${TUNING.AUDIO_MUSIC_BUS_GAIN}|${TUNING.AUDIO_SFX_BUS_GAIN}|${TUNING.AUDIO_USER_MUSIC_GAIN}|${TUNING.AUDIO_VOLUME_CURVE}|${TUNING.AUDIO_LIMITER_THRESHOLD_DB}|${TUNING.AUDIO_LIMITER_RATIO}|${this.volumes.music}|${this.volumes.sfx}`;
    if (key === this.lastMix) return;
    this.lastMix = key;
    const now = ctx.currentTime;
    glide(g.master.gain, TUNING.AUDIO_MASTER_GAIN, now);
    glide(g.musicBus.gain, TUNING.AUDIO_MUSIC_BUS_GAIN * curve(this.volumes.music), now);
    glide(g.sfxBus.gain, TUNING.AUDIO_SFX_BUS_GAIN * curve(this.volumes.sfx), now);
    glide(g.userGain.gain, TUNING.AUDIO_USER_MUSIC_GAIN, now);
    g.limiter.threshold.value = TUNING.AUDIO_LIMITER_THRESHOLD_DB;
    g.limiter.ratio.value = TUNING.AUDIO_LIMITER_RATIO;
  }

  // --- music ---------------------------------------------------------------------------------

  private scheduleTick(): void {
    if (this.timer !== null || !this.ctx) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pumpMusic();
      if (this.ctx) this.scheduleTick();
    }, TUNING.AUDIO_SCHEDULER_MS);
  }

  private pumpMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.paused || !this.player || ctx.state !== 'running') return;
    this.player.pump(ctx.currentTime + TUNING.AUDIO_LOOKAHEAD_S);
  }

  private startMusic(): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const wantUser = this.userMode && this.playlist.count > 0 && this.track !== null;
    if (wantUser) {
      this.stopSynth();
      if (!this.paused) this.playlist.play(ctx, g.userGain);
      return;
    }
    this.playlist.pause();
    if (this.track === null) {
      this.stopSynth();
      return;
    }
    if (this.player && this.player.song.id === this.track && this.player.isRunning) return;
    this.stopSynth();
    this.player = new MusicPlayer(ctx, g.musicBus, SONGS[this.track]);
    this.player.start(ctx.currentTime + MUSIC_START_PAD_S);
    this.pumpMusic();
  }

  private stopSynth(): void {
    if (this.player && this.ctx) this.player.stop(this.ctx.currentTime);
    this.player = null;
  }

  playMusic(track: MusicTrack | null): void {
    this.track = track;
    this.startMusic();
  }

  loadUserMusic(files: readonly File[]): Promise<number> {
    const n = this.playlist.load(files);
    if (this.userMode) this.startMusic();
    return Promise.resolve(n);
  }

  useUserMusic(on: boolean): void {
    this.userMode = on;
    if (!on) this.playlist.stop();
    this.startMusic();
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = { music: clamp01(finite(v.music, 0)), sfx: clamp01(finite(v.sfx, 0)) };
    this.applyMix();
  }

  // --- SFX -----------------------------------------------------------------------------------

  onEvent(e: SimEvent): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    for (const call of voicesForEvent(e)) {
      const out = call.bus === 'ui' ? g.uiBus : g.gameBus;
      playVoice(call.voice, { ctx, out, t: ctx.currentTime + START_PAD_S }, call.params);
    }
    if (e.type === 'grindStart' || e.type === 'grindSwitch') this.ensureGrind(e.railKind);
    else if (e.type === 'grindEnd' || e.type === 'bail') this.stopGrind();
  }

  uiSound(kind: UiSound): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    playVoice(UI_VOICE[kind], { ctx, out: g.uiBus, t: ctx.currentTime + START_PAD_S });
  }

  private ensureGrind(kind: GrindLoop['kind']): GrindLoop | null {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return null;
    if (this.grind && this.grind.kind === kind) return this.grind;
    this.stopGrind();
    this.grind = new GrindLoop(ctx, g.gameBus, kind);
    this.grind.set(TUNING.AUDIO_GRIND_GAIN * 0.75, 0.5);
    return this.grind;
  }

  private stopGrind(): void {
    this.grind?.stop();
    this.grind = null;
  }

  update(snapshot: SimSnapshot | null, dtS: number): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    this.applyMix();
    if (!snapshot) {
      this.roll?.set(0, 0);
      this.wind?.set(0, 0);
      this.stopGrind();
      return;
    }
    const sk = snapshot.skater;
    const ratio = clamp01(finite(sk.speedRatio, 0));
    const speed = Math.max(0, finite(sk.speed, 0));

    // Rolling: filtered noise tied to speed, wood vs concrete.
    const rolling = ROLL_STATES.includes(sk.state) && sk.contactPoint !== null && speed >= TUNING.AUDIO_ROLL_MIN_SPEED;
    const surface = surfaceFor(snapshot);
    if (!this.roll || this.roll.surface !== surface) {
      this.roll?.stop();
      this.roll = new RollLoop(ctx, g.gameBus, surface);
    }
    const rollLevel = rolling ? TUNING.AUDIO_ROLL_GAIN * (0.25 + 0.75 * ratio) * (sk.state === 'Manual' ? MANUAL_ROLL_SCALE : 1) : 0;
    this.roll.set(rollLevel, ratio);

    // Concrete joints: a soft clack every AUDIO_CRACK_SPACING_M of rolling.
    if (rolling && surface === 'concrete' && sk.state !== 'Manual') {
      this.crackDistM += speed * Math.max(0, finite(dtS, 0));
      const spacing = Math.max(0.1, TUNING.AUDIO_CRACK_SPACING_M);
      if (this.crackDistM >= spacing) {
        this.crackDistM %= spacing;
        playVoice('crack', { ctx, out: g.gameBus, t: ctx.currentTime + START_PAD_S }, { intensity: TUNING.AUDIO_CRACK_LEVEL * (0.3 + 0.7 * ratio) });
      }
    }

    // Grind loop by rail kind, pitch by speed.
    if (sk.state === 'Grind' && sk.grind) {
      this.ensureGrind(sk.grind.railKind)?.set(TUNING.AUDIO_GRIND_GAIN * (0.5 + 0.5 * ratio), ratio);
    } else if (this.grind) {
      this.stopGrind();
    }

    // Wind: in the air, and a little when bombing along.
    if (!this.wind) this.wind = new WindLoop(ctx, g.gameBus);
    const airborne = sk.state === 'Air';
    this.wind.set(TUNING.AUDIO_WIND_GAIN * ratio * ratio * (airborne ? 1 : 0.5), ratio);
  }

  // --- lifecycle -----------------------------------------------------------------------------

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    const level = paused ? SILENT : 1;
    g.musicGate.gain.setTargetAtTime(level, now, PAUSE_FADE_S);
    g.gameBus.gain.setTargetAtTime(level, now, PAUSE_FADE_S);
    if (paused) {
      this.playlist.pause();
    } else {
      this.player?.resync(now + MUSIC_START_PAD_S);
      this.startMusic();
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.stopSynth();
    this.stopGrind();
    this.roll?.stop();
    this.wind?.stop();
    this.roll = null;
    this.wind = null;
    this.playlist.stop();
    this.removeUnlock?.();
    this.graph?.master.disconnect();
    this.graph = null;
    if (this.ownsContext) void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.initPromise = null;
  }
}

export function createAudioEngine(): AudioEngine {
  return new SynthAudioEngine();
}
