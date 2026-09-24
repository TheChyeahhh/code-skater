/**
 * src/app/session.ts (integration): one run from level load to results, wiring every track
 * (ARCHITECTURE.md section 2):
 *   BuiltLevel (levels, cached by the stage) -> createWorld (sim) -> views (render / skater / fx)
 *   -> input (FrameBuilder per tick) -> bus (events to HUD, FX, camera, audio, rumble, hitstop).
 * Per render frame: loop.frame(dt) runs fixed 120 Hz ticks (input.nextTick -> builder.next ->
 * world.step -> bus.emitAll, then loop.setTimeScale(snapshot.timeScale): the 900ms Inference
 * slow-mo); a macguffin event's hitstopTicks freeze the loop (REQ-FX-03). Then
 * lerpSnapshot(prev, curr, alpha) -> level / skater / fx views -> camera -> lighting -> post -> HUD
 * -> audio. Saves never happen here: the app applies the run end (REQ-SAV-03).
 *
 * Scripted mode (the dev debug hook, REQ-DEP-07): the first setInput() or step() pauses real time and
 * device input; the sim then advances only through step(n) (src/sim/debug.ts driver, same builder).
 */

import { Scene, Vector3 } from 'three';
import { EventBus, type EventOf } from '../core/events';
import { lerpSnapshot } from '../core/interp';
import { FixedLoop } from '../core/loop';
import { TUNING } from '../core/tuning';
import type { BoardConfig, InputFrame, InputTimeline, LevelId, MacGuffinId, RunMode, ScriptInput, SimSnapshot, Vec3 } from '../core/types';
import { createFrameBuilder } from '../input/frameBuilder';
import { rumbleForEvent } from '../input/rumble';
import type { InputSystem, ParsedAction, ParserMemory } from '../input/types';
import { createLevelRaycaster } from '../levels/lib/bvh';
import type { BuiltLevel } from '../levels/types';
import { createCameraRig } from '../render/camera';
import { createFxSystem } from '../render/fx/fxSystem';
import { markBloom } from '../render/lib/bloomLayer';
import { VIEWPORT } from '../render/lib/viewport';
import { createLevelView } from '../render/levelView';
import { createLighting } from '../render/lighting';
import { createNpcFigure } from '../render/npc';
import { createPostChain } from '../render/post';
import { createSkaterView } from '../render/skater/skaterView';
import type { CameraRaycast, QualitySettings } from '../render/types';
import { createDebugDriver } from '../sim/debug';
import { createWorld } from '../sim/world';
import type { AudioEngine } from '../audio/types';
import type { HudExt, ScreenPoint } from '../ui/hud';
import { warmScene, type Stage, type StageScene } from './stage';

export type PauseReason = 'player' | 'controller' | 'focus';

export interface SessionOptions {
  readonly stage: Stage;
  readonly built: BuiltLevel;
  readonly mode: RunMode;
  readonly seed: number;
  readonly board: BoardConfig;
  readonly collectedMacGuffins: readonly MacGuffinId[];
  readonly completedGoals: readonly string[];
  readonly input: InputSystem;
  readonly audio: AudioEngine;
  readonly hud: HudExt;
  /** The canvas: a click during the run asks for pointer lock (mouse camera, REQ-CAM-03). */
  readonly canvas: HTMLCanvasElement;
  /** Fired INT_RESULTS_DELAY_S after the sim's runEnd event. */
  readonly onRunEnd: (e: EventOf<'runEnd'>) => void;
}

export interface GameSession extends StageScene {
  readonly levelId: LevelId;
  readonly mode: RunMode;
  readonly bus: EventBus;
  /** Latest sim snapshot. */
  readonly snapshot: SimSnapshot;
  readonly paused: boolean;
  readonly ended: boolean;
  /** Last input frame the sim consumed (input dev overlay). */
  readonly lastFrame: InputFrame | null;
  /** Parser memory after the last tick (input dev overlay's buffers). */
  readonly parserMemory: ParserMemory | null;
  /** Ticks with parsed actions since the last call, oldest first (input dev overlay's log; capped). */
  takeParsed(): { readonly tick: number; readonly actions: readonly ParsedAction[] }[];
  pause(reason: PauseReason): void;
  resume(): void;
  /** Debug hook (dev builds): scripted input, exact steps, teleport, scores. */
  readonly debug: {
    setInput(input: ScriptInput | InputTimeline): void;
    step(ticks: number): SimSnapshot;
    teleport(pos: Vec3, dir: Vec3, speed: number): void;
    comboBanked(): number;
    runScore(): number;
    /** Leave scripted mode: real time and device input again. */
    resume(): void;
  };
}

/** Most parsed-action ticks kept between two takeParsed() calls (the overlay shows far fewer). */
const PARSE_LOG_MAX = 64;

/** Camera collision against the level, passing through shapes lower than INT_CAM_IGNORE_HEIGHT_M (fx request). */
function cameraRaycast(built: BuiltLevel): CameraRaycast {
  const ray = createLevelRaycaster(built.collider);
  return (origin, dir, maxDist) => {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    let travelled = 0;
    let o = origin;
    for (let pass = 0; pass < TUNING.INT_CAM_RAY_PASSES; pass++) {
      const hit = ray.raycast(o, d, maxDist - travelled);
      if (!hit) return null;
      const s = built.surfaces[hit.surfaceId];
      const tall = !s || s.bounds.max.y - s.bounds.min.y >= TUNING.INT_CAM_IGNORE_HEIGHT_M;
      if (tall) return travelled + hit.distance;
      const step = hit.distance + 0.02;
      travelled += step;
      if (travelled >= maxDist) return null;
      o = { x: o.x + d.x * step, y: o.y + d.y * step, z: o.z + d.z * step };
    }
    return null;
  };
}

export function createGameSession(opts: SessionOptions): GameSession {
  const { stage, built, input, audio, hud } = opts;
  const bus = new EventBus();
  const world = createWorld({
    level: built,
    mode: opts.mode,
    seed: opts.seed,
    collectedMacGuffins: opts.collectedMacGuffins,
    completedGoals: opts.completedGoals,
    ...(opts.mode === 'free' ? { runLengthS: TUNING.INT_FREE_SKATE_LENGTH_S } : {}),
  });
  const builder = createFrameBuilder();
  const driver = createDebugDriver(world, builder);

  // --- scene ------------------------------------------------------------------------------------
  const env = stage.environment(built.def.environment);
  const scene = new Scene();
  scene.background = env.background;
  scene.environment = env.environment;
  scene.fog = env.fog;
  // three 0.186: a material with envMap null takes scene.environmentIntensity (default 1), so the
  // skater, NPCs, board and FX (outside the registry) got full-strength IBL (render request).
  scene.environmentIntensity = TUNING.RSKY_ENV_INTENSITY;
  const lighting = createLighting(built.def.environment, stage.quality);
  scene.add(lighting.group);
  const levelView = createLevelView({ built, materials: stage.materials, createNpc: createNpcFigure });
  scene.add(levelView.group);
  const skaterView = createSkaterView(opts.board);
  scene.add(skaterView.group);
  const rig = createCameraRig(cameraRaycast(built));
  let loopRef: FixedLoop | null = null;
  const fx = createFxSystem(rig.camera, opts.seed, {
    freeze: (t) => loopRef?.freeze(t),
    setDeckOverride: (m) => skaterView.board.setDeckOverride(m),
    viewportHeightPx: () => VIEWPORT.heightPx,
  });
  // Selective bloom (render polish): sparks, trail, ribbon, glow and flash only bloom when marked.
  markBloom(fx.group);
  scene.add(fx.group);
  const post = createPostChain(stage.renderer, scene, rig.camera);

  // --- state ------------------------------------------------------------------------------------
  let prev: SimSnapshot | null = null;
  let curr: SimSnapshot = world.snapshot;
  let paused = false;
  let scripted = false;
  let ended = false;
  let endEvent: EventOf<'runEnd'> | null = null;
  let endTimer = 0;
  let endFired = false;
  let disposed = false;
  let lastLook = { x: 0, y: 0 };
  const mouseAcc = { x: 0, y: 0 };

  const takeEvents = (): void => {
    const events = driver.takeEvents();
    bus.emitAll(events);
  };

  const parseLog: { tick: number; actions: readonly ParsedAction[] }[] = [];
  const logParse = (): void => {
    const p = world.lastParse;
    if (!p || p.actions.length === 0) return;
    parseLog.push({ tick: p.tick, actions: p.actions });
    if (parseLog.length > PARSE_LOG_MAX) parseLog.shift();
  };

  // Founder 2026-09-23: a gentle slow motion in the air, so there is time for tricks. Presentation
  // only (the loop's time scale, like the 900ms Inference special): sim physics, heights and every
  // window in sim time are unchanged. Eased over INT_AIR_TIME_BLEND_S so takeoff never jolts.
  let airScale = 1;
  const loop = new FixedLoop({
    onTick: () => {
      const frame = builder.next(input.nextTick(), world.tick);
      lastLook = frame.look;
      mouseAcc.x += frame.lookDelta.x;
      mouseAcc.y += frame.lookDelta.y;
      const res = world.step(frame);
      logParse();
      prev = curr;
      curr = res.snapshot;
      bus.emitAll(res.events);
      const airTarget = curr.skater.state === 'Air' ? TUNING.INT_AIR_TIME_SCALE : 1;
      airScale += (airTarget - airScale) * Math.min(1, 1 / (TUNING.SIM_HZ * Math.max(1e-3, TUNING.INT_AIR_TIME_BLEND_S)));
      loop.setTimeScale(curr.timeScale * airScale);
    },
  });
  loopRef = loop;

  // --- bus wiring -------------------------------------------------------------------------------
  bus.onAny((e) => {
    hud.onEvent(e);
    fx.onEvent(e);
    rig.onEvent(e);
    audio.onEvent(e);
    if (e.type === 'grindStart') input.setRumbleLoop('grindPulse');
    else if (e.type === 'grindEnd' || e.type === 'bail' || e.type === 'runEnd') input.setRumbleLoop(null);
    const r = e.type === 'grindStart' ? null : rumbleForEvent(e);
    if (r) input.rumble(r);
  });
  bus.on('macguffin', (e) => loop.freeze(e.hitstopTicks));
  bus.on('runEnd', (e) => {
    ended = true;
    endEvent = e;
    endTimer = TUNING.INT_RESULTS_DELAY_S;
  });

  // --- HUD projector (balance meter over the head, ui request) ------------------------------------
  const projV = new Vector3();
  hud.setProjector((p: Vec3): ScreenPoint | null => {
    projV.set(p.x, p.y, p.z).project(rig.camera);
    const visible = projV.z < 1 && projV.x >= -1 && projV.x <= 1 && projV.y >= -1 && projV.y <= 1;
    return { x: ((projV.x + 1) / 2) * stage.width, y: ((1 - projV.y) / 2) * stage.height, visible };
  });

  const onCanvasClick = (): void => {
    if (!paused && !ended) input.requestPointerLock();
  };
  opts.canvas.addEventListener('click', onCanvasClick);

  audio.playMusic(built.def.id === 'woodshed' ? 'woodshed' : 'marketStreet');
  rig.snapTo(curr);
  let firstFrame = true;

  const enterScripted = (): void => {
    if (scripted) return;
    scripted = true;
    loop.pause();
  };

  const session: GameSession = {
    levelId: built.def.id,
    mode: opts.mode,
    bus,
    get snapshot() {
      return curr;
    },
    get paused() {
      return paused;
    },
    get ended() {
      return ended;
    },
    get lastFrame() {
      return builder.last;
    },
    get parserMemory() {
      return world.lastParse?.memory ?? null;
    },
    takeParsed() {
      return parseLog.splice(0, parseLog.length);
    },
    warm() {
      // Link every program of the run scene (level, skater, NPCs, FX meshes, hidden ones included:
      // three's compile walks all materials) through KHR_parallel_shader_compile before the first frame.
      scene.environmentIntensity = TUNING.RSKY_ENV_INTENSITY;
      return warmScene(stage.renderer.renderer, scene, rig.camera);
    },
    pause(reason) {
      if (paused || disposed) return;
      paused = true;
      loop.pause();
      input.setRumbleLoop(null);
      input.exitPointerLock();
      audio.setPaused(true);
      bus.emit({ type: 'pause', tick: world.tick, paused: true, reason });
    },
    resume() {
      if (!paused || disposed) return;
      paused = false;
      if (!scripted) loop.resume();
      audio.setPaused(false);
      bus.emit({ type: 'pause', tick: world.tick, paused: false, reason: 'player' });
    },
    render(dtS) {
      if (disposed) return;
      if (!scripted && !paused) loop.frame(dtS);
      else if (!scripted) input.nextTick(); // drain edges that arrive while paused
      const alpha = scripted ? 1 : loop.alpha;
      const view = lerpSnapshot(prev, curr, alpha);
      if (firstFrame) {
        rig.snapTo(view);
        firstFrame = false;
      }
      levelView.update(view, dtS);
      skaterView.update(view, dtS);
      fx.update(view, paused ? 0 : dtS);
      rig.update(view, { stick: lastLook, mouseDeltaPx: { x: mouseAcc.x, y: mouseAcc.y } }, dtS);
      mouseAcc.x = 0;
      mouseAcc.y = 0;
      lighting.update(view.skater.pos);
      scene.environmentIntensity = TUNING.RSKY_ENV_INTENSITY;
      post.setGlowing(view.special.glowing);
      post.render(dtS);
      hud.update(view, dtS);
      audio.update(paused ? null : view, dtS);
      if (endEvent && !endFired) {
        endTimer -= dtS;
        if (endTimer <= 0) {
          endFired = true;
          opts.onRunEnd(endEvent);
        }
      }
    },
    resize(w, h) {
      post.setSize(w, h);
      rig.setAspect(w / h);
    },
    setQuality(q: QualitySettings) {
      lighting.setQuality(q);
      post.setQuality(q);
      fx.setQuality(q);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      input.setRumbleLoop(null);
      input.exitPointerLock();
      opts.canvas.removeEventListener('click', onCanvasClick);
      hud.setProjector(null);
      bus.clear();
      post.dispose();
      fx.dispose();
      skaterView.dispose();
      levelView.dispose();
      lighting.dispose();
    },
    debug: {
      setInput(inp) {
        enterScripted();
        driver.setInput(inp);
      },
      step(n) {
        enterScripted();
        const steps = Math.max(0, Math.floor(n));
        for (let i = 0; i < steps; i++) {
          prev = curr;
          driver.step(1);
          logParse();
          curr = world.snapshot;
          takeEvents();
        }
        const last = builder.last;
        if (last) lastLook = last.look;
        prev = curr;
        return curr;
      },
      teleport(pos, dir, speed) {
        driver.teleport(pos, dir, speed);
        prev = null;
        curr = world.snapshot;
        rig.snapTo(curr);
      },
      comboBanked: () => world.lastBanked,
      runScore: () => world.snapshot.run.score,
      resume() {
        if (!scripted) return;
        scripted = false;
        if (!paused) loop.resume();
      },
    },
  };
  return session;
}
