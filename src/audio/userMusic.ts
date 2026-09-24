/**
 * src/audio/userMusic.ts (audio track): the player's own music folder (REQ-AUD-02, SPEC §15).
 * The player picks a folder (file input with webkitdirectory); the playable audio files become a
 * shuffled playlist played through one <audio> element routed into the music bus, so the Options
 * music slider still applies. Nothing is bundled or uploaded: files stay local object URLs.
 */

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm)$/i;

export interface FileLike {
  readonly name: string;
  readonly type: string;
}

/** An audio file by MIME type, or by extension when the browser leaves the type empty. */
export function isPlayableAudioFile(f: FileLike): boolean {
  if (f.type) return f.type.startsWith('audio/');
  return AUDIO_EXT.test(f.name);
}

/** Fisher-Yates shuffle into a new array (rnd defaults to Math.random: this is not the sim). */
export function shuffled<T>(items: readonly T[], rnd: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Open the folder picker and resolve with the chosen files (empty when cancelled). Must be called
 * from a user gesture (a click or a confirm press handler). The ui track's Options screen and the
 * dev harness use it; pass the result to AudioEngine.loadUserMusic.
 */
export function pickMusicFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.mp3';
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    const done = (files: File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}

/** Shuffled playlist on one media element. Tracks reshuffle after each full pass. */
export class UserPlaylist {
  private files: File[] = [];
  private order: File[] = [];
  private index = -1;
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private failures = 0;
  private playing = false;

  get count(): number {
    return this.files.length;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Name of the current track, or null. */
  get current(): string | null {
    return this.order[this.index]?.name ?? null;
  }

  /** Replace the playlist with the playable files; returns how many there are. */
  load(files: readonly File[]): number {
    this.stop();
    this.files = files.filter(isPlayableAudioFile);
    this.order = [];
    this.index = -1;
    return this.files.length;
  }

  /** Start or resume playing into `out` (the music bus). */
  play(ctx: AudioContext, out: AudioNode): void {
    if (this.files.length === 0) return;
    if (!this.el) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('ended', () => this.next());
      el.addEventListener('error', () => this.onError());
      el.addEventListener('playing', () => {
        this.failures = 0;
      });
      ctx.createMediaElementSource(el).connect(out);
      this.el = el;
    }
    this.playing = true;
    if (this.index < 0) this.next();
    else void this.el.play().catch(() => undefined);
  }

  pause(): void {
    this.playing = false;
    this.el?.pause();
  }

  /** Advance to the next track (reshuffling after a full pass). */
  next(): void {
    if (!this.el || this.files.length === 0) return;
    this.index += 1;
    if (this.index >= this.order.length) {
      this.order = shuffled(this.files);
      this.index = 0;
    }
    const file = this.order[this.index];
    if (!file) return;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.el.src = this.url;
    if (this.playing) void this.el.play().catch(() => undefined);
  }

  stop(): void {
    this.pause();
    if (this.el) {
      this.el.removeAttribute('src');
      this.el.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.index = -1;
  }

  /** Skip unplayable files; give up after every file failed in a row. */
  private onError(): void {
    if (!this.playing) return;
    this.failures += 1;
    if (this.failures >= this.files.length) {
      this.pause();
      return;
    }
    this.next();
  }
}
