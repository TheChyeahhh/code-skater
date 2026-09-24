# ARCHITECTURE.md: CODE SKATER module contracts, data flow, ownership

Source of truth order (AGENTS.md): SPEC.md, then DESIGN.md, then this file. This file says HOW the
code is split so 11 build tracks can work in one shared tree at once without touching each other's
files. Every contract below exists in code at M0 as typed signatures with doc comments; unbuilt
bodies throw `notImplemented('<module>: <fn>')` (src/core/contract.ts).

Status at M0: tooling, `src/core/tuning.ts` (+ one `src/core/tuning/<track>.ts` per track), the
fixed-tick loop, the event bus, the complete trick catalog, the brand table, all contract files, the
lit test scene, seven dev harnesses, smoke tests, a DOM test environment (happy-dom), grep tests.
Contract fixes after the M0 review (flipPhase, the pose table, clockZero, spine-transfer gap, land
text timing, NPC dialog, rail pipes, menu flythrough, results helper, rumble loop) are in.

## 1. Module map

```
index.html                 canvas#game + div#ui-root, loads src/main.ts
src/main.ts                tiny entry: start gate, AudioContext in the gesture, import('./app/boot')
src/styles/base.css        page frame + gate styles (system font stack)
src/app/                   integration: boot.ts (menu chunk: app flow, UI root, input, audio, save,
                           pause sources, frame loop), game.ts (game chunk entry), stage.ts (the one
                           renderer, level / environment caches, menu flythrough backdrop, quality),
                           session.ts (one run: world, views, loop, bus), lazyBoardPreview.ts,
                           debugHook.ts (dev builds only)
src/core/                  FROZEN shared kernel
  tuning.ts                TUNING / TUNING_META / presets / ticks(); assembles the track files below
  tuning/<track>.ts        one file of tunables per track, OWNED BY THAT TRACK (section 7)
  types.ts                 Vec3, Quat, Dir8, Button, InputFrame, ids, SimSnapshot, BoardConfig, options
  events.ts                SimEvent union + EventBus
  loop.ts                  FixedLoop (120 Hz accumulator) + RafDriver
  interp.ts                lerpSnapshot(prev, curr, alpha) for every view
  math.ts                  record math, heading helpers, xzy()
  rng.ts                   seedable Rng (mulberry32)
  mock.ts                  restSnapshot, mockSnapshotAt(tick), mockEventsAt(tick), neutralFrame
  contract.ts              notImplemented / isNotImplemented / tryImplemented
  debugApi.ts              window.__codeSkater.debug contract, window.__shotReady
src/data/                  FROZEN data
  tricks.ts                SPEC §9.1 schema, full DESIGN D.2 catalog, variant ids, names, input tables
  brands.ts                THE ONLY file with real names; parody / real tables; BRANDS, BRAND_MODE
  goals.ts                 GoalDef / GoalCondition types + small helpers
src/levels/types.ts        FROZEN level schema, BuiltLevel, violations
src/levels/registry.ts     FROZEN lazy LevelDef loader
src/levels/builder.ts ...  levels track (builder, validate, testBox, primitives/)
src/levels/marketStreet.ts street track        src/levels/woodshed.ts  woodshed track
src/input/                 input track (types.ts frozen): devices, system, frameBuilder, parser, dir8, glyphs, rumble
src/sim/types.ts           FROZEN logic <-> sim <-> app contracts
src/sim/stateMachine.ts, scoring.ts, balance.ts, special.ts        logic track (pure)
src/sim/controller.ts, collision.ts, rails.ts, gaps.ts, world.ts, run.ts, debug.ts   sim track
src/render/types.ts        FROZEN render / skater / fx contracts
src/render/{renderer,post,quality,lighting,sky,materials,levelView,menuFlythrough}.ts, textures/  render track
src/render/skater/, src/render/npc.ts                              skater track
src/render/fx/, src/render/camera.ts                               fx track
src/ui/ (types.ts frozen; results.ts = buildRunResults), src/save/ (types.ts frozen)   ui track
src/audio/ (types.ts frozen)                                       audio track
dev/<track>.html + .ts     per-track harness pages; dev/shared/ helpers (integration)
tests/                     vitest (node; DOM suites opt in to happy-dom); e2e/ playwright; scripts/ checks
```

Dependency direction (enforced by review, partly by eslint): `core` <- `data` <- `levels/types` <-
everything else. `sim/**` may import core, data, levels/types, input (parser + types) and sim; never
render, ui, audio, app, save, DOM or clocks. `levels/**` may import core, data and three geometry;
never meshes, materials, textures or sim. Render, ui and audio read snapshots and events; nothing
writes sim state except the sim.

## 2. Data flow

Per render frame (src/app/session.ts, integration phase):

```
rAF
 |- input.sample(now)                         InputSystem polls pads, drains keyboard / mouse queues
 |- loop.frame(realDt)                        FixedLoop: clamp 0.1 s, x timeScale, <= 12 ticks
 |    each tick:
 |      raw   = input.nextTick()              held + queued edges (each delivered exactly once)
 |      frame = frameBuilder.next(raw, tick)  Dir8, dirAxis, DirEnter ring, press history (pure)
 |      {snapshot, events} = world.step(frame)
 |      bus.emitAll(events)                   audio, FX, HUD, rumble (+ grind pulse loop), camera shake, hitstop
 |      loop.setTimeScale(snapshot.timeScale); macguffin event -> loop.freeze(hitstopTicks)
 |- view = lerpSnapshot(prevSnapshot, snapshot, loop.alpha)
 |- levelView.update(view); skaterView.update(view); fx.update(view); camera.update(view, look)
 |- lighting.update(view.skater.pos); post.setGlowing(view.special.glowing); post.render()
 |- hud.update(view); ui.update(input.nav()); audio.update(view)
```

Main menu (no run, no sim): the app builds the Market Street scene (LevelView, lighting, sky) and
renders it through `createMenuFlythrough(built, aspect).camera` behind #ui-root while the mainMenu
screen shows; it is disposed when a run starts. BuiltLevels, EnvironmentHandles and the material
registry are cached by src/app/stage.ts for the page's lifetime, so the backdrop and every run reuse them.

App flow (src/app/boot.ts): gate -> main menu -> Career / Free Skate -> park select -> goal list
(career) -> run (2:00 career, untimed Free Skate, DESIGN L CR-42) -> pause -> results -> save
(`applyRunEnd`, `buildRunResults`) -> menu. The app, not the UI, handles nav.pause during a run (the
frame's NavInput is swallowed so Esc cannot pause and resume in one frame); a gamepad disconnect
mid-run pauses and shows the UI root's overlay; a hidden tab pauses. F2 toggles the input dev
overlay; ~ / View toggles the tuning panel (UI root). Camera collision uses a level BVH ray that passes
through shapes shorter than INT_CAM_IGNORE_HEIGHT_M.

Per sim tick inside `world.step(frame)` (src/sim/world.ts):

0. `timerEvent()` first: state timers (LandWindow, RevertWindow, GetUp, lip hold) expire at the START
   of the tick, before parsing, so a window of N ticks accepts input on exactly N ticks (sim track, M4).
1. Build `ParserContext` from the current machine state and geometry queries at the current position
   (spine transfer available, air grind / lip candidate, ground snap candidate, grind types by Dir8).
2. `parseTick(ctx, frame, memory)` (input) -> `ParsedAction[]`.
3. Air tricks, enhance, quick spin and Air specials go straight to scoring and animation timers; every
   other action becomes an `SmEvent`; `transition()` (logic) returns next state, combo effect, element
   and effects; the world applies them (scoring, controller, balance, clock).
4. `stepController` (sim) in the mode the state implies -> physics events. On `contact`,
   `resolveLanding()` (input) supplies the revert buffer and manual pair for the `LandingFacts`.
5. Derived events (slowStop, climbSteep, velocityUp, needleOut, clockZero, overtime) -> more
   transitions. clockZero repeats every tick from 0:00 until RunEnd.
6. Balance, special meter (fed by `scoring.takeClosed()`), hold accrual, gaps, pickups, NPC talk,
   run clock, goals.
7. Fresh plain `SimSnapshot` + this tick's `SimEvent[]`.

## 3. Contract summary: who computes what

| Question | Answer (module, track) |
|---|---|
| Raw device state -> per-tick input | `InputSystem.sample` / `nextTick` (src/input/system.ts, input) |
| Dir8, dirAxis, DirEnter ring, press history | `FrameBuilder.next` (src/input/frameBuilder.ts, input) |
| Presses and sequences -> actions, CR-11 / CR-12 arbitration, double tap, buffers | `parseTick`, `resolveLanding` (src/input/parser.ts, input) |
| Geometric predicates the parser needs | the world, before parsing (`ParserContext`, sim) |
| Grind type for a direction (toe-side rule) | `railOnToeSide` + `grindTypesByDir` (src/sim/rails.ts, sim) using `grindTypeFromDir` (data) |
| Actions + physics -> state machine events | the world (src/sim/world.ts, sim) |
| Which transition happens, combo effect, element to add, effects | `transition` / `timerEvent` over `TRANSITIONS` (src/sim/stateMachine.ts, logic) |
| Element value, degradation, multiplier, FINAL, bank / lose | `Scoring` (src/sim/scoring.ts, logic) |
| Land quality (clean / ok / sick / insane) | `landQuality(offAxisDeg, final)` (scoring, logic); off-axis angle from the controller (sim). The `land` event carries landQuality(offAxis, 0) (clean / ok); `comboBanked` carries the banked quality (sick / insane possible); the world keeps the contact's offAxisDeg until the bank and rewrites `snapshot.lastLand` then (LandView doc) |
| Yaw / tilt off-axis, surface flags, vert assist, pops, pivots, mirrors | controller (src/sim/controller.ts, sim) |
| Balance input from the stick (axis + sign) | `balanceInput(axis, frame.dirAxis)` (balance, logic), called by the world |
| Needle dynamics and re-centre | `startBalance` / `stepBalance` / `driftK` (balance, logic) |
| Special meter fill, drain, glow | `feedSpecial` / `stepSpecial` / `emptySpecial` (special, logic) |
| Magnet query, grind motion, rail ends, corners, transfer rail lookup | src/sim/rails.ts (sim) |
| Raycasts / sphere contacts against the level | src/sim/collision.ts (sim, three-mesh-bvh) |
| Named gaps | src/sim/gaps.ts (sim) from `GapDef` rules (levels/types): the ONLY producer of gap elements, the spine transfer's +1 included (row 11 is "live" with no element, CR-24) |
| Run clock, letters, MacGuffin, NPC trigger, goal completion | src/sim/run.ts (sim); goal lists are level data (street / woodshed). clockZero is re-emitted every tick at 0:00 until RunEnd (CR-25); `npcTalk` fires on every trigger entry (CR-23); trigger radius 0 = read COLLECT_RADIUS_M / TALK_TRIGGER_M live |
| Career persistence (goals, MacGuffins, best scores, unlocks, stamp) | the app at run end through `SaveStore` (src/save, ui track); never inside a tick |
| Results card data (nearest goal distance, unlock lines) | `buildRunResults(runEnd, before, after, goals)` (src/ui/results.ts, ui), pure and unit-tested; the app calls it after the save update |
| Mesh / collider / rail spline / trigger / decal generation | `buildLevel` (src/levels/builder.ts, levels) |
| Rail and coping pipe meshes | the builder: a default pipe for every kind "rail" rail without a `RailPipePrim`, a coping pipe for every kind "coping" rail, none for ledges; a `RailPipePrim` overrides the style (rule above RailPipePrim in src/levels/types.ts) |
| Decal placement | authored in LevelDef.decals (street / woodshed), quads built by the levels builder, validated off rails by `validateLevel` (levels), textured and drawn by LevelView (render) |
| Level validation (rail coverage, decals, MacGuffin reach, feeds, walls) | `validateLevel` (src/levels/validate.ts, levels) |
| Board flip rotation per trick | `boardFlipRotation(flipId, flipPhase)` (src/render/skater/poses.ts, skater); the sim supplies `skater.flipId` + `skater.flipPhase`, which keeps running when a grab or a snap takes the pose |
| Pose per state | sim picks `pose` / `poseVariant` / `posePhase` by the table on `PoseId` (src/core/types.ts); skater maps them to joint rotations |
| Speed tier | sim, from speedRatio: fast >= CAM_FOV_KICK_SPEED, cruise >= SPEED_TIER_CRUISE_RATIO, else slow; `speedTier` event on change |
| Interpolation for rendering | `lerpSnapshot` (src/core/interp.ts, frozen) |
| Camera (chase, orbit, FOV kick, collision, shake) | src/render/camera.ts (fx); collision through an injected raycast from the app |
| Sparks, dust, speed lines, trails, ribbon, flash | src/render/fx (fx) from SimEvents + snapshot |
| Hitstop and time scale | sim reports (`macguffin.hitstopTicks`, `snapshot.timeScale`); app applies to FixedLoop |
| Rumble | `rumbleForEvent` (input) mapping; app wires bus -> `InputSystem.rumble`; the grind pulse repeats via `InputSystem.setRumbleLoop` (grindStart on, grindEnd / bail / pause off) |
| HUD text, splashes, toasts, NPC dialog, balance meter | src/ui/hud.ts (ui) from snapshot + events; the HUD owns the NPC dialog's open / closed state (opens on `npcTalk`, closes after NPC_DIALOG_S or on confirm); `snapshot.npc` only says "inside a trigger" |
| Menus, Board Lab, options, results, dev panel, controller overlay | src/ui (ui); 3D board preview, sticker cursor and provisional sticker via `BoardPreviewHost` (skater) |
| Main menu park flythrough (REQ-MNU-01) | `createMenuFlythrough` (src/render/menuFlythrough.ts, render) gives the camera; the app mounts the scene behind #ui-root |
| Level materials for rails, copings, boundary | LevelView: role rail / coping -> `registry.rail(kind)`, else `registry.get(material)`; "boundary" renders invisible |
| Start gate | src/ui/startGate.ts (ui; tiny, no imports), mounted by src/main.ts; its prompt text and class names are an e2e contract, its CSS is in src/styles/base.css (integration) |
| Sound and music | src/audio/engine.ts (audio) from events + snapshot; AudioContext created in the gate gesture by main.ts |
| Brand names anywhere | `BRANDS` (src/data/brands.ts) only |

## 4. Decisions every builder must know

1. **Math at boundaries = plain records.** `Vec3 {x,y,z}`, `Quat {x,y,z,w}` everywhere data crosses a
   module boundary (snapshots, events, level data, input). Inside implementations three.js math
   classes are fine, including in `src/sim/**` and `src/levels/**`; rendering classes are banned
   there (eslint `no-restricted-imports`). A `Vector3` can be passed where a `Vec3` is read, but copy
   before storing into a snapshot or event. Snapshots are JSON-safe (the e2e hook returns them).
2. **Axes and heading.** x east, y up, z south, origin at the park's north-west corner. Heading
   `yaw` in radians about +y, three's right-hand rule: 0 = north (-z), +PI/2 = west, PI = south,
   -PI/2 = east; `forward = (-sin yaw, 0, -cos yaw)`. Skater local frame: -z nose, +y up, +x right;
   `snapshot.skater.rot` maps it to world, so `object.quaternion.set(...)` just works. Level data uses
   compass words (`Facing`); DESIGN's (x, z, y) tables go through `xzy()`.
3. **Time.** The sim is a fixed 120 Hz tick; windows are authored in ms and converted with
   `ticks(ms) = ceil(ms x 120 / 1000 - 1e-9)`, half-open (inside iff n < N). Hitstop floors (7 ticks).
   No `Date`, `performance`, timers or `Math.random` in `src/sim/**`, the parser or the frame builder
   (eslint enforces). Randomness only from the world's `Rng` (seeded by `WorldConfig.seed`).
4. **Determinism.** `(seed, InputFrame sequence)` fully determines a run. Tests replay frames; the
   debug hook's `step(n)` pauses real time.
5. **Tuning is live.** Read `TUNING.KEY` at use time every tick; never cache. Trick bases that DESIGN
   makes tunable are getters in src/data/tricks.ts for the same reason.
6. **FINAL = floor(COMBO_BASE x MULTIPLIER + 1e-6).** The epsilon absorbs binary float error so the
   D.3 worked example is exactly 15504. trickValue is not rounded; accruals round when the element closes.
7. **The special grind id is `gpu_slide`** (DESIGN D.2 names it after the chip brand's platform;
   AGENTS.md allows real names only in brands.ts; logged as DESIGN §L CR-20). Display name:
   `BRANDS.specialSlideName` ("VIDA Slide" in parody).
8. **Both brand tables live in src/data/brands.ts** (SPEC §11 and AGENTS.md name one file; DESIGN
   REQ-BRD-01's two-file split is logged as CR-21). `BRANDS` is a ternary on the statically replaced
   `import.meta.env.VITE_BRAND_MODE`; the parody build drops `realTable()`. `npm run check:parody`
   proves it on dist/ (and correctly FAILS on `npm run build:private`, verified at M0).
9. **Neutral Square = Kickflip, neutral Circle = Indy** (DESIGN leaves neutral flip / grab open;
   M0 default in `FLIP_BY_DIR` / `GRAB_BY_DIR`). Change there if the founder rules otherwise.
10. **LandWindow and RunEnd are states** (CR-18 and row 41). `COMBO_ALIVE_STATES` in core/types.ts.
11. **Air tricks are not transitions.** Flips, grabs, enhance, quick spin and Air specials are handled
    by the world with scoring; Grind / Manual specials are rows 24 / 34.
12. **Collider triangles are non-indexed.** Original triangle of a BVH hit = `floor(hit.face.a / 3)`;
    per-triangle `triTag` / `triSurface` are indexed by it. Rail and coping pipes are not in the collider.
13. **Every primitive id is a surface id** ("MS-F1"): contacts, gaps and goals refer to surfaces by it.
14. **Start gate and audio.** The gate paints before any game code loads; the AudioContext is created
    and resumed inside the gate gesture in src/main.ts and handed to `AudioEngine.init(ctx)`.
    `?autostart` skips the gate (screenshots); audio then waits for a real gesture.
15. **Code split.** Entry chunk (gate) about 2 KB gzip; `import('./app/boot')` after the gesture pulls
    the menu chunk (UI, input, audio, save; no three.js), which paints the main menu at once and then
    `import('./game')` pulls the game chunk (renderer, levels, sim, views) and one `vendor` chunk
    (three, postprocessing, n8ao, three-mesh-bvh) behind it (REQ-MNU-05). The Board Lab holds a lazy
    BoardPreviewHost that forwards to the 3D turntable once the game chunk is in. Each park's LevelDef
    is its own chunk (src/levels/registry.ts). Budget 1500 KB gzip total (`npm run check:size`).
16. **Headless WebGL flags.** SPEC's `--use-gl=swiftshader` loses the WebGL context about a second
    after creation on Chromium 153 (measured: black screenshots). We use
    `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`
    (same software renderer, stable) in playwright.config.ts and scripts/shot.mjs.
17. **Browser for tests.** `npx playwright install chromium` works here (Chromium 153 / headless
    shell); `PW_CHANNEL=chrome` switches both Playwright and shot.mjs to the installed Chrome.
18. **TypeScript 6.0.3**, not 7: typescript-eslint 8.70 supports TypeScript < 6.1. `erasableSyntaxOnly`
    is on (no enums, namespaces or parameter properties) so Node can import tuning.ts directly;
    tuning.ts imports its track files with explicit `.ts` specifiers (`allowImportingTsExtensions`).
19. **No em dashes in user-facing strings** (NPC lines, toasts, splashes, menus, HUD). Code comments exempt.
20. **Stubs.** A contract file's exported names and types are the contract. Implement bodies freely,
    add private helpers and new files inside your own globs, but do not change an exported signature
    another track uses; request it instead (section 8).
21. **three 0.186 notes.** `PCFSoftShadowMap` is removed (three warns and uses `PCFShadowMap`, which is
    the soft-filtered path now): use `PCFShadowMap` for REQ-REN-03's "PCFSoft". The e2e smoke fails
    on any `THREE.` console warning, so deprecations surface immediately.
22. **Calling another track's function during the phase.** It may still be a stub. Call it through
    `tryImplemented(() => fn(...)) ?? fallback` and keep a plain fallback (the ui controls view uses
    `glyphLabel` this way, falling back to the Button name). Never copy another track's table or logic
    to get around a stub.
23. **Pose and flip phases.** `posePhase` follows the PoseId table (balance poses lean with the
    needle, so the phase moves both ways); `flipPhase` is the board flip's own clock. `lerpSnapshot`
    blends posePhase within one pose unless it jumps by more than 0.5 (a loop wrap), and flipPhase
    while the same flip runs.
24. **Level trigger radii are live.** `TriggerSphere.radius` is 0 unless authored (NpcDef.talkRadius);
    the sim reads COLLECT_RADIUS_M / TALK_TRIGGER_M at test time, so dev panel sliders work.

## 5. Contract files (frozen after M0, integration track only)

| File | Holds |
|---|---|
| src/core/types.ts | math records, directions, buttons, InputFrame, ScriptInput / InputTimeline, NavInput, all trick / id unions, SkaterStateName, SurfaceFlags, PoseId, SimSnapshot and parts, BoardConfig, GameOptions |
| src/core/events.ts | SimEvent union (producer noted per event) and EventBus |
| src/core/tuning.ts | TUNING, TUNING_META, TUNING_ENUM_META, DEGRADATION_PRESETS, SpinMode, PIXEL_RATIO_CAPS, SHADOW_MAP_SIZES, ticks / ticksS / hitstopTicks / statFactor / maxSpeed / degradationTable, TuningEntry / TrackTuningSpec. The area sections are frozen; `src/core/tuning/<track>.ts` are NOT contract files: each is owned and edited by its track |
| src/core/loop.ts, interp.ts, math.ts, rng.ts, mock.ts, contract.ts, debugApi.ts | kernel utilities (section 1) |
| src/data/tricks.ts, brands.ts, goals.ts | catalog, brand table, goal types |
| src/levels/types.ts | LevelDef and every primitive, RailDef, GapDef and rules, BuiltLevel, BuiltCollider, violations, MaterialId, EnvironmentPreset |
| src/input/types.ts | devices, InputSystem, RawTickInput, FrameBuilder, ParserContext, ParserMemory, ParsedAction, LandingLinkers |
| src/sim/types.ts | DESIGN_ROW_IDS, SmEvent, SmFacts, MachineState, TransitionRow, TransitionResult, SmEffect, ElementRef / ElementSpec / ComboElement / BankResult, BalanceState, SpecialState, WorldConfig, SkaterWorld |
| src/render/types.ts | QualitySettings, GameRenderer, PostChain, EnvironmentHandle, Lighting, MaterialRegistry, LevelView (+ LevelViewDeps), BoardModel, SkaterView, NpcFigure, BoardPreviewHost, FxSystem, CameraLookInput, CameraRig, CameraRaycast, MenuFlythrough |
| src/ui/types.ts | ScreenId, UiActions, UiState, UiDeps, RunResults, BuildRunResults, Hud, FocusItem, FocusManager, UiRoot |
| src/save/types.ts | SaveData, CareerProgress, DEFAULT_SAVE, StorageLike, SaveStore |
| src/audio/types.ts | AudioEngine, AudioVolumes, MusicTrack, UiSound |

Track entry points (stub now, implemented by the owner): `createInputSystem`, `createFrameBuilder`,
`parseTick`, `resolveLanding`; `TRANSITIONS`, `transition`, `timerEvent`, `Scoring`, `driftK`,
`startBalance`, `stepBalance`, `balanceInput`, `feedSpecial`, `stepSpecial`, `emptySpecial`;
`buildLevel`, `validateLevel`, `TEST_BOX`; `MARKET_STREET`; `WOODSHED`; `createWorld`,
`createCollisionWorld`, `createRailNetwork`, `stepController`, `createGapTracker`, `createRun`,
`createDebugDriver`; `createGameRenderer`, `createPostChain`, `qualitySettings`, `createLighting`,
`createEnvironment`, `createMaterialRegistry`, `createLevelView`; `createSkaterView`,
`createBoardModel`, `createBoardPreview`, `createNpcFigure`, `getPose`, `boardFlipRotation`;
`createMenuFlythrough`; `createFxSystem`, `createCameraRig`; `createUiRoot`, `createHud`,
`createFocusManager`, `createDevPanel`, `createSaveStore`, `buildRunResults`; `createAudioEngine`.

## 6. Ownership table

Every file in src/, tests/, dev/, e2e/ and scripts/ (and the root config files) has exactly one
owner. Rule: an exact path (no `*`) beats any glob; otherwise all matching globs must name the same
owner. `tests/ownership.test.ts` enforces this table against the tree, so a new file outside your
globs fails the suite: put new files inside your own globs (the private folders exist for that).

| Paths | Owner | Notes |
|---|---|---|
| `src/core/**` | integration | frozen after M0 |
| `src/data/**` | integration | frozen after M0 |
| `src/levels/types.ts` `src/levels/registry.ts` | integration | frozen after M0 |
| `src/input/types.ts` `src/sim/types.ts` `src/render/types.ts` `src/ui/types.ts` `src/save/types.ts` `src/audio/types.ts` | integration | frozen contract files |
| `src/vite-env.d.ts` `src/main.ts` `src/app/**` `src/styles/**` | integration | |
| `index.html` `vite.config.ts` `vitest.config.ts` `playwright.config.ts` `eslint.config.js` `tsconfig.json` `package.json` `package-lock.json` `.env` `.env.private` `.gitignore` `ARCHITECTURE.md` | integration | root config |
| `DESIGN.md` `SPEC.md` `AGENTS.md` | integration | tracks submit CHANGE-REQUEST lines under `requests` (section 8) |
| `DEPLOY.md` `.github/**` | integration | SPEC §12 deploy steps and the GitHub Pages workflow (REQ-DEP-02) |
| `src/core/tuning/integration.ts` | integration | |
| `e2e/**` `scripts/**` `dev/shared/**` | integration | |
| `tests/tuning.test.ts` `tests/loop.test.ts` `tests/events.test.ts` `tests/tricks.test.ts` `tests/brands.test.ts` `tests/contracts.test.ts` `tests/ownership.test.ts` | integration | |
| `tests/grep*.test.ts` `tests/integration*.test.ts` `tests/fixtures/integration/**` | integration | |
| `src/input/**` `src/core/tuning/input.ts` | input | |
| `tests/input*.test.ts` `tests/rumble*.test.ts` `tests/fixtures/input/**` | input | |
| `dev/input.html` `dev/input.ts` `dev/input/**` | input | port 5301 |
| `src/sim/stateMachine.ts` `src/sim/scoring.ts` `src/sim/balance.ts` `src/sim/special.ts` `src/sim/logic/**` `src/core/tuning/logic.ts` | logic | pure logic |
| `tests/scoring*.test.ts` `tests/stateMachine*.test.ts` `tests/balance*.test.ts` `tests/special*.test.ts` | logic | |
| `tests/fixtures/workedExample.ts` `tests/fixtures/logic/**` | logic | D.3 as data (REQ-TST-05) |
| `src/levels/builder.ts` `src/levels/validate.ts` `src/levels/testBox.ts` `src/levels/primitives/**` `src/levels/lib/**` `src/core/tuning/levels.ts` | levels | |
| `tests/levels*.test.ts` `tests/fixtures/levels/**` | levels | |
| `dev/levels.html` `dev/levels.ts` `dev/levels/**` | levels | port 5303 |
| `src/levels/marketStreet*.ts` `tests/marketStreet*.test.ts` `tests/fixtures/street/**` `src/core/tuning/street.ts` | street | view on port 5304 via dev/levels.html?level=marketStreet |
| `src/levels/woodshed*.ts` `tests/woodshed*.test.ts` `tests/fixtures/woodshed/**` `src/core/tuning/woodshed.ts` | woodshed | view on port 5305 via dev/levels.html?level=woodshed |
| `src/levels/labCampus*.ts` `tests/labCampus*.test.ts` | integration | Lab Campus (2026-09-23), view via dev/levels.html?level=labCampus |
| `src/sim/controller.ts` `src/sim/collision.ts` `src/sim/rails.ts` `src/sim/gaps.ts` `src/sim/world.ts` `src/sim/run.ts` `src/sim/debug.ts` `src/sim/physics/**` `src/core/tuning/sim.ts` | sim | |
| `tests/sim*.test.ts` `tests/controller*.test.ts` `tests/grind*.test.ts` `tests/lip*.test.ts` `tests/goals*.test.ts` `tests/fixtures/sim/**` | sim | DESIGN suite names map here (section 10); port 5306 for any page under dev/sim/ |
| `dev/sim.html` `dev/sim.ts` `dev/sim/**` | sim | optional harness |
| `src/render/renderer.ts` `src/render/post.ts` `src/render/quality.ts` `src/render/lighting.ts` `src/render/sky.ts` `src/render/materials.ts` `src/render/levelView.ts` `src/render/menuFlythrough.ts` `src/render/textures/**` `src/render/lib/**` `src/core/tuning/render.ts` | render | |
| `tests/render*.test.ts` `tests/materials*.test.ts` `tests/quality*.test.ts` `tests/fixtures/render/**` | render | |
| `dev/render.html` `dev/render.ts` `dev/render/**` | render | port 5307 |
| `src/render/skater/**` `src/render/npc.ts` `tests/skater*.test.ts` `tests/fixtures/skater/**` `src/core/tuning/skater.ts` | skater | |
| `dev/skater.html` `dev/skater.ts` `dev/skater/**` | skater | port 5308 |
| `src/render/fx/**` `src/render/camera.ts` `tests/fx*.test.ts` `tests/camera*.test.ts` `tests/fixtures/fx/**` `src/core/tuning/fx.ts` | fx | |
| `dev/fx.html` `dev/fx.ts` `dev/fx/**` | fx | port 5309 |
| `src/ui/**` `src/save/**` `tests/ui*.test.ts` `tests/hud*.test.ts` `tests/save*.test.ts` `tests/fixtures/ui/**` `src/core/tuning/ui.ts` | ui | DOM suites: happy-dom on line 1 (section 10) |
| `dev/ui.html` `dev/ui.ts` `dev/ui/**` | ui | port 5310 |
| `src/audio/**` `tests/audio*.test.ts` `tests/fixtures/audio/**` `src/core/tuning/audio.ts` | audio | |
| `dev/audio.html` `dev/audio.ts` `dev/audio/**` | audio | port 5311 |

## 7. Tuning rule (src/core/tuning.ts + src/core/tuning/<track>.ts)

- The area sections in src/core/tuning.ts (sim, windows, input, landing, movement, air, vert, grind,
  lip, manual, scoring, special, balance, stats, camera, fx, hud, run, render, audio, deploy) hold
  every DESIGN M number and are frozen: changing one needs a `CHANGE-REQUEST` (section 8).
- Each track OWNS one file, `src/core/tuning/<track>.ts`, exporting `<TRACK>_TUNING = { ... }
  satisfies TrackTuningSpec`. Add your keys only there, in the entry format
  `KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'],` followed by a comment with the REQ id,
  range and rationale. META is generated from the same entry. One owner per file means two tracks
  can never overwrite each other's keys; tuning.ts itself is never edited by a track (it already
  imports and assembles all twelve files).
- Keys are global: prefix track keys when a name could collide (`tests/tuning.test.ts` fails on
  duplicates and checks every key of your file reached TUNING in group `track:<name>`).
- Systems read `TUNING.KEY` (live), never the `<TRACK>_TUNING` object. Keep the track file import
  free except `import type { TrackTuningSpec } from '../tuning.ts'` (Node type stripping loads it).
- Enum tunables (dropdowns) are added only by the integration track (`ENUMS`, `TUNING_ENUM_META`).

## 8. Working in parallel

- Edit only files your track owns. For anything else (a contract type, a tuning area value, a
  dependency, a helper in core) put it under `requests` in your final output with the exact change.
- CHANGE-REQUEST lines (a locked number or a DESIGN rule you need changed) are submitted under
  `requests` in your final output, in the form `CHANGE-REQUEST: <id> old -> new, reason`; the
  integration track writes them into DESIGN.md §L. No track edits DESIGN.md, SPEC.md or AGENTS.md.
- Another track's function may still be a stub: call it through `tryImplemented` with a plain
  fallback (section 4, decision 22).
- Do not run `npm install`, and never commit with `git add -A` during the parallel phase; stage only
  your own paths (AGENTS.md).
- Whole-project `tsc` can show errors in other tracks' files mid-phase; keep your own files clean:
  `npx tsc --noEmit 2>&1 | grep <your path>`.
- Run only your tests: `npx vitest run tests/<yours>`. Lint your files: `npx eslint <your paths>`.

## 9. Dev ports and harnesses

| Track | Port | Page |
|---|---|---|
| input | 5301 | dev/input.html (raw devices now; InputFrame and NavInput once built) |
| logic | 5302 | no page: `npx vitest run tests/scoring.test.ts` etc. (reserved port) |
| levels | 5303 | dev/levels.html (?level=testBox, ?raw draws LevelDef data, ?top) |
| street | 5304 | dev/levels.html?level=marketStreet&raw (the built view appears once buildLevel lands) |
| woodshed | 5305 | dev/levels.html?level=woodshed&raw (same) |
| sim | 5306 | optional dev/sim.html (sim track may add it); tests are the main surface (see the sim note in section 10) |
| render | 5307 | dev/render.html (material swatches, rail, deck) |
| skater | 5308 | dev/skater.html (?pose=grind, ?t=2.9 seconds into the mock loop) |
| fx | 5309 | dev/fx.html (mock events drive FX and the camera) |
| ui | 5310 | dev/ui.html (?screen=mainMenu and so on) |
| audio | 5311 | dev/audio.html (click "Start audio") |
| integration | 5173 | index.html (the game), `?autostart` skips the gate |

Run a harness: `npx vite --port <port> --strictPort`, open `http://localhost:<port>/dev/<page>.html`.
Screenshot: `node scripts/shot.mjs "http://localhost:<port>/dev/<page>.html" screenshots/<name>.png`
(`--wait ms`, `--size 1920x1080`, `--gpu` for hardware GL). Pages set `window.__shotReady = true`
after 10 frames; shot.mjs prints console errors, page errors and WebGL context losses and exits
nonzero on page errors. Look at the PNG with the Read tool before calling visual work done. Kill
the server you started when finished. Harnesses fall back to placeholders while a module still
throws notImplemented, so they render from day one.

## 10. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Pure logic | vitest, node (`npm test`) | every DESIGN C.5 row (stateMachine), the D.3 example = 15504 and degradation (scoring), needle cases (balance), meter (special), parser priority and CR-11 / CR-12 (input), level validation (levels / street / woodshed), controller, rails, gaps, run (sim*), poses and flip axes (skater), camera maths (fx), save and HUD formatting (ui), event -> voice map (audio) |
| Contracts | vitest (tuning, loop, events, tricks, brands, contracts, ownership, grep, integrationDom) | M0 kernel, catalog = D.2, no real names outside brands.ts, every module imports in node, ownership, comment-stripped source greps, the DOM environment and the start gate's e2e contract |
| Replays | vitest via `replay()` (src/sim/debug.ts) | deterministic scripted runs of the real world on real levels |
| Browser | Playwright (`npm run test:e2e`) | project "dev": boot, gate, no console errors, screenshots, scripted runs through `window.__codeSkater.debug`; project "static": the production build from a subpath via `vite preview`, keyboard-only start, clean console (REQ-DEP-01, REQ-DEP-06) |
| Visual | scripts/shot.mjs + Read | every visual change reviewed by eye |
| Build | `npm run build`, `check:parody`, `check:size`, `zip` | parody bundle, budget, itch.io zip |

Grep-style tests must strip comments before matching (REQ-TST-04; `tests/grep.test.ts` does it for
REQ-SM-11, REQ-TIM-03 and REQ-CTL-01). A test is not trusted until it has been seen to FAIL on a
deliberate mutation of the code it guards (then restore the code).

**DOM suites.** Vitest runs in node. A suite that needs a DOM (tests/ui*.test.ts, tests/hud*.test.ts)
puts exactly `// @vitest-environment happy-dom` on line 1; everything else stays node
(`tests/contracts.test.ts` asserts there is no `window` by default; `tests/integrationDom.test.ts` is
the working example). happy-dom is installed; no track installs anything.

**DESIGN suite names -> files.** DESIGN's Verify column names suites by topic; write them in files
your track owns: controller.test -> `tests/simController.test.ts` (or `tests/controller*.test.ts`),
grind.test -> `tests/simGrind.test.ts`, lip.test -> `tests/simLip.test.ts`, goals.test ->
`tests/simRun.test.ts` (goal evaluation, sim) plus `tests/saveCareer.test.ts` (unlock and stamp
persistence, ui), scoring.test "one test per gap rule kind" (REQ-LVL-07, REQ-STR-04) ->
`tests/simGaps.test.ts` (gaps are sim), levels.test for REQ-STR-* / REQ-WSH-* ->
`tests/marketStreet*.test.ts` / `tests/woodshed*.test.ts`, camera.test -> fx, render / quality /
materials.test -> render, skater.test -> skater, hud / save.test -> ui, input / rumble.test ->
input, audio.test -> audio; tricks / brands / loop / tuning / grep.test are integration.

**Testing against another track's stubs.** During the parallel phase a dependency may still throw
notImplemented. Never write a test that fails only because someone else is not done:
- Street and woodshed suites have two describe blocks. (1) Data-only checks that pass now:
  coordinate spot checks against DESIGN G, ids unique, every copingRailId / railId / peakRailId /
  gap-rule rail resolves, 10 goals with the right TUNING keys, no U+2014 in any text, primitive and
  rail census by kind. (2) Builder-backed checks (rail coverage, MacGuffin reach, feed hops,
  validateLevel) inside `describe.skipIf(tryImplemented(() => validateLevel(DEF, buildLevel(DEF))) === null)`, which
  integration turns on after merge. Look at your park with `dev/levels.html?level=<id>&raw`.
- Sim: `world.ts` and `replay()` depend on input, logic and levels stubs, so they are
  integration-verified; write them against the contracts and keep them out of the sim gate. Unit-test
  controller, rails, collision, gaps and run against hand-built fixtures in `tests/fixtures/sim/**`
  (a BuiltCollider is a non-indexed Float32Array of triangles plus triTag / triSurface; a BuiltRail
  is a RailDef plus segments). Wrap world / replay tests in
  `describe.skipIf(tryImplemented(() => createWorld(cfg).step(neutralFrame(0))) === null)` (the
  probe steps once, so any stub in the chain skips; a real error still fails).
- Any track: a harness or test that calls another track's stub goes through `tryImplemented`.

Definition of done per milestone: `npm run typecheck && npm test && npm run build && npm run lint`
plus `npm run check:parody`, `npm run check:size` and `npm run test:e2e`.
