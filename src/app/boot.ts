/**
 * src/app/boot.ts (integration): the menu chunk, loaded right after the start gate (src/main.ts).
 * It owns the app flow (SPEC §16 M8 "full loop from title to Lab Circuit stamp"):
 *
 *   boot -> main menu (Market Street flythrough behind the title) -> Career / Free Skate -> park select
 *   (Woodshed unlocked by UNLOCK_WOODSHED_GOALS Street goals) -> goal list (career) -> run (2:00 in
 *   career, untimed in Free Skate) -> pause / goal list -> results -> save -> menu; Board Lab, Options,
 *   Credits; controller-disconnect auto-pause; the dev tuning panel (~ / View, in the UI root); the input
 *   dev overlay (F2); window.__codeSkater.debug in dev builds only.
 *
 * Code split (REQ-MNU-05, REQ-DEP-03): this chunk holds the UI, input, audio and save code only, so the
 * menu paints at once; the game chunk (src/app/game.ts: renderer, levels, sim, views) and the vendor
 * chunk load behind it, then the flythrough fades in under the menu and runs become startable.
 * Saves happen here and only here: at run end, on option / Board Lab changes, on reset (REQ-SAV-03).
 */

import { createAudioEngine } from '../audio/engine';
import type { EventOf } from '../core/events';
import { LETTERS, type LevelId, type ParkId, type RunMode } from '../core/types';
import { BRAND_MODE } from '../data/brands';
import type { GoalDef } from '../data/goals';
import { createInputOverlay, type InputOverlay } from '../input/devOverlay';
import { createInputSystem } from '../input/system';
import { loadLevelDef } from '../levels/registry';
import { applyRunEnd, withBoard, withOptions } from '../save/career';
import { createSaveStore } from '../save/storage';
import type { SaveData } from '../save/types';
import { buildRunResults } from '../ui/results';
import { createUiRoot, NO_NAV } from '../ui/root';
import type { UiActions, UiState } from '../ui/types';
import { createLazyBoardPreview } from './lazyBoardPreview';
import { createSoundChip } from './soundChip';
import type { GameSession, Stage } from './game';

export interface BootOptions {
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;
  /** Created and resumed inside the start gate gesture; null with ?autostart (REQ-AUD-03). */
  readonly audioContext: AudioContext | null;
}

/** Frames of the menu backdrop drawn before a page counts as visually settled for screenshots. */
const SHOT_READY_FRAMES = 10;
/** Longest real frame the app feeds the loop and the UI (the loop clamps again at SIM_MAX_CATCHUP_S). */
const MAX_FRAME_S = 0.1;
const VERSION = 'v0.1';
const INPUT_OVERLAY_KEY = 'F2';

type GameModule = typeof import('./game');

export async function boot(options: BootOptions): Promise<void> {
  const { canvas, uiRoot } = options;
  const store = createSaveStore();
  let save: SaveData = store.load();
  let debugUnlocked = false;

  const input = createInputSystem();
  input.attach(window, canvas);
  input.setRumbleEnabled(save.options.rumble);

  const audio = createAudioEngine();
  // Never awaited: a context made outside a gesture (?autostart) resumes only on the first real one.
  void audio.init(options.audioContext ?? undefined);
  audio.setVolumes({ music: save.options.musicVolume, sfx: save.options.sfxVolume });

  const goals: Record<ParkId, readonly GoalDef[]> = { marketStreet: [], woodshed: [], labCampus: [] };
  const preview = createLazyBoardPreview(save.board);

  let stage: Stage | null = null;
  let game: GameModule | null = null;
  let session: GameSession | null = null;
  let runToken = 0;
  let lastRun: { level: LevelId; mode: RunMode } | null = null;
  let glyphs = input.activeDevice.glyphs;
  let overlay: InputOverlay | null = null;
  /** A run was asked for before the game chunk arrived: skip building the menu backdrop at all. */
  let runRequested = false;
  /** The tuning panel paused the live run (no pause screen): resume when it closes. */
  let devPaused = false;
  const soundChip = createSoundChip(uiRoot);

  const effectiveSave = (): SaveData =>
    debugUnlocked ? { ...save, career: { ...save.career, woodshedUnlocked: true } } : save;
  const uiState = (): UiState => ({ save: effectiveSave(), glyphs, brandMode: BRAND_MODE, version: VERSION, goals });
  const persist = (next: SaveData): void => {
    save = next;
    store.save(next);
  };
  const isPark = (id: LevelId): id is ParkId => id === 'marketStreet' || id === 'woodshed';

  // --- the game chunk -------------------------------------------------------------------------
  // Fetched and evaluated only after the main menu has painted two frames: its park build (texture
  // generation, the PMREM bake, first shader links) holds the main thread for over a second, and
  // starting it at once kept the menu itself off screen until about 1.9 s after the gate (REQ-MNU-05).
  const afterPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const gameReady: Promise<GameModule> = afterPaint().then(() => import('./game')).then((mod) => {
    game = mod;
    stage = mod.createStage(canvas, save.options.quality);
    stage.applyQuality(save.options.quality);
    preview.attach(mod.createBoardPreview(save.board));
    // A fast player who already picked a run never pays for the backdrop scene (first-playable finding).
    if (!session && !runRequested) void stage.showMenuBackdrop();
    return mod;
  });

  // --- run flow -------------------------------------------------------------------------------
  const endSession = (keepProgress: boolean): void => {
    const s = session;
    if (!s) return;
    if (keepProgress && !s.ended && isPark(s.levelId)) {
      // A run left before its end (Quit to menu, Restart run, a new run) still keeps what it earned:
      // Free Skate (no clock, DESIGN L CR-42) its MacGuffin and best scores; a career run also the
      // goals it already completed (goals complete on bank or pickup), polish round 2.
      const r = s.snapshot.run;
      const goalsCompleted = s.mode === 'career' ? r.goalsCompleted : [];
      if (r.macguffinCollected || r.score > 0 || goalsCompleted.length > 0) {
        const runEnd: EventOf<'runEnd'> = {
          type: 'runEnd', tick: s.snapshot.tick, levelId: s.levelId, mode: s.mode, score: r.score, bestCombo: r.bestCombo,
          goalsCompleted, letters: LETTERS.filter((l) => r.letters[l]), macguffin: r.macguffinCollected,
        };
        persist(applyRunEnd(save, runEnd));
      }
    }
    session = null;
    stage?.setScene(null);
  };

  const onRunEnd = (s: GameSession, e: EventOf<'runEnd'>): void => {
    if (session !== s) return;
    const before = save;
    const after = applyRunEnd(save, e);
    persist(after);
    const results = buildRunResults(e, before, after, isPark(e.levelId) ? goals[e.levelId] : []);
    ui.setState(uiState());
    ui.showResults(results);
  };

  const startRun = async (level: LevelId, mode: RunMode, seed?: number): Promise<void> => {
    const token = ++runToken;
    runRequested = true;
    const mod = await gameReady;
    const st = stage;
    if (!st) throw new Error('stage missing');
    const built = await st.level(level);
    if (token !== runToken) return;
    endSession(true);
    audio.setPaused(false); // a restart from the pause menu comes in paused
    const park = isPark(level) ? level : null;
    const s: GameSession = mod.createGameSession({
      stage: st,
      built,
      mode,
      seed: seed ?? (Date.now() & 0x7fffffff),
      board: save.board,
      collectedMacGuffins: save.career.macguffins,
      completedGoals: park ? save.career.goals[park] : [],
      input,
      audio,
      hud: ui.hud,
      canvas,
      onRunEnd: (e) => onRunEnd(s, e),
    });
    // Link every program off the main thread before the first frame (first-playable finding); the
    // menu keeps drawing meanwhile. A newer start or a quit in between drops this session.
    await s.warm?.();
    if (token !== runToken) {
      s.dispose();
      return;
    }
    session = s;
    lastRun = { level, mode };
    st.setScene(s);
    ui.hud.setGoals(park && mode === 'career' ? goals[park] : [], park ? save.career.goals[park] : []);
    ui.show('hud');
  };

  const toMenu = (): void => {
    runToken += 1;
    runRequested = false;
    devPaused = false;
    endSession(true);
    ui.setState(uiState());
    ui.show('mainMenu');
    audio.setPaused(false);
    audio.playMusic('menu');
    if (stage) void stage.showMenuBackdrop();
  };

  const actions: UiActions = {
    startRun(level, mode) {
      void startRun(level, mode).catch((err) => console.error('Code Skater: could not start the run', err));
    },
    resume() {
      if (!session) return;
      session.resume();
      ui.show('hud');
    },
    restartRun() {
      const r = lastRun;
      if (!r) return;
      void startRun(r.level, r.mode).catch((err) => console.error('Code Skater: could not restart the run', err));
    },
    quitToMenu() {
      toMenu();
    },
    setOptions(o) {
      const qualityChanged = o.quality !== save.options.quality;
      persist(withOptions(save, o));
      audio.setVolumes({ music: o.musicVolume, sfx: o.sfxVolume });
      input.setRumbleEnabled(o.rumble);
      if (qualityChanged) stage?.applyQuality(o.quality);
      ui.setState(uiState());
    },
    resetCareer() {
      save = store.resetCareer();
      debugUnlocked = false;
      ui.setState(uiState());
    },
    setBoard(board) {
      persist(withBoard(save, board));
      ui.setState(uiState());
    },
    async loadMusicFolder(files) {
      const n = await audio.loadUserMusic(files);
      audio.useUserMusic(n > 0);
      return n;
    },
    uiSound(kind) {
      audio.uiSound(kind);
    },
  };

  const ui = createUiRoot(uiRoot, { actions, boardPreview: preview });
  ui.setState(uiState());
  ui.show('mainMenu');
  audio.playMusic('menu');

  void Promise.all([loadLevelDef('marketStreet'), loadLevelDef('woodshed')]).then(([street, shed]) => {
    goals.marketStreet = street.goals;
    goals.woodshed = shed.goals;
    ui.setState(uiState());
  });

  // --- pause sources: controller loss (REQ-INP-08), hidden tab ---------------------------------
  const pauseRun = (reason: 'player' | 'controller' | 'focus'): void => {
    if (!session || session.ended) return;
    session.pause(reason);
    if (ui.screen === 'hud') ui.show('pause');
  };
  input.onConnection((e) => {
    if (e.device.kind !== 'gamepad') return;
    if (e.connected) {
      ui.setControllerLost(false);
      session?.bus.emit({ type: 'controllerConnected', tick: session.snapshot.tick, id: e.device.id, glyphs: e.device.glyphs });
      if (ui.screen === 'hud') ui.hud.toast('Controller connected');
    } else {
      session?.bus.emit({ type: 'controllerDisconnected', tick: session.snapshot.tick, id: e.device.id });
      if (session && !session.ended && (ui.screen === 'hud' || ui.screen === 'pause')) {
        pauseRun('controller');
        ui.setControllerLost(true);
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseRun('focus');
    if (!session) audio.setPaused(document.hidden);
  });
  // A live run asks before the tab closes (a keyboard player's old Ctrl+W nollie habit, input request).
  window.addEventListener('beforeunload', (e) => {
    if (!session || session.ended) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== INPUT_OVERLAY_KEY) return;
    e.preventDefault();
    if (overlay) overlay.toggle();
    else {
      overlay = createInputOverlay(document.body);
      overlay.show();
    }
  });

  // --- dev debug hook (REQ-DEP-07): dev builds only -------------------------------------------
  if (import.meta.env.DEV) {
    const { createDebugApi, installDebugHook } = await import('./debugHook');
    installDebugHook(createDebugApi({
      get ready() {
        return stage !== null && game !== null;
      },
      startRun: (level, mode) => startRun(level, mode, 1),
      session: () => session,
      unlockAll: () => {
        debugUnlocked = true;
        ui.setState(uiState());
      },
    }));
  }

  // --- the frame loop ---------------------------------------------------------------------------
  let lastMs: number | null = null;
  const frame = (nowMs: number): void => {
    const dt = lastMs === null ? 0 : Math.min(MAX_FRAME_S, Math.max(0, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    input.sample(nowMs);
    let nav = input.nav();
    overlay?.logNav(nav);

    const g = input.activeDevice.glyphs;
    if (g !== glyphs) {
      glyphs = g;
      ui.setState(uiState());
    }

    // The tuning panel (~ / View) freezes a live run without the pause screen, so panel navigation
    // never steers the skater (ui request); closing it resumes.
    if (session && !session.ended && ui.screen === 'hud') {
      if (ui.devPanelOpen && !session.paused) {
        session.pause('player');
        devPaused = true;
      } else if (!ui.devPanelOpen && devPaused) {
        devPaused = false;
        session.resume();
      }
    } else if (!ui.devPanelOpen) devPaused = false;

    if (session && !session.ended) {
      if (ui.screen === 'hud' && nav.pause && !ui.devPanelOpen) {
        pauseRun('player');
        nav = NO_NAV;
      } else if (ui.screen === 'pause' && nav.pause && !nav.back && !ui.devPanelOpen) {
        actions.resume();
        nav = NO_NAV;
      }
    }
    ui.update(nav, dt);
    if (!session) {
      input.nextTick(); // menus: drop gameplay edges so they never reach the next run
      audio.update(null, dt);
    }
    stage?.frame(dt);
    const parsed = session?.takeParsed() ?? [];
    if (overlay?.visible) for (const p of parsed) overlay.logActions(p.tick, p.actions);
    overlay?.update({ device: input.activeDevice, frame: session?.lastFrame ?? null, memory: session?.parserMemory ?? null });
    soundChip.update(audio.suspended);
    if (!window.__shotReady && stage && stage.framesDrawn >= SHOT_READY_FRAMES) window.__shotReady = true;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
