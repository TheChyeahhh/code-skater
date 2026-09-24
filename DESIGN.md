# CODE SKATER: DESIGN.md

Implementable restatement of SPEC.md (v2, research-corrected). SPEC wins on conflict; this file adds REQ IDs, the locked numbers, and everything the spec left open. Every deviation from a locked number is logged as a CHANGE-REQUEST (section CR, before the Locked numbers table).

Conventions used everywhere in this file:
- REQ IDs: `REQ-<AREA>-<NN>`. Every REQ row has four columns: ID, requirement, SPEC source, verification. The index at the end is generated from those rows.
- Units: metres, seconds, degrees, m/s, m/s^2. `tick` = 1/120 s (8.333 ms is a display value only). Window lengths in ticks: `ticks(ms) = Math.ceil(ms * SIM_HZ / 1000 - 1e-9)` (exact: 90 ms = 11, 100 = 12, 120 = 15, 140 = 17, 150 = 18, 180 = 22, 200 = 24, 250 = 30, 600 = 72, 850 = 102). Every window is half-open: an event at tick index n after its anchor is inside iff n < N. Hitstop is the one floor: floor(60 * 120 / 1000) = 7 ticks.
- Coordinates: x east, z south, y up. Level origin = north-west corner of the park at ground level.
- "deg" is written out; no unicode symbols in tables.
- In-game copy in this file (NPC lines, toasts, splashes, menu labels) contains no em dashes.

---

## A. One-page pitch

**CODE SKATER.** Tagline: **"Compile the line. Fetch the drive."**

| | |
|---|---|
| What | Browser arcade skate game in the THPS lineage: 2:00 runs, combos that live through grinds, manuals and reverts, a special meter, degradation, named gaps, letters, a hidden MacGuffin per park. |
| Fantasy | Tech-industry skate video. Two parks: **Market Street** (downtown plaza, glass towers, server-closet alleys, scaffolds) and **Woodshed** (indoor wood park: bowls, spine, full-pipe, rainbow rails). Parody brands by default (North Star, Canticle, Vidia). |
| Core promise | Combo continuity is the product. If you can see an edge you can grind it. Manual and revert are the glue. One more run. |
| Session | 2:00 run, 10 goals per park, 6/10 Street goals unlock Woodshed, both MacGuffins stamp the Lab Circuit on the menu. |
| Platform | Three.js + TypeScript + Vite, static site, controller first (PS + Xbox), keyboard fallback. Zero downloaded assets. |
| Not | Not a physics sim, not open world, not a typing minigame, no licensed content, no real logos, no real likenesses. |

## B. Core loops

### B.1 Moment to moment (5 to 15 s)
```
roll (auto-push) -> crouch (hold X) -> pop (release) -> trick in air (flip / grab / spin)
   -> land on a linker: GRIND (Triangle, magnet snaps to nearest rail)
                        MANUAL (Up->Down within 140 ms of contact)
                        REVERT (R2 on a vert landing, then manual)
   -> hold balance (needle) -> pop off -> next linker ... -> clean land: BANK (base x multiplier)
   -> or BAIL: combo gone, special gone, 0.85 s get-up
```
Worked micro-loop with a grind: roll at the marble ledge, tap X, press Triangle in the air; the board snaps to the ledge (magnet 0.55 m, entry angle <= 55 deg), sparks, light rumble; hold left/right against the needle; press DR+Triangle to switch to a Smith (new element, needle re-centres to 35%); ollie off the end into a 180 spin; land Up->Down into a manual; ollie out, kickflip, land clean: banked.

### B.2 The 2:00 run
| Phase | What happens |
|---|---|
| 0:00 to 2:00 | Free skating, goals live, score accumulates from banked combos. Clock pulses red under 0:10. |
| 2:00 hits mid-combo | Clock stops at 0:00, sim continues; combo banks if landed, lost on bail (REQ-GOL-06). |
| Run end | Results card: score, best combo, goals completed this run, letters, new goal unlocks, Retry / Park select. |

### B.3 Career
Street: 10 goals. 6 of 10 completed (cumulative across runs) unlocks Woodshed. Woodshed: 10 goals. Both MacGuffins collected = Lab Circuit stamp on the main menu. Progress in localStorage.

### B.4 One-more-run hook
Every run ends on the results card with the nearest uncompleted goal and its distance (score gap or missing letter) shown, and a single-press Retry. Named gaps splash their name and value the moment they are earned so the map teaches its own lines. Degradation resets per run, so a new run is always worth as much as the last.

---

## C. Input and state machine

### C.1 Per-frame data flow

```
requestAnimationFrame(t_render)
  |- input.sample()              // gamepad + keyboard raw snapshot, once per render frame
  |- accumulator += min(dt_render, 0.1 s)
  |- while accumulator >= 1/120:
  |     sim.tick(snapshot, tickIndex)   // pure: input -> parser -> stateMachine -> controller -> scoring -> balance
  |     accumulator -= 1/120
  |- render.interpolate(alpha = accumulator * 120)   // position/rotation lerp between last two sim states
  |- hud.update(sim.readonlyView)
```

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-TIM-01 | Simulation runs at a fixed 120 Hz tick with an accumulator; render frames interpolate between the two latest sim states. | §7 | tests/loop.test: 1000 frames of random dt produce the same tick count as dt sum * 120 |
| REQ-TIM-02 | Input is sampled once per render frame; the sim consumes the latest snapshot each tick. Button press and release edges are queued with the render timestamp and delivered on the next tick so no press is lost at low frame rates. | §7 | input.test: two presses within one frame produce two press events |
| REQ-TIM-03 | Every timing window is measured in sim ticks via ticks(ms) = Math.ceil(ms * SIM_HZ / 1000 - 1e-9) and compared half-open (inside iff n < N); no wall-clock time reaches the sim. | §7, AGENTS | grep test: no Date/performance in src/sim; tuning.test: ticks(200) = 24, ticks(150) = 18, ticks(100) = 12 |
| REQ-TIM-04 | Accumulator catch-up is capped at 0.1 s per render frame (12 ticks); beyond that the sim drops time rather than spiral. | mine | loop.test |
| REQ-TIM-05 | Window lengths in ticks: coyote 11, grind pre-buffer 24, revert pre 18, revert post 22, revert-to-manual 24, manual land window 17, special sequence 30, special button 30, double-tap 30, manual pair gap 30, grind switch cooldown 12, land yaw snap 12, grind snap blend 10, grab release before land 15, lip min hold 18, manual swap cooldown 72, bail tumble 72, get-up 102. | §7 | tuning.test: each window key converts to the listed tick count |

### C.2 Input map (REQ-INP)

| Action | PS | Xbox | Keyboard | Notes |
|---|---|---|---|---|
| Ollie / crouch-charge | Cross hold->release | A | Space | hold 0.1 to 0.6 s |
| Flip (8-way) | Square + dir | X + dir | J + dir | |
| Grab (8-way, holdable) | Circle + dir | B + dir | K + dir | |
| Grind / Lip | Triangle | Y | L | |
| Revert / stance toggle / spine transfer | R2 | RT | Shift | |
| Nollie / fakie modifier | L2 | LT | Z (Ctrl also works; CR-48) | held while pressing flip/grab |
| Quick spin L / R | L1 / R1 | LB / RB | Q / E | |
| Manual | Up->Down | Up->Down | W->S | |
| Nose manual | Down->Up | Down->Up | S->W | |
| Steer / spin / balance | Left stick + D-pad | same | WASD / arrows | |
| Camera | Right stick | same | Mouse (pointer lock) | |
| Pause / goals | Options | Menu | Esc | |
| Dev tuning panel | Share | View | ~ | |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-INP-01 | The map above is the only binding set in MVP; keyboard is a fallback and every action is reachable on a pad. | §5 | input.test: every Action has a pad binding |
| REQ-INP-02 | Dir8 comes from D-pad OR left stick: stick deadzone 0.35, 8 sectors of 45 deg centred on the cardinals; if both are non-neutral the D-pad wins. D-pad and stick must produce identical Dir8 for the same direction. | §5 | input.test: 16 stick angles + 8 dpad states map to expected Dir8 |
| REQ-INP-03 | A DirEnter event fires when Dir8 changes to a non-neutral value that is then held for at least DIR_MIN_DWELL_TICKS (3); the entry is stamped tEnter (the tick the direction began) and tExit (the tick it was left; = now while still held). A ring of the last 4 entries feeds every sequence parser, so a stick sweep around the rim yields only the directions it dwelt on. | §5, CR-11 | input.test: Up,Neutral,Down yields 2 events; a 120 ms rim sweep Up to Down yields the pair (Up, Down) |
| REQ-INP-04 | Double-tap: the same flip or grab (same button AND same Dir8) pressed again within 250 ms while in Air upgrades the pending trick to its enhanced version (one element, not two). | §5 | input.test: two kickflip presses 200 ms apart = Double Kickflip once |
| REQ-INP-05 | Rumble via gamepad.vibrationActuator: grind contact light (weak 0.25, 100 ms pulses while grinding), bail medium (strong 0.8, 250 ms), gap and MacGuffin short (strong 0.5, 120 ms; MacGuffin 0.6, 200 ms). Fails silently if unsupported. | §5 | manual check + rumble.test: calls are no-ops without an actuator |
| REQ-INP-06 | Glyph set from gamepad.id: contains "Xbox" -> Xbox glyphs; contains "054c" or "DualSense" or "Wireless Controller" -> PlayStation glyphs; default Xbox. | §5 | input.test: three ids |
| REQ-INP-07 | Keyboard flip/grab direction = held WASD/arrow direction at the moment J/K is pressed; keyboard steer and Dir8 share the same keys. | §5 | input.test |
| REQ-INP-08 | Gamepad connect/disconnect mid-run auto-pauses with the message "Controller disconnected"; reconnect resumes on any button. | §12 | e2e smoke: simulated disconnect event shows the overlay |
| REQ-INP-09 | A "Click or press any button to start" gate precedes the menu so audio and gamepad activate. | §12 | e2e smoke |

### C.3 Parser: arbitration and priority (CR-11, CR-12)

Inputs to the parser each tick: state S, `glowing`, current Dir8 `d`, held buttons, the press-event queue, DirEnter ring `H` (H[-1] newest), buffers. The parser emits at most one Action per press event, in this priority order. A rule that matches consumes the press; a special also consumes the two DirEnter events it used (they are marked `consumed` in the ring and no later rule may read them).

| Pri | Condition | Action |
|---|---|---|
| P1 | press R2, S=Air, spine-transfer condition true (REQ-VRT-08) | SPINE_TRANSFER (consumes the press; no revert buffer written) |
| P2 | press R2, S=Air | write revertBuffer (valid 150 ms pre-land, 18 ticks) |
| P2b | press R2, S=LandWindow, the landing was on vert (slope >= 40 at contact), no revert yet this landing | REVERT now (the post-contact half of the 180 ms window, row 9c) |
| P3 | press b in {Square, Circle, Triangle}, `glowing`, a special exists with button b and seq (s1,s2), H[-2].dir=s1, H[-1].dir=s2, both unconsumed, H[-1].tEnter - H[-2].tExit <= 30 ticks, now - H[-1].tEnter <= 30 ticks, special.state == S (Air for Kernel Panic / Token Overflow / 900ms Inference; Grind for CUDA Slide; Manual for Context Window) | SPECIAL(id); mark H[-2], H[-1] consumed |
| P4 | press Triangle, S=Grind, d != neutral, grindType(d, approach) != current type, ticks since last switch >= 12 | GRIND_SWITCH(type) |
| P5 | press Triangle, S=Air | GRIND_TRY now (REQ-GRD-03); if no candidate, write grindBuffer (24 ticks) |
| P5b | press Triangle, S in {Grounded, LandWindow, Manual} rolling >= 3.0 m/s and a rail within magnet whose height is within [-0.2, +0.7] m of the board | GRIND_TRY with a hop of max(0.3, dy + 0.1) m (REQ-GRD-05); from LandWindow the combo banks first (row 9g), from Manual it lives (row 34b) |
| P5c | Triangle held or pressed during Crouch | grindBuffer starts at the pop tick (24 ticks from pop) |
| P6 | press Square or Circle, S=Air, same (button, d) as the pending flip/grab within 30 ticks | ENHANCE pending trick |
| P7 | press Square or Circle, S=Air | TRICK(button, d, nollie = L2 held) |
| P8 | press Cross: S=Grounded -> CROUCH or PUMP (rows 1, 1b); S=LandWindow -> CROUCH (banks first, row 9e); S in {Grind, Manual, Lip} -> CROUCH_ON_LINKER (charge while staying in state, pop on release, max 0.6 s); S=Air -> P8b, else ignored | |
| P8b | press Cross, S=Air, ticks since leftSurface or railEnd < 11 (coyote), no pop yet in this air | POP(charge = 0, i.e. 0.9 m). Formula: v += p * v_pop where p is the pop direction from the LAST contact normal (up on flat, blended on a bank; after a transition at slope >= 70 p = up with the assist clamp re-applied, REQ-VRT-10); v.y is not clamped |
| P9 | release Cross in Crouch or a charging linker; or release Cross in Air within 11 ticks of leftSurface when Cross was already held at leftSurface (row 37b) | POP(charge accumulated so far) |
| P10 | press L1 / R1, S=Air | QUICKSPIN(-180 / +180) queued (REQ-VRT-04) |
| P11 | anything else | ignored |

Sequence readers (not press-driven, evaluated every tick on unconsumed DirEnter events). Pair gap rule for every reader: gap = H[-1].tEnter - H[-2].tExit, the time from LEAVING the first direction to ENTERING the second, so a stick held forward for seconds (auto-push) and then tapped back still reads as Up,Down:

| Reader | Condition | Result |
|---|---|---|
| MANUAL_ENTRY | H[-2].dir, H[-1].dir in {(Up,Down),(Down,Up)}, gap <= 30 ticks, both unconsumed; S=Grounded rolling >= 1.0 m/s on flat (slope < 35 deg) | MANUAL (Up,Down) or NOSE_MANUAL (Down,Up); consumes both |
| MANUAL_LAND | same pair (same gap rule); on the contact tick (S=Air, flat landing) when the pair completed within 17 ticks before contact (row 7), or while S=LandWindow after a flat landing, i.e. within 17 ticks after contact (row 9d) | linker MANUAL; consumes both |
| REVERT_MANUAL | same pair completes within 24 ticks of entering RevertWindow (events pressed during the revert animation are kept) | MANUAL from RevertWindow; consumes both |
| MANUAL_SWAP | in Manual, the pair opposite to the current type (nose <-> normal), same gap rule, the second direction held >= MANUAL_SWAP_MIN_HOLD_TICKS (4), ticks since the last swap >= 72 (MANUAL_SWAP_COOLDOWN_MS 600) and fewer than MANUAL_SWAP_MAX_PER_RUN (3) swaps in this manual run; a pair failing any of these is ignored and does not consume its events | swap type (+1 element) |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-INP-10 | The parser is a pure function of (state, glowing, snapshot, ring, buffers) and applies the priority table above in order; the first matching row wins. | CR-11, CR-12 | input.test: table rows as cases |
| REQ-INP-11 | CR-11: DirEnter events consumed by a special are removed from the manual readers; a landed Kernel Panic (U,D + Circle) never produces a manual from the same Up,Down. | CR-11 | input.test: U,D,Circle then land on flat -> no manual |
| REQ-INP-12 | Specials are only parsed while `glowing`; the same sequence while not glowing falls through to the normal trick (U,D + Circle not glowing = Tailgrab, and the Up,Down pair stays available to the manual reader). | CR-11 | input.test |
| REQ-INP-13 | CR-12: in Grind, two directions within 250 ms + Triangle while glowing = CUDA Slide; otherwise a single direction + Triangle = grind switch. A pair older than 250 ms is not a sequence. | CR-12 | input.test: U,D(200ms),Triangle glowing -> gpu_slide; not glowing -> switch to 5-0 (D) |
| REQ-INP-14 | Context Window: in Manual, L,R within 250 ms + Triangle while glowing; otherwise Triangle in Manual falls through to P5b (ground snap, row 34b) and does nothing if P5b has no candidate. | CR-10 | input.test |
| REQ-INP-15 | Grind press while crouched is buffered from the pop tick; a grind press in Air with no candidate stays valid 24 ticks and snaps the moment a candidate appears. | §7 | input.test, stateMachine.test |
| REQ-INP-16 | R2 in Air is a spine transfer only when the transfer condition holds; otherwise it is a revert pre-buffer. A transfer press never doubles as a revert buffer. | §9.2 | stateMachine.test |
| REQ-INP-17 | Every pair reader measures the gap as H[-1].tEnter - H[-2].tExit (leave-to-enter); DirEnter entries record both stamps. | mine | input.test: Up held 2 s then Down within 100 ms -> MANUAL |
| REQ-INP-18 | Manual swaps are rate-limited: second direction held >= 4 ticks, 600 ms cooldown, at most 3 swaps per manual run; balance taps never farm swaps. | mine | balance.test: 20 alternating taps over 4 s produce at most 3 swaps |

### C.4 Timing windows (REQ-TIM, values locked)

| Window | ms | Range | Ticks | Key |
|---|---|---|---|---|
| Late-ollie (coyote) off edges and coping | 90 | 70 to 120 | 11 | COYOTE_MS |
| Grind magnet radius | 0.55 m | 0.40 to 0.80 | n/a | GRIND_MAGNET_RADIUS_M |
| Grind entry max angle | 55 deg | 45 to 70 | n/a | GRIND_ENTRY_MAX_DEG |
| Grind button pre-buffer | 200 | 120 to 300 | 24 | GRIND_PREBUFFER_MS |
| Revert pre-land buffer | 150 | 100 to 200 | 18 | REVERT_PRE_MS |
| Revert window after vert land | 180 | 140 to 220 | 22 | REVERT_POST_MS |
| Revert to manual buffer | 200 | 160 to 260 | 24 | REVERT_TO_MANUAL_MS |
| Manual entry on land | 140 | 100 to 180 | 17 | MANUAL_LAND_WINDOW_MS |
| Landing forgiveness off-axis | 28 deg | 22 to 35 | n/a | LAND_OFFAXIS_BAIL_DEG |
| Get-up lockout | 850 | 600 to 1100 | 102 | GETUP_LOCKOUT_S |
| Special sequence window | 250 | 200 to 350 | 30 | SPECIAL_SEQ_MS |
| Special button after 2nd direction (mine) | 250 | 150 to 350 | 30 | SPECIAL_BUTTON_MS |
| Double-tap enhanced | 250 | 180 to 320 | 30 | DOUBLE_TAP_MS |
| Manual pair gap (mine, leave-to-enter) | 250 | 180 to 350 | 30 | MANUAL_SEQ_MS |
| Landing window = LandWindow timer (same keys) | 140 flat / 180 vert | as above | 17 / 22 | MANUAL_LAND_WINDOW_MS / REVERT_POST_MS |
| Grab release before land | 120 | 80 to 200 | 15 | GRAB_RELEASE_BEFORE_LAND_MS |
| Manual swap cooldown (mine) | 600 | 400 to 1000 | 72 | MANUAL_SWAP_COOLDOWN_MS |
| Lip minimum hold (mine) | 150 | 100 to 300 | 18 | LIP_MIN_HOLD_MS |
| Dir8 dwell before it enters the ring (mine) | 3 ticks | 1 to 6 | 3 | DIR_MIN_DWELL_TICKS |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-TIM-06 | Coyote: a Cross press within 90 ms (11 ticks, half-open) after leaving a ledge, rail end or coping edge pops as if the press had happened on the surface (P8b, 0.9 m); a Cross already held at leftSurface keeps charging and its release inside the window pops with that charge (row 37b). | CR-14 | stateMachine.test |
| REQ-TIM-07 | Revert pre-buffer: R2 pressed up to 150 ms before a vert contact fires the revert on the contact tick. | CR-03 | stateMachine.test "pre-buffer fires on contact" |
| REQ-TIM-08 | Manual entry on land: the Up->Down pair completed within 140 ms before flat contact (row 7, on the contact tick) or after it (row 9d, from LandWindow) enters Manual and keeps the combo. | §7 | stateMachine.test |
| REQ-TIM-09 | Revert to manual: 200 ms from entering RevertWindow; pair events pressed during the revert animation are retained. | CR-03 | stateMachine.test |
| REQ-TIM-10 | Get-up lockout 0.85 s: no input is parsed in GetUp except pause and camera. | §7 | stateMachine.test |
| REQ-TIM-11 | LandWindow timer: 17 ticks after a flat landing (MANUAL_LAND_WINDOW_MS) or 22 ticks after a vert landing (REVERT_POST_MS); the combo stays alive in it and banks when it expires. It is the on-ground half of the SPEC §7 manual and revert windows. | §7, CR-18 | stateMachine.test rows 9 to 9h; "R2 at 170 ms after a vert landing reverts, at 190 ms it does not" |

### C.5 State machine (REQ-SM)

States: `Grounded, Crouch, Air, Grind, Lip, Manual, RevertWindow, LandWindow, Bail, GetUp`. Combo ALIVE in `Air, Grind, Lip, Manual, RevertWindow, LandWindow`. Combo DIES in `Grounded` or `Bail`. "Banks" = FINAL is added to the run score and the special meter has already been fed per element.

`LandWindow` (CR-18) is the on-ground half of the SPEC §7 windows: after a clean contact with no linker on the contact tick, the skater rolls with Grounded movement rules (steer, friction, auto-push, brake), no needle runs, the combo stays ALIVE, for 17 ticks after a flat landing (MANUAL_LAND_WINDOW_MS) or 22 ticks after a vert landing (REVERT_POST_MS). A manual pair or R2 inside it links; the timer expiring banks. Without it the post-contact halves of "Up/Down pressed within 140 ms before OR AFTER contact" and "180 ms after a vert land" would be dead code.

Full transition table (spec rows plus the implicit events). Combo column: `starts`, `lives`, `+1` (new element), `banks` (FINAL added, combo cleared), `lost` (combo and special cleared), `-` (no combo effect). Lettered rows are as real as numbered rows; every row is a test.

| # | From | Event / condition | To | Combo | Notes |
|---|---|---|---|---|---|
| 1 | Grounded | press Cross on flat or bank, or on a transition while moving up it | Crouch | - | charge timer starts |
| 1b | Grounded | press Cross on a transition while moving down it (on its flat-sloped foot: descending faster than SIM_PUMP_MIN_DESCENT_MPS, so a level bowl floor still crouches; CR-54) | Grounded (pumping) | - | pump +4.0 m/s^2 along the surface; no charge; the release fires no hop (REQ-CTL-21) |
| 1c | Grounded (pumping) | velocity turns upward along the surface with Cross still held | Crouch | - | charge starts now, not at the press |
| 2 | Crouch | release Cross | Air | starts | pop height from hold (REQ-CTL-05); auto-push disabled while crouched |
| 3 | Crouch | hold > 0.6 s | Crouch | - | charge saturates, crouch holds indefinitely |
| 4 | Grounded | MANUAL_ENTRY pair, speed >= 1.0, slope < 35 deg | Manual | starts, +1 | needle starts at +-0.05 |
| 5 | Air | GRIND_TRY (pressed or buffered) with a candidate: rail within 0.55 m, entry angle <= 55 deg; all trick animations done | Grind | lives, +1 | snap blend 80 ms; if no combo yet, starts |
| 5b | Air | GRIND_TRY with a candidate while a flip/grab/special animation is unfinished | Bail | lost | grinding mid-flip |
| 6 | Air | Triangle, coping candidate, approach angle > 55 deg to coping, surface below near-vertical, vy <= 3.0, animations done | Lip | lives, +1 | Axle Stall (neutral) or Rock to Fakie (Down) |
| 7 | Air | contact, flat, yaw off-axis <= 28, tilt <= 40, anims done, MANUAL_LAND pair completed within 17 ticks before contact | Manual | lives, +1 | needle re-centred to 0.35 x sign(prev) |
| 8 | Air | contact on vert (slope >= 40), off-axis ok, anims done, R2 in the pre buffer (18 ticks) | RevertWindow | lives, +1 | stance toggles; board yaws 180 |
| 9 | Air | contact, off-axis ok, anims done, no linker on this tick | LandWindow | lives | timer 17 ticks (flat) or 22 ticks (vert, slope >= 40); nothing banks yet |
| 9b | LandWindow | timer expires | Grounded | banks | 0 if the combo is empty; a pump with Cross still held carries on (CR-54) |
| 9c | LandWindow (vert landing) | press R2 (P2b) | RevertWindow | lives, +1 | stance toggles; the post-contact half of the 180 ms window |
| 9d | LandWindow (flat landing) | MANUAL_LAND pair completes | Manual | lives, +1 | the post-contact half of the 140 ms window |
| 9e | LandWindow | press Cross | Crouch | banks | banks on the press, then Crouch begins |
| 9f | LandWindow | head-on wall hit (REQ-CTL-20) | Bail | lost | |
| 9g | LandWindow | GRIND_TRY with a low candidate (P5b) | Grind via hop | banks, then starts +1 | the window is for the manual pair and R2 only (SPEC §7); a ground snap is a new combo |
| 9h | LandWindow | leftSurface | Air | lives | rolled off an edge inside the window |
| 9i | LandWindow / RevertWindow | press Cross on a transition while moving down it (the row 1b rule) | same (pumping) | - | pump, no charge, the release fires no hop; checked before rows 9e and 18 (CR-54) |
| 9j | LandWindow / RevertWindow (pumping) | velocity turns upward with Cross still held | Crouch | banks | the row 1c rule; the charge starts now (CR-54) |
| 10 | Air | contact with yaw off-axis > 28 OR tilt > 40 OR an unfinished flip/grab/special animation | Bail | lost | a grab's animation ends GRAB_RELEASE_BEFORE_LAND_MS (15 ticks) after its release; a grab still held has no end tick and so is unfinished |
| 11 | Air | SPINE_TRANSFER condition + R2 | Air | lives, +1 (gap "Spine Transfer") | position and perpendicular velocity mirrored across the transfer plane (REQ-VRT-08); the +1 is the level's transferOn gap from the gap tracker, the row itself adds no element (CR-24) |
| 12 | Air | contact while Cross is held, flat ground (not a descending transition, row 12b), no valid manual pair | Crouch | banks | banks at contact; charge starts at contact, not earlier |
| 12b | Air | contact while Cross is held on a transition while moving down it (the row 1b rule), no manual pair, no revert | LandWindow (pumping) | lives | pump from contact, no charge, the release fires no hop; row 8 with Cross held also pumps (CR-54) |
| 13 | Air | contact while Cross held, MANUAL_LAND pair valid | Manual | lives, +1 | held Cross becomes a manual pop charge |
| 14 | Air | head-on wall hit (REQ-CTL-20) | Bail | lost | |
| 15 | RevertWindow | REVERT_MANUAL pair within 24 ticks | Manual | lives, +1 | manual scores as switch if stance is now switch; entering Manual on the descending face is allowed (row 31) |
| 16 | RevertWindow | 24 ticks elapse | Grounded | banks | a pump with Cross still held carries on (CR-54) |
| 17 | RevertWindow | head-on wall hit | Bail | lost | needle is not running in this state |
| 18 | RevertWindow | press Cross | Crouch | banks | Cross in RevertWindow is not a linker: the combo banks on the press, then Crouch begins |
| 19 | Grind | release Cross after CROUCH_ON_LINKER, or tap Cross | Air | lives | pop from charge; coyote applies past the rail end |
| 20 | Grind | GRIND_SWITCH(type) | Grind (new type) | lives, +1 | own degradation history; needle re-centred; same object x1.6 drift stays |
| 21 | Grind | rail end | Air | lives | keeps tangent velocity; a switch press on the same tick is dropped |
| 22 | Grind | speed < 1.5 m/s | Air | lives | stall-out hop 0.3 m; lands LandWindow then Grounded unless a linker |
| 22b | Grind | head-on wall hit (REQ-CTL-20) | Bail | lost | rails that end at walls (none are authored; MS-L6 was shortened) |
| 22c | Grind | glancing wall hit | Grind | lives | velocity clamped along the rail x0.8 |
| 23 | Grind | needle abs >= 1 | Bail | lost | |
| 24 | Grind | SPECIAL gpu_slide | Grind (special type) | lives, +1 | holdable, +150/s |
| 25 | Lip | press Cross, or release Triangle after LIP_MIN_HOLD_MS | Air | lives | exit per REQ-LIP-03: 0.15 m off the face, faceDown x 3.5 m/s + up x 0.5 x sqrt(2 g x 0.25); Rock to Fakie exits fakie; the first contact on the face is a vert landing (revert allowed) |
| 25b | Lip | release Triangle before LIP_MIN_HOLD_MS (150 ms) | Lip | lives | stays until 150 ms, then row 25 |
| 26 | Lip | needle abs >= 1 | Bail | lost | a wall hit is impossible in Lip (the skater is stalled on a coping) |
| 27 | Manual | release Cross (charged) or tap Cross | Air | lives | |
| 28 | Manual | MANUAL_SWAP pair (rate-limited, REQ-INP-18) | Manual (other type) | lives, +1 | |
| 29 | Manual | needle abs >= 1 | Bail | lost | |
| 30 | Manual | speed < 1.0 m/s | Grounded | banks | rolled to a stop |
| 31 | Manual | surface slope >= 35 deg while climbing (v.y > 0) on a bank (not tagged transition) | Grounded | banks | a manual rolled into a transition rides up the face and leaves the lip into the air with the combo alive (row 33b), CR-55; descending a transition in Manual is allowed: the revert-manual line rolls down the face into the flat |
| 32 | Manual | head-on wall hit (speed >= 5.0, incidence <= 45 deg) | Bail | lost | |
| 33 | Manual | glancing wall hit | Manual | lives | velocity redirected along the wall x0.8; row 30 applies if too slow |
| 33b | Manual | leftSurface | Air | lives | manual off a ledge; landing needs a linker again |
| 34 | Manual | SPECIAL context_window | Manual (special) | lives, +1 | drift x2 while held |
| 34b | Manual | GRIND_TRY with a candidate (P5b) | Grind via hop of max(0.3, dy + 0.1) m | lives, +1 | the grind -> manual -> grind line |
| 35 | Grounded / Crouch | head-on wall hit | Bail | lost | combo already dead |
| 36 | Grounded / Crouch | GRIND_TRY with a low candidate (P5b) | Grind via hop | starts, +1 | |
| 37 | Grounded | leftSurface: the down ray misses within 0.3 m of the last contact (ledge, step, roof edge, bowl rim, coping launch) | Air | starts | no trick yet; combo starts empty and banks 0 if nothing is added |
| 37b | Crouch | leftSurface | Air | starts | the held charge keeps accumulating; a Cross release within 11 ticks pops with it (P9), later releases do nothing |
| 38 | Bail | animation end (0.6 s tumble) | GetUp | - | |
| 39 | GetUp | 0.85 s | Grounded | - | |
| 40 | Any alive state | run clock reaches 0:00 | same | lives | clock freezes at 0:00; run ends at the next banks or lost; after 30 s overtime force Bail; clockZero repeats every tick at 0:00 (CR-25) |
| 41 | Grounded | run clock reaches 0:00, no combo alive | RunEnd | - | also from Crouch (row x:crouch-clock-zero); Bail / GetUp wait, so a lost combo ends the run after the get-up (CR-25) |
| 42 | Any | pause | same (frozen) | - | sim ticks stop |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-SM-01 | The state machine is a pure, table-driven module (`src/sim/stateMachine.ts`) with no rendering imports; every row above, numbered and lettered, is a test case. | §8 | stateMachine.test: one test per row 1 to 41 including lettered rows |
| REQ-SM-02 | Combo is alive only in Air, Grind, Lip, Manual, RevertWindow, LandWindow; entering Grounded banks, entering Bail discards. LandWindow is the on-ground half of the SPEC §7 windows (CR-18). | §6, CR-18 | stateMachine.test |
| REQ-SM-03 | Landing bail conditions: yaw off-axis > 28 deg, or tilt > 40 deg, or an unfinished flip/grab/special animation at contact, where a grab's animation ends 15 ticks (GRAB_RELEASE_BEFORE_LAND_MS 120) after its release and a held grab has no end tick. | §6, §8 | stateMachine.test row 10; "grab released 100 ms before contact bails, 130 ms lands" |
| REQ-SM-04 | Revert toggles stance and yaws the board 180 deg; the fakie flag is recomputed from velocity versus nose after the pivot. | CR-04 | stateMachine.test "revert toggles stance" |
| REQ-SM-05 | Bail: combo discarded, special meter set to 0, 0.6 s tumble then 0.85 s GetUp lockout. | §6 | scoring.test, stateMachine.test |
| REQ-SM-06 | Grind rail end and a grind-switch press on the same tick: rail end wins, the press is dropped. | mine | stateMachine.test |
| REQ-SM-07 | Landing with Cross held is not a linker: the combo banks (or nothing if none), then Crouch begins at the contact tick. A valid manual pair takes precedence. | mine | stateMachine.test rows 12, 13 |
| REQ-SM-08 | Manual ends (banks) when speed < 1.0 m/s or, climbing a bank (not a transition), the surface slope reaches 35 deg; up a transition the manual rides on and leaves the lip into the air (CR-55). | mine | stateMachine.test rows 30, 31; integrationManualLine.test |
| REQ-SM-09 | At 0:00 mid-combo the clock freezes and the run ends when the combo resolves; landed banks, bail loses; a 30 s overtime cap forces Bail. | §15 | stateMachine.test row 40 |
| REQ-SM-10 | Bail during RevertWindow is only possible from a head-on wall hit. | mine | stateMachine.test row 17 |
| REQ-SM-11 | Physics never changes state on its own: the controller emits events (contact, railEnd, wallHit, stall, leftSurface) and only the state machine transitions. | §19 | grep test: src/sim/controller has no state assignment |
| REQ-SM-12 | Every way off a surface is a row: Grounded, Crouch, Manual and LandWindow each have a leftSurface row (37, 37b, 33b, 9h); rolling off a ledge, step, roof edge or bowl rim never needs an invented transition. | mine | stateMachine.test rows 37, 37b, 33b, 9h |
| REQ-SM-13 | Pump versus crouch: Cross held on a transition while descending is a pump (the state stays Grounded, LandWindow or RevertWindow, no charge, release fires no hop), also when Cross is already held at the landing; Crouch is entered on flat, on a bank, or when the velocity turns upward with Cross held (CR-54). | mine | stateMachine.test rows 1, 1b, 1c, 9i, 9j, 12b: a bowl pump release does not hop; integrationPump.test |
| REQ-SM-14 | Grind has wall rows: head-on = Bail, glancing = clamp along the rail; Lip cannot hit a wall. | §8 | stateMachine.test rows 22b, 22c |

### C.6 Kinematic controller and feel physics (REQ-CTL, REQ-VRT)

No rigidbody engine. The skater is a capsule (radius 0.35, height 1.8, feet at the position point) moved kinematically; collision by three-mesh-bvh raycasts (down ray for the surface, forward ray for walls, a short ray along the predicted trajectory for landing prediction). In Air only one sphere (r 0.35) centred 0.45 m above the feet along the skater's own up axis (which follows auto-orient) is tested against surfaces; the head never collides (the full-pipe ceiling and the billboard would otherwise cap every high air). The collect point for letters and MacGuffins is the feet plus 0.9 m world up. Rail and coping pipe meshes are excluded from the movement BVH (grind query only), so a skater rolls through a flat bar instead of bailing on it. Surfaces are classified by their tag and slope.

**Surface vocabulary (precise definitions)**

| Term | Definition |
|---|---|
| slope | angle between the surface normal at the contact point and world up, in deg. Flat ground = 0. |
| flat | slope < 35 deg (FLAT_MAX_SLOPE_DEG). Manuals are allowed only here. |
| bank | 35 <= slope < 45 and not tagged transition. Ordinary rolling; no manual, no revert. |
| transition | any surface tagged `transition` (quarter-pipe, bowl wall, spine face, full-pipe wall, fountain face, snake-run wall, hump). Reduced along-surface gravity applies (REQ-CTL-11). |
| near-vertical | slope >= 70 deg (VERT_ASSIST_MIN_SLOPE_DEG). Leaving a transition here triggers vert assist. |
| on vert (landing) | contact with a surface of slope >= 40 deg (VERT_LAND_MIN_SLOPE_DEG). Reverts are allowed only here. 40 rather than 45 because the assisted return on the R 1.5 fountain and the R 1.8 mini quarter lands at 40 to 47 deg (see the assist trace below). |
| skater basis | up_s = the auto-oriented up (REQ-CTL-09). nose = rotate(nose0, yawTotal) about up_s, re-projected onto the plane perpendicular to up_s. nose0 at launch = the launch tangent direction; on a face with slope >= 45 it points up the face. Spin accumulates in yawTotal about up_s, never about world up, so a spin on a vertical face changes the landing reading exactly as it does on flat. |
| at coping | within 0.55 m (LIP_MAGNET_M) of a rail with kind `coping`, and the skater y >= coping y - 0.3. |
| wall | slope >= 80 deg (WALL_MIN_SLOPE_DEG) and not tagged transition. |
| yaw off-axis | angle between the skater-basis nose projected onto the landing surface plane and the velocity projected onto the same plane, folded: off = min(theta, 180 - theta). If the projected velocity is < 0.5 m/s the surface downhill direction is used (world -z on true flat). This is the 28 deg rule angle. |
| tilt off-axis | angle between the skater up axis and the landing surface normal. Bail above 40 deg (TILT_BAIL_DEG). |
| fakie | rolling backward: theta (unfolded) > 90 deg, i.e. the nose points against the velocity. A motion flag, not a stance. Recomputed every tick on the ground. |
| switch | the stance flag (regular / switch). Toggled only by revert (CR-04). Score x1.2 while switch. |
| nollie | flip or grab pressed with L2 held while rolling forward; `fakie_` variant when rolling fakie with L2. Distinct trick IDs, base x1.1. |

**Ground movement**

| Quantity | Formula / rule |
|---|---|
| heading h | yaw of the skater; steer: h += TURN_RATE(v) * stickX * dt, TURN_RATE(v) = 150 * (1 - 0.5 * v / 11) deg/s (150 at rest, 75 at max). In Manual: up to 120 deg/s (TURN_RATE_MANUAL_DPS): radius = v / 2.094 = 0.477 x v (3.6 m at 7.5 m/s, 3.0 m at 6.3 m/s). |
| velocity | arcade: the velocity direction is the heading (or its opposite when fakie) projected onto the surface tangent each tick; no lateral slip. |
| auto-push | stick forward (Dir8 in {Up, UL, UR}) and v < 0.70 * vmax and state Grounded or LandWindow (never Crouch, Manual, Grind, Lip): a += 4.5 m/s^2 along heading; push animation cycles every 0.6 s. |
| rolling friction | a -= 0.25 m/s^2 always on the ground when not pushing (v never goes below 0 from friction). |
| brake | stick back and v >= 0.5, state Grounded or LandWindow only (in Manual the vertical axis is balance, in Crouch/Grind/Lip it is ignored): a -= 6.0; below 0.5 m/s with stick back the skater pivots 180 deg over 0.3 s and rolls the other way (never pushes backward). |
| max speed | vmax = 11 m/s * statFactor(speed); glowing x1.08 = 11.88. Speed above vmax decays to vmax at 4 m/s^2 (drop-ins can exceed briefly). |
| pump | on a transition, moving downward along the surface, Cross held: state stays Grounded (row 1b, no Crouch), a += 4.0 m/s^2 along the surface; the release fires no hop. If the velocity turns upward with Cross still held, Crouch begins and the charge starts then (row 1c). |
| crouch | Cross pressed on flat, on a bank, or while moving up a transition: charge c = clamp((hold - 0.1) / 0.5, 0, 1); movement unchanged; auto-push off. |

**Ollie and air**

| Quantity | Formula / rule |
|---|---|
| pop height | h = 0.9 + 0.7 * c^1.0 (OLLIE_H_TAP_M, OLLIE_H_FULL_M, OLLIE_CHARGE_EXP), x statFactor(air), x(1 - 0.15) in switch at switch stat 4. Tap (hold < 0.1 s) = 0.9 m. |
| pop speed | v_pop = sqrt(2 * g * h): 6.29 m/s (tap, 0.9 m), 8.39 m/s (full, 1.6 m) at g = 22. |
| pop direction | p = normalize(0.5 * n + 0.5 * up) where n is the surface normal (POP_UP_BLEND 0.5); on flat p = up. On a surface with slope >= 45 deg v_pop is scaled by VERT_POP_SCALE 0.6. Coyote pop after leaving a transition at slope >= 70 (a Cross release or press within 11 ticks of leftSurface): p = up, then the vert assist clamp is re-applied to the result (perpendicular horizontal x0.15, clamped to [0.4, 1.0] m/s outward), so "release at the lip" and "release just before the lip" land within 0.3 m of each other instead of 3 m apart (REQ-VRT-10). |
| air motion | v.y -= 22 * dt; no air steer; yaw spin only (REQ-VRT-03, 04). |
| auto-orient | pitch and roll slerp toward the predicted landing normal at 360 deg/s (AIR_ORIENT_RATE_DPS); the predicted normal comes from a ray cast from the predicted position 0.25 s ahead along the trajectory, refreshed every 4 ticks; default = world up. |
| landing | velocity projected onto the surface tangent; along-surface speed x0.96 (LAND_SPEED_RETAIN); the normal component is discarded (no bounce). On a transition face that rises along the horizontal travel, the horizontal velocity projected onto the face (the fall absorbed) is used when that is larger, then x0.96 (CR-58). The board yaw snaps to the nearest 180 deg multiple over 100 ms. |
| fall height | no fall damage from any height; only the axis and animation checks can bail a landing. |

**Derived feel numbers at g = 22 (flat ground)**

| Situation | Air time | Distance at 8 m/s | Distance at 11 m/s | Distance at 11.88 m/s (glow) |
|---|---|---|---|---|
| Tap ollie 0.9 m (v 6.29) | 0.572 s | 4.58 m | 6.29 m | 6.79 m |
| Full ollie 1.6 m (v 8.39) | 0.763 s | 6.10 m | 8.39 m | 9.06 m |
| Max gap on flat (level landing) | | | 8.39 m | 9.06 m |
| Time to 7.7 m/s (push ceiling) from rest | 1.71 s at 4.5 m/s^2 | | | |
| Time to 11 m/s | not reachable by pushing; one pumped 3.6 m vert drop-in reaches 10.6 m/s (see below), the second pumped wall reaches 11: about 2.5 s after the drop | | | |

Every level gap is sized against these: a 6 m roof gap needs a full ollie at 8 m/s or a tap at 11 m/s; no required gap exceeds 6.5 m.

**Transitions and vert (the energy problem and its answer)**

At 11 m/s with full gravity a frictionless ramp converts all kinetic energy at 121 / 44 = 2.75 m of rise, so a 3.6 m vert wall would be unreachable and a 2.4 m quarter-pipe would give 0.35 m of air. The fix is two rules:

1. **Transition gravity factor** (REQ-CTL-11): while on a surface tagged `transition`, the along-surface gravity acceleration is g x 0.45 (TRANSITION_GRAVITY_FACTOR). Speed at the coping: v_c^2 = v0^2 - 2 x 22 x 0.45 x h_coping = v0^2 - 19.8 x h_coping. In the air, gravity is the full 22 again, so re-entry is fast and pumping (+4.0 m/s^2 on the way down) rebuilds speed.
2. **Vert assist launch rule** (REQ-VRT-01, CR-15): leaving a transition at slope >= 70 deg with the lateral fraction |v_along_coping| / |v| < 0.4: the horizontal velocity component perpendicular to the ramp face is scaled to 0.15 of itself, then clamped to [0.4, 1.0] m/s outward (0.15 x the perpendicular never exceeds 0.56 m/s on any ramp here, so the effective value is 0.4). The skater rises nearly straight up and comes down on the face below the coping. Measured on the real sim after CR-44 (polish round 2, trace table below): standard QP (2.4 m) 0.91 m at 8.5 m/s, 1.09 m at 11 and 1.21 m at 13 with no pop, 1.36 m at 11 with a full pop; mini quarter (1.5 m) 0.51 to 0.93 m from 6 to 13 m/s; vert wall (3.6 m) 1.78 to 2.21 m from 8 to 13 m/s with no pop, 2.34 to 2.75 m with a full pop (y 0.85 at 13 m/s). The deeper vert landings come from the higher CR-44 air (a longer fall onto the face); every one is on the face and a vert landing (slope >= 40), so every one accepts a revert. (M0 predicted 0.7 to 1.3 m at the old 0.45 gravity factor.) VERT_LAND_MIN_SLOPE_DEG is 40 so every one of those accepts a revert. The along-coping component is kept (carving along the ramp). Leaving at slope < 70 deg, or carving with lateral fraction >= 0.4, is a free launch with full velocity (this is how you get onto decks, out of bowls and over the closet roof). The full-pipe has its own launch rule (REQ-VRT-11).

| Ramp type (id prefix) | Coping height | Radius + vertical ext | Exit slope | Min speed to reach coping | Air above coping at 11 m/s: no pop / tap / full | Air time at 11 m/s: no pop / tap |
|---|---|---|---|---|---|---|
| Fountain face (MS F1) | 1.2 | 1.5 + 0 | 78.5 deg | 4.9 m/s | 2.12 / 3.46 / 3.97 m | 0.88 / 1.12 s |
| Mini quarter (small QP) | 1.5 | 1.8 + 0 | 80.4 deg | 5.5 m/s | 2.02 / 3.32 / 3.83 m | 0.86 / 1.10 s |
| Standard quarter-pipe (QP), spine faces | 2.4 | 2.7 + 0 | 83.6 deg | 6.9 m/s | 1.65 / 2.85 / 3.32 m | 0.77 / 1.02 s |
| Bowl BW1 wall | 2.4 | 2.4 + 0 | 90 deg | 6.9 m/s | 1.67 / 2.87 / 3.35 m | 0.78 / 1.02 s |
| Bowl BW2 wall | 2.0 | 2.0 + 0 | 90 deg | 6.3 m/s | 1.85 / 3.11 / 3.60 m | 0.82 / 1.06 s |
| Vert wall (WS VW1) | 3.6 | 3.0 + 0.6 | 90 deg | 8.4 m/s | 1.13 / 2.15 / 2.56 m | 0.64 / 0.88 s |
| Full-pipe (R 4.0; the 4.0 m line where the wall is vertical acts as the coping; own launch rule REQ-VRT-11) | 4.0 | 4.0 + 0 | 90 deg | 8.9 m/s | 0.95 / 1.90 / 2.28 m | 0.59 / 0.83 s |

Formulas used: v_c = sqrt(v0^2 - 19.8 x h) x sin(exitSlope); pop adds 0.707 x 0.6 x v_pop vertically (POP_UP_BLEND at a vertical face gives a 45 deg pop, VERT_POP_SCALE 0.6): tap +2.67 m/s, full +3.56 m/s; air above coping = v_up^2 / 44; air time = 2 x v_up / 22. Checks: standard QP no pop: 121 - 47.5 = 73.5, sqrt = 8.57, x0.994 = 8.52, squared / 44 = 1.65. Fountain: sqrt(121 - 23.76) = 9.86 x 0.980 = 9.66; tap 12.33 squared / 44 = 3.46, time 1.12 s. Mini: sqrt(91.3) = 9.56 x 0.986 = 9.42; tap 12.09 squared / 44 = 3.32. BW2: sqrt(81.4) = 9.02; tap 11.69 squared / 44 = 3.11. Vert wall tap: 7.05 + 2.67 = 9.72, squared / 44 = 2.15. Kernel Panic (700 ms) fits every popped vert air and a flat full ollie (763 ms).

| Vert assist landing, m below the coping (no pop / full pop), CR-44 | 8 m/s | 8.5 m/s | 10 m/s | 11 m/s | 13 m/s |
|---|---|---|---|---|---|
| Standard QP 2.4 (WS-QE1) | | 0.91 / 1.20 | | 1.09 / 1.36 | 1.21 / 1.46 |
| Mini quarter 1.5 (TB-MINI) | 0.67 / 0.91 | | | 0.83 / 1.04 | 0.93 / on the deck |
| Vert wall 3.6 (TB-VERT) | 1.78 / 2.34 | 1.85 / 2.40 | 1.99 / 2.54 | 2.07 / 2.62 | 2.21 / 2.75 |

**Full-pipe launch rule** (REQ-VRT-11): above the 4.0 m line the pipe wall overhangs (0.13 m inboard at y 5.0, 0.48 m at y 5.9), so the 0.4 m/s assist would put the skater inside the wall. At the 4.0 m line the toward-axis horizontal speed is set to FULLPIPE_ASSIST_OUT_MPS = 2.0 m/s (1.5 to 3.0) instead. Trace at 11 m/s with a full pop (v_up 10.03, the highest air): feet distance from the axis is 3.90 m at t 0.1, 3.93 at 0.2, 3.83 at 0.3, 3.85 at the 0.456 s apex, always under the 4.1 m the collision sphere allows (sphere centre 0.45 inboard along the skater up, radius 0.35). The return lands on the lower wall about 1.8 m from the bottom at slope 25 to 30 deg, which is flat (< 35), so a pipe air ends in a manual, not a revert.

Drop-in and pump: dropping into the 3.6 m vert from the deck gives sqrt(19.8 x 3.6) = 8.44 m/s; with Cross held (pump 4.0 over the 5.3 m arc) v^2 = 71.3 + 42.4 = 113.7, v = 10.66 m/s. A second pumped wall reaches the 11 m/s cap.

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-CTL-01 | Kinematic capsule controller with three-mesh-bvh raycasts; no rigidbody engine. | §4 | grep test: no cannon/rapier/ammo import |
| REQ-CTL-02 | Surface classes flat / bank / transition / near-vertical / wall are computed from tag and slope exactly as the vocabulary table. | mine | controller.test: 6 normals classify as listed |
| REQ-CTL-03 | Ground steering at 150 deg/s at rest falling linearly to 75 deg/s at vmax; velocity follows heading with no slip; manual steering up to 120 deg/s (radius 0.477 x v). | mine | controller.test: a 180 deg manual turn at 7.5 m/s spans 7.2 m |
| REQ-CTL-04 | Auto-push at 4.5 m/s^2 while stick forward and v < 70% vmax; rolling friction 0.25 m/s^2; brake 6.0 m/s^2; pivot instead of reverse. Brake and auto-push run only in Grounded and LandWindow. Cross tap on flat does nothing extra. | §15 | controller.test: 0 to 7.7 m/s in 1.71 s within 1 tick; stick back in Manual does not brake |
| REQ-CTL-05 | Ollie height 0.9 m tap to 1.6 m at 0.6 s charge, linear in charge; v_pop = sqrt(2gh); pop direction blends normal and up 50/50. | §15, §8 | controller.test: apex 0.9 / 1.6 m within 1 cm |
| REQ-CTL-06 | Gravity 22 m/s^2 in air; max speed 11 m/s (+8% glowing); over-speed decays at 4 m/s^2. | §15 | controller.test |
| REQ-CTL-07 | Landing keeps 0.96 of the tangential speed and discards the normal component; yaw snaps to the nearest 180 within 100 ms. | mine | controller.test |
| REQ-CTL-08 | No fall damage. | mine | controller.test: 10 m drop lands clean |
| REQ-CTL-09 | Auto-orientation toward the predicted landing normal at 360 deg/s; prediction ray 0.25 s ahead, refreshed every 4 ticks. | mine | controller.test: launching from flat onto a 60 deg bank lands with tilt < 40 |
| REQ-CTL-10 | Yaw off-axis and tilt off-axis are computed exactly as defined in the vocabulary table; land quality: clean < 15, OK 15 to 28, bail > 28. | §6 | scoring.test, controller.test |
| REQ-CTL-11 | On surfaces tagged transition the along-surface gravity is g x 0.45; pump adds 4.0 m/s^2 while Cross is held on the way down. | mine | controller.test: 11 m/s reaches a 3.6 m coping at 7.05 m/s within 0.1 |
| REQ-CTL-12 | Rolling onto a transition converts velocity to the surface tangent with no loss; leaving the top edge of a transition at slope < 70 deg (or carving with lateral fraction >= 0.4) is a free launch with full velocity. | mine | controller.test |
| REQ-CTL-13 | Stats mapping: statFactor(s) = 0.7 + 0.05 x s (6 -> 1.0). speed scales vmax; air scales ollie height; balance divides drift k0; spin scales spin rates; switch stat s applies pop x(1 - 0.15 x (10 - s) / 6) and drift x(1 + 0.35 x (10 - s) / 6) while in switch (4/10 -> -15% pop, x1.35 drift). Defaults 6/6/6/4/6. The spec-literal reading of "-20% balance drift tolerance" is tolerance x0.8, i.e. drift x1.25; under the damped REQ-BAL-01 dynamics x1.25 only shortens a hands-off manual from a 0.35 start by 15.6% (2.22 s instead of 2.63 s), so CR-19 raises it to x1.35, which bails in 2.10 s = 20.0% sooner, the figure the spec names. | §15, CR-19 | scoring.test, balance.test: switch stance bails 20% sooner (within 3%) than regular from a 0.35 start with no input |
| REQ-CTL-14 | Pop out of Grind / Manual / Lip uses the same charge curve (hold Cross while on the linker, pop on release); a tap gives 0.9 m. | §8 | stateMachine.test |
| REQ-CTL-15 | The skater collects letters and MacGuffins when the collect point (feet + 0.9 m world up) is within 0.9 m (COLLECT_RADIUS_M) of the item. | mine | levels.test |
| REQ-CTL-16 | Sim uses the seedable RNG only (needle start sign, spark seeds); no Math.random in src/sim. | AGENTS | grep test |
| REQ-CTL-17 | Slope thresholds: FLAT_MAX_SLOPE 35, VERT_LAND_MIN_SLOPE 40, VERT_ASSIST_MIN_SLOPE 70, WALL_MIN_SLOPE 80 deg. | mine | controller.test |
| REQ-CTL-18 | On a transition below the coping with v < 0.5 m/s the skater rolls back down (no stall); reversing direction on a transition sets fakie. | mine | controller.test |
| REQ-CTL-19 | The render transform interpolates the last two sim states; sim positions are never written by the renderer. | §7 | grep test |
| REQ-CTL-20 | Wall hit: contact with a wall (slope >= 80, not transition) at speed >= 5.0 m/s and incidence angle <= 45 deg between -velocity and the wall normal = head-on = Bail in any state (Grind included). Otherwise the normal component is removed and the tangential speed keeps 0.8. | §8 | controller.test: 6 m/s at 30 deg bails; 6 m/s at 60 deg slides |
| REQ-CTL-21 | Pump: Cross held on a transition while descending adds 4.0 m/s^2 along the surface with no crouch and no hop on release; Crouch begins only on flat, bank, or once the velocity turns upward with Cross held. | mine | controller.test: a bowl pump-and-release leaves the surface never |
| REQ-CTL-22 | Air collision uses one sphere r 0.35 at 0.45 m above the feet along the skater up; the head is never collided; rail and coping meshes are not in the movement BVH. | mine | controller.test: a full-pipe air at 11 m/s with a full pop never intersects the wall |

**Vert, air, spin (REQ-VRT)**

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-VRT-01 | Vert assist as defined above: perpendicular horizontal component x0.15 clamped to [0.4, 1.0] m/s outward, along-coping component kept, only when exit slope >= 70 and lateral fraction < 0.4, disabled for one air by a spine transfer. The return lands on the same face (a vert landing, revert legal): about 0.9 to 1.5 m below a 2.4 m coping and 1.8 to 2.8 m below the 3.6 m vert coping at 8 to 13 m/s (the CR-44 air, trace table above). | CR-15 | controller.test: exit at 8.5 m/s up a 2.4 QP lands on the same face within 1.0 m of the coping |
| REQ-VRT-02 | Pop on a face with slope >= 45 deg is scaled by 0.6 and blended 45 deg toward up, giving the air table above. | mine | controller.test: every row of the air table within 3% |
| REQ-VRT-03 | Stick spin: yaw rate 360 deg/s x statFactor(spin) from the horizontal stick axis (analog, proportional to deflection past the deadzone; D-pad = full). | §5 | controller.test |
| REQ-VRT-04 | Quick spin: each L1/R1 press queues a 180 deg burst at 720 deg/s (0.25 s); holding repeats bursts back to back; bursts snap to 180 deg increments; stick and quick spin rates add, capped at 900 deg/s. | CR-01 | input.test, controller.test |
| REQ-VRT-05 | Spin credit at the end of an air (landing, grind snap, lip snap or transfer) = round(abs(total yaw in this air) / 180) 180s, added to the combo spin total; the yaw snap removes the residual. Fakie landings (unfolded theta > 90) still count the full rotation. | §6 | scoring.test: 170 deg lands as 1 spin, 80 deg as 0; a 180 into a grind snap counts 1 |
| REQ-VRT-06 | Landing on vert: with the skater basis (nose0 = launch tangent, up the face) an even number of 180s (including zero) re-enters riding fakie and an odd number forward; a revert pivots the board 180 deg so a fakie re-entry becomes forward (and vice versa) and toggles the stance flag. | CR-04 | stateMachine.test; controller.test: 180 spin on a 90 deg wall lands forward with off-axis 0 |
| REQ-VRT-07 | Multiple airs in one combo accumulate spin credit (multiplier +0.5 per 180 total). | §6 | scoring.test |
| REQ-VRT-08 | Spine transfer, implemented as SPEC §9.2 says (rotate 180 deg around the edge's axis = a mirror). Condition: state Air, R2 pressed, a rail tagged `transfer` whose closest point is within 1.5 m below the skater (skater y - rail y in [0, 1.5]) and within 1.0 m horizontally of the rail line. Each transfer rail carries a vertical `transferPlane` containing the rail direction: for WS-SP1-W and WS-SP1-E the plane is x = 43.0 (the spine centre line), for WS-VW1-C it is the coping itself (x = 84). launchSide = sign of the skater's perpendicular offset from that plane at leftSurface (stored on launch). Effect at the press: if the skater is still on the launch side (the normal case) the horizontal position is mirrored across the plane (offset d -> -d) and the perpendicular horizontal velocity is negated; if a carving launch already crossed the plane the position is kept. Then the perpendicular speed is set to max(|v_perp|, SPINE_TRANSFER_PUSH_MPS = 0.4) directed away from the plane on the far side (-launchSide), never toward the closest rail; along-axis and vertical velocity are kept; the body plays a 180 deg rotation about the rail axis over 0.3 s (animation only); no further assist runs in this air (CR-15's "disable" clause: the launch assist already acted and the mirror reverses it). Named gap "Spine Transfer" 500 (or "Over the Vert" 1200 on WS-VW1-C), +1, once per air. Trace, spine at 11 m/s no pop, R2 at the apex (0.387 s): offset 0.15 m west of the plane -> 0.15 m east, velocity 0.4 m/s east, falls 1.65 m in 0.387 s -> lands 0.31 m out on the east face at y 1.41, slope 61 deg, revert legal; pressed 0.7 s after launch it still lands on the face at y about 1.35. Vert wall at 11 m/s: lands on the deck at x 84.28 (no pop) to 84.34 (full pop), y 3.6; with Triangle held the descent passes 0.2 m from WS-OV (x 84.5, y 4.0) and snaps it directly. | §9.2, CR-15 | stateMachine.test row 11; controller.test: transfer pressed 0.4 s after launch lands on the far face within 1.2 m below the coping; VW1 transfer at 11 m/s lands on the deck or snaps WS-OV |
| REQ-VRT-10 | Coyote pop after leaving a transition at slope >= 70: pop direction = up, then the assist clamp is re-applied; the pop never adds outward speed beyond the clamp. | mine | controller.test: 11 m/s up the QP, Cross released 50 ms after leaving the coping, lands on the same face within 1.5 m below the coping |
| REQ-VRT-11 | Full-pipe launch: at the 4.0 m line the toward-axis horizontal speed is set to FULLPIPE_ASSIST_OUT_MPS (2.0) instead of the assist clamp; the return contact on the lower wall (slope 25 to 30 deg) is flat, so it links with a manual, not a revert. | mine | controller.test: 11 m/s full pop in WS-FP1 clears the wall and lands at slope < 35; letter D at (60, 33.2, 6.5) is collected at 9.5 m/s with a tap |
| REQ-VRT-12 | Spin uses the skater basis (yawTotal about up_s, nose0 = launch tangent); the 28 deg rule and the fakie flag read that nose on every surface, vertical faces included. | mine | controller.test: 180 spin on a 90 deg wall lands forward with off-axis 0; 90 deg spin on flat bails |
| REQ-VRT-09 | Landing quality text: clean < 15 deg, OK 15 to 28 deg, SICK when the banked combo >= 10,000, INSANE >= 50,000 (SICK/INSANE replace the angle text). | §6 | hud.test |

**Camera (REQ-CAM)**

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-CAM-01 | Chase camera: 4.2 m behind, 1.6 m up, look-at target 1.5 m ahead along velocity (or heading at rest), critically damped spring omega = 8 on position and target. | §10 | camera.test: step response settles within 2% in 0.8 s, no overshoot |
| REQ-CAM-02 | In vert air (assist active) the offset grows by 2.0 m back and 1.5 m up over 0.3 s so the ramp stays framed; returns on landing. | §10 | camera.test |
| REQ-CAM-03 | Right stick orbits at 180 deg/s; 1.2 s after release the camera springs back behind the skater. Keyboard: mouse with pointer lock (requested on the first click inside the canvas during a run, released on pause; Esc releases it), CAM_MOUSE_DEG_PER_PX 0.15 (0.05 to 0.4), same 1.2 s spring-back. | §10, §5 | camera.test: 100 px of mouse motion orbits 15 deg and springs back |
| REQ-CAM-04 | Base FOV 70 deg; +6 deg kick above 85% of vmax, lerped at 4/s; speed lines start at the same threshold. The sim's speed tier enters "fast" SIM_SPEED_TIER_HYST (0.03) above the threshold and leaves below it (CR-56). | §10 | camera.test; integrationSpeedTier.test |
| REQ-CAM-05 | Camera collision: a ray from the target to the desired position shortens the boom to the hit distance minus 0.3 m, but never below CAM_MIN_BOOM_M 1.2 (0.8 to 2.0); when the shortened boom would be below 1.2 m the boom stays 1.2 m and the camera rises by (1.2 - hit) x 1.5 m instead, so the 3 m passage x[92,95] and the euro gap never put the camera inside the skater. | mine | camera.test: a 3 m corridor keeps the boom >= 1.2 m |
| REQ-CAM-06 | Bail shake: 0.12 m amplitude decaying over 0.35 s. | §10 | camera.test |
| REQ-CAM-07 | Never first-person or shoulder by default; the camera reads the interpolated sim state only. | §2 | manual |

---

## D. Scoring sheet and worked example (REQ-SCR, REQ-DEG, REQ-SPC, REQ-BAL)

### D.1 Formulas

```
trickValue_i = base_i * stance_i * degradation_i           stance_i = 1.2 if the stance flag is switch when the element is added, else 1.0
holdAccrual_i = holdRate_i * heldSeconds_i                 (not degraded, not stance-multiplied: SPEC §6 puts stance on trickValue only; grabs, grinds, manuals, lips, holdable specials)
COMBO_BASE   = sum(trickValue_i) + sum(holdAccrual_i)
MULTIPLIER   = elements + 0.5 * spin180s                    elements = number of +1 elements; spin180s = total 180s across all airs
FINAL        = floor(COMBO_BASE * MULTIPLIER)               landed only; accruals rounded to whole points per element
```

Element rules: each flip, grab, grind TYPE (a switch is a new type), manual (each swap is a new one), lip, revert, named gap, MacGuffin pickup, special = +1. Degradation is per run, per trick ID, incremented when the element is added to the combo line; factors 100/90/75/50/25% (5th and later 25%). Switch, nollie and fakie variants are distinct IDs (`switch_kickflip`, `nollie_kickflip`, `fakie_kickflip`, `switch_nollie_kickflip`). Gaps and MacGuffins never degrade. Enhanced tricks (`double_kickflip`) are their own IDs. Goal and gap rules match on category (revert, manual, grind, special) never on id unless the rule says id, so `switch_manual` satisfies "a manual".

### D.2 Per-trick base values (becomes `src/data/tricks.ts`)

Flips (Square + Dir8; tier step 50; enhanced = double-tap, +1 tier, anim +120 ms (ENHANCED_ANIM_EXTRA_MS) so every enhanced flip fits a flat full ollie of 763 ms):

| id | name | dir | tier | base | anim ms | enhanced id | enhanced name | enhanced base | enhanced anim |
|---|---|---|---|---|---|---|---|---|---|
| kickflip | Kickflip | L | 1 | 100 | 380 | double_kickflip | Double Kickflip | 150 | 500 |
| heelflip | Heelflip | R | 1 | 100 | 380 | double_heelflip | Double Heelflip | 150 | 500 |
| pop_shove_it | Pop Shove-It | D | 1 | 100 | 380 | shove_it_360 | 360 Shove-It | 150 | 500 |
| varial_kickflip | Varial Kickflip | UL | 2 | 150 | 450 | double_varial_kickflip | Double Varial Kickflip | 200 | 570 |
| varial_heelflip | Varial Heelflip | UR | 2 | 150 | 450 | double_varial_heelflip | Double Varial Heelflip | 200 | 570 |
| impossible | Impossible | U | 3 | 200 | 520 | double_impossible | Double Impossible | 250 | 640 |
| hardflip | Hardflip | DL | 3 | 200 | 520 | double_hardflip | Double Hardflip | 250 | 640 |
| tre_flip | 360 Flip | DR | 4 | 250 | 600 | double_tre_flip | Double 360 Flip | 300 | 720 |

Grabs (Circle + Dir8; holdable; min pose 250 ms; the grab animation ends 120 ms (15 ticks) after release, so a grab released later than that before contact is an unfinished animation = bail (row 10); enhanced = "Tweaked", +1 tier of base = 150 + FLIP_TIER_STEP 50 = 200, the same rule as flips per SPEC §5):

| id | name | dir | base | hold rate | enhanced id / name / base |
|---|---|---|---|---|---|
| nosegrab | Nosegrab | U | 150 | 100/s | tweaked_nosegrab / Tweaked Nosegrab / 200 |
| tailgrab | Tailgrab | D | 150 | 100/s | tweaked_tailgrab / Tweaked Tailgrab / 200 |
| indy | Indy | L | 150 | 100/s | tweaked_indy / Tweaked Indy / 200 |
| melon | Melon | R | 150 | 100/s | tweaked_melon / Tweaked Melon / 200 |
| japan | Japan | UL | 150 | 100/s | tweaked_japan / Tweaked Japan / 200 |
| stalefish | Stalefish | UR | 150 | 100/s | tweaked_stalefish / Tweaked Stalefish / 200 |
| benihana | Benihana | DL | 150 | 100/s | tweaked_benihana / Tweaked Benihana / 200 |
| crossbone | Crossbone | DR | 150 | 100/s | tweaked_crossbone / Tweaked Crossbone / 200 |

Grinds (Triangle + Dir8; balance axis h):

| id | name | dir | base | hold rate |
|---|---|---|---|---|
| fifty_fifty | 50-50 | neutral | 100 | 80/s |
| nosegrind | Nosegrind | U | 150 | 90/s |
| five_o | 5-0 | D | 150 | 90/s |
| boardslide | Boardslide | L or R, rail on the toe side at approach | 120 | 90/s |
| lipslide | Lipslide | L or R, rail on the heel side at approach | 130 | 90/s |
| crooked | Crooked | UL | 160 | 90/s |
| overcrook | Overcrook | UR | 170 | 90/s |
| feeble | Feeble | DL | 160 | 90/s |
| smith | Smith | DR | 180 | 90/s |

Lips (Triangle at coping; balance axis h): `axle_stall` Axle Stall, neutral, 150, 100/s. `rock_to_fakie` Rock to Fakie, D, 150, 100/s (exits fakie).

Manuals (balance axis v): `manual` Manual 50, 40/s. `nose_manual` Nose Manual 50, 40/s. Revert: `revert` Revert 100.

Specials (glowing only; names read the brand table in parody mode: CUDA Slide -> VIDA Slide):

| id | name | input | state | base | hold | anim / juice |
|---|---|---|---|---|---|---|
| kernel_panic | Kernel Panic | U,D + Circle | Air | 3000 | none | 700 ms grab-spin (fits a flat full ollie of 763 ms with 60 ms to spare); board shows the blue-screen texture |
| token_overflow | Token Overflow | L,R + Square | Air | 2800 | none | 700 ms flip; sticker particles |
| inference_900ms | 900ms Inference | D,U + Circle | Air | 4500 | 150/s | holdable, min 900 ms pose, sim time scale 0.6 while held, release >= 120 ms before contact |
| gpu_slide | CUDA Slide (display name BRANDS.specialSlideName; id per CR-20) | U,D + Triangle | Grind | 500 | 150/s | special grind type; green ribbon |
| context_window | Context Window | L,R + Triangle | Manual | 1400 | 60/s | special manual; drift x2 while held |

MacGuffins: `secret_laptop` 2500, `secret_drive` 2500, never degrade, +1 element. Named gaps: see section G (200 to 2000, never degrade, +1 element).

### D.3 Worked example (this is the unit test, verbatim)

Park: Market Street. Run history before this combo: `kickflip` done 1 time, `boardslide` done 1 time, everything else 0. Stance regular at the start. The inputs are skateable on the named objects: the hubba MS-L2 is 8 m (5.2 m at 8.75 deg then 2.8 m flat, ledge friction 0.30) and holds a grind for 2.11 s at the 3.0 m/s minimum entry or 1.9 s at 3.5 m/s, so the skater approaches at about 3.5 m/s, full ollie, kickflip + 180 in the air (anim 380 ms + spin 500 ms, both done before the snap on the way down at 0.66 s), snaps L2 near z 39. MS-R1 (8 m) at 4.4 m/s holds 1.85 s. The fountain air is a low pop on the face at about 50 deg that lands back on the face (vert, revert legal); the manual after the revert starts on the descending face (row 31) and continues on the plaza. Combo events in order:

| # | Element | Trick id | Base | Stance | Times done before | Degradation | trickValue | Hold | Accrual | Spin this air |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Full ollie off the terrace, Kickflip (Square+L) | kickflip | 100 | 1.0 | 1 | 0.90 | 90 | - | 0 | 180 deg (1 x 180), credited at the grind snap |
| 2 | Snap hubba L2, Triangle neutral | fifty_fifty | 100 | 1.0 | 0 | 1.00 | 100 | 1.0 s x 80/s | 80 | - |
| 3 | DR + Triangle mid-ledge (same object) | smith | 180 | 1.0 | 0 | 1.00 | 180 | 0.8 s x 90/s | 72 | - |
| 4 | Ollie from the hubba end onto the flat bar R1: gap | gap:PLAZA_BAR_HOP | 500 | never | never | 1.00 | 500 | - | 0 | 0 |
| 5 | L + Triangle, rail on toe side | boardslide | 120 | 1.0 | 1 | 0.90 | 108 | 1.8 s x 90/s | 162 | - |
| 6 | Low pop on the fountain face, R2 in the pre-buffer, land on vert | revert | 100 | 1.0 | 0 | 1.00 | 100 | - | 0 | 0 (stance -> switch) |
| 7 | Up,Down within 200 ms | switch_manual | 50 | 1.2 | 0 | 1.00 | 60 | 1.5 s x 40/s | 60 | - |
| 8 | Ollie out, Square+R, 360 spin, land clean | switch_heelflip | 100 | 1.2 | 0 | 1.00 | 120 | - | 0 | 360 deg (2 x 180) |

Intermediate numbers:
- trickValues: 90 + 100 + 180 + 500 + 108 + 100 + 60 + 120 = 1258
- accruals: 80 + 72 + 162 + 60 = 374 (the switch manual accrues at the plain 40/s; only its base carries the 1.2)
- COMBO_BASE = 1258 + 374 = 1632
- elements = 8 (kickflip, 50-50, smith, gap, boardslide, revert, manual, heelflip)
- spin180s = 1 + 2 = 3, spin bonus = 1.5
- MULTIPLIER = 8 + 1.5 = 9.5
- FINAL = 1632 x 9.5 = 15504

Arithmetic check 1: 1632 x 9 = 14688; 1632 x 0.5 = 816; 14688 + 816 = 15504. Check 2: 1258 x 9.5 = 11951; 374 x 9.5 = 3553; 11951 + 3553 = 15504.

**FINAL = 15,504.** Land text: SICK (>= 10,000). Special meter fed 1632 / 6000 = 0.272 across the combo. After banking, the run degradation table reads kickflip 2, fifty_fifty 1, smith 1, boardslide 2, revert 1, switch_manual 1, switch_heelflip 1.

### D.4 Scoring, degradation, special and balance requirements

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-SCR-01 | FINAL = floor(COMBO_BASE x MULTIPLIER) with COMBO_BASE and MULTIPLIER as in D.1; the D.3 example produces exactly 15504. | §6, §14-D | scoring.test "worked example" |
| REQ-SCR-02 | Switch stance multiplies the base by 1.2 for every element added while the stance flag is switch; hold accruals are not multiplied (SPEC §6 applies stance in trickValue only). | §6, CR-05 | scoring.test: switch_manual base 60, its 1.5 s accrual 60 |
| REQ-SCR-03 | Spin adds +0.5 to the multiplier per 180 (SPIN_MODE "multiplier"); preset "base" instead adds 100 points x 180s to the trick base and nothing to the multiplier (exposed in tuning, default "multiplier"). | CR-08 | scoring.test "spin adds 0.5" |
| REQ-SCR-04 | Hold accruals are added un-degraded and un-multiplied by stance at holdRate x seconds, rounded to the nearest point when the element ends; the live HUD shows the running value. | §6 | scoring.test |
| REQ-SCR-05 | Named gaps add base and +1 and never degrade; each gap can be earned once per combo, any number of times per run. | §6 | scoring.test "gaps never degrade" |
| REQ-SCR-06 | MacGuffin pickup = 2500, +1, never degrades, once per career (it stays collected). | §6 | scoring.test |
| REQ-SCR-07 | Bail discards the whole combo and sets the special meter to 0. | §6 | scoring.test "bail" |
| REQ-SCR-08 | Land text thresholds: SICK 10,000, INSANE 50,000 on the banked FINAL. | §6 | hud.test |
| REQ-SCR-09 | Trick data lives in `src/data/tricks.ts` with the schema of SPEC §9.1 and the exact bases of D.2. | §9.1 | tricks.test: every base matches this table |
| REQ-SCR-10 | Nollie / fakie variants (L2 held) are distinct IDs with base x1.1 (NOLLIE_FAKIE_MULT). | §5 | scoring.test |
| REQ-SCR-11 | Enhanced tricks replace the pending element (never two elements); enhanced base = base + FLIP_TIER_STEP (flips and grabs alike), enhanced anim = anim + ENHANCED_ANIM_EXTRA_MS 120 (flips). | §5 | scoring.test; tricks.test: no enhanced anim exceeds 740 ms |
| REQ-DEG-01 | Degradation per run keyed by trick ID: 1.00, 0.90, 0.75, 0.50, 0.25 (5th and later 0.25). Reset at run start. | §6, CR-07 | scoring.test "degradation table" |
| REQ-DEG-02 | Preset DEGRADATION_PRESET = "thps1" (default) or "thps3" (1.00, 0.75, 0.50, 0.25, 0.10), selectable in tuning. | CR-07 | scoring.test |
| REQ-DEG-03 | Switch, nollie, fakie and enhanced variants have separate histories from the base trick. | CR-05 | scoring.test "switch variant separate history" |
| REQ-DEG-04 | The count increments when the element is added to the combo line, whether or not the combo later banks. | mine | scoring.test |
| REQ-DEG-05 | A grind-type switch is a new element with its own history; switching to the current type is ignored. | §6 | scoring.test |
| REQ-SPC-01 | Special meter in [0, 1]; each completed element adds (trickValue + accrual) / 6000 (SPECIAL_FULL_BASE), clamped. | §6 | special.test |
| REQ-SPC-02 | Idle drain 4% per second after 3.0 s without a completed element; drain pauses while a combo is alive. | §6 | special.test |
| REQ-SPC-03 | Glowing turns on at meter >= 1.0 and off below 0.85 (hysteresis); glowing enables specials and +8% vmax. | §6 | special.test |
| REQ-SPC-04 | Bail sets the meter to 0 and ends glowing immediately. | §6 | special.test |
| REQ-SPC-05 | Holdable specials accrue at their hold rate; 900ms Inference scales sim time by 0.6 while held (the render loop advances sim time x0.6) and its hold is measured in presentation seconds (sim seconds / 0.6). The run clock is sim state: while the special is held it decrements by tickSeconds / INFERENCE_TIME_SCALE per tick so the HUD clock keeps real time (REQ-TIM-03 intact). | §9.1 | special.test: 0.6 s of dilated sim advances the run clock 1.0 s |
| REQ-SPC-06 | Specials require glowing at the press tick only; the meter is not spent by a special. | §9.1 | special.test |
| REQ-BAL-01 | Needle in [-1, 1]; bail at abs >= 1. Per tick: nv += (k x sign(needle) - input x 2.0) x dt; nv x= (1 - 1.5 x dt); needle += nv x dt. k = 0.5 x (1 + 0.12 x elements) x (1.6 if same object as the previous grind) x (2.0 during Context Window) x switchDrift / statFactor(balance). | §6, CR-06 | balance.test "drift grows with element count", "same object x1.6" |
| REQ-BAL-02 | Each new grind/lip/manual element sets needle = 0.35 x sign(previous needle) (0.05 x a seeded random sign for the first element) and nv = 0. | CR-06 | balance.test "re-center on new element" |
| REQ-BAL-03 | Balance input axis: manual = vertical stick/dpad (Up = input -1 pushes the needle negative = nose down), grind and lip = horizontal (Left = input -1 pushes the needle negative; the HUD arc shows negative to the left of centre). | CR-02 | balance.test: both axes and both signs |
| REQ-BAL-04 | Same object = the previous grind element in this combo was on the same rail id (a polyline is one object). Not compounding. | §6 | balance.test |
| REQ-BAL-05 | `elements` in the drift formula counts the +1 elements already in the combo when the linker starts, excluding the linker itself: a first grind in an empty combo has elements = 0 (k = k0), a grind after a kickflip has 1. | CR-06 | balance.test: first grind k = 0.5, second element k = 0.56 |
| REQ-BAL-06 | The HUD balance meter reads the needle directly: horizontal arc over the head for grind/lip, vertical bar beside the skater for manual. | §17 | hud.test |

Balance feel check (k0 0.5, input 2.0, BAL_DAMP 1.5 included; the damping saturates the drift velocity at k / 1.5): a first grind with no input (elements 0, k 0.5, start 0.05) bails after 3.54 s; a 5-element combo (k 0.8) after 2.45 s; the same object with 5 elements (k 1.28) after 1.35 s from a 0.35 start; the 10-element Woodshed chain (k 1.1) after 1.49 s from 0.35, which is why its linkers are 0.9 to 1.8 s between re-centres. Input 2.0 out-pushes drift until 25 elements (12 on the same object), so long combos become unholdable rather than impossible. These four numbers are balance.test cases.

### D.5 Points economy sanity check

Assumed competent 2:00 run (lands 9 of 11 attempts):

| Park | Combo mix | Estimated run | High / Pro / Sick | High Combo | Verdict |
|---|---|---|---|---|---|
| Market Street | 6 short (base 400 x 3.0 = 1,200 each = 7,200) + 3 medium (base 1,100 x 7.0 = 7,700 each = 23,100) + 1 line like D.3 (15,504) | about 45,800 | 15,000 / 40,000 / 80,000 | 10,000 | High = first session; Pro = competent; Sick needs one special-finished line (Kernel Panic 3000 inside a 12-element combo adds about 40,000) plus the rest. Reachable, not trivial. |
| Woodshed | 5 short (1,500 each = 7,500) + 3 medium with spins (base 1,400 x 8.5 = 11,900 each = 35,700) + 1 rail chain (G.2 estimate, base 2,713 x 10 = 27,130) + 1 vert line with 2 reverts (base 1,300 x 9 = 11,700) | about 82,000 | 25,000 / 60,000 / 120,000 | 15,000 | Pro = competent; Sick needs the 20 s chain plus a special line. The 20 s rail chain alone clears High Combo. |
| CR-09 check | one glowing Kernel Panic landed alone: 3000 x 1 = 3,000; with a revert-manual finish x3: 9,000 | | | | below High Score 15,000, as CR-09 intends |

No base change needed; no CHANGE-REQUEST from the economy.

---

## E. Grind bible and mechanic sheets

Every mechanic below carries the seven fields of SPEC §1.2 in one compact table. TUNABLES list key = value (range): rationale.

### E.1 Grind (REQ-GRD)

| Field | Content |
|---|---|
| PURPOSE | The first-class linker. Any visible edge is a rail; the button snaps to it. Both parks are grind instruments. |
| PLAYER FEEL | Sticky, magnetic, forgiving on entry, demanding on balance. Sparks, light rumble, a held note in the audio. |
| INPUTS | Triangle (pressed in Air, buffered 200 ms, or held through a pop). Dir8 at press selects the type. Horizontal stick/dpad = balance. Cross = pop off (charge by holding). Dir8 + Triangle = type switch. |
| OUTPUTS | State Grind on rail id, type, along-rail speed, needle, accrual (holdRate x s), element +1, sparks, rumble, HUD arc meter. Rail end -> Air with tangent velocity. |
| FAILURE STATE | needle abs >= 1 -> Bail. Speed < 1.5 m/s -> stall-out hop to Air (combo dies on the flat landing unless linked). Entry angle > 55 deg or no rail in 0.55 m -> no snap (press buffered 200 ms then dropped). |
| EDGE CASES | Rail end and switch on the same tick: end wins. Polyline corner sharper than 55 deg between segments: treated as a rail end. Two candidates: the one with the smallest (distance / 0.55 + angle / 55) score wins. Coping rails: grind if the approach angle to the coping tangent is <= 55, else Lip (E.4). Landing from Air directly on a rail without pressing Triangle: no snap, normal landing (you can roll along a wide ledge top, it is just floor; round rail meshes are not in the movement BVH, REQ-CTL-22). Grinding uphill on a sloped rail slows at 0.35 g x sin(slope). Snap speed is the velocity projected on the 3D rail tangent, so re-snapping while rising never adds speed. A grind that runs head-on into a wall bails (row 22b); no authored rail ends at a wall. Rainbow rails follow the arc; tangent updates per segment. Switching to the current type is ignored. |
| TUNABLES | GRIND_MAGNET_RADIUS_M = 0.55 (0.40 to 0.80): arcade sticky per spec. GRIND_ENTRY_MAX_DEG = 55 (45 to 70). GRIND_PREBUFFER_MS = 200 (120 to 300). GRIND_SNAP_BLEND_MS = 80 (50 to 120): short enough to read as instant, long enough to hide the pop. GRIND_FRICTION_RAIL = 0.10 m/s^2 (0 to 0.8), GRIND_FRICTION_LEDGE = 0.30, GRIND_FRICTION_COPING = 0.15: rails keep speed for the 20 s chain; concrete bites a little. GRIND_GRAVITY_FACTOR = 0.35 (0.2 to 1.0): sloped rails accelerate but not violently, and the Street scaffold climb (4.2 m of rise over three rails) stays holdable from 9 m/s. GRIND_MIN_SPEED = 1.5 m/s (1.0 to 2.5). GRIND_MIN_ENTRY_SPEED = 3.0 (2 to 4): the snapped along-rail speed is max(projected, 3.0) so slow approaches still slide. GRIND_SWITCH_COOLDOWN_MS = 100 (60 to 200). GRIND_EXIT_POP_M = 0.3 (0.2 to 0.5): the stall-out hop. |

**Magnet math (per tick while Triangle is pressed or buffered and state is Air, or P5b on the ground)**

```
for each rail R in the level's rail grid cell around P (board centre):
  for each segment (A, B) of R.points:
    t = clamp(dot(P - A, B - A) / |B - A|^2, 0, 1);  C = A + t (B - A)      // closest point on segment
    d = |P - C|;  if d > 0.55: continue
    tan = normalize(B - A);  if dot(v, tan) < 0: tan = -tan                    // travel direction along the rail
    ang = angle(normalize(v_h), tan_h)  (horizontal projections)
    if ang > 55: continue
    score = d / 0.55 + ang / 55
  best = min score
snap: position blends P -> C over 80 ms (10 ticks) with the y raised by the board thickness 0.05;
      tan3D = unit rail direction (sign chosen along travel);  velocity = tan3D * max(dot(v, tan3D), 3.0)   // vertical velocity counts only along a sloped rail: no free speed from an ollie-and-resnap
      needle = 0.35 * sign(prevNeedle) or 0.05 * rngSign();  element +1
each tick in Grind: s += v dt along the polyline; v += (-friction(kind) - 0.35 * 22 * sin(railSlope)) dt; at s beyond the last point -> railEnd event
```

Type selection at snap and at switch: Dir8 -> type per D.2. For L/R: toe side = right of travel when (stance regular XOR fakie), else left. lateral = dot(C - P, right); if lateral x toeSign > 0 the rail is on the toe side -> Boardslide, else Lipslide.

**Anti-cheese**: same rail id as the previous grind element -> drift x1.6 (REQ-BAL-04); every type has its own degradation history (REQ-DEG-05) so 50-50 / Smith / 50-50 / Smith on one rail is 100 + 180 + 90 + 162 and the fifth switch is worth 25%; the switch cooldown blocks mashing faster than 10 per second, and the element count itself raises drift.

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-GRD-01 | Rails are explicit polylines {id, points, kind: rail / ledge / coping, tags, name} authored in level data; the builder emits mesh, collider and the grind spline from the same points. | §9.2 | levels.test: every rail id has geometry and every ledge/coping top edge has a rail within 0.1 m |
| REQ-GRD-02 | Magnet: closest point on each segment, radius 0.55 m, horizontal entry angle <= 55 deg between velocity and the rail tangent; candidates scored by d/0.55 + ang/55, lowest wins. | §7, §14-E | grind.test: 8 geometric cases |
| REQ-GRD-03 | Snap: 80 ms position blend to the rail, velocity set to tan3D x max(dot(v, tan3D), 3.0) m/s, needle re-centred, element added with the Dir8 type. | §14-E | grind.test: an ollie snapped while rising at 4 m/s vertical enters a flat rail at its horizontal speed, not faster |
| REQ-GRD-04 | Pre-buffer: a Triangle press in Air stays valid 200 ms and snaps the moment a candidate appears; a press with no candidate after 200 ms is dropped silently. | §7 | grind.test, stateMachine.test |
| REQ-GRD-05 | Ground snap: Triangle while Grounded, LandWindow or Manual at >= 3.0 m/s with a rail within the magnet and rail height dy within [-0.2, +0.7] m of the board (GRIND_GROUND_SNAP_DY_MIN/MAX) performs a hop of max(0.3, dy + 0.1) m and snaps; MS-R1 (0.6), WS-RA (0.55), WS-FB1 (0.55) and MS-R2 (0.9 from the plaza is out of reach; 0.6 from the bank) all qualify. From Manual the combo lives (row 34b). | §1 rule 5 | grind.test: dy 0.6 hops 0.7 m; dy 0.8 is refused |
| REQ-GRD-06 | Grind types and their Dir8 per D.2; Boardslide/Lipslide chosen by the toe-side rule; the type is fixed at snap unless switched. | §9.1 | grind.test: toe-side cases for regular, switch, fakie |
| REQ-GRD-07 | Type switch: Dir8 + Triangle in Grind, new type differs, 100 ms cooldown; +1 element with its own history; needle re-centred; same-object multiplier unchanged. | §6, §8 | grind.test, scoring.test |
| REQ-GRD-08 | Rail motion: friction by kind (0.10 rail, 0.30 ledge, 0.15 coping) and 0.35 g along-rail slope component; below 1.5 m/s the skater hops off. | mine | grind.test: 8 m/s lasts > 20 s on a flat rail; 9 m/s entering MS-P1 leaves MS-P3 at 6.0 m/s within 0.3 with the two hops scripted to snap near the apex (speed-neutral) |
| REQ-GRD-09 | Rail end: state Air with the tangent velocity (vertical component included on sloped rails); coyote 90 ms applies. | §8, CR-14 | stateMachine.test |
| REQ-GRD-10 | Polyline corners with a direction change > 55 deg act as rail ends. | mine | grind.test |
| REQ-GRD-11 | Same object detection uses the rail id (one polyline = one id, kinked ledges included). | §6 | balance.test |
| REQ-GRD-12 | Every rail and coping renders a faint emissive rim (0.05) and shows sparks while grinding; sparks are GPU points with gravity, additive, seeded. | §10 | e2e screenshot review |
| REQ-GRD-13 | A hold-accrual of holdRate x seconds (no stance factor, no degradation) is added when the grind element ends (exit, switch or bail excluded). | §6 | scoring.test |
| REQ-GRD-14 | Rails are spatially hashed (cells 8 m) so the magnet query touches at most the 9 cells around the board. | mine | grind.test perf: 1000 queries < 5 ms |
| REQ-GRD-15 | Grind wall handling: head-on (REQ-CTL-20) = Bail, glancing = tangential speed x0.8 clamped along the rail; the level validator rejects a rail whose end lies within 0.5 m of a wall along its tangent. | §8 | stateMachine.test rows 22b, 22c; levels.test "no rail ends at a wall" |

**Named rails per park**: see G.1 and G.2 feature tables (ids MS-L*, MS-R*, MS-P*, MS-Q*-coping, WS-R*, WS-HB*, WS-RR*, WS-TR*, WS-SP*, WS-OV, WS-SR*).

### E.2 Manual and nose manual (REQ-MAN)

| Field | Content |
|---|---|
| PURPOSE | Keeps the combo alive on flat; the glue between rails and ramps. |
| PLAYER FEEL | A wheelie you steer while fighting a vertical needle; every second is worth points, every turn costs attention. |
| INPUTS | Up->Down (manual) or Down->Up (nose manual) with a leave-to-enter gap <= 250 ms on flat rolling >= 1.0 m/s, or within 140 ms before or after a flat landing (row 7 / row 9d), or within 200 ms of a revert. Vertical stick = balance (brake and auto-push are off in Manual). Cross = pop (charge by holding). Opposite pair = swap (rate-limited). Triangle with a rail in reach = hop-and-snap grind (row 34b). L,R + Triangle while glowing = Context Window. |
| OUTPUTS | State Manual, base 50, +40/s, element +1, vertical HUD bar, lean pose. |
| FAILURE STATE | needle abs >= 1 -> Bail. Speed < 1.0 -> Grounded (banks). Climbing into slope >= 35 -> Grounded (banks). Head-on wall -> Bail. |
| EDGE CASES | Manual pair typed in Air before contact counts if the second press is within 140 ms of contact; a pair typed after contact counts inside LandWindow. A pair consumed by a special never enters a manual (CR-11). Manual in switch stance is `switch_manual` (x1.2, own history). Swap nose<->normal is a new element (+1, own history) and re-centres the needle, at most 3 per manual run with a 600 ms cooldown and a 4-tick hold on the second direction, so balance taps never farm swaps. Turning is allowed at up to 120 deg/s (the Woodshed chain turns are traced at 7.5 and 6.3 m/s with that rate). Manual across a gap edge (rolling off a ledge) becomes Air with the combo alive (row 33b); landing needs a linker again. A manual entered from a revert on a transition rides DOWN the face legally; only climbing into slope >= 35 ends it (row 31). |
| TUNABLES | MANUAL_FRICTION = 0.35 m/s^2 (0.2 to 0.8): a 3 s manual costs about 1 m/s so chains stay possible. MANUAL_MIN_SPEED = 1.0 (0.5 to 2.0). MANUAL_LAND_WINDOW_MS = 140 (100 to 180). MANUAL_SEQ_MS = 250 (180 to 350). TURN_RATE_MANUAL_DPS = 120 (60 to 120): 90 put the chain's turns into the spine foot and the west wall. MANUAL_SWAP_COOLDOWN_MS = 600 (400 to 1000). MANUAL_SWAP_MAX_PER_RUN = 3 (2 to 5). MANUAL_SWAP_MIN_HOLD_TICKS = 4 (2 to 8). FLAT_MAX_SLOPE_DEG = 35 (25 to 40). |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-MAN-01 | Manual entry on flat from Grounded (pair within 250 ms, speed >= 1.0, slope < 35) starts a combo with element +1. | §8 | stateMachine.test row 4 |
| REQ-MAN-02 | Manual as a landing linker within the 140 ms window keeps the combo (also from RevertWindow within 200 ms). | §7, §8 | stateMachine.test "manual within 140 ms keeps combo" |
| REQ-MAN-03 | Nose/normal swap by the opposite pair is +1 with its own history and re-centres the needle. | §8 | scoring.test |
| REQ-MAN-04 | Manual balance uses the vertical axis; needle dynamics per REQ-BAL-01; manual friction 0.35 m/s^2. | CR-02 | balance.test |
| REQ-MAN-05 | Manual exits: pop (Cross), bail (needle, wall), stop (< 1.0 m/s), slope (>= 35) as in the state table rows 27 to 34. | §8 | stateMachine.test |
| REQ-MAN-06 | The combo survives a manual: grind -> manual -> grind banks as one combo (quality gate). | §19 | stateMachine.test, e2e |
| REQ-MAN-07 | A manual entered from RevertWindow on a transition continues down the face; row 31 ends a manual only when it climbs into slope >= 35 (v.y > 0). | mine | stateMachine.test: revert-manual on the QP face rolls out onto the flat with the combo alive |

### E.3 Revert (REQ-REV)

| Field | Content |
|---|---|
| PURPOSE | Turns a vert landing into a combo link and flips stance so the next tricks score x1.2. |
| PLAYER FEEL | Slap R2 as the wheels touch, the board pivots, then Up-Down keeps it rolling. Spamming R2 slightly early must work. |
| INPUTS | R2 within 150 ms before (pre-buffer, row 8) or 180 ms after (LandWindow, row 9c) a vert contact (slope >= 40). Manual pair within 200 ms after. |
| OUTPUTS | Element revert 100, +1, stance toggles, board yaw 180 deg, speed x0.85, RevertWindow 200 ms, HUD "Revert" in the ticker. |
| FAILURE STATE | Window timeout -> Grounded, banks. Head-on wall in the window -> Bail. R2 too early (> 150 ms before contact) -> nothing (the buffer expired); too late (>= 180 ms after contact) -> LandWindow has expired and the combo already banked. |
| EDGE CASES | R2 on a flat landing: nothing (no revert on flat; combo banks as usual). Two R2 presses: the second is ignored. Revert after a 180-spin landing (forward re-entry) pivots to fakie; the fakie flag follows velocity. Revert then Cross: banks then Crouch (row 18). Revert on the fountain, bowls, spine faces, vert wall, snake-run walls: all are slope >= 40 at the assisted re-entry (fountain 40 to 47 deg, mini quarter 45 to 51, QP 55 to 68). The full-pipe return is on the lower wall at 25 to 30 deg: flat, manual only, no revert. In switch stance the revert element itself scores 100 x 1.2 when the stance was already switch before the toggle. |
| TUNABLES | REVERT_PRE_MS = 150 (100 to 200). REVERT_POST_MS = 180 (140 to 220). REVERT_TO_MANUAL_MS = 200 (160 to 260). REVERT_SPEED_RETAIN = 0.85 (0.7 to 1.0): a pivot costs a little speed so revert-manual lines need pumping first. VERT_LAND_MIN_SLOPE_DEG = 40 (35 to 60): the popped fountain return lands at 40 to 42 deg. |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-REV-01 | Revert requires a landing on slope >= 40 deg and R2 within [-150, +180) ms of contact (pre-buffer before, LandWindow after); it adds element revert 100 and toggles stance. | CR-03, CR-04 | stateMachine.test rows 8, 9c, 15, 16 |
| REQ-REV-02 | Manual inputs pressed during the revert animation are buffered, not dropped; a pair completed within 200 ms enters Manual. | CR-03 | stateMachine.test "revert to manual inside 200 ms" |
| REQ-REV-03 | Timeout of the window banks the combo. | §8 | stateMachine.test "timeout kills it" |
| REQ-REV-04 | Revert speed x0.85 and yaw 180 deg; the fakie flag is recomputed. | mine | controller.test |
| REQ-REV-05 | The quality gate case: land on vert with R2 pressed 100 ms early, then Up,Down at 150 ms -> Manual with the combo alive and the stance switched. | §19 | stateMachine.test |

### E.4 Lip tricks (REQ-LIP)

| Field | Content |
|---|---|
| PURPOSE | Makes the coping a linker at the apex; stalls that hold the combo and add a beat before dropping back in. |
| PLAYER FEEL | Reach the coping, press Triangle, freeze in a stall while the horizontal needle wobbles, drop back into the ramp. |
| INPUTS | Triangle in Air at coping (within 0.55 m of a `coping` rail, y >= coping - 0.3, vy <= 3.0 m/s) with the approach angle to the coping tangent > 55 deg (otherwise it is a coping grind). A Triangle press buffered in Air (24 ticks) enters Lip when the candidate appears. Neutral = Axle Stall, Down = Rock to Fakie. Hold Triangle to stay; a release earlier than LIP_MIN_HOLD_MS (150) exits at 150 ms, so a tap still reads as a stall. Horizontal axis = balance. Cross or release Triangle = exit. |
| OUTPUTS | State Lip, base 150, +100/s, +1, HUD arc meter, stall pose. Exit formula: position = coping point + 0.15 m along the face normal; v = faceDown x LIP_EXIT_SPEED (3.5) + up x 0.5 x sqrt(2 g LIP_EXIT_POP_M) (= 1.66 m/s up), then normal air physics; the first contact on the face is a vert landing (revert allowed). Rock to Fakie sets fakie on exit. |
| FAILURE STATE | needle abs >= 1 -> Bail (tumbles down the face). |
| EDGE CASES | Lip entered from a spine coping: exit returns to the side the skater came from. Lip on the fountain ring: allowed. Triangle at coping while travelling along it (angle <= 55): coping grind, not lip. Lip then landing on vert below: revert allowed (slope >= 45), the line lip -> revert -> manual works. Lip is not possible on ledges or flat rails (kind must be coping). |
| TUNABLES | LIP_MAGNET_M = 0.55 (0.4 to 0.8): same as grind. LIP_MAX_VY = 3.0 m/s (2 to 5): must be near the apex. LIP_EXIT_SPEED = 3.5 (2.5 to 5). LIP_EXIT_POP_M = 0.25 (0.1 to 0.4): halved in the formula so the pop never cancels the drop. LIP_MIN_HOLD_MS = 150 (100 to 300). |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-LIP-01 | MVP ships Axle Stall (neutral) and Rock to Fakie (Down), base 150, +100/s, entered as defined above. | CR-13 | stateMachine.test row 6, lip.test |
| REQ-LIP-02 | Lip versus coping grind is decided by the approach angle to the coping tangent (<= 55 grind, > 55 lip); a rail or ledge candidate always beats a coping candidate. | mine | grind.test |
| REQ-LIP-03 | Lip exit: position = coping + 0.15 m along the face normal, v = faceDown x 3.5 + up x 0.5 x sqrt(2 x 22 x 0.25); the first face contact is a vert landing; Rock to Fakie exits fakie; a release before 150 ms exits at 150 ms. | §8 | lip.test: exit on the QP contacts the face within 0.4 s at slope >= 40 |
| REQ-LIP-04 | Lip balance uses the horizontal axis and the shared needle rules. | CR-02 | balance.test |

### E.5 Ollie, air tricks and spin (REQ-SKT feel, REQ-VRT)

| Field | Content |
|---|---|
| PURPOSE | The verb that starts every combo and links every linker. Air is where flips, grabs, spins and specials live. |
| PLAYER FEEL | Hold to crouch, release to pop; taller the longer you hold, capped at 0.6 s. In the air the stick spins, L1/R1 snaps 180s, flips and grabs are one press each. |
| INPUTS | Cross hold/release. Square + Dir8 (flip), Circle + Dir8 (grab, hold), double-tap for enhanced, L2 modifier, L1/R1, stick spin. |
| OUTPUTS | Air state, pop velocity, trick element(s) with anim timers, spin accumulation, pose. |
| FAILURE STATE | Landing with an unfinished anim (a grab's anim ends 120 ms after release; a held grab never ends), off-axis > 28 or tilt > 40 -> Bail. Grind snap with an unfinished anim -> Bail (row 5b). |
| EDGE CASES | Trick pressed in the last 100 ms of an air always bails (anim cannot finish): intended. A second different flip in the same air is a new element if the first anim finished (allowed; degradation applies). Grab hold accrual stops at release. Kickflip then Kickflip double-tap after the 250 ms window = two Kickflips (second degraded), not a Double. Nollie variants when L2 is held. Cross held through a landing: see row 12. Spin credit is folded (REQ-VRT-05) and accumulates about the skater up axis (REQ-VRT-12). Coyote: a press within 11 ticks after leaving a surface pops (P8b); a release within 11 ticks with Cross held since before the edge pops with the accumulated charge (row 37b). |
| TUNABLES | OLLIE_H_TAP_M = 0.9 (0.7 to 1.1). OLLIE_H_FULL_M = 1.6 (1.3 to 2.0). OLLIE_TAP_MAX_S = 0.10, OLLIE_FULL_S = 0.60 (0.4 to 0.8). OLLIE_CHARGE_EXP = 1.0 (0.6 to 1.5): linear reads best on a pad. GRAB_MIN_POSE_MS = 250, GRAB_RELEASE_BEFORE_LAND_MS = 120 (80 to 200). FLIP anims per D.2 (300 to 900), ENHANCED_ANIM_EXTRA_MS = 120 (80 to 200): keeps every enhanced flip under a flat full ollie. SPIN_RATE_STICK_DPS = 360 (270 to 450). QUICKSPIN_RATE_DPS = 720 (540 to 900). SPIN_RATE_CAP_DPS = 900. DOUBLE_TAP_MS = 250. |

### E.6 Special meter and specials (REQ-SPC, sheet)

| Field | Content |
|---|---|
| PURPOSE | Reward for sustained scoring; unlocks combo finishers and a speed buff; the thing a bail takes away. |
| PLAYER FEEL | Bar fills as tricks land, then glows and pulses; the skater leaves a trail; you feel faster and you are. |
| INPUTS | Landed elements feed it. Specials: two directions within 250 ms + button within 250 ms while glowing, in the right state. |
| OUTPUTS | meter [0,1], glowing flag, +8% vmax, specials enabled, HUD gradient, chromatic aberration on. |
| FAILURE STATE | Bail -> 0. Idle 3 s -> 4%/s drain; glow off below 0.85. |
| EDGE CASES | Meter feeds per element, not at bank, so a long combo glows mid-line. A special performed while glowing does not spend the meter. 900ms Inference dilates sim time (render loop steps sim at 0.6 x real); the run clock stays sim-driven and decrements by (1/120) / INFERENCE_TIME_SCALE per tick while the special is held, so it matches real time without any wall-clock read (REQ-SPC-05). CUDA Slide is a grind type: switching from it to a normal type is a switch (+1). Context Window ends when Triangle is released or the manual ends; drift x2 while held. Kernel Panic needs 0.7 s of air: a flat tap ollie (0.57 s) bails, a full ollie (0.76 s) or any vert air lands it. |
| TUNABLES | SPECIAL_FULL_BASE = 6000 (4000 to 9000). SPECIAL_IDLE_DELAY_S = 3.0 (2 to 5). SPECIAL_DRAIN_PER_S = 0.04 (0.02 to 0.08). SPECIAL_GLOW_OFF = 0.85 (0.6 to 0.95): a short idle should not kill the glow. GLOW_SPEED_BONUS = 0.08. INFERENCE_TIME_SCALE = 0.6 (0.4 to 0.8). INFERENCE_MIN_HOLD_MS = 900. SPECIAL_SEQ_MS = 250, SPECIAL_BUTTON_MS = 250. |

### E.7 Balance (REQ-BAL, sheet)

| Field | Content |
|---|---|
| PURPOSE | The finite resource that ends long linkers; the skill test inside grinds, lips and manuals. |
| PLAYER FEEL | A needle that wanders faster the longer the combo, that you push back with the stick; each new element gives you a partial reset. |
| INPUTS | Horizontal axis (grind, lip), vertical axis (manual). |
| OUTPUTS | needle, HUD meter, bail event. |
| FAILURE STATE | abs(needle) >= 1 -> Bail. |
| EDGE CASES | Element count includes gaps and spins? Gaps yes (they are elements); spins no. Same-object only checks the previous grind. Context Window x2. Switch stance x1.35 drift at switch stat 4 (CR-19; 20% less hands-off time). Needle direction on the first element is a seeded coin flip so it is never static. Sign convention: manual Up = negative, grind/lip Left = negative. |
| TUNABLES | BAL_K0 = 0.5 /s^2 (0.3 to 1.0): 3.54 s hands-off on a first grind with BAL_DAMP 1.5 (the drift velocity saturates at k0 / 1.5 = 0.33 per s); generous on the first linker, the element count is the difficulty curve. BAL_ELEMENT_GAIN = 0.12 (0.06 to 0.20). BAL_SAME_OBJECT_MULT = 1.6 (1.2 to 2.0). BAL_RECENTER = 0.35 (0.2 to 0.5). BAL_INPUT_ACCEL = 2.0 /s^2 (1.2 to 3.0). BAL_DAMP = 1.5 /s (0.5 to 3.0). BAL_START_OFFSET = 0.05 (0 to 0.15). CONTEXT_WINDOW_DRIFT_MULT = 2.0. SWITCH_DRIFT_MULT = 1.35 at stat 4 (CR-19: spec-literal 1.25 raised so the hands-off time drops 20%, REQ-CTL-13). |

### E.8 Degradation (REQ-DEG, sheet)

| Field | Content |
|---|---|
| PURPOSE | Forces variety within a run; makes the whole catalog matter. |
| PLAYER FEEL | The ticker shows the shrinking value; the fifth kickflip is a rounding error. |
| INPUTS | Trick ID at element creation. |
| OUTPUTS | factor from the preset table. |
| FAILURE STATE | none (a degraded trick still counts as an element). |
| EDGE CASES | Gaps, MacGuffins exempt. Variants separate. Reset per run, not per combo. Hold accruals are not degraded (so a long grind on a tired type still pays). |
| TUNABLES | DEGRADATION_PRESET = "thps1" ("thps1" or "thps3"). DEGRADATION_THPS1 = [1, 0.9, 0.75, 0.5, 0.25]. DEGRADATION_THPS3 = [1, 0.75, 0.5, 0.25, 0.1]. |

### E.9 Spine transfer (REQ-VRT-08, sheet)

| Field | Content |
|---|---|
| PURPOSE | Woodshed's signature move; connects the two halves of the park in one air; a named gap and a route to the Drive. |
| PLAYER FEEL | Air up the spine, tap R2, the world flips and you drop in on the other side, still in the combo. Timing is forgiving: any press from launch to the last 0.2 s of the air works. |
| INPUTS | R2 in Air within 1.5 m above and 1.0 m beside a rail tagged transfer. |
| OUTPUTS | Position and perpendicular velocity mirrored across the rail's transfer plane (spine centre x 43.0; vert-wall coping x 84), outward speed >= 0.4 m/s toward the far side, 180 deg body rotation animation, gap "Spine Transfer" 500 (or "Over the Vert" 1200 on the vert wall), +1. Landing on the far face at 55 to 65 deg: revert legal. |
| FAILURE STATE | Off-axis landing on the far face (> 28) -> Bail; pressing R2 outside the volume is a revert buffer instead. |
| EDGE CASES | The vert wall coping is also tagged transfer: transferring there mirrors the skater onto the deck (lands at x 84.3, y 3.6) and a held Triangle snaps WS-OV on the way down. A carving launch that already crossed the plane is not mirrored, only pushed outward. Once per air. A transfer followed by a vert landing allows a revert with a fresh R2 press. Spine coping grind (Triangle) is still available instead. Side is always the launch side stored at leftSurface, never the closest rail. |
| TUNABLES | SPINE_TRANSFER_HEIGHT_M = 1.5 (1.0 to 2.0). SPINE_TRANSFER_LATERAL_M = 1.0 (0.6 to 1.5). SPINE_TRANSFER_PUSH_MPS = 0.4 (0.3 to 1.5): the minimum outward speed after the mirror; 0.4 matches the assist so the far-side landing sits 1.0 m below the coping. SPINE_TRANSFER_ANIM_S = 0.3. GAP_SPINE_TRANSFER = 500. |

### E.10 Named gaps, letters and MacGuffins (REQ-SCR-05, 06, REQ-LVL-07, 08, sheet)

| Field | Content |
|---|---|
| PURPOSE | Gaps teach the map's lines and pay +1 with no degradation; letters and the MacGuffin are the sacred per-park goals. |
| PLAYER FEEL | A splash with the gap name and value the instant it is earned; a ding per letter; a full-width splash, flash, hitstop and rumble for the MacGuffin. |
| INPUTS | Element events (grind start/end with rail id and along-rail distance, air start/landing with boxes, transfer events, manual span) and axis-aligned box tests; letters and MacGuffins by the collect point within 0.9 m. |
| OUTPUTS | Gap: base 200 to 2000, +1, splash 1.2 s, rumble 0.5 x 120 ms. Letter: tray fills, ding. MacGuffin: 2500, +1, full-width splash 1.5 s, flash 120 ms, hitstop 7 ticks, rumble 0.6 x 200 ms, toast. |
| FAILURE STATE | A gap whose end is not reached in the same combo (start in one combo, end in the next) awards nothing; a bail between start and end voids it. |
| EDGE CASES | Each gap once per combo, any number of times per run. MacGuffin once per career (it stays collected and never respawns). Letters reset per run; C-O-D-E needs all four in one run. Gap and goal rules match on category, never on id. Grind-span and grind-distance gaps sum consecutive grind elements on the same rail id, so a mid-rail type switch never voids them. |
| TUNABLES | GAP_SPLASH_S = 1.2 (0.6 to 2.0). MACGUFFIN_SPLASH_S = 1.5 (1.0 to 2.5). HITSTOP_MACGUFFIN_MS = 60 (30 to 120, floor to 7 ticks). FLASH_MACGUFFIN_MS = 120 (60 to 250). COLLECT_RADIUS_M = 0.9 (0.6 to 1.2). RUMBLE_GAP_STRONG 0.5, RUMBLE_MACGUFFIN_STRONG 0.6. Gap bases are level data (G.1, G.2). |

### E.11 Bail and get-up (REQ-SM-05, REQ-CTL-20, sheet)

| Field | Content |
|---|---|
| PURPOSE | The cost of a miss: the whole combo and the special meter, plus 1.45 s of dead time. Readable, slightly cartoon. |
| PLAYER FEEL | A scripted tumble, camera shake, medium rumble, crash sound; the skater stands up and you are rolling again. |
| INPUTS | None accepted during Bail and GetUp except pause and camera (REQ-TIM-10). |
| OUTPUTS | Combo discarded, special meter 0, glow off, bail pose 0.6 s, camera shake 0.12 m over 0.35 s, rumble 0.8 x 250 ms, GetUp 0.85 s, then Grounded at 0 m/s facing the pre-bail heading. |
| FAILURE STATE | none (Bail is the failure state). |
| EDGE CASES | Bail at 0:00 ends the run with nothing banked (row 40). Bail inside a gap voids the gap. A wall bail needs speed >= 5.0 and incidence <= 45 deg; slower or shallower contacts slide. Off-axis > 28 and tilt > 40 bail from any height; there is no fall damage. |
| TUNABLES | BAIL_TUMBLE_S = 0.6 (0.4 to 0.9). GETUP_LOCKOUT_S = 0.85 (0.60 to 1.10). WALL_BAIL_SPEED_MPS = 5.0 (3 to 8). WALL_BAIL_ANGLE_DEG = 45 (30 to 60). TILT_BAIL_DEG = 40 (30 to 50). LAND_OFFAXIS_BAIL_DEG = 28 (22 to 35). CAM_SHAKE_BAIL_AMP_M = 0.12, CAM_SHAKE_BAIL_S = 0.35. RUMBLE_BAIL_STRONG = 0.8, RUMBLE_BAIL_MS = 250. |

---

## F. Vertical slice contents

| Area | In the slice (MVP, this build) | v1.0 | Later |
|---|---|---|---|
| Skater | 1 preset (stats 6/6/6/4/6), regular stance, procedural rig, 12 core poses | 8 fictional skaters, create-a-skater, goofy | |
| Tricks | 8 flips + 8 enhanced, 8 grabs + 8 tweaked, 9 grind types, 2 lips, manual + nose manual, revert, 5 specials, nollie/fakie variants | full lip catalog, wallride, wallplant, acid drop, flatland | |
| Systems | combo, degradation (2 presets), special meter, balance, gaps, letters, MacGuffins, spine transfer (Woodshed), 2:00 run, 10 goals per park, 6/10 unlock, Lab Circuit stamp | | online leaderboards, HORSE, Trick Attack |
| Parks | Market Street, Woodshed | more parks | lab-campus park |
| Presentation | procedural materials, sun + shadows, PMREM sky / room env, post chain, sparks/dust/speed lines/trails, synthesized audio, HUD, main menu, Board Lab, Options, Credits, results card | Nintendo glyphs, split-screen | more sponsor sheets |
| Platform | static Vite build, GitHub Pages workflow, Vercel/Netlify notes, itch zip, parody brand mode, quality presets with FPS probe | | |

Smoke-test notes for the Woodshed pass bar: the 20 s rails + manuals chain is G.2 "Rail chain".

---

## G. Park one-pagers

Level format (REQ-LVL). The authoritative schema is `src/levels/types.ts` (`LevelDef` and its primitive types); the field names in this paragraph are prose. Renames in code: `qp` -> `quarterPipe`, `fullpipe` -> `fullPipe`, `scaffoldPipe` -> `railPipe` with style `scaffold` (any rail's visible pipe; plain rails and copings get a default pipe from the builder), `spawn.yawDeg` -> `spawn.facing` (a compass word), `letters: Vec3[4]` -> `letters: LetterDef[]` ({letter, pos}), `npc` -> `npcs: NpcDef[]`, `bank` y0 / y1 / facing -> yHigh / yLow / downhill, plus `environment`, `feeds` and `boundaryHeight`. A level file exports `{ id, name, size: {x, z}, spawn: {pos, yawDeg}, spawnArea: {x0, z0, x1, z1}, primitives: Primitive[], rails: Rail[], gaps: Gap[], letters: Vec3[4], macguffin, npc, goals, decals }`. Primitive kinds and their fields: `box` (x0, z0, x1, z1, y0, height, grindable?: true marks its convex top edges as edges that must carry a rail), `qp` (quarter-pipe: foot line, facing, width, copingHeight, radius, vertExt, baseY default 0), `bowl` (rect, depth, radius, cornerRadius), `spine` (line, length, copingHeight, radius, gapWidth), `fullpipe` (axis start/end, radius), `bank` (rect, y0, y1, facing), `stairs` (rect, steps, drop, down: north / south / east / west), `hubba` (rect, yTop, yKink, kinkAt, yEnd, along), `channel` (centreline polyline, width, floorY, wallRadius, wallHeight), `hump` (rect, ridgeAxis, height), `fountain` (centre, rimRadius, rimHeight, faceRadius, footRadius, basinY), `scaffoldPipe` (a rail with a visible pipe mesh). `facing` = the direction from the coping line toward the foot line (the side the skater approaches from). Tags: `transition` (every rideable curved surface, set by the builder), `transfer` (rails), `wall` (boundary). The builder emits four boundary walls at the size rectangle (h 12, kind wall) for every level. Round rail and coping pipe meshes are rendered but excluded from the movement BVH (grind query only). Every ledge, coping and rail has a Rail entry. Coordinates below: x east, z south, y up; origin at the north-west corner; all values in metres.

Feed rule (REQ-LVL-06, REQ-LVL-10): a rail end feeds the next rail start when the hop is <= 3.5 m horizontal, <= 1.2 m up AND the lateral offset between the exit tangent line and the next rail's start is <= 0.5 m (GRIND_MAGNET_RADIUS_M - 0.05), because air has no steer. levels.test also simulates each listed feed as a straight-line hop at the recorded exit speed with a full ollie and asserts the next rail's segment (not just its endpoint) comes within the magnet at some tick.

Trigger volumes are axis-aligned boxes written as x[a,b] z[c,d] y[e,f]. Gap conditions reference element events (grind start/end, air start/landing, transfer) so they are machine-checkable in the sim without geometry queries at runtime beyond box tests.

### G.1 MARKET STREET (120 x 120 m, outdoor, late afternoon)

Spawn: (46, 30, 0.8) on the north terrace, facing south (yaw toward +z). spawnArea x[20,84] z[20,88] (terrace plus plaza). SAM stands at (50, 27, 0.8).

```
        x:  0   8   16  24  32  40  48  56  64  72  80  88  96  104 112 120
            |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
  z=  0     AAAAAAAAA..BBBBBBBBBB.CCCCCCCC      A/B/C = glass towers (h 40/48/36)
  z=  4     AAAAAAAAA..BBBBBBBBBB.CCCCCCCC
  z=  8     AAAAAAAAA..BBBBBBBBBB.CCCCCCCC
  z= 12     AAAAAAAAA..BBBBBBBBBB.CCCCCCCC
  z= 16     AAAAAAAAA..BBBBBBBBBB.CCCCCCCC
  z= 20     ==============================      = north terrace, y 0.8
  z= 24     ============N=================      N = SAM (50,27)
  z= 28     ===========*==================      * = spawn (46,30) facing south
  z= 32     ==============================
  z= 36     ==========L=L=LLLLLL==========      L = hubba tops L1/L2, terrace ledge L3
  z= 40     //////////LSL/////////W///####      / banks B1,B2,B5  S stairs S1 (step ledges L7/L8 beside the hubbas)  W server-closet roof (86.7..88.5)  # annex (h 6)
  z= 44     .R........L.L.........QW..P###      R = R9 bench, Q = Q2 quarter-pipe, P = scaffold P1 (x 103.9)
  z= 48     .R..........R.........QW..P###      R (col 12) = R1 flat bar (50.2, 49..57)
  z= 52     .R..........R....LLL..QW..P###      L = L5 ledge (68..80, 52)
  z= 56     .R..........R.........QW..P###      P2 (103.9, 54..62)
  z= 60     .R..........OOO.......QW..P###      O = fountain F1 centre (52,64) r 5
  z= 64     .R..........OOO.......QW..P###      D letter above the north rim (52, 59.5, 2.9)
  z= 68     .R..........OOO.......QW..P###      P3 (103.9, 64..70)
  z= 72     Q.....LLL.............W.DDDR##      L = L4 ledge (24..36, 74); D = dock platform D1 (95..101, 70..88); R = R7 roof rail (104.2, 72..87)
  z= 76     Q.....................W.DDDR##      Q (col 0) = Q4 west mini quarter (z 74..86)
  z= 80     Q.....................W.DDD$##      $ = SECRET LAPTOP (104.2, 80, 7.2)
  z= 84     Q..............RRRRR..W.QQQR##      R = R2 bus stop bar (60..80, 86.5); Q = Q3 dock quarter (95..101, z 85..88)
  z= 88     ~~~~~~~~~R SSS R~~~~~GGG..WWWWWW    ~ street y -1.2, S = stairs S2 with rails R3/R4, G = depot roof (82..90), W = dock roof (95..120, y 3.5)
  z= 92     ~~~~~~~~~~+++++~~~~~~GGG.OWWWWWW    + crosswalk (38..54, 91.6..102), O letter mid gap (92.5, 94, 5.0)
  z= 96     ~~~~~~~~~~+++++~~~~~~GGG..WWWWWW    C letter over the stairs (46, 90.5, 2.4)
  z=100     ~~~~~~~~~~+++++~~~~~~GGG..######    G row 100..102 = billboard on the depot roof; # = south-east block SE
  z=104     /////////////////////GGG..######    / = south curb bank B3
  z=108     ..............................
  z=112     ..............................
  z=116     .......QQQQQQQQQ..............      Q = Q1 south quarter-pipe (30..62, coping z 118)
  z=120     ##############################      south block wall
```

**Feature table**

| id | primitive | extent (x, z) | heights / dims | notes |
|---|---|---|---|---|
| MS-T1 | ground | x[0,120] z[0,120] | y 0 | asphalt/concrete decals; the plaza is x[20,84] z[42.4,88] |
| MS-T2 | box (terrace) | x[0,120] z[20,40] | top y 0.8 | marble; the whole north band; grindable edges only at the two step segments beside the hubbas (rails MS-L7, MS-L8) |
| MS-TA / TB / TC | box (towers) | x[0,36] z[0,20]; x[44,84] z[0,20]; x[90,120] z[0,20] | h 40 / 48 / 36 | glass; walls (head-on = bail) |
| MS-TG1 / TG2 | box (tower connectors) | x[36,44] z[0,20]; x[84,90] z[0,20] | h 20 | close the gaps between towers so nothing leads north |
| MS-B1 | bank | x[0,38] z[40,42.4] | y 0.8 -> 0, slope 18.4 deg | rideable both ways |
| MS-S1 | stairs | x[42,50] z[40,43.2] | 4 steps, drop 0.8 | |
| MS-L1 / MS-L2 | hubba | x[41.4,41.8] and x[50.2,50.6], z[38,46] | yTop 1.2 at z 38, yKink 0.4 at kinkAt z 43.2, yEnd 0.4 at z 46, along +z | marble; rails MS-L1, MS-L2 |
| MS-B2 | bank | x[54,86.7] z[40,42.4] | y 0.8 -> 0 | |
| MS-L3 | ledge box | x[56,80] z[39.2,40] | top y 1.2 | marble terrace ledge |
| MS-B5 | bank | x[88.5,104] z[40,42.4] | y 0.8 -> 0 | alley entrance |
| MS-F1 | fountain | centre (52, 64) | footRadius 5.0, faceRadius 1.5, rimRadius 3.5, rimHeight 1.2, basinY 0.9 (water decal, rideable flat) | outer face tagged transition; face, rim and basin are all contact surfaces with id MS-F1; rim coping rail MS-F1-C |
| MS-L4 | ledge box | x[24,36] z[73.8,74.2] | top y 0.45 | granite bench ledge |
| MS-L5 | ledge box | x[68,80] z[51.8,52.2] | top y 0.45 | |
| MS-R1 | rail (round) | (50.2, 49) -> (50.2, 57) | y 0.6 | plaza flat bar, directly south of L2 |
| MS-R9 | ledge box | x[3.8,4.2] z[50,70] | top y 0.45 | storefront bench |
| MS-Q4 | qp | foot x 1.8, coping x 0, z[74,86], facing east | coping 1.5, R 1.8 | west mini quarter |
| MS-EB | box (server closet row) | x[86.7,88.5] z[40,88] | h 2.4, roof walkable (1.8 m deck) | west wall carries MS-Q2 for z[46,70]; plain wall elsewhere; narrow so a 50 to 60 deg pop off Q2 at 11 m/s clears it (lands x 88.8 to 90.4) for ALLEY TRANSFER |
| MS-Q2 | qp | foot x 84.0, coping x 86.7, z[46,70], facing west | coping 2.4, R 2.7 | plaza quarter-pipe east; deck = MS-EB roof |
| MS-R8 | ledge | (88.3, 46, 2.4) -> (88.3, 70, 2.4) | | east edge of the MS-EB roof, drops into the alley |
| MS-ALLEY | ground | x[88.5,104] z[40,88] | y 0 | plus the passage x[92,95] z[88,120] |
| MS-D1 | box (dock platform) | x[95,101] z[70,88] | top y 1.1 | loading dock |
| MS-L6 | ledge | (101, 70, 1.1) -> (101, 85, 1.1) | | dock platform east edge; ends 3 m short of the MS-Q3 body and the MS-DB wall |
| MS-Q3 | qp | foot z 85.3 (on the platform), coping z 88, x[95,101], facing north, baseY 1.1 | coping y 3.5 (2.4 above the platform), R 2.7 | "rooftop-access QP": ollie early on the transition to land on the dock roof |
| MS-DB | box (dock block) | x[95,120] z[88,100] | h 3.5, roof = dock roof | spans to the east boundary so rolling off the annex south edge always lands on it |
| MS-DP | box (depot) | x[82,90] z[88,104] | h 3.5, roof = depot roof | |
| MS-BB1 | box (billboard) | x[83,89] z[101,102] | y 3.5 to 9.5 | emissive parody sign (brand table) |
| MS-R6 | rail (round) | (89.5, 97, 3.9) -> (82.5, 97, 3.9) | | depot vent pipe (z 94 -> 97, CR-62) |
| MS-AX | box (server annex) | x[104,120] z[40,88] | h 6.0 | scaffold on its west face |
| MS-P1 / P2 / P3 | scaffoldPipe | see rail table | | climb south along x 103.9, hugging the annex face at x 104 |
| MS-R7 | rail (round) | (104.2, 72, 6.3) -> (104.2, 87, 6.3) | parapet pipe 0.3 above the roof, 0.2 m in from the west edge | rooftop rail, Laptop above its midpoint |
| MS-R2 | rail (round) | (60, 86.5, 0.9) -> (80, 86.5, 0.9) | | the long bus stop bar, 20 m |
| MS-S2 | stairs | x[40,52] z[88,91.6] | 6 steps, drop 1.2 | plaza to street |
| MS-R3 / MS-R4 | rail (round) | (39.6, 87.4, 0.9) -> (39.6, 92.2, -0.3); (52.4, 87.4, 0.9) -> (52.4, 92.2, -0.3) | slope 14 deg | stair handrails |
| MS-ST | ground (street) | x[0,82] z[88,104] | y -1.2 | crosswalk decal x[38,54] z[91.6,102] |
| MS-B3 | bank | x[0,84] z[104,106.4] | y -1.2 -> 0 | south curb |
| MS-B4 | bank | x[0,82] z[86,88] except x[38,54] | y 0 -> -1.2 | plaza edge drops into the street as a bank except at the stair set, whose landing x[38,54] is flat so MS-R3/R4 stand 0.9 m above it |
| MS-Q1 | qp | foot z 115.3, coping z 118, x[30,62], facing north | coping 2.4, R 2.7 | south quarter-pipe |
| MS-SB | box (south block) | x[0,120] z[118,120] | h 12 | wall behind Q1 |
| MS-SE | box | x[95,120] z[100,120] | h 8 | south-east block |
| (boundary) | wall x4 | the size rectangle | h 12 | emitted by the builder (G format); the west one is the storefront wall |

**Rail table (polylines; every ledge/coping top edge from the feature table appears here)**

| id | kind | points (x, z, y) | tags / name |
|---|---|---|---|
| MS-L1 | ledge | (41.6, 38, 1.2) (41.6, 43.2, 0.4) (41.6, 46, 0.4) | Hubba West |
| MS-L2 | ledge | (50.4, 38, 1.2) (50.4, 43.2, 0.4) (50.4, 46, 0.4) | Hubba East |
| MS-L3 | ledge | (56, 39.6, 1.2) (80, 39.6, 1.2) | Terrace Ledge |
| MS-L4 | ledge | (24, 74, 0.45) (36, 74, 0.45) | Bench Ledge |
| MS-L5 | ledge | (68, 52, 0.45) (80, 52, 0.45) | Plaza Ledge |
| MS-L6 | ledge | (101, 70, 1.1) (101, 85, 1.1) | Dock Ledge |
| MS-L7 | ledge | (38, 40, 0.8) (41.4, 40, 0.8) | Terrace Step West |
| MS-L8 | ledge | (50.6, 40, 0.8) (54, 40, 0.8) | Terrace Step East |
| MS-R1 | rail | (50.2, 49, 0.6) (50.2, 57, 0.6) | Plaza Flat Bar |
| MS-R2 | rail | (60, 86.5, 0.9) (80, 86.5, 0.9) | Bus Stop Bar |
| MS-R3 | rail | (39.6, 87.4, 0.9) (39.6, 92.2, -0.3) | Stair Rail West |
| MS-R4 | rail | (52.4, 87.4, 0.9) (52.4, 92.2, -0.3) | Stair Rail East |
| MS-R6 | rail | (89.5, 97, 3.9) (82.5, 97, 3.9) | Depot Vent Pipe |
| MS-R7 | rail | (104.2, 72, 6.3) (104.2, 87, 6.3) | Annex Roof Rail |
| MS-R8 | ledge | (88.3, 46, 2.4) (88.3, 70, 2.4) | Closet Roof Edge |
| MS-R9 | ledge | (4, 50, 0.45) (4, 70, 0.45) | Storefront Bench |
| MS-P1 | rail | (103.9, 42, 1.0) (103.9, 52, 1.8) | Scaffold Tier 1 |
| MS-P2 | rail | (103.9, 54, 2.6) (103.9, 62, 3.4) | Scaffold Tier 2 |
| MS-P3 | rail | (103.9, 64, 4.2) (103.9, 70, 5.2) | Scaffold Tier 3 |
| MS-Q1-C | coping | (30, 118, 2.4) (62, 118, 2.4) | South QP Coping |
| MS-Q2-C | coping | (86.7, 46, 2.4) (86.7, 70, 2.4) | Plaza QP Coping |
| MS-Q3-C | coping | (95, 88, 3.5) (101, 88, 3.5) | Dock QP Coping |
| MS-Q4-C | coping | (0, 74, 1.5) (0, 86, 1.5) | West Quarter Coping |
| MS-F1-C | coping | 24-point circle, centre (52, 64), radius 3.5, y 1.2 | Fountain Rim |

Scaffold feed check (along, up, lateral): P1 end (103.9,52,1.8) -> P2 start (103.9,54,2.6): 2.0 m, +0.8, 0. P2 end -> P3 start: 2.0 m, +0.8, 0. P3 end (103.9,70,5.2) -> R7 start (104.2,72,6.3): 2.0 m, +1.1, 0.3 m lateral (inside the 0.5 m rule; R7 sits 0.2 m in from the roof edge for exactly this). Speed check at GRIND_GRAVITY_FACTOR 0.35 and rail friction 0.10 from 9.0 m/s at P1: P1 is 10.03 m at 4.6 deg (decel 0.71) -> 8.2 m/s; P2 8.04 m at 5.7 deg (decel 0.87) -> 7.3; P3 6.08 m at 9.5 deg (decel 1.37) -> 6.0. Final hop trace: P3's tangent gives 5.92 m/s horizontal and 0.99 m/s up at the rail end; a full pop at the end (+8.39 up) comes back down through R7's height (+1.1) at 0.71 s, 4.2 m out, i.e. on R7 at z 74.2 with 0.3 m lateral; a tap (+6.29) comes down at 0.43 s, 2.5 m out, at z 72.5, just past R7's start. So the last hop needs at least a tap at the rail end and a full charge lands mid-rail; the roof (y 6.0) is never touched because the skater is above 6.3 at x 103.9 to 104.25.

**Lines (ordered feature sequences with the tricks a player would do)**

| # | Letter | Sequence |
|---|---|---|
| 1 | C | spawn (46,30) south -> MS-L2 hubba (Triangle neutral 50-50, DR+Triangle Smith, gap HUBBA_HOP) -> ollie onto MS-R1 (L+Triangle Boardslide, gap PLAZA_BAR_HOP) -> land, Up,Down manual south along x 46 -> ollie onto MS-R4 stair rail (D+Triangle 5-0; letter C hangs over the stairs at (46, 90.5, 2.4), take it with a kickflip over the stairs instead for STAIR_SET) -> land in the street, Up,Down manual across the crosswalk z 93 -> 100.5 (CROSSWALK_MANUAL) -> up MS-B3 -> MS-Q1 (air, Indy, R2 revert) -> Up,Down manual north. |
| 2 | O | terrace east end (100, 30) south -> MS-B5 down into the alley -> ollie onto MS-L6 dock ledge (U+Triangle Nosegrind 15 m) -> hop onto the platform -> MS-Q3: ollie at about slope 50 deg (DOCK_ROOF_ACCESS) -> land on the dock roof heading south, turn west -> full ollie over the slot (BILLBOARD_GAP, grab the O at (92.5, 94, 5.0) with a Melon) -> land on the depot roof, carve south-west onto MS-R6 (Boardslide) -> roll off the west edge to the plaza (y 0) -> manual. |
| 3 | D | MS-R1 south end (50.2, 57) south -> up the fountain north face (air 1 to 2 m, Nosegrab, letter D at (52, 59.5, 2.9)) -> land on the face, R2 revert -> Up,Down manual north (or carve across: FOUNTAIN_TRANSFER) -> ollie onto MS-L2 uphill (UL+Triangle Crooked) -> land on the terrace. |
| 4 | E | alley from MS-B5 south at 9 m/s along x 103.9 -> MS-P1 (50-50) -> MS-P2 (Smith; letter E at (103.9, 58, 4.4)) -> MS-P3 (5-0) -> hold Cross on P3 and release at the rail end (a full charge lands mid-rail, a tap only just makes it) onto MS-R7 (Nosegrind; SECRET LAPTOP at (104.2, 80, 7.2); SCAFFOLD_CLIMB) -> roll off the annex south edge (ROOFTOP_DROP onto the dock roof y 3.5) -> west -> BILLBOARD_GAP -> depot roof. |

Letters: C (46, 90.5, 2.4), O (92.5, 94, 5.0), D (52, 59.5, 2.9), E (103.9, 58, 4.4). MacGuffin `secret_laptop` at (104.2, 80, 7.2): 6.4 m above the alley floor and 6.0 m above the plaza; a max ollie (1.6 m + 0.9 m reach) from any spawnArea point reaches y 3.3 at most, so it is reachable only by the scaffold chain (grind) or by rolling off the annex, which itself is reachable only by the chain.

**Named gaps (Market Street)**

| id | name (splash) | base | condition (machine-checkable) |
|---|---|---|---|
| MS-G01 | HUBBA HOP | 250 | consecutive grind elements on the same rail id (MS-L1 or MS-L2; type switches allowed) whose combined span goes from z <= 40 to z >= 44 (grindSpan with sameRail) |
| MS-G02 | TERRACE DROP | 200 | Air that starts on MS-T2 (y >= 0.8, z <= 40, x[0,86]) and lands at y <= 0.1, z >= 43 with no contact between |
| MS-G03 | PLAZA BAR HOP | 500 | grind element on MS-L1 or MS-L2, then Air, then grind element on MS-R1, consecutive with no ground contact |
| MS-G04 | FOUNTAIN TRANSFER | 750 | leave MS-F1's face or rim at azimuth a1 (about the centre), next contact is any MS-F1 surface (face, rim or basin) at azimuth a2 with the wrapped abs(a1 - a2) >= 45 deg. Reachable two ways: a carve along the rim at lateral fraction >= 0.4 (free launch, about 3.5 m of chord, 56 deg, lands back on the face), or a pop at 50 to 60 deg on the face that crosses the basin (lands flat in the basin at y 0.9, 180 deg away, needs a manual to keep the combo) |
| MS-G05 | STAIR SET | 300 | Air from x[38,54] z <= 88 y >= -0.1 to a landing at z >= 92 y <= -1.1 |
| MS-G06 | CROSSWALK MANUAL | 350 | one Manual (or nose manual) element whose path within x[38,54] spans from z <= 93 to z >= 100.5 (either direction) |
| MS-G07 | BUS STOP BAR | 500 | grind element on MS-R2 with along-rail distance >= 14 m |
| MS-G08 | ALLEY TRANSFER | 600 | Air leaving MS-Q2's transition and landing at x >= 88.5, y <= 0.1, z[40,88] (a free launch popped at 50 to 60 deg at 11 m/s clears the 1.8 m closet roof) |
| MS-G09 | DOCK ROOF ACCESS | 300 | Air that started on MS-Q3's transition and lands in x[95,108] z[88,100] y[3.4,3.7] |
| MS-G10 | BILLBOARD GAP | 1000 | Air from x >= 95, y >= 3.4, z[88,100] to a landing at x <= 90, y >= 3.4, z[88,104] |
| MS-G11 | SCAFFOLD CLIMB | 800 | grind elements on MS-P1, MS-P2 and MS-P3 in that order within one combo |
| MS-G12 | ROOFTOP DROP | 400 | Air that starts at y >= 6.0 on MS-AX and lands in x[95,120] z[88,100] y[3.4,3.7] (the dock roof) |

NPC SAM at (50, 27, 0.8), talk trigger radius 2 m (roll into it; dialog box in the HUD; opens again on every re-entry, REQ-NPC-02, CR-23):
"Hey, I lost my laptop. It's got all my code on it. Grab it before the demo."
Splash on pickup: `SECRET LAPTOP` (parody: `NORTH STAR LAPTOP`). Toast: "Nice. Don't open README.md."

**Goals (Market Street)**: a goal that references an element counts when the combo containing that element banks.

| # | Goal | Completion condition |
|---|---|---|
| 1 | High Score | run score >= 15,000 at run end |
| 2 | Pro Score | run score >= 40,000 at run end |
| 3 | Sick Score | run score >= 80,000 at run end |
| 4 | High Combo | any banked FINAL >= 10,000 |
| 5 | C-O-D-E | all four letters collected within one run |
| 6 | Secret Laptop | `secret_laptop` collected (any run) |
| 7 | Grind the Bus Stop Bar | gap MS-G07 in a banked combo |
| 8 | Transfer the Billboard Gap | gap MS-G10 in a banked combo |
| 9 | Manual the Crosswalk | gap MS-G06 in a banked combo |
| 10 | 5,000 over the fountain | a banked combo with FINAL >= 5,000 during which the skater contacted MS-F1's face or earned MS-G04 |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-STR-01 | Market Street is built from data exactly as the feature and rail tables above (positions within 0.05 m). | §9.2 | levels.test: spot-check 12 coordinates |
| REQ-STR-02 | The four lines are skateable as described: each line's rail feeds are within 3.5 m / 1.2 m / 0.5 m lateral or bridged by a flat roll, and the P3 -> R7 hop passes the REQ-LVL-10 simulation at 6.0 m/s with a full ollie. | §9.2 | levels.test: feed distances and hop simulation; e2e scripted line 1 |
| REQ-STR-03 | Letters and the Laptop at the listed coordinates; the Laptop fails the max-ollie check at spawn and the 12 spawnArea points. | §9.2 | levels.test "MacGuffin not spawn-ollie reachable" |
| REQ-STR-04 | The 12 named gaps with the listed conditions and bases; each gap is a start/end trigger pair or an element-sequence rule. | §9.2 | levels.test, scoring.test |
| REQ-STR-05 | SAM at (50, 27, 0.8) with a 2 m trigger, the line above (no em dash), splash and toast. | §9.2, AGENTS | levels.test: text has no U+2014 |
| REQ-STR-06 | The 10 goals with the listed conditions; 6 of 10 unlocks Woodshed. | §9.2 | goals.test |
| REQ-STR-07 | Street plays as a street park: 10 ledges (L1 to L8, R8, R9), 9 rails (R1, R2, R3, R4, R6, R7, P1, P2, P3), 5 copings (4 quarter-pipes + fountain rim), 1 fountain, 2 stair sets, 3 roof levels; no bowl, no spine, no full-pipe. | §19 "parks play identically" | levels.test: primitive census |

### G.2 WOODSHED (90 x 70 m, indoor wood park)

Spawn: (34, 64, 0) facing west (yaw toward -x; nothing stands in that direction for 34 m). spawnArea x[20,42] z[50,66] (clear of the booth, the quarter-pipes and the snake run). DARIO stands at (46, 65, 0) beside the contest booth.

```
        x:  0   6   12  18  24  30  36  42  48  54  60  66  72  78  84  90
            |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
  z=  0     ...............RRRR/PPPPPvbbbb      R = FB1 flat bar (47..56, z 8) / bank P = platform PL1 (58..70, z 2..14) v = euro gap b = bowl BW2 (80..88, z 2..18)
  z=  3     .C................/PPPPPvObbb       C letter (14, 5.6, 2.8); O letter (76.2, 8, 2.0)
  z=  6     .bbbbbbb........../PPPPP.vbbbb      b = bowl BW1 (4..24, z 6..26)
  z=  9     .bbbbbbb.........../PPPPLS.bbbb     L/S = hubbas HB1N/HB1S (x 70..74, z 8.0 and 12.6) and stairs ST1 (x 70..72.5, z 8.3..12.3)
  z= 12     .bbbbbbb.....^^^..................  ^ = spine SP1 (40..46, z 12..44)
  z= 15     .bbbbbbb.....^^^..................
  z= 18     .bbbbbbb.....^^^..................
  z= 21     .bbbbbbb.....^^^...........VVV      V = vert wall VW1 (foot x 81, coping x 84, z 22..48), deck behind
  z= 24     .bbbbbbb.....^^^...........VRV      R = over-vert rail OV (84.5, z 26..44)
  z= 27     .............^$^.OOOOOOOOOOVRV      O = full-pipe FP1 (x 50..76, z 26..34, R 4); $ = SECRET DRIVE (43, 28, 3.6)
  z= 30     .............^^^.OOOOOOOOOOVRV      D letter inside the pipe (60, 33.2, 6.5)
  z= 33     .............^^^.OOOOOOOOOOVRV
  z= 36     ..RRRRRRRr.rr^^^...........VRV      R = R-A (8..24, z 38), r = R-B (26.5..33, z 38.3)
  z= 39     .............^^^.nnnnnn..SSSVEV     n = RR2 centre rainbow (48..64, z 40); S = snake run SR1; E letter (84.5, 40, 4.9)
  z= 42     .............^^^.........SSSVRV
  z= 45     ..nnnnnnnnn..............SSSVRV     n = RR1 rainbow (7..31, z 45)
  z= 48     ..................hhh....SSS...     h = hump H1 (56..64, z 47..55)
  z= 51     ...LLLLL.RRRRR....hhh...SSS.......  L = R-E kink ledge (9..24, z 51); R = R-F booth rail (26.2..40, z 51.3)
  z= 54     ..................hhh..SSS........
  z= 57     .................SSSSS............  S = snake run west leg (52..64, z 60), open end ramps up over x 49..52
  z= 60     ..............TT..................  T = contest booth (44..48, z 60..64)
  z= 63     ...........*...N..................  * = spawn (34,64) facing west; N = DARIO (46,65)
  z= 66     .QQQQQQQQQRRRRRRRRRRQQQQQQQQQQ.     Q = Q-W1 (4..30, coping 2.0) / Q-E1 (60..88, coping 2.4); R = TR1 coping link (30..60, z 69.5)
  z= 69     .QQQQQQQQQRRRRRRRRRRQQQQQQQQQQ.
```

**Feature table**

| id | primitive | extent (x, z) | heights / dims | notes |
|---|---|---|---|---|
| WS-FL | ground | x[0,90] z[0,70] | y 0, maple plywood | walls at the boundary (h 12), ceiling trusses at y 12 |
| WS-BW1 | bowl | x[4,24] z[6,26] | depth 2.4, wall R 2.4 (vertical at the rim), corner R 3.0, floor x[6.4,21.6] z[8.4,23.6] at y -2.4 | pool coping rail WS-BW1-C |
| WS-RA | rail (round) | (8, 38) -> (24, 38) | y 0.55 | Long Bar |
| WS-RB | rail (round) | (26.5, 38.3) -> (33, 38.3) | y 1.2 -> 0.6 | Step-up Bar, slopes down east; 0.3 m lateral from RA's line |
| WS-RR1 | rainbow rail | (31, 45) -> (7, 45) | y 0.5 to 1.5 arc | Rainbow, 7 points; 6.9 m south of RA = one 180 deg manual turn at 7.5 m/s |
| WS-RE | ledge box | x[9,24] z[50.8,51.2] | top y 0.6 | Kink Ledge; 6.0 m south of RR1 = one 180 deg turn at 6.3 m/s |
| WS-RF | rail (round) | (26.2, 51.3) -> (40, 51.3) | y 0.9 -> 0.5 | Booth Rail; 0.3 m lateral from RE's line |
| WS-QW1 | qp | foot z 67.8, coping z 70, x[4,30], facing north | coping 2.0, R 2.2 | south-west quarter |
| WS-TR1 | rail (round, on the wall) | (30, 69.5, 2.0) -> (60, 69.5, 2.4) | | Coping Link, 30 m |
| WS-QE1 | qp | foot z 67.3, coping z 70, x[60,87], facing north | coping 2.4, R 2.7 | south-east quarter (span to 87, CR-59) |
| WS-QE1-END | box (deck) | x[87,90] z[67.3,70], y0 0, h 2.4 | maple | corner deck flush with the coping (CR-59) |
| WS-QW1-END | box (deck) | x[0,4] z[67.8,70], y0 0, h 2.0 | maple | corner deck flush with the coping (CR-59) |
| WS-VW1-N-END | box | x[89.4,90] z[19,22], h 3.6 | maple | closes the slot at the vert pocket end (CR-59) |
| WS-VW1-S-END | box | x[89.4,90] z[48,51], h 3.6 | maple | closes the slot at the vert pocket end (CR-59) |
| WS-SP1 | spine | west foot x 40.0, west coping x 42.7, east coping x 43.3, east foot x 46.0, z[12,44] | coping 2.4, R 2.7, deck gap 0.6 | both copings tagged transfer with transferPlane x 43.0; peak rail WS-SP1-P |
| WS-BT | box (booth) | x[44,48] z[60,64] | h 1.2 + canopy at 2.6 | contest booth with coffee |
| WS-FB1 | rail (round) | (47, 8) -> (56, 8) | y 0.55 | Street Flat Bar |
| WS-BK1 | bank | x[55.6,58] z[2,14] | y 0 -> 1.0, slope 22.6 deg | up onto PL1 |
| WS-PL1 | box (platform) | x[58,70] z[2,14] | top y 1.0 | street platform |
| WS-FB3 | rail (round) | (59, 8) -> (69, 8) | y 1.55 | Platform Bar |
| WS-ST1 | stairs | x[70,72.5] z[8.3,12.3] | 5 steps, drop 1.0 | down eastward; placed so the north hubba rail lies on the WS-FB3 line z 8 |
| WS-HB1N / WS-HB1S | hubba | x[70,74] at z[7.8,8.2] and z[12.4,12.8] | top y 1.4 -> 0.4 over x[70,72.5], flat to x 74 | rails below |
| WS-EG1 | channel (euro gap) | x[75,77.4] z[2,14] | floor y -0.6, 45 deg banks 0.6 m | jump it |
| WS-BW2 | bowl | x[80,88] z[2,18] | depth 2.0, wall R 2.0, corner R 2.0 | East Bowl; coping WS-BW2-C |
| WS-FP1 | fullpipe | axis (50, 30, 4.0) -> (76, 30, 4.0) | R 4.0, open both ends, floor tangent at y 0 | wall tagged transition; letter D inside |
| WS-VW1 | qp (vert) | foot x 81, coping x 84, z[22,48], facing west | coping 3.6, R 3.0 + vertical ext 0.6 | deck x[84,90] at y 3.6; coping tagged transfer, transferPlane x 84 |
| WS-OV | rail (round) | (84.5, 26, 4.0) -> (84.5, 44, 4.0) | 0.4 above the deck, 0.5 m behind the coping | Over-vert Rail: the mirrored transfer descent passes 0.2 m from it |
| WS-RR2 | rainbow rail | (48, 40, 0.5) (52, 40, 1.15) (56, 40, 1.5) (60, 40, 1.15) (64, 40, 0.5) | | Centre Rainbow |
| WS-H1 | hump | x[56,64] z[47,55] | ridge along x at z 51, height 0.8, sine profile (max slope 17 deg, so a manual may cross it) | tagged transition; sits 1.5 m north of the snake run's inner rim at x 64 |
| WS-SR1 | channel (snake run) | centreline (76,40) (76,52) (64,60) (52,60); width 6 | floor y -1.2, wall R 1.5, wall height 1.2, rims at y 0 | open ends ramp up over 3 m (west end x[49,52]); rim rails WS-SR1-A / WS-SR1-B; ends 4 m east of the booth |

**Rail table**

| id | kind | points (x, z, y) | tags / name |
|---|---|---|---|
| WS-BW1-C | coping | (4,6,0) (24,6,0) (24,26,0) (4,26,0) (4,6,0) with corners rounded R 3 (4 points per corner) | Bowl Coping |
| WS-BW2-C | coping | (80,2,0) (88,2,0) (88,18,0) (80,18,0) (80,2,0) with corners rounded R 2 (4 points per corner, like BW1) | East Bowl Coping |
| WS-RA | rail | (8, 38, 0.55) (24, 38, 0.55) | Long Bar |
| WS-RB | rail | (26.5, 38.3, 1.2) (33, 38.3, 0.6) | Step-up Bar |
| WS-RR1 | rail | (31, 45, 0.5) (27, 45, 1.05) (23, 45, 1.4) (19, 45, 1.5) (15, 45, 1.4) (11, 45, 1.05) (7, 45, 0.5) | Rainbow |
| WS-RE | ledge | (9, 51, 0.6) (24, 51, 0.6) | Kink Ledge |
| WS-RF | rail | (26.2, 51.3, 0.9) (40, 51.3, 0.5) | Booth Rail |
| WS-QW1-C | coping | (4, 70, 2.0) (30, 70, 2.0) | SW Coping |
| WS-TR1 | rail | (30, 69.5, 2.0) (60, 69.5, 2.4) | Coping Link |
| WS-QE1-C | coping | (60, 70, 2.4) (87, 70, 2.4) | SE Coping |
| WS-SP1-W | coping | (42.7, 12, 2.4) (42.7, 44, 2.4) | tags [transfer]; Spine West |
| WS-SP1-E | coping | (43.3, 12, 2.4) (43.3, 44, 2.4) | tags [transfer]; Spine East |
| WS-SP1-P | rail | (43.0, 16, 2.75) (43.0, 40, 2.75) | Spine Peak Rail (Drive above its midpoint) |
| WS-FB1 | rail | (47, 8, 0.55) (56, 8, 0.55) | Street Flat Bar |
| WS-FB3 | rail | (59, 8, 1.55) (69, 8, 1.55) | Platform Bar |
| WS-PL1-N | ledge | (58, 2.2, 1.0) (70, 2.2, 1.0) | Platform North Edge |
| WS-PL1-S | ledge | (58, 13.8, 1.0) (70, 13.8, 1.0) | Platform South Edge |
| WS-HB1N | ledge | (70, 8.0, 1.4) (72.5, 8.0, 0.4) (74, 8.0, 0.4) | Hubba North |
| WS-HB1S | ledge | (70, 12.6, 1.4) (72.5, 12.6, 0.4) (74, 12.6, 0.4) | Hubba South |
| WS-VW1-C | coping | (84, 22, 3.6) (84, 48, 3.6) | tags [transfer]; Vert Coping |
| WS-OV | rail | (84.5, 26, 4.0) (84.5, 44, 4.0) | Over-vert Rail |
| WS-RR2 | rail | see feature table | Centre Rainbow |
| WS-SR1-A | coping | (79, 40, 0) (79, 52.6, 0) (65.6, 62.6, 0) (52, 62.6, 0) | Snake Run Outer Rim |
| WS-SR1-B | coping | (73, 40, 0) (73, 50.4, 0) (62.6, 57.4, 0) (52, 57.4, 0) | Snake Run Inner Rim |

**Rail network and the 20 s chain** (rails + manuals only; feeds within 3.5 m horizontal, 1.2 m up and 0.5 m lateral; manual turns at up to 120 deg/s: a 180 deg turn takes 1.5 s and spans 2r = 0.955 x v_avg, which is what sets the row spacing RA -> RR1 6.9 m and RR1 -> RE 6.0 m; the script may turn slower than the maximum, never faster). Speeds use rail friction 0.10 (ledge 0.30), the 0.35 g slope term, manual friction 0.35, landing x0.96, and snap speed = dot(v, tan3D):

| step | element | from -> to | length | est. time | speed after | trace |
|---|---|---|---|---|---|---|
| 1 | enter at the 7.7 m/s push ceiling, ollie onto WS-RA, 50-50 | (8,38) -> (24,38) | 16 m | 2.1 s | 7.5 | v^2 = 59.3 - 3.2 |
| 2 | tap to WS-RB (feed 2.5 m along, +0.65, 0.3 lateral), Smith | (26.5,38.3) -> (33,38.3) | 6.5 m | 0.85 s | 7.8 | snap while rising costs 0.2; slope 5.3 deg down adds 0.6 net |
| 3 | rail end, land at (34.6, 38.3) at 7.46, Up,Down manual, 180 deg right turn at 120 deg/s | half-circle to (34.6, 45.2) heading west, then 2.3 m straight | 10.8 + 2.3 m | 1.9 s | 6.9 | r shrinks 3.56 -> 3.3; eastmost x 38.2 + 0.35 capsule clears the spine foot (x 40.0) by 1.5 m; lateral to RR1 0.2 |
| 4 | tap onto WS-RR1 (rail y 0.5), 5-0, switch to Feeble at the peak | (31,45) -> (7,45) | 24 m | 3.6 s | 6.6 | peak speed 5.6; the two arcs cancel; RAINBOW counts across the switch (same rail id) |
| 5 | rail end, land at (5.85, 45) at 6.28, Down,Up nose manual, 180 deg left turn | half-circle to (5.85, 50.7) heading east, then 3 m straight | 9.0 + 3 m | 2.0 s | 5.7 | westmost x 2.98, capsule 2.63 from the wall at x 0; lateral to RE 0.3 |
| 6 | tap onto WS-RE, Crooked | (9,51) -> (24,51) | 15 m | 2.8 s | 4.9 | ledge friction 0.30 |
| 7 | tap to WS-RF (feed 2.2 m, +0.3, 0.3 lateral), Boardslide | (26.2,51.3) -> (40,51.3) | 13.8 m | 2.7 s | 5.2 | 1.7 deg downhill nets +0.12 |
| 8 | rail end, land at (41, 51.3) at 5.0, Up,Down manual east along z 51.3 | (41, 51.3) -> (55, 51.3) | 14 m | 3.1 s | 4.0 | stops 1 m short of the hump (x 56); ollie, land, bank |
| | total | | | 19.1 s on linkers + 2.2 s of airs = 21.3 s from the first snap to the bank | | 8 linkers + 1 switch + gap RAINBOW = 10 elements |

Score estimate for the chain: bases 100 + 180 + 50 + 150 + 160 + 50 + 160 + 120 + 50 = 1020; gap 350; accruals RA 2.1 x 80 = 168, RB 0.85 x 90 = 77, manual 1.9 x 40 = 76, 5-0 1.8 x 90 = 162, Feeble 1.8 x 90 = 162, nose manual 2.0 x 40 = 80, Crooked 2.8 x 90 = 252, Boardslide 2.7 x 90 = 243, manual 3.1 x 40 = 124, total 1344: COMBO_BASE about 2,714 x 10 = 27,140. Clears High Combo 15,000 with margin. Balance at 9 prior elements on the last manual: k = 0.5 x 2.08 = 1.04 against input 2.0: holdable; the longest single needle run is 1.8 s (each half of the rainbow) against a 1.35 s hands-off bail at k 1.1, so the script must hold the stick, which is the point.

Other feeds (along, up, lateral): WS-FB1 end (56, 8, 0.55) -> WS-FB3 start (59, 8, 1.55): 3.0 m, +1.0, 0. WS-FB3 end (69, 8, 1.55) -> WS-HB1N start (70, 8, 1.4): 1.0 m, -0.15, 0 (the hubba rail lies on the bar's line). WS-QW1-C end -> WS-TR1: 0, 0, 0.5 lateral. WS-TR1 end -> WS-QE1-C: 0, 0, 0.5 lateral. WS-VW1-C -> WS-OV: 0, +0.4, 0.5 lateral (reached from the mirrored transfer air, REQ-VRT-08, or by a ground snap from the deck: distance 0.45 m, rise 0.4). WS-SP1-W/E -> WS-SP1-P: 0, +0.35, 0.3 lateral.

**Lines**

| # | Letter | Sequence |
|---|---|---|
| 1 | C | drop into WS-BW1 from the south rim (DROP_IN), pump two walls (Cross held on the way down), air the north wall (letter C at (14, 5.6, 2.8), Tailgrab), carve out over the east rim heading east (BOWL_CARVE_OUT) -> roll to the spine west face (foot x 40) -> air, R2 (SPINE_TRANSFER) -> land on the east face, R2 revert, Up,Down manual east -> ollie onto WS-RR2 (Nosegrind, CENTER_RAINBOW) -> land, manual south around the hump -> WS-QE1 (air, Stalefish, R2 revert) -> manual. |
| 2 | O | from (40, 8) east: ollie onto WS-FB1 (50-50) -> hop to WS-FB3 on the platform (Smith) -> hop straight ahead onto WS-HB1N hubba (5-0, HUBBA_DROP; feed 1.0 m, -0.15, 0 lateral) -> land at (75, 8), full ollie over the euro gap (EURO_GAP, letter O at (76.2, 8, 2.0) on the line, Kickflip) -> land (78, 8) -> roll into WS-BW2 (DROP_IN) -> air, revert, manual. |
| 3 | D | from the spine east side at (48, 30) east into WS-FP1 at 10+ m/s (two pumped walls): up the south wall past the 4.0 m line (letter D at (60, 33.2, 6.5) with a Melon, needs 9.5 m/s with a tap; PIPE_HIGH_AIR needs 11 m/s with a tap or 10.2 m/s with a full pop) -> land on the lower wall (slope 25 to 30 deg, counts as flat) into an Up,Down manual out of the east mouth (76, 30) -> turn south into WS-SR1 -> ollie onto WS-SR1-A rim (Boardslide, SNAKE_BITE) -> drop into the run, pump the bends -> exit west over the ramp at (50, 60) -> manual to spawn. |
| 4 | E | WS-FP1 east mouth (76, 30) east at 9+ m/s -> up WS-VW1 (vert, 3.6 m) -> R2 within 1.5 m above the coping (OVER_THE_VERT: the mirror puts the skater over the deck) -> Triangle in the same air snaps WS-OV (Feeble, letter E at (84.5, 40, 4.9)) -> hop back over the coping (Triangle: coping grind on WS-VW1-C or drop in) -> land on the vert face, R2 revert, Up,Down manual west -> spine east face -> air, R2 transfer (SECRET DRIVE at (43, 28, 5.5): collected only in a transfer air, CR-40 and polish round 2 in L) -> Triangle onto WS-SP1-P. |

Letters: C (14, 5.6, 2.8), O (76.2, 8, 2.0), D (60, 33.2, 6.5), E (84.5, 40, 4.9). Letter D trace (REQ-VRT-11): at 11 m/s with a tap the apex feet position is (33.17, 5.9), collect point (33.17, 6.8), 0.3 m from D; at 9.5 m/s with a tap the collect point passes 0.82 m from it. MacGuffin `secret_drive` at (43.0, 28, 3.6) above the spine peak rail: 3.6 m above the floor, needs a spine air plus Triangle (or a transfer); a max ollie from any spawnArea point reaches y 2.5 with the 0.9 reach.

**Named gaps (Woodshed)**

| id | name (splash) | base | condition |
|---|---|---|---|
| WS-G01 | SPINE TRANSFER | 500 | transfer event on WS-SP1-W or WS-SP1-E |
| WS-G02 | BOWL CARVE-OUT | 300 | Air leaving WS-BW1's wall and landing outside x[4,24] z[6,26] at y >= -0.1 |
| WS-G03 | EURO GAP | 400 | Air from x <= 75, z[2,14], y >= -0.1 to a landing at x >= 77.4, z[2,14] |
| WS-G04 | HUBBA DROP | 250 | consecutive grind elements on the same rail id (WS-HB1N or WS-HB1S) spanning x <= 70.5 to x >= 73 |
| WS-G05 | PIPE HIGH AIR | 600 | Air inside x[50,76] z[26,34] reaching feet y >= 5.5 and landing on WS-FP1 (needs 11 m/s with a tap or 10.2 m/s with a full pop) |
| WS-G06 | OVER THE VERT | 1200 | transfer event on WS-VW1-C followed by a landing at x >= 84, y >= 3.5 or a grind on WS-OV |
| WS-G07 | DROP-IN | 200 | Air starting on WS-FL (the floor) and landing at x[4,88] z[2,26], y <= -0.7 (inside a bowl, wall or floor; CR-60) |
| WS-G08 | RAINBOW | 350 | consecutive grind elements on WS-RR1 (switches allowed) spanning x >= 29 to x <= 9 or the reverse |
| WS-G09 | CENTER RAINBOW | 350 | consecutive grind elements on WS-RR2 spanning x <= 50 to x >= 62 or the reverse (CR-61) |
| WS-G10 | COPING LINK | 700 | consecutive grind elements on WS-TR1 with summed along-rail distance >= 24 m |
| WS-G11 | HUMP AIR | 200 | Air within x[56,64] from z <= 47 to z >= 55 or the reverse |
| WS-G12 | SNAKE BITE | 450 | consecutive grind elements on WS-SR1-A or on WS-SR1-B with summed along-rail distance >= 10 m |

NPC DARIO at (46, 65, 0), trigger 2 m, holding coffee: "The next model is on this hard drive. Please get it before anyone else does."
Splash: `SECRET DRIVE` (parody: `CANTICLE WEIGHTS DRIVE`). Toast: "Thank you. Do not inference this."

**Goals (Woodshed)**

| # | Goal | Completion condition |
|---|---|---|
| 1 | High Score | run score >= 25,000 |
| 2 | Pro Score | run score >= 60,000 |
| 3 | Sick Score | run score >= 120,000 |
| 4 | High Combo | any banked FINAL >= 15,000 |
| 5 | C-O-D-E | all four letters in one run |
| 6 | Secret Drive | `secret_drive` collected |
| 7 | Spine Transfer the Center | gap WS-G01 in a banked combo |
| 8 | Grind the Rainbow | gap WS-G08 in a banked combo |
| 9 | Hold a 3-second special | a special element (gpu_slide, context_window or inference_900ms) held >= 3.0 presentation seconds, in a banked combo |
| 10 | 2 revert-manuals in one combo | a banked combo containing at least two occurrences of an element of category revert immediately followed by an element of category manual (any id: manual, nose_manual, switch_manual, switch_nose_manual; the first revert makes the stance switch, so matching on id would never fire) |

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-WSH-01 | Woodshed is built from data exactly as the feature and rail tables above. | §9.2 | levels.test |
| REQ-WSH-02 | Rail spacing: every listed feed is within 3.5 m horizontal, 1.2 m up and 0.5 m lateral (WS-RA->RB, WS-RE->RF, FB1->FB3, FB3->HB1N, QW1-C->TR1, TR1->QE1-C, VW1-C->OV, SP1-W/E->SP1-P) and passes the REQ-LVL-10 hop simulation. | §9.2 | levels.test "Woodshed rail spacing" |
| REQ-WSH-03 | The 20 s chain in the table is holdable by a scripted competent input (balance held at the needle sign, manual turns at <= 120 deg/s), lasts >= 20.0 s from the first snap to the bank, and banks >= 15,000. | §9.2, §19 | e2e "woodshed rail chain" with scripted input asserts duration and score; smoke-test note |
| REQ-WSH-04 | Spine transfer works on WS-SP1 from both sides and on WS-VW1 onto the deck. | §9.2 | e2e scripted transfer; stateMachine.test |
| REQ-WSH-05 | Letters and the Drive at the listed coordinates; the Drive fails the max-ollie check at spawn and the 12 spawnArea points; each letter is collectable by the launch table from its nearest feature at the stated speed. | §9.2 | levels.test: MacGuffin unreachable; letter reach simulation |
| REQ-WSH-06 | The 12 gaps, DARIO, splash and toast, the 10 goals as listed. | §9.2 | levels.test, goals.test |
| REQ-WSH-07 | Woodshed plays as a transition park: 2 bowls, 1 spine, 1 full-pipe, 1 vert wall, 2 quarter-pipes, 1 snake run, 1 hump, 2 rainbow rails; no stairs longer than 5 steps, no roof levels. | §19 | levels.test: primitive census differs from Street |

### G.3 Level format, builder, validation, goals, NPC requirements

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-LVL-01 | Levels are TypeScript data in `src/levels/*.ts` with the schema at the top of section G; the builder produces meshes, BVH colliders, rail splines, trigger volumes and decals from that single source. | §9.2 | levels.test |
| REQ-LVL-02 | Rails are explicit polylines `{id, points, kind, tags?, name?}`; kinds rail / ledge / coping; tags include `transfer`. | §9.2 | levels.test |
| REQ-LVL-03 | Validation: every eligible grind line has a rail within 0.1 m. Eligible lines are (a) the coping line of every qp, bowl, spine, fountain and channel primitive, (b) the top centreline of every ledge and hubba primitive (one grind line per ledge: every authored ledge is at most 0.8 m wide, so the centre rail is within 0.4 m of either edge and inside the 0.55 m magnet from both sides; MS-L3 z 39.6 in z[39.2,40], MS-L1 x 41.6 in x[41.4,41.8]), (c) every convex horizontal top edge segment a box marks grindable: true (MS-T2's two step segments MS-L7, MS-L8); plain boxes (towers, walls, blocks, booth, platform) are exempt. | §9.2 | levels.test "rail coverage": fails when MS-L7 is removed, passes with the towers |
| REQ-LVL-04 | Validation: no decal quad overlaps a rail within 0.15 m. | §9.2 | levels.test "decals off rails" |
| REQ-LVL-05 | Validation: a simulated straight-up max ollie (1.6 m + 0.9 m reach) at spawn and at a 3 x 4 grid of 12 points over the level's declared spawnArea rectangle (Street x[20,84] z[20,88]; Woodshed x[20,42] z[50,66]) must fail to collect the MacGuffin. | §9.2 | levels.test "MacGuffin unreachable" |
| REQ-LVL-06 | Validation: every listed feed (Woodshed per REQ-WSH-02, Street scaffold per G.1) is <= 3.5 m horizontal, <= 1.2 m up and <= 0.5 m lateral between the exit tangent line and the next rail's start. | §9.2 | levels.test |
| REQ-LVL-07 | Named gaps are data: `{id, name, base, rule}` where rule is one of `airBoxToBox`, `grindSpan`, `grindDistance`, `grindSequence`, `transferOn`, `manualSpan`, `airApexIn`, `surfaceAzimuth`, `dropIn`; the sim evaluates rules from element events and box tests only. | §9.2 | scoring.test: one test per rule kind |
| REQ-LVL-08 | Trigger volumes for letters (0.9 m collect radius) and NPC talk (2.0 m). | §9.2 | levels.test |
| REQ-LVL-09 | Every rideable curved surface primitive is tagged transition by the builder; boxes and banks are not. | mine | levels.test |
| REQ-LVL-10 | Validation: levels.test simulates each listed feed as a straight-line hop (no air steer) at the recorded exit speed with a full ollie and asserts that the next rail's segment lies within GRIND_MAGNET_RADIUS_M at some tick of the hop. | mine | levels.test "feed hop simulation": P3 -> R7 passes at 6.0 m/s, fails if R7 is moved to x 104.6 |
| REQ-LVL-11 | Rail and coping pipe meshes are excluded from the movement BVH; the builder emits four boundary walls (h 12) at the size rectangle for every level. | mine | levels.test: a ray through a flat bar at ground level hits nothing; the boundary is closed |
| REQ-LVL-12 | No rail end lies within 0.5 m of a wall along its exit tangent. | mine | levels.test "no rail ends at a wall" |
| REQ-GOL-01 | Career runs are 2:00 (RUN_LENGTH_S 120), the default session; Free Skate has no clock (CR-42). | §2, §19 | goals.test, e2e |
| REQ-GOL-02 | Ten goals per park with the exact conditions listed; goal state persists per career; goals referencing elements count on bank. | §9.2 | goals.test |
| REQ-GOL-03 | Woodshed unlocks at 6 completed Street goals. | §9.2 | goals.test |
| REQ-GOL-04 | Both MacGuffins collected -> Lab Circuit stamp on the main menu. | §9.2 | goals.test, e2e |
| REQ-GOL-05 | Letters reset per run; C-O-D-E requires all four in one run; the HUD tray shows collected letters. | §9.2 | goals.test |
| REQ-GOL-06 | At 0:00 the clock freezes; a live combo may still bank; the results card follows. | §15 | stateMachine.test row 40 |
| REQ-GOL-07 | Results card shows score, best combo, goals completed this run, nearest uncompleted goal with distance, Retry and Park select; Retry is one press. | §14-B | e2e |
| REQ-NPC-01 | NPCs are primitive-built low-poly figures with no facial likeness; SAM: hoodie, empty laptop sleeve; DARIO: contest jacket, coffee cup. | §9.2, §11 | screenshot review |
| REQ-NPC-02 | Talk trigger: rolling within 2 m opens the dialog box in the HUD with the NPC line; closes after 4 s or on any confirm button; repeats after leaving the trigger. | §9.2 | e2e |
| REQ-NPC-03 | NPC names and lines read from `src/data/brands.ts` for the parody/real switch (Sam / Dario stay; titles differ). | §11 | brands.test |
| REQ-NPC-04 | No em dashes in any NPC line, toast or splash. | AGENTS | levels.test: text scan |

---

## H. Board Lab and main menu wireframes (REQ-HUD, REQ-MNU, REQ-LAB)

### H.1 Main menu
```
+--------------------------------------------------------------------------+
|  [animated park flythrough: Street at dusk, camera on a 40 s spline]     |
|                                                                          |
|      CODE SKATER                                    [LAB CIRCUIT stamp]  |
|      Compile the line. Fetch the drive.              (only when both     |
|                                                       MacGuffins held)   |
|         > CAREER                                                         |
|           FREE SKATE                                                     |
|           BOARD LAB                                                      |
|           OPTIONS                                                        |
|           CREDITS                                                        |
|                                                                          |
|  (A) Select   (B) Back                          v0.1  parody build       |
+--------------------------------------------------------------------------+
```
Career -> park select (Street; Woodshed locked with "6 of 10 Street goals" until unlocked) -> goal list with checkmarks -> Start run. Free Skate -> park select (both if unlocked) -> an untimed run without goal toasts (CR-42); Quit to menu keeps its MacGuffin and best scores. Options: Quality (Low/Med/High/Ultra/Auto), Music volume, SFX volume, Load music folder, Controls (view only, glyphs per pad), Reset career (confirm). Credits: plain text.

### H.2 HUD (in run)
```
+--------------------------------------------------------------------------+
| SCORE 46,600                     1:23                    C O D E         |
|                                (red pulse < 0:10)      [tray, dim = missing]
|                                                                          |
|   [goal peek: last done / next]                                          |
|                     (balance arc over the head in grind/lip)             |
|                              o                                           |
|                     [vertical bar beside the skater in manual]           |
|                                                                          |
|                         SICK / OK / INSANE  (land text, 0.6 s)           |
|                         BILLBOARD GAP  +1000  (gap splash, 1.2 s)        |
|                                                                          |
| 50-50 + Smith + Kickflip + Revert + Manual          1,644 x 9.5          |
| [special bar ############------]   (gradient + glow when full)           |
+--------------------------------------------------------------------------+
   SECRET LAPTOP  <- full-width splash, 1.5 s, screen flash, 60 ms hitstop
   [dialog box bottom-left when in an NPC trigger: name + line, 4 s]
```

### H.3 Board Lab
```
+--------------------------------------------------------------------------+
|  BOARD LAB                        [3D board on a turntable, 12 deg/s,   |
|                                    right stick spins, A flips top/bottom]|
|  > DECK GRAPHIC   [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ]   procedural sheets      |
|    GRIP           [black][gray][clear][die-cut]                          |
|    TRUCKS         [raw][black][gold][red]                                |
|    WHEELS         [white 99a][blue 101a][green 97a][orange 99a]          |
|    STICKERS       [sheet: North Star | Canticle | Vidia | wafer | PCB |  |
|                    token-stream | inference ]  drag to place, up to 6    |
|                                                                          |
|  (A) Pick  (B) Back  (X) Remove sticker  (Y) Random                      |
+--------------------------------------------------------------------------+
```

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-HUD-01 | HUD shows: clock (top centre, red pulse under 0:10), run score, combo ticker (names joined by " + ", live base x multiplier), special bar (animated gradient when full), balance meter (arc for grind/lip, vertical bar for manual), land text, gap splashes, MacGuffin full-width splash, goal peek, letter tray. | §17 | hud.test (DOM), e2e screenshot |
| REQ-HUD-02 | The HUD is a DOM/CSS overlay over the canvas, reads a read-only view of the sim, and never writes sim state. | §4 | grep test |
| REQ-HUD-03 | Combo ticker updates within one render frame of an element being added; the running total shows COMBO_BASE x MULTIPLIER as integers. | §17 | hud.test |
| REQ-HUD-04 | Land text: clean shows nothing, OK shows "OK", SICK / INSANE per thresholds, shown 0.6 s. Gap splash 1.2 s with "+base". | §6, §17 | hud.test |
| REQ-HUD-05 | Button glyphs in HUD hints and menus follow the detected pad (REQ-INP-06). | §5 | e2e |
| REQ-HUD-06 | No em dashes in any HUD string; system font stack only. | AGENTS | text scan test |
| REQ-MNU-01 | Main menu: Title with the animated park flythrough, Career, Free Skate, Board Lab, Options, Credits; Lab Circuit stamp when both MacGuffins are collected. | §17 | e2e screenshot "menu" |
| REQ-MNU-02 | Every menu is fully navigable with D-pad/stick + confirm (Cross/A) + back (Circle/B); keyboard mirrors with arrows/Enter/Esc. | §17, §19 | e2e: scripted pad input reaches every screen |
| REQ-MNU-03 | Pause (Options/Menu/Esc) freezes the sim, shows the goal list with completion state, Resume, Restart run, Options, Quit to menu. | §5, §17 | e2e |
| REQ-MNU-04 | Options: quality preset, music and SFX volume, load-own-music folder picker (files never bundled), controls view, Reset career with confirmation. | §15, §17 | e2e |
| REQ-MNU-05 | Menus are code-split from the game bundle (separate chunk). | §12 | build size test |
| REQ-MNU-06 | Results card after each run per REQ-GOL-07. | §14-B | e2e |
| REQ-LAB-01 | Board Lab: 3D board on a turntable; tabs Deck Graphic, Grip, Trucks (colour), Wheels (colour and durometer label), Underside Stickers (drag or D-pad place up to 6 from sheets: brand sheets via the brand table plus wafer, PCB, token-stream, inference). | §17 | e2e screenshot "board lab" |
| REQ-LAB-02 | All Lab art is procedural CanvasTexture; selections persist in localStorage and appear on the in-game board (top = grip, bottom = graphic + stickers). | §17, §10 | e2e, save.test |
| REQ-LAB-03 | Sticker placement is controller-complete: a cursor moved by the stick, place with confirm, remove with X/Square. | §19 | e2e pad script |

---

## I. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Grind snap feels loose or misses visible edges (quality gate) | Med | High | Rail entries are generated with the mesh (REQ-GRD-01) and validated (REQ-LVL-03); magnet 0.55 m with a scored candidate pick; a scripted e2e grinds a known rail. |
| 2 | Vert air feels wrong (fly-off or no height) | Med | High | Transition gravity factor + vert assist + the air table in C.6 with numeric tests (REQ-CTL-11, REQ-VRT-01); tunables live on the dev panel. |
| 3 | Balance too easy (infinite combos) or too hard (20 s chain impossible) | Med | High | k0 / input numbers chosen for the chain (D.4 feel check); e2e "woodshed rail chain" with scripted input is the pass bar (REQ-WSH-03). |
| 4 | Input arbitration bugs: specials trigger manuals or grind switches | Med | High | Deterministic priority parser (C.3) with table-driven tests for CR-11/CR-12 (REQ-INP-10 to 14). |
| 5 | Frame-rate dependence creeping in (windows measured in render frames) | Low | High | All windows in ticks (REQ-TIM-03), loop test with random dt, grep test for wall-clock in src/sim. |
| 6 | Bundle over 1.5 MB gzip or slow first load | Med | Med | Code-split menus, tree-shaken three.js, no assets; size check in CI (REQ-DEP-04). |
| 7 | Headless WebGL (SwiftShader) too slow or black for screenshots | Med | Med | Low preset auto-selected under SwiftShader; screenshots reviewed by eye; e2e asserts only console cleanliness and banked score. |
| 8 | Brand or likeness leak in the public build | Low | High | Names only in `src/data/brands.ts`; build-time mode default parody; a test scans the built bundle for the real names and the forbidden THPS terms (REQ-BRD-04). |

---

## J. Build plan

### J.1 Milestones (SPEC §16) and what is testable at each

| # | Milestone | Testable when done |
|---|---|---|
| M0 | Scaffold: Vite + TS strict + three + postprocessing + vitest + playwright, lint, `tuning.ts` with TUNING_META, fixed-tick loop | blank scene renders; `npm test` runs; loop.test (REQ-TIM-01, 04); tuning.test (REQ-TIM-05) |
| M1 | Input layer (gamepad + keyboard, Dir8, buffers, parser) + dev overlay of raw/parsed input | input.test: REQ-INP-02 to 07, 10 to 16 |
| M2 | Pure state machine + scoring + degradation + special meter + balance | stateMachine.test (all rows), scoring.test (worked example 15504), special.test, balance.test |
| M3 | Kinematic controller: ground, transitions, vert assist, landing checks, bail; test box level | controller.test: REQ-CTL-*, REQ-VRT-01/02/05; can skate, ollie, land, bail in the dev level |
| M4 | Rails: data format, magnet, types, switching, ends, sparks; manual + revert wiring | grind.test, lip.test; e2e: grind -> manual -> revert combo in the test level |
| M5 | Market Street from data + validation + letters + SAM + Laptop + gaps + goals | levels.test (Street), goals.test; e2e line 1 scripted |
| M6 | Woodshed + spine transfer + lips + DARIO + Drive + goals; 20 s rail chain check | levels.test (Woodshed spacing), e2e "woodshed rail chain" |
| M7 | Rendering: materials, lighting, shadows, post, skater rig + poses, FX, camera polish, quality presets | screenshots (menu, Street spawn, Street mid-grind, Woodshed bowl, Board Lab) reviewed by eye |
| M8 | HUD, main menu, career, Board Lab, pause/goals, Options, synthesized audio | e2e: full loop title -> run -> results -> Lab Circuit stamp with scripted pad input |
| M9 | Deploy config, `DEPLOY.md`, parody build check, bundle-size check, final smoke | `npm run build` output served statically with no console errors; size test; brand scan |

Budget order if short: M2 -> M4 -> M5 -> M7 -> M6 -> M8.

### J.2 Presentation and platform requirements (owned by M7 to M9)

| ID | Requirement | SPEC | Verify |
|---|---|---|---|
| REQ-REN-01 | `WebGLRenderer` with outputColorSpace SRGB, toneMapping AgX (fallback ACESFilmic), exposure tunable (RENDER_EXPOSURE 1.0, 0.5 to 2.0). | §10 | render.test (unit on config), screenshot |
| REQ-REN-02 | IBL: PMREM from the three `Sky` shader (Street, sun elevation 18 deg, late afternoon) and `RoomEnvironment` plus a warm fill (Woodshed). | §10 | screenshot |
| REQ-REN-03 | One directional sun with a 2048^2 PCFSoft shadow map whose ortho frustum (30 m box) follows the skater and is texel-snapped; vertex-colour fake AO on level primitives. | §10 | screenshot; render.test: frustum centre tracks the skater |
| REQ-REN-04 | Post chain: AO -> bloom (threshold 0.9, only emissive) -> SMAA -> vignette (0.25) -> chromatic aberration (0.002, only while glowing). AO pass = N8AO (n8ao package) at Med and above; if N8AO throws at init the chain falls back to postprocessing SSAO and logs one console.warn; Low disables AO. | §10 | render.test: pass order; the SSAO fallback case |
| REQ-REN-05 | Quality presets Low/Med/High/Ultra: shadow 1024/2048/2048/4096, AO off/on/on/on, pixel ratio cap 1.0/1.25/1.5/2.0, bloom off/on/on/on; auto-picked by a 2 s FPS probe on first load (>= 55 fps Ultra, >= 45 High, >= 30 Med, else Low). | §10 | quality.test |
| REQ-REN-06 | Targets: 60 fps at 1080p on an RTX 3060 / M1 class at High; 30+ fps on integrated at Low. | §10 | manual measurement recorded in DEPLOY.md |
| REQ-REN-07 | Fill the window; resize handled; pixel ratio capped by preset. | §15 | e2e resize |
| REQ-MAT-01 | Maple plywood: Canvas2D grain (layered noise + ring stretch), seams every 2.4 m, clearcoat 0.3, roughness 0.45. | §10 | screenshot Woodshed |
| REQ-MAT-02 | Steel coping and rails: metalness 1, roughness 0.25, anisotropic streak normal map, emissive rim 0.05 on every rail and coping. | §10 | screenshot; materials.test: rail material emissive = 0.05 |
| REQ-MAT-03 | Concrete, marble (domain-warped veins), asphalt with the painted crosswalk, glass towers (high reflect, low roughness, env-mapped), scaffold pipes: all generated in `src/render/materials.ts`. | §10 | screenshot Street |
| REQ-MAT-04 | Sponsor signage: CanvasTexture wordmarks from the brand table in original typography; emissive neon boxes; never on rail or coping geometry (REQ-LVL-04). | §10, §11 | levels.test |
| REQ-MAT-05 | Zero downloaded assets: no network fetches at runtime, no CDN fonts; optional CC0 HDRIs only under `public/optional/` and never required. | §4 | build test: no external URLs in dist; e2e network log empty |
| REQ-SKT-01 | Procedural low-poly skater (2k to 4k tris) from capsules/boxes with a bone hierarchy (hips, spine, head, 2 arms, 2 legs), hoodie + cap + baggy pants, flat-shaded with rim light. | §10 | screenshot; skater.test: triangle count |
| REQ-SKT-02 | Board: concave extruded outline with kicks, trucks, wheels; top = Lab grip, bottom = Lab graphic and stickers. | §10 | screenshot Board Lab |
| REQ-SKT-03 | Pose library of at least 12 keyframed poses: push, crouch, pop, air-neutral, 8 grab poses, flip, 50-50, 5-0, nosegrind, boardslide, smith, feeble, manual lean, nose manual lean, lip stall, bail tumble, get-up; blended over 80 ms. | §10 | skater.test: every pose id resolves |
| REQ-SKT-04 | Board flip rotation axis per trick: kickflip/heelflip roll, shove-it yaw, impossible pitch wrap, varial = roll + yaw, hardflip = roll + pitch, 360 flip = roll + 360 yaw; the rotation completes exactly at animMs. | §10 | skater.test: axis table |
| REQ-SKT-05 | Auto-orientation (REQ-CTL-09) drives the rig root; spin drives yaw; the revert plays a 180 pivot over the window. | mine | skater.test |
| REQ-FX-01 | Grind sparks: GPU points, additive, gravity, 240 particles/s at the contact point, seeded. | §10 | screenshot mid-grind |
| REQ-FX-02 | Wheel dust on landing (burst of 24), speed lines + FOV kick above 85% vmax, board motion trail during specials, green ribbon along the rail for CUDA Slide, blue-screen texture on the deck during Kernel Panic, sticker particles for Token Overflow. | §10, §9.1 | screenshot; fx.test: triggers fire on events |
| REQ-FX-03 | MacGuffin pickup: screen flash 120 ms + 60 ms hitstop (render holds, sim pauses floor(60 x 120 / 1000) = 7 ticks) + rumble. | §10 | fx.test |
| REQ-FX-04 | Bail: camera shake (REQ-CAM-06) + medium rumble. | §10 | fx.test |
| REQ-AUD-01 | Web Audio only, everything synthesized: roll (filtered noise scaled by speed), push, pop, land thud, grind (band-passed noise + metallic partials, pitch by speed), spark ticks, bail crash, gap chime, letter ding, MacGuffin fanfare, menu blips. | §4, §15 | audio.test: every event has a synth voice; no audio files in dist |
| REQ-AUD-02 | Music: a synthesized Y2K breakbeat loop per park (94 BPM Street, 170 BPM Woodshed, CR-41; kick/snare/hat from oscillators + noise, bass and pad from oscillators), volume slider, optional player-chosen MP3 folder via the file picker (never bundled). | §15 | e2e: music toggles |
| REQ-AUD-03 | Audio starts only after the start gate (user gesture). | §12 | e2e |
| REQ-SAV-01 | Persistence in localStorage wrapped in try/catch: career goals, letters state per park (per run only), MacGuffins, best scores per park, Board Lab, options, quality preset; key `codeSkater.v1`. | §4, §15 | save.test: round trip; save.test: storage throwing does not crash |
| REQ-SAV-02 | Reset career clears everything except options and Board Lab. | §15 | save.test |
| REQ-SAV-03 | Save writes happen at run end, on menu changes and on Lab changes; never inside the sim tick. | mine | grep test |
| REQ-BRD-01 | `src/data/brands.ts` holds both tables and is the only file allowed to hold real company or person names; `BRANDS` is a ternary on the static `import.meta.env.VITE_BRAND_MODE` literal, so the parody build drops `realTable()` from the bundle (CR-21). | §11, AGENTS | brands.test: grep the tree; REQ-BRD-04 proves the drop |
| REQ-BRD-02 | Mode chosen at build time by `VITE_BRAND_MODE`, default `parody`; `npm run build:private` sets `real`. | §11 | build test |
| REQ-BRD-03 | No logo artwork in either mode; `real` uses plain-text names; `parody` uses original marks (North Star, Canticle, Vidia, VIDA Slide, North Star Laptop, Canticle Weights Drive). | §11 | screenshot review |
| REQ-BRD-04 | The public build's bundle contains none of: the real names, "Tony Hawk", "Neversoft", "Activision", "Warehouse", "School II", "The Hangar". | §1, §19 | build test scans dist |
| REQ-BRD-05 | NPCs never attempt a real likeness in either mode. | §11 | review |
| REQ-DEP-01 | `vite.config.ts` uses `base: "./"`; `npm run build` emits `dist/` that runs from any static subpath. | §12 | e2e against `vite preview` on a subpath |
| REQ-DEP-02 | `DEPLOY.md` gives copy-paste steps for GitHub Pages (`.github/workflows/deploy.yml` on push to main), Vercel/Netlify (preset Vite, output dist), itch.io (`npm run zip` -> `code-skater-web.zip`). | §12 | file exists; workflow lints |
| REQ-DEP-03 | First load: menus code-split from the game; first playable < 5 s on broadband. | §12 | manual timing in DEPLOY.md |
| REQ-DEP-04 | Total gzipped JS <= 1.5 MB, checked by a script in CI. | §12 | size test |
| REQ-DEP-05 | Start gate and controller disconnect handling (REQ-INP-08, 09). | §12 | e2e |
| REQ-DEP-06 | No console errors on load in the built output. | §19 | e2e smoke |
| REQ-DEP-07 | Dev tuning panel (~ / Share / View) exposes live sliders for every TUNING key with its range from TUNING_META; dev builds only expose `window.__codeSkater.debug` with unlockAll(), startFreeSkate(parkId), inject(inputScript) and readBanked(). | §1, §13 | e2e dev build |
| REQ-TST-01 | Vitest suites: scoring, stateMachine, input, balance, levels, plus loop, tuning, controller, grind, lip, special, goals, camera, save, brands, hud, tricks, rumble, render, quality, materials, skater, fx, audio and tests/grep; all run in node without WebGL. Suites that construct three.js materials, geometries or pass chains run with no renderer (three core is WebGL-free until render()); anything that needs a canvas belongs in e2e. | §13 | `npm test` |
| REQ-TST-02 | Playwright `e2e/smoke.spec.ts` with SwiftShader flags: boots to the menu with no console errors; calls debug.unlockAll() then starts Free Skate on both parks; scripted input ollies, grinds a known rail for 2 s and lands, asserting banked > 0; captures screenshots (menu, Street spawn, Street mid-grind, Woodshed bowl, Board Lab). | §13 | CI |
| REQ-TST-03 | Definition of done per milestone: `npm run typecheck && npm test && npm run build` pass. | §13 | CI |
| REQ-TST-04 | Source-grep tests strip comments before matching so an explanatory comment can never satisfy a rule. | AGENTS lessons | tests/grep.test self-check |
| REQ-TST-05 | The worked example (D.3) is stored as data in `tests/fixtures/workedExample.ts` and asserted to equal 15504. | §13 | scoring.test |

---

## K. Open questions (max 8, each with the default used)

| # | Question | Default used |
|---|---|---|
| 1 | Do hold accruals degrade with the trick, or only the base? | Only the base degrades (REQ-SCR-04); accruals reward long holds on tired types. |
| 2 | Special meter: fill per landed element or at bank? | Per completed element (REQ-SPC-01) so long lines can glow mid-combo. |
| 3 | CUDA Slide (500) and Context Window (1400) sit below the CR-09 floor of 1500. | Kept verbatim from SPEC §9.1 (holdables earn +150/s and +60/s); no change logged because the spec's table is explicit. |
| 4 | SPEC line 4 of Woodshed says "over-vert rail (Drive)" while the DARIO goal says "Secret Drive on spine-peak rail". | Drive on the spine-peak rail (WS-SP1-P); the over-vert rail carries letter E; line 4 ends at the spine. |
| 5 | Degradation count timing: at element creation or at bank? | At creation (REQ-DEG-04): simplest, deterministic, and a bailed attempt still tires the trick. |
| 6 | Does a goal that names a gap count when the gap is earned mid-combo but the combo bails? | No; goals count on bank (G.1 note). |
| 7 | "Hold a 3-second special": which specials qualify and which clock? | Any holdable special (gpu_slide, context_window, inference_900ms) held >= 3.0 presentation seconds. |
| 8 | Fakie and nollie variants: distinct trick IDs and a bonus? | Distinct IDs (own degradation), base x1.1 (NOLLIE_FAKIE_MULT), no stance change. |

---

## L. CHANGE-REQUEST log

Format: `CHANGE-REQUEST: <id> old -> new, reason`. CR-01 to CR-16 are the approved corrections in SPEC §3 and are applied throughout. New entries from this document:

- CHANGE-REQUEST: CR-17 SAM's line "Hey (em dash) I lost my laptop. It's got all my code on it. Grab it before the demo." -> "Hey, I lost my laptop. It's got all my code on it. Grab it before the demo.", reason: house rule, no em dashes in in-game copy (AGENTS.md).
- CHANGE-REQUEST: CR-18 SPEC §8 state list `Grounded, Crouch, Air, Grind, Lip, Manual, RevertWindow, Bail, GetUp` -> plus `LandWindow`, reason: SPEC §7 locks a 140 ms manual window "before or after contact" and a 180 ms revert window after a vert landing, and SPEC §6 says the combo dies in Grounded only "outside manual/revert windows"; a state table that banks on the contact tick makes the post-contact halves dead code and fails the §19 gate "vert landing cannot revert into a manual". LandWindow is that on-ground window made explicit (C.5); no timing value changed.
- CHANGE-REQUEST: CR-19 SWITCH_DRIFT_MULT 1.25 -> 1.35, reason: SPEC §15 gives the switch penalty as "-20% balance drift tolerance", whose literal value is tolerance x0.8 = drift x1.25. The REQ-BAL-01 needle is damped (BAL_DAMP 1.5), so x1.25 makes a hands-off manual from a 0.35 start bail after 2.22 s instead of 2.63 s, only 15.6% sooner; x1.35 gives 2.10 s, 20.0% sooner, which is the figure the spec names. Simulated with the REQ-BAL-01 tick rule at 120 Hz. If the founder prefers the literal ratio, set SWITCH_DRIFT_MULT 1.25 and relax the balance.test bound to 15%.

- CHANGE-REQUEST: CR-20 trick id of the special grind (D.2 "U,D + Triangle", display name from the brand table) -> `gpu_slide`, reason: its D.2 id spells the chip brand's platform mark, and AGENTS.md allows real names only in `src/data/brands.ts`; the display name still reads `BRANDS.specialSlideName` (VIDA Slide in parody). No value changed. (M0)
- CHANGE-REQUEST: CR-21 REQ-BRD-01 file split (`brands.real.ts` + `brands.parody.ts`) -> both tables inside `src/data/brands.ts`, reason: SPEC §11 and AGENTS.md name that single file as the only place real names may appear; the static `import.meta.env.VITE_BRAND_MODE` ternary still drops the real table from a parody build, proven on dist/ by `npm run check:parody` (and the private build fails that check, as it should). (M0)
- CHANGE-REQUEST: CR-22 SPEC §13 headless flag `--use-gl=swiftshader` -> `--use-gl=angle --use-angle=swiftshader` (plus `--enable-unsafe-swiftshader --ignore-gpu-blocklist`), reason: measured at M0 on Chromium 153, the old flag loses the WebGL context about a second after creation (black screenshots); ANGLE's SwiftShader backend is the same software renderer and stays up. (M0)
- CHANGE-REQUEST: CR-23 G.1 SAM talk trigger "once per run, always repeatable from the goal list" -> the dialog opens on every entry into the trigger (REQ-NPC-02 "repeats after leaving the trigger"), reason: the two lines disagreed; the REQ row is the testable one and SPEC §9.2 only says "talk by rolling into a 2 m trigger". The HUD owns closing (NPC_DIALOG_S or confirm). (M0 review)
- CHANGE-REQUEST: CR-24 C.5 row 11 combo "lives, +1 (gap Spine Transfer)" -> the row returns "lives" with no element; the +1 is the level's `transferOn` gap (WS-G01 on the spine, WS-G06 on WS-VW1-C) that src/sim/gaps.ts earns from the world's transfer feed, reason: the state table cannot know level gap ids, and two producers would add the element twice. Observable scoring is unchanged. (M0 review)
- CHANGE-REQUEST: CR-25 rows 40 / 41 "the run clock reaches 0:00" as a one-shot -> the world emits clockZero on the tick the clock reaches 0:00 and on every later tick until RunEnd; row 40 is idempotent, row 41 ends the run from Grounded and an implementation row ends it from Crouch; Bail and GetUp ignore it, so a combo lost at 0:00 ends the run after the get-up instead of never, reason: a one-shot event arriving in Bail, GetUp or Crouch matched no row and the run could not end. (M0 review)


### L.2 Change requests from the build tracks (written by integration at M5 to M8)

Each line is a track's submission, in the track's words where they were exact. "Applied" means the code implements it (the track did it in its own files, or integration did it at M8); where older text in this document disagrees, the line here wins. Superseded lines are kept so the history reads in order.

Logic track (M2):
- CHANGE-REQUEST: CR-26 REQ-BAL-01 formula `nv += (k x sign(needle) - input x 2.0) x dt` -> `nv += (k x sign(needle) + input x BAL_INPUT_ACCEL) x dt`, reason: REQ-BAL-03 says Left = input -1 pushes the needle negative (and Up pushes the nose down); the printed minus sign steered the stick into the lean. The D.4 hands-off numbers are unaffected. Applied (src/sim/balance.ts).
- CHANGE-REQUEST: CR-27 C.3 P8 and REQ-CTL-14 "S in {Grind, Manual, Lip} -> CROUCH_ON_LINKER" -> Grind and Manual only, reason: C.5 row 25 and the SmEvent contract make a Cross press in Lip exit the lip at once (REQ-LIP-03 fixed exit), not a charge. Applied.
- CHANGE-REQUEST: CR-28 D.3 row 4 element id `gap:PLAZA_BAR_HOP` -> `gap:MS-G03` (display name PLAZA BAR HOP), reason: element ids are `gap:<level gap id>` (GapElementId in src/core/types.ts); the fixture uses the id. Applied (tests/fixtures/workedExample.ts); FINAL is still 15504.

Sim track (M3, M4):
- CHANGE-REQUEST: CR-29 C.6 yaw off-axis "projected velocity < 0.5 m/s -> downhill direction (world -z on true flat)" -> "downhill direction on a slope; on true flat, the launch heading before spin", reason: with world -z an ollie in place facing east bailed (90 deg off-axis), and the Over the Vert deck landing always bailed. Applied (src/sim/controller.ts).
- CHANGE-REQUEST: CR-30 open, not applied: REQ-VRT-08 and E.9 disagree (the rule wants skater y minus rail y in [0, 1.5] but the trace presses R2 at the apex, 1.65 m above the coping at 11 m/s; at 11 m/s with no pop the transfer is unavailable from 0.27 s to 0.50 s). SPINE_TRANSFER_HEIGHT_M stays 1.5 (SPEC §9.2). If playtests find the window stingy: SPINE_TRANSFER_HEIGHT_M 1.5 -> 2.0 (inside its range), reason: the E.9 trace.
- ARCHITECTURE.md section 2 step 5: timerEvent() runs at the START of each tick, before parsing (otherwise every window was one tick long). Applied in ARCHITECTURE.md.

Skater track (M7):
- CHANGE-REQUEST: CR-31 REQ-SKT-04 hardflip "roll + pitch" -> "roll + frontside half yaw with a transient pitch wobble (0 at animMs)", reason: a half pitch turn lands the deck grip-down; the wobble keeps the vertical look. Applied (src/render/skater/poses.ts).

Render track (M7):
- CHANGE-REQUEST: CR-32 RAIL_EMISSIVE_RIM 0.05 -> 0.12, reason: at sun 14 the 0.05 rim is invisible against sunlit concrete. DECLINED: 0.05 is a SPEC §10 number, and the render polish made rails read another way (dark gunmetal bar, a fresnel edge gain RMAT_RAIL_RIM_GAIN, and a screen-thickness inflate so a rail never draws under 3.5 px); the M8 screenshots show rails as clear dark lines at 25 to 70 m. The key stays live on the dev panel (its range tops at 0.12) for a playtest call.
- CHANGE-REQUEST: CR-33 conditional, not applied: PIXEL_RATIO_CAPS High 1.5 -> 1.25, reason: only if a real RTX 3060 misses 60 fps at 1080p High (measured on an RTX 5070: High at 1.5x costs 5.5 ms a frame; projected about 14 ms on a 3060). Needs a real measurement (REQ-REN-06).

Street track (M5, Market Street geometry; each a fix found by building or by the street critic):
- CHANGE-REQUEST: CR-34 MS-B3 x[0,84] -> x[0,82]; MS-DP box y0 0 -> -1.2 (roof stays 3.5); MS-SB x[0,120] -> x[0,95]; plaza ground MS-T1 authored as x[0,86.7] z[40,86] + MS-T1E x[82,86.7] z[86,88] + a landing box MS-S2L x[38,54] z[86,88] (top y 0); MS-Q1-C z 118 -> 117.96, reasons: the street MS-ST is x[0,82] (a 1.2 m pit otherwise); the depot's west wall must reach the street floor; MS-SE already occupies x[95,120] z[100,120]; the strips beside the S2 stairs need a retaining wall; on z 118 the coping rail lay in the south block's wall plane and the REQ-LVL-11 buried-rail probe flagged it. Applied.
- CHANGE-REQUEST: CR-35 REQ-STR-01 MS-S1 x[42,50] -> x[41.8,50.2]; MS-L1 / MS-L2 yTop 1.2 -> 1.4 (rails to match); MS-EB z1 88 -> 80 plus ground MS-T1S x[86.7,88.5] z[80,88]; MS-Q2 span [46,70] -> [44,78] (MS-Q2-C and MS-R8 to match); MS-AX x0 104 -> 104.7 (ANNEX_FACE_X), MS-P1/P2/P3 x 103.9 -> 104.3, MS-R7 x 104.2 -> 104.8, MS-Q3 span [95,101] -> [95,104.1]; MS-L6 end z 85 -> 80; new MS-D2 dock step x[101,104.7] z[80,88] (1.1 m) with bank MS-D2B z[76,80]; new MS-Q5 mini quarter on the dock roof (facing north, foot z 98.2, coping z 100 y 5.0, span [96,118], R 1.8, rail MS-Q5-C); new MS-K1 kicker x[28,34] z[62,66] 0.6 m, MS-L3W, MS-L9, MS-L10, MS-L11, MS-R10 (41.6, z 49..57, y 0.6), MS-R11 (x 10..24, z 110, y 0.6), MS-R12 (x 105.5..118, z 87.8, y 6.3), MS-R13 (shelter roof ledge), MS-PL1..6 planter and prop ledges; MS-R2 z 86.5 -> 85.7; MS-R3 / MS-R4 x 39.6 / 52.4 -> 40.4 / 51.6; MS-Q1 span [30,62] -> [22,70], reasons (street critic): stair and hubba slits, the bus stop bar ran into the closet wall, the scaffold pipes sat 0.10 m off the wall (under the skater radius), the west half was dead flat, collidable props had edges with no rail, line 2 was infeasible and line 1 needed a 4.2 m sideways hop. Applied.
- CHANGE-REQUEST: CR-36 REQ-STR-03 letter D (52, 59.5, 2.9) -> (50.4, 60.9, 3.0) (on the fountain rim circle, 1.8 m over the coping), E x 103.9 -> 104.3, Secret Laptop x 104.2 -> 104.8; REQ-STR-05 SAM (50, 27, 0.8) facing south -> (47.5, 35, 0.8) facing north (beside the spawn lane, inside the 2 m trigger); REQ-STR-07 census 10 ledges / 9 rails / 5 copings -> 21 / 12 / 6, 5 quarter-pipes, 1 kicker; MS-G03's second step adds MS-R10; MS-G12 starts at x 104.7. Applied.
- CHANGE-REQUEST: CR-37 G.1 line prose: line 1 rides L1 -> R10 (the mirror of L2 -> R1; R1's exit runs into the fountain foot); line 2 pops Q3 at slope 40 deg with >= 7.5 m/s at the foot (STREET_Q3_POP_POINT, below the 45 deg VERT_POP_SCALE cliff), lands on the dock roof at z about 89, then Q5; "roll off the west edge to the plaza (y 0)" -> "4.7 m down to the street at (79, 94, -1.2)". The lines as data in src/levels/marketStreetLines.ts are the reference. Applied.

Woodshed track (M6 geometry; a later line supersedes an earlier one for the same object):
- CHANGE-REQUEST: CR-38 WS-SR1 centreline (76,40)(76,52)(64,60)(52,60) -> (73,45)(73,52)(64,60)(52,60), rim rails WS-SR1-A (76,45)(76,53.35)(65.14,63)(52,63) and WS-SR1-B (70,45)(70,50.65)(62.86,57)(52,57); letter D (60, 33.2, 6.5) -> (60, 32.8, 6.2); add WS-FB2 "Corner Bar" (28, 14, 0.55) -> (36, 14, 0.55) and the wall skin WS-WALL-S backing WS-TR1; WS-G03 EURO GAP counts in either direction; line 1's finish runs past the snake-run mouth instead of "south around the hump", reasons: at x 76 the lane to the vert foot was 2 m and the mouth ramp sat on the centre rainbow's line; the DESIGN D point is inside the pipe shell (4.06 m from the axis, R 4.0); empty floor west of the spine and a wall-mounted rail with no wall; the trench is jumpable both ways. Applied.
- CHANGE-REQUEST: CR-39 WS-BT booth x[44,48] z[60,64] -> x[41,45] z[64.5,68.5], reason: the DESIGN spot was 1 m in front of the snake run's west exit ramp. Superseded by CR-40.
- CHANGE-REQUEST: CR-40 WS-H1 hump x[56,64] z[47,55] ridge z 51 -> x[77,83.5] z[52,60] ridge z 56, and WS-G11 HUMP AIR start z <= 47 / land z >= 55 x[56,64] base 200 -> start z <= 53 / land z >= 59 x[77,83.5] base 300; add vert pockets WS-VW1-N (facing north, coping z 22, foot z 19, span [84,89.4], 3.6 / R 3 / vert 0.6, coping WS-VW1-NC) and WS-VW1-S (facing south, coping z 48, foot z 51, coping WS-VW1-SC); secret_drive (43, 28, 3.6) -> (43, 28, 5.5) (wording: "high above the spine-peak rail: a pumped spine air plus the transfer"); WS-BN4 y0 4.6 -> 5.4; WS-WALL-S z0 69.7 -> 69.9, booth WS-BT -> x[36,40] z[60.5,63.5], DARIO (46,65) -> (41,61) facing north, new ledge WS-BT-N (36,60.5,1.2) -> (40,60.5,1.2); spawn (34,64) facing west -> (34,62) facing north; WS-RR1 z 45 -> 45.4, WS-RE z 51 -> 51.6 (box z[51.4,51.8]), WS-RF z 51.3 -> 51.9; WS-BK1 x[55.6,58] -> x[56.2,58.6], WS-PL1 x[58,70] -> x[58.6,70], WS-FB3 (59,8)->(69,8) -> (59.4,8)->(69,8), WS-PL1-N/S start x 58 -> 58.6, new ledge WS-PL1-E (70,2.4,1.0) -> (70,7.0,1.0), WS-QE1 span [60,88] -> [60,89.4], reasons (woodshed critic): the old hump was walled off by the snake run and never on line 1 (and G11 was an 8 m flat air); the deck's 3.6 m end walls were head-on bail traps; a peak-rail grind collected the Drive in the first minute (SPEC: "needs speed + transfer"); a banner frame met a full ollie's air sphere; the booth capsule was buried in the wall panel; the opening faced 34 m of empty floor; row spacing equalled the 120 deg/s turn diameter with no slack; FB1's end post stood on the bank and the platform's east edge was an unrailed drop. Applied. REQ-WSH-03's scripted 20 s chain now runs on the real sim in tests/woodshedChain.test.ts (23.9 s from first snap to bank, 19,930 banked).

Audio track (M8):
- CHANGE-REQUEST: CR-41 MUSIC_BPM_STREET 140 (range 120 to 160) -> 94 (range 80 to 160) and MUSIC_BPM_WOODSHED 150 -> 170, reason: the songs are arranged as a swung boom-bap (92 to 96 BPM) and a punk breakbeat (about 170); 140 and 150 were this document's defaults, not SPEC numbers. Applied by integration (src/core/tuning.ts, REQ-AUD-02, table M).

Integration (M8):
- CHANGE-REQUEST: CR-42 REQ-GOL-01 and H.1 "Free Skate -> 2:00 run" -> Free Skate is untimed (the world gets runLengthS = INT_FREE_SKATE_LENGTH_S, one day; the HUD shows FREE SKATE in the clock slot); Career stays the 2:00 default session (SPEC §19), reason: the integration brief; Free Skate is the practice mode and a clock there only cuts lines short. Quit to menu from a Free Skate run folds its score, best combo and MacGuffin into the save (applyRunEnd, no goals) so a Laptop found in Free Skate is kept. Applied.
- Noted, not applied: the levels track asked whether SurfaceTag should carry finer classes (ground, ramp, vert, wall, ledge top); it stays solid / transition / boundary, the finer class is derivable from tag, normal and surfaces[id].kind. Gap boxes and goal zones stay GapRule boxes, not trigger spheres. The fx track's FxHooks (hitstop freeze, deck override, viewport height) stays the optional third argument of createFxSystem and is wired by the app. The fx track's camera-ray request is met in the app: the injected CameraRaycast passes through shapes shorter than INT_CAM_IGNORE_HEIGHT_M.

Founder playtest, 2026-09-23 (the product owner on a real controller; these OVERRIDE SPEC and this document where they disagree; polish round 1, written and applied by integration unless a track is named):
- CHANGE-REQUEST: CR-43 REQ-CTL-10 / REQ-SM-03 landing forgiveness: LAND_OFFAXIS_BAIL_DEG 28 (22 to 35) -> 50 (22 to 60); LAND_OFFAXIS_OK_DEG 15 (10 to 20) -> 20 (10 to 30), so clean < 20 and OK up to 50; TILT_BAIL_DEG 40 (30 to 50) -> 180 (30 to 180, so tilt never bails: the air auto-orient and the contact snap handle it); only YAW counts: the off-axis at contact is the smaller of the landing-plane angle and the world-yaw angle between nose and velocity (a plain ollie across a bank read 20 to 40 deg on the plane measure); a landing with under SIM_LAND_SLOW_MPS 2.0 m/s of horizontal speed is judged only by the player's own air spin; the left stick in the air spins only past SIM_AIR_SPIN_DEADZONE 0.75 of lateral deflection (a riding diagonal, 0.71, never spins; full lock is still full rate) and never pitches; the air nose is carried through the auto-orient instead of re-projected (an ollie up a mini ramp face turned the nose 70 deg sideways); a flip or released grab that ends within SIM_LAND_ANIM_GRACE_MS 120 ms after contact lands; a feet contact with an underside (normal.y below -SIM_CEILING_NORMAL_Y) is a ceiling, never an upside-down landing. Reason: founder items 1, 4, 8 ("ollies and small leans bail constantly"). Measured by tests/integrationFeel.test.ts (seeded, real world, test box): plain ollies with riding leans bailed 12/100 on flat, 36/100 on a bank and 24/60 off a mini ramp before; 0, 0 and 0 after. Ollie + a flip pressed before the apex bailed 25/100 flat and 55/100 bank before; 0/100 and 3/100 after. Applied (src/core/tuning.ts, src/core/tuning/sim.ts, src/sim/controller.ts, src/sim/world.ts).
- CHANGE-REQUEST: CR-44 REQ-CTL-04 / 05 / 06 / 11 speed and air: MAX_SPEED_MPS 11 (9 to 13) -> 13 (9 to 15); PUSH_ACCEL 4.5 (3 to 7) -> 9.2 (3 to 12) and PUSH_CUTOFF 0.70 (0.6 to 0.85) -> 0.85 (0.6 to 1.0), so a push reaches its 11.05 m/s top in 1.2 s; TRANSITION_GRAVITY_FACTOR 0.45 (0.3 to 0.7) -> 0.3 (0.2 to 0.7); OLLIE_H_TAP_M 0.9 (0.7 to 1.1) -> 1.2 (0.7 to 1.5); OLLIE_H_FULL_M 1.6 (1.3 to 2.0) -> 2.0 (1.3 to 2.5). The C.6 air table follows its own formula at the new factor (11 m/s over the 2.4 m coping: 1.65 -> 2.03 m; at 13 m/s a 3.6 m vert coping throws 2.76 m). Reason: founder item 3 ("not enough speed and air to go up ramps and do a trick"). Measured (tests/integrationFeel.test.ts): from a standing push, TB-VERT air 0.68 -> 2.80 m over the coping and TB-MINI 1.11 -> 2.70 m; every quarter-pipe of both parks now launches a standing push into 0.93 to 1.18 s of air (2.2 to 2.8 m over its coping), more than a tier-1 flip plus 150 ms. Level data kept feasible with the higher ollie: Market Street letter O (92.5, 94, 5.6) -> (92.5, 94, 6.1) (the charged Billboard Gap arc rose), MS-PR-CRATES height 1.8 -> 2.2 m (a 2.0 m full ollie would otherwise reach its unrailed top), Woodshed WS-BN4 y0 5.4 -> 5.8 (head room over the Coping Link). Applied.
- CHANGE-REQUEST: CR-45 REQ-CAM-01 / 02 camera: CAM_BACK_M 4.2 (3 to 6) -> 6.0 (3 to 8); CAM_UP_M 1.6 (1 to 2.5) -> 2.3 (1 to 3); CAM_VERT_BACK_EXTRA_M 2.0 -> 2.5 and CAM_VERT_UP_EXTRA_M 1.5 -> 1.8 to match. Camera collision is unchanged (CAM_MIN_BOOM_M, the pass-through ray). Reason: founder item 9 ("camera too close"). Screenshots screenshots/fix-integration/cam-before-*.png and cam-after-*.png. Applied.
- CHANGE-REQUEST: CR-46 REQ-AUD-01 / 02 mix: AUDIO_ROLL_GAIN 0.32 -> 0.05 (about 15%); the concrete roll band sweeps AUDIO_ROLL_BRIGHT_HZ 900 instead of 2200 Hz (softer, less hiss); joint clacks scale by AUDIO_CRACK_LEVEL 0.25; AUDIO_MUSIC_BUS_GAIN 0.5 -> 0.25 and the default music slider 0.7 -> 0.5 (a new player hears music 12 dB lower, an existing save 6 dB lower); AUDIO_SFX_BUS_GAIN 0.85 -> 0.75 and the default SFX slider 0.8 -> 0.75. Reason: founder items 2, 7 ("rolling sound annoying and too loud; music too loud"). The audio fixer did not change these this round; integration applied them (src/core/tuning/audio.ts, src/audio/engine.ts, src/audio/loops.ts, DEFAULT_OPTIONS in src/core/types.ts).
- CHANGE-REQUEST: CR-47 REQ-GRD-02 auto-grind (sim track, new rule): in the air, descending into the magnet of a rail, ledge or deck coping (feet at or above the rail, entry angle within GRIND_ENTRY_MAX_DEG, animations done) snaps a 50-50 with no Triangle; Triangle still picks the type. Not for the rail just left, and not for a coping during a vert-assisted air or after a transfer. Switch: SIM_AUTO_GRIND (1). Reason: founder item 6 ("landing on a rail should start a grind"). Applied (src/sim/world.ts). Sim notes that come with it: for kind "ledge" rails the across-the-ledge part of the magnet distance is measured from the capsule (less SKATER_RADIUS_M), so a skater touching a ledge face is inside the locked 0.55 m magnet from both sides (round rails and copings still use the distance to the rail point); a candidate on an open rail with less than one tick of rail left along the travel is no candidate (this ends the rail-end re-snap loop).
- Sim notes (sim track, polish round 1, no number changed): REQ-VRT-08 / E.9: SPINE_TRANSFER_HEIGHT_M (1.5) gates only the first moment a transfer rail comes in reach during an air; after that the press is height-free, so R2 works up to the apex of a full-pop air (this settles CR-30 without raising the window). REQ-VRT-10: the coyote pop after a vert launch scales its upward push by the on-face pop direction's up component, so the height is continuous across the lip. createWorld defaults Free Skate to INT_FREE_SKATE_LENGTH_S itself (CR-42).
- Skater track look change (founder item 5, no locked number): SKATER_RIM_STRENGTH 0.55 -> 0.25, new SKATER_OUTLINE_BRIGHTNESS 0, SKATER_LIGHT_SCALE 0.7, SKATER_SELF_LIGHT 0.12 and new SKATER_COLORS (src/core/tuning/skater.ts, src/render/skater/rig.ts). Integration also sets scene.environmentIntensity = RSKY_ENV_INTENSITY on the run and menu scenes (three 0.186 gives envMap-less materials, the skater and FX among them, scene.environmentIntensity, default 1; render request).

Other tracks, polish round 1:
- CHANGE-REQUEST: CR-48 SPEC §5 / C.2 keyboard "Nollie / fakie modifier" Ctrl -> Z (Ctrl kept as an alternate), reason: the keyboard nollie trick "up" is the chord Ctrl+W, which Chrome and Edge reserve to close the tab and never deliver to the page. Applied by input (src/input/devices.ts binds KeyZ and both Ctrl keys; glyph "Z"); a live run also asks "Leave site?" before the tab closes (src/app/boot.ts).
- CHANGE-REQUEST: CR-49 REQ-MNU-04 music folder picker -> pointer or keyboard only (the SPEC §19 "every screen fully usable with a pad" gate excepts this one control), reason: browsers never count gamepad presses as user activation, so a file chooser cannot open from a pad. The screen says "Click or press Enter to pick a folder" and plays the error blip on a pad confirm (ui). The same browser rule is why a pad-only start leaves audio suspended: the app shows a "Sound off: click or press any key to turn it on" chip until the context runs (src/app/soundChip.ts).
- CHANGE-REQUEST: CR-50 REQ-STR-01 / 03 fountain: MS-F1 centre (52, 64) -> (50.4, 66); letter D (50.4, 60.9, 3.0) -> (50.4, 62.5, 3.0) on the moved rim; MS-DC-WATER and MS-G04's centre follow FOUNTAIN_CENTRE, reason: line 3's hop off MS-R1 landed on the steep fountain face and bailed; on the R1 lane with 4 m of flat, 0 bails in the sim. Applied (street).
- CHANGE-REQUEST: CR-51 REQ-STR-03 letter O (92.5, 94, 5.0) -> (92.5, 94, 5.6), reason: a charged Billboard Gap ollie carried the collect point at y 5.6 to 6.0 and O at 5.0 was missed by the natural full pop. Applied (street); superseded by CR-44 (6.1 with the 2.0 m full ollie).
- CHANGE-REQUEST: CR-52 REQ-STR-01 MS-Q3 radius 2.7 -> 4.0 and footLine 85.3 -> 84.33 (lip 66 deg, below VERT_ASSIST_MIN_SLOPE_DEG); line 2 pop point (101.4, 87.05, 1.732) -> (101.4, 86.9, 2.036); MS-L10 end z 84.8 -> 83.8, reason: the DOCK ROOF ACCESS pop window was 1 to 3 ticks; it now spans about a metre of the face and a roll-off also lands on the roof. Applied (street).
- CHANGE-REQUEST: CR-53 REQ-STR-01 ground and dressing: MS-SOUTH z0 104 -> 106.4 plus solid box MS-SOUTH-E (x 82..95, z 104..106.4, y -1.2..0); MS-T1E ground -> solid box y0 -1.2; plaza MS-T1 split into MS-T1W / T1N / T1 / T1F / T1M / T1R / T1K (concrete, tile, granite and brick zones); MS-SB split into MS-SBW 15 m / MS-SB 12 m / MS-SBE 20 m; MS-SE 8 -> 16 m; west storefront fronts MS-WF1..3, reason: two fall-forever pockets under the sidewalk floors, and the park read as a sparse tile lot. Applied (street). G.1 line 1 prose already says x 46, and src/levels/marketStreetLines.ts now matches it.
- CR-07 preset names: DEGRADATION_PRESET options "thps1" / "thps3" -> "classic" / "steep" (same tables), reason: the dev tuning panel ships in production and showed the series' trademark abbreviation to public players; `npm run check:parody` now also fails on that abbreviation in dist/. The lineage stays in code comments only.
- DEFAULT_STANCE dropdown removed (SPEC §15's goofy stance is v1.0, DESIGN F; nothing read it).
- REQ-REN-05 probe: "auto" waits until the scene on screen has drawn INT_PROBE_WARM_FRAMES (30) frames, takes the MEDIAN frame over FPS_PROBE_S ignoring intervals over INT_PROBE_DROP_FRAME_MS (100 ms), and keeps the result in localStorage so later loads skip it (SPEC §10 "first load"). Reason: the 2 s window used to overlap the park build and first-draw shader links, and an RTX 5070 picked Low on every load; it now picks Ultra (DEPLOY.md).

Polish round 2 (audit findings; written by integration; "Applied" names the file):
- CHANGE-REQUEST: CR-54 C.5 rows 9e, 12, 18 and REQ-SM-13 / REQ-CTL-21 pumping after an air: new rows 9i (Cross pressed in LandWindow or RevertWindow on a transition while moving down it: stay, pumping, no charge, the release fires no hop), 9j (pumping in a window, velocity turns upward with Cross held: Crouch, banks) and 12b (contact with Cross already held on a descending transition: LandWindow pumping; row 8 with Cross held pumps too); rows 9b, 9c and 16 carry a held pump into the next state; row 12 is flat ground only; the row 1b rule also covers the flat-sloped foot of a transition while descending faster than SIM_PUMP_MIN_DESCENT_MPS 0.1 m/s (new, 0.01 to 1), so a level bowl floor still crouches. Reason: after any air the whole descent of a ramp fits in the 22-tick LandWindow, where Cross banked and crouched (row 9e) and the release ollied the skater off the face: TB-VERT and TB-MINI showed 1 pop and no speed gain for Cross held 5 to 20 ticks after landing, and a WS-BW1 shuttle never built air. Now the same holds give +0.4 to +1.6 m/s and no pop, and pumping every descent of WS-BW1 from 8 m/s grows each air (0.66, 1.43, 1.89 m) and reaches letter C (tests/integrationPump.test.ts, fails on the old code). No locked number changed. Applied (src/sim/stateMachine.ts, src/sim/types.ts, src/sim/world.ts, src/core/tuning/sim.ts).
- CHANGE-REQUEST: CR-55 C.5 row 31 "climbing into slope >= 35 (a bank or transition) banks" -> only a bank (not tagged transition) ends a climbing manual; a manual rolled into a transition rides up the face and leaves the lip into the air with the combo alive (row 33b). Reason: G.1 line 1 ("manual across the crosswalk -> up MS-B3 -> MS-Q1 (air, Indy, R2 revert)") and G.2 lines 1, 3 and 4 chain a manual into a ramp air, and row 31 banked every one of them at the ramp foot (slope 37). Replays: the crosswalk manual at 11 to 13 m/s now airs MS-Q1 and reverts in one combo; a manual into the spine west face at 7, 9 and 11 m/s airs with the combo alive (tests/integrationManualLine.test.ts, fails on the old code). The G.1 / G.2 line tables stand as written. Applied (src/sim/world.ts, the climbSteep event; src/sim/stateMachine.ts note).
- CHANGE-REQUEST: CR-56 REQ-CAM-04 speed tier: new SIM_SPEED_TIER_HYST 0.03 (0 to 0.1): the snapshot tier enters cruise / fast only this far above SPEED_TIER_CRUISE_RATIO / CAM_FOV_KICK_SPEED and leaves below the threshold itself. CAM_FOV_KICK_SPEED stays 0.85 (SPEC §10 "above 85% max speed"). Reason: the CR-44 top push (PUSH_CUTOFF 0.85) sat on the threshold and a sustained push flipped fast / cruise 19 times in 4 s; now it settles in cruise (at most 2 tier events), and the +6 deg kick, which ramps in over FXCAM_KICK_RAMP above 0.85, stays the "faster than you can push" cue: downhill, transitions, pumping. Applied (src/sim/world.ts, src/core/tuning/sim.ts; tests/integrationSpeedTier.test.ts).
- CHANGE-REQUEST: CR-57 CR-42 "Quit to menu from a Free Skate run folds its score, best combo and MacGuffin into the save" -> any run left before its end (Quit to menu, Restart run, a new run) folds its score, best combo and MacGuffin through applyRunEnd, and a career run also the goals it already completed. Reason: a career run quit or restarted after the Laptop lost the Laptop and every goal it had completed, while the same pickup in Free Skate was kept. Applied (src/app/boot.ts endSession; e2e/smoke.spec.ts "career quit to menu keeps the MacGuffin and its goal", fails on the old code).
- C.6 vert assist landing numbers (no number changed, text only): REQ-VRT-01 and the C.6 assist paragraph restated to the CR-44 measurements (trace table in C.6): a vert wall return now lands 1.8 to 2.8 m below the coping instead of 0.7 to 1.3 m, always on the face and revert-legal.
- CHANGE-REQUEST: CR-58 C.6 landing rule "velocity projected onto the surface tangent; along-surface speed x0.96" -> the same, except on a transition face that rises along the horizontal travel: the horizontal velocity projected onto the face (the fall absorbed) when that is larger, x0.96, reason (sim track): a hop into a rising face (Market Street line 3, the MS-R1 end into the MS-F1 foot) projected to 0.46 to 2.9 m/s and missed the D 5 of 12 times; now 4.35 to 8.6 m/s, 12/12. No locked number changed. Applied (src/sim/controller.ts land()).
- Sim notes (sim track, polish round 2, no locked number changed): REQ-GRD-02 / REQ-INP-15: the rail an air left is out of the air magnet (pressed, buffered and auto grinds) while the skater still rises, so pop + Triangle reaches the next rail and cannot farm +1 on the same bar; re-grinding it after the apex still counts. REQ-VRT-08: launchSide uses the launch position only when it is more than SIM_TRANSFER_SIDE_EPS_M (0.05 m) off the plane, else the launch face normal. Row 25b: a buffered Triangle released before its lip snap counts as released on the snap tick. REQ-SCR-06: a MacGuffin held from the save never re-completes its goal.
- REQ-WSH-05 / SPEC §9.2 the Woodshed drive "needs speed + transfer" (woodshed request, applied by integration): MacGuffinDef gains an optional `needs: { transferInAir }`; the drive (43, 28, 5.5) keeps y 5.5 (3.6 fails REQ-LVL-05 with the CR-44 2.0 m ollie) and is collected only in an air that already made a spine transfer, or on a grind that air reached. Reason: a plain spine roll-up at 10 m/s reached it. A spine air at 10 to 13 m/s with no input never collects it; with R2 over the spine at 11 m/s it does (tests/integrationDrive.test.ts; the e2e career loop now collects it with a real transfer). Applied (src/levels/types.ts, src/levels/woodshed.ts, src/sim/world.ts).
- CHANGE-REQUEST: CR-59 G.2 WS-QE1 span [60,89.4] -> [60,87] and WS-QE1-C (60,70,2.4)->(89.4,70,2.4) -> (60,70,2.4)->(87,70,2.4); new solid boxes WS-QE1-END x[87,90] z[67.3,70] y0 0 h 2.4 maple, WS-QW1-END x[0,4] z[67.8,70] y0 0 h 2.0 maple, WS-VW1-N-END x[89.4,90] z[19,22] h 3.6 maple, WS-VW1-S-END x[89.4,90] z[48,51] h 3.6 maple, reason (woodshed track): the 0.6 m slots at the ramp ends let the air sphere leave the park (22 of 554 drops), and a Coping Link grind auto-carried onto WS-QE1-C or WS-QW1-C ran into the wall and lost the combo; it now lands on a corner deck flush with the coping and banks first. Applied (src/levels/woodshed.ts).
- CHANGE-REQUEST: CR-60 G.2 WS-G07 DROP-IN rule dropIn { surfaces [WS-BW1, WS-BW2], minStartY -0.1 } -> airBoxToBox { startSurface WS-FL, land x[4,88] z[2,26] y <= -0.7 }, base 200 unchanged, reason (woodshed track): the bowls are vertical at the rim, so from 6 m/s up the first contact is the bowl floor (tag solid) and the old rule never counted it. Applied (src/levels/woodshed.ts).
- CHANGE-REQUEST: CR-61 G.2 WS-G09 CENTER RAINBOW grindSpan on WS-RR2 x <= 49 to x >= 63 -> x <= 50 to x >= 62, reason (woodshed track): 4 of 9 audited approaches snapped past x 49 and earned nothing; this gives 2 m of slack at each end, as WS-G08 has. Applied (src/levels/woodshed.ts).
- CHANGE-REQUEST: CR-62 REQ-STR-01 MS-R6 (89.5, 94, 3.9) -> (82.5, 94, 3.9) becomes (89.5, 97, 3.9) -> (82.5, 97, 3.9), reason (street track): on z 94 the pipe sat under the O, so a charged Billboard Gap ollie snapped it mid-air and MS-G10 fired on about 1 run in 10; on z 97 it is 25 of 25 per lane. G.1 line 2 now reads "land on the depot roof, carve south-west onto MS-R6". Applied (src/levels/marketStreet.ts).
- CHANGE-REQUEST: CR-63 REQ-STR-01 terrace planter MS-PR-PLANTER2 centre z 32.5 -> 34.75, and its ledge MS-PL2 z 30..35 -> z 32.25..37.25 (x 50.4, y 1.4), reason (street track): line 3 comes off the uphill hubba MS-L2 at about 2.5 m/s, and a full pop at that speed carries about 2 m, so the old 3 m feed from z 38 missed; with the planter 0.75 m past the hubba top, 24 of 24 sim runs grind it. Applied (src/levels/marketStreet.ts).
- CHANGE-REQUEST: CR-64 REQ-REN-04 CHROMATIC_ABERRATION 0.002 -> 0.0008 (range 0 to 0.006 unchanged), reason (render track): SPEC §10 asks for "subtle"; with the clear radius now 0.5 (RPOST_CA_MODULATION_OFFSET), 0.002 still split about 3 px at the frame corners at 1080p, 0.0008 gives about 1 to 1.5 px at the edge (A/B in screenshots/fix-render/r2/ca-compare.png). Applied by integration (src/core/tuning.ts, table M).
- CHANGE-REQUEST: CR-65 founder playtest 2 (movement feel), REQ-CTL-04 / 05 / 06 / 10 / 20, REQ-SM-03: (1) THPS1 auto-roll: SIM_AUTO_PUSH 1, the skater pushes on his own whenever the stick is not held back (no stick needed); PUSH_CUTOFF 0.85 -> 1.0 and PUSH_ACCEL 9.2 -> 13 (3 to 16), so full speed comes in about 1.1 s; holding ollie (Crouch) keeps pushing, so charging never costs speed. (2) No brake pivot: stick back only brakes (BRAKE_DECEL), never turns the skater 180 or reverses (BRAKE_PIVOT_* are no longer read). (3) Walls never bail: a glancing hit slides (WALL_SLIDE_RETAIN), a near head-on hit (incidence <= WALL_BAIL_ANGLE_DEG) bounces back at SIM_WALL_BOUNCE 0.35 of the into-wall speed; any collision that turns an air also turns the launch basis, so a bounced skater lands along his new travel. (4) More air and speed: MAX_SPEED_MPS 13 -> 15 (9 to 18), GRAVITY 22 -> 20, OLLIE_H_FULL_M 2.0 -> 2.5 (1.3 to 3.2; tap stays 1.2 so the Woodshed WS-FB3 -> WS-HB1N feed still connects). (5) Fewer falls: LAND_OFFAXIS_BAIL_DEG 50 -> 60 (22 to 75); a landing spin assist turns the nose onto the travel line (forward or fakie) in the last SIM_SPIN_ASSIST_S 0.18 s at SIM_SPIN_ASSIST_DPS 900 unless a quick-spin burst is running; a grab still held at touchdown lets go (SIM_GRAB_AUTO_RELEASE); Triangle during a flip or grab waits for it inside the pre-buffer instead of bailing on row 5b (SIM_GRIND_WAITS_FOR_TRICK); flip animations 380/450/520/600 -> 300/340/380/420 ms (enhanced +120); SIM_LAND_ANIM_GRACE_MS 120 -> 200; GRAB_RELEASE_BEFORE_LAND_MS 120 -> 60. Level data kept feasible: Market Street letter O y 6.1 -> 6.5, van roofs and the crate stack gained ledge rails (MS-VAN1-R, MS-VAN2-R, MS-CRATES-R) since a full ollie now reaches them, line 3 MS-PL2 minSpeed 2.5 -> 2.7; Woodshed WS-BN4 y0 5.8 -> 6.1. Reason: founder playtest 2 ("i dont like the hold forward to move, it should just be holding ollie like THPS 1. not enough air, still easy to fall. hit a wall you fall, almost anything you do you fall. i dont like the holding back and you turn around business. not enough speed"). Measured: standing push to TB-VERT 2.80 -> 5.65 m above the coping; 14.2 m/s reached in 1.10 s; full ollie 2.50 m, 0.99 s of air; tests/simFeelBot.test.ts (seeded careless bot, 15 min over the test box and both parks, 750+ airs) 0 wall and 0 landing-angle bails, about 0.9 bails per minute, all flips started too late to finish. The coasting scenario suites run with SIM_AUTO_PUSH 0 (tests/fixtures/integration/setup.ts); tests/simFounder2.test.ts checks the shipped behavior. Applied.
- Render note (no locked number): the finish pass uses SoftContrastEffect (src/render/lib/softContrast.ts) instead of postprocessing's BrightnessContrastEffect; RPOST_CONTRAST keeps its meaning as a contrast amount (the midtone slope gain, range 0 to 0.5). New render tunables: RPOST_AO_FLOOR, RPOST_CA_MODULATION_OFFSET, RLIT_SKYFILL_INTENSITY / _ELEVATION_DEG / _AZIMUTH_OFFSET_DEG, RMAT_SKYLINE_LIT_RATIO, RMAT_SKYLINE_WINDOW_EMISSIVE, RMAT_SKYLINE_HAZE_BLUE.
- Controls screen (ui, applied by integration): the Options controls table row for R2 reads "Revert / Transfer: Vert landing: toggles stance. In the air over a spine or vert coping: Spine Transfer" (DESIGN E.9).
- Tests: vitest testTimeout 5 s -> 30 s (vitest.config.ts): the park-building sim suites timed out 3 to 4 tests at 5 s on a loaded machine.

At M0 (before L.2), no locked number in SPEC §5, §6, §7, §8, §9, §10 or §15 was changed except the one logged as CR-19 above (a §15 penalty restated as a drift multiplier). Two locked STRUCTURES were restated, not changed: the §8 state list gains LandWindow (CR-18 above) and the §9.2 spine transfer is implemented literally as a mirror about the edge (REQ-VRT-08) rather than a push. Every other value in this document fills a gap the spec left open and is marked "mine" in its REQ row; the ones a skeptic review moved are TURN_RATE_MANUAL_DPS 90 -> 120, VERT_LAND_MIN_SLOPE_DEG 45 -> 40, ENHANCED_ANIM_EXTRA_MS 180 -> 120, SPINE_TRANSFER_PUSH_MPS 1.5 -> 0.4, SWITCH_DRIFT_MULT 1.25 -> 1.35 (now logged as CR-19 because it touches a §15 figure), GRIND_GROUND_SNAP_DY_MAX 0.5 -> 0.7, kernel_panic anim 800 -> 700 ms, Tweaked grabs 225 -> 200 (back to SPEC §5's +1 tier).

---

## M. Locked numbers (master table, becomes `src/core/tuning.ts`)

Every key gets a `TUNING_META` entry with min, max, unit and REQ. Values marked (spec) are locked by SPEC; the rest are this document's defaults.

| KEY | Value | Range | Unit | REQ | Note |
|---|---|---|---|---|---|
| SIM_HZ | 120 | 120 | Hz | REQ-TIM-01 | spec, fixed |
| SIM_MAX_CATCHUP_S | 0.1 | 0.05 to 0.25 | s | REQ-TIM-04 | |
| COYOTE_MS | 90 | 70 to 120 | ms | REQ-TIM-06 | spec |
| GRIND_MAGNET_RADIUS_M | 0.55 | 0.40 to 0.80 | m | REQ-GRD-02 | spec |
| GRIND_ENTRY_MAX_DEG | 55 | 45 to 70 | deg | REQ-GRD-02 | spec |
| GRIND_PREBUFFER_MS | 200 | 120 to 300 | ms | REQ-GRD-04 | spec |
| REVERT_PRE_MS | 150 | 100 to 200 | ms | REQ-REV-01 | spec |
| REVERT_POST_MS | 180 | 140 to 220 | ms | REQ-REV-01 | spec |
| REVERT_TO_MANUAL_MS | 200 | 160 to 260 | ms | REQ-REV-02 | spec |
| MANUAL_LAND_WINDOW_MS | 140 | 100 to 180 | ms | REQ-MAN-02 | spec |
| LAND_OFFAXIS_BAIL_DEG | 50 | 22 to 60 | deg | REQ-CTL-10 | spec 28; CR-43 founder playtest |
| LAND_OFFAXIS_OK_DEG | 20 | 10 to 30 | deg | REQ-CTL-10 | spec 15 (clean below); CR-43 |
| TILT_BAIL_DEG | 180 (off) | 30 to 180 | deg | REQ-SM-03 | was 40; CR-43 |
| GETUP_LOCKOUT_S | 0.85 | 0.60 to 1.10 | s | REQ-TIM-10 | spec |
| BAIL_TUMBLE_S | 0.6 | 0.4 to 0.9 | s | REQ-SM-05 | |
| SPECIAL_SEQ_MS | 250 | 200 to 350 | ms | REQ-INP-13 | spec |
| SPECIAL_BUTTON_MS | 250 | 150 to 350 | ms | REQ-INP-10 | |
| DOUBLE_TAP_MS | 250 | 180 to 320 | ms | REQ-INP-04 | spec |
| MANUAL_SEQ_MS | 250 | 180 to 350 | ms | REQ-MAN-01 | |
| GRIND_SWITCH_COOLDOWN_MS | 100 | 60 to 200 | ms | REQ-GRD-07 | |
| LAND_YAW_SNAP_MS | 100 | 60 to 160 | ms | REQ-CTL-07 | |
| GRIND_SNAP_BLEND_MS | 80 | 50 to 120 | ms | REQ-GRD-03 | |
| STICK_DEADZONE | 0.35 | 0.2 to 0.5 | ratio | REQ-INP-02 | spec |
| DIR_SECTOR_DEG | 45 | 45 | deg | REQ-INP-02 | spec |
| RUN_LENGTH_S | 120 | 60 to 180 | s | REQ-GOL-01 | spec |
| RUN_OVERTIME_MAX_S | 30 | 10 to 60 | s | REQ-SM-09 | |
| CLOCK_RED_S | 10 | 5 to 20 | s | REQ-HUD-01 | spec |
| MAX_SPEED_MPS | 13 | 9 to 15 | m/s | REQ-CTL-06 | spec 11; CR-44 |
| GLOW_SPEED_BONUS | 0.08 | 0.05 to 0.12 | ratio | REQ-SPC-03 | spec |
| OVERSPEED_DECAY | 4.0 | 2 to 8 | m/s^2 | REQ-CTL-06 | |
| GRAVITY | 22 | 16 to 26 | m/s^2 | REQ-CTL-06 | spec |
| OLLIE_H_TAP_M | 1.2 | 0.7 to 1.5 | m | REQ-CTL-05 | spec 0.9; CR-44 |
| OLLIE_H_FULL_M | 2.0 | 1.3 to 2.5 | m | REQ-CTL-05 | spec 1.6; CR-44 |
| OLLIE_TAP_MAX_S | 0.10 | 0.05 to 0.2 | s | REQ-CTL-05 | spec (0.1 to 0.6 hold) |
| OLLIE_FULL_S | 0.60 | 0.4 to 0.8 | s | REQ-CTL-05 | spec |
| OLLIE_CHARGE_EXP | 1.0 | 0.6 to 1.5 | exponent | REQ-CTL-05 | |
| POP_UP_BLEND | 0.5 | 0.3 to 0.7 | ratio | REQ-CTL-05 | |
| VERT_POP_SCALE | 0.6 | 0.4 to 1.0 | ratio | REQ-VRT-02 | |
| PUSH_ACCEL | 9.2 | 3 to 12 | m/s^2 | REQ-CTL-04 | was 4.5; CR-44 |
| PUSH_CUTOFF | 0.85 | 0.6 to 1.0 | ratio of vmax | REQ-CTL-04 | spec 0.70; CR-44 |
| PUSH_CYCLE_S | 0.6 | 0.4 to 0.9 | s | REQ-CTL-04 | animation |
| ROLL_FRICTION | 0.25 | 0.1 to 0.6 | m/s^2 | REQ-CTL-04 | |
| BRAKE_DECEL | 6.0 | 4 to 9 | m/s^2 | REQ-CTL-04 | |
| BRAKE_PIVOT_SPEED | 0.5 | 0.3 to 1.0 | m/s | REQ-CTL-04 | |
| BRAKE_PIVOT_S | 0.3 | 0.2 to 0.5 | s | REQ-CTL-04 | |
| TURN_RATE_GROUND_DPS | 150 | 110 to 200 | deg/s | REQ-CTL-03 | |
| TURN_SPEED_FALLOFF | 0.5 | 0.3 to 0.7 | ratio | REQ-CTL-03 | rate x (1 - falloff x v/vmax) |
| TURN_RATE_MANUAL_DPS | 120 | 60 to 120 | deg/s | REQ-CTL-03 | radius 0.477 x v; sets the Woodshed chain row spacing |
| PUMP_ACCEL | 4.0 | 2 to 6 | m/s^2 | REQ-CTL-11 | |
| TRANSITION_GRAVITY_FACTOR | 0.3 | 0.2 to 0.7 | ratio | REQ-CTL-11 | was 0.45; CR-44 |
| FLAT_MAX_SLOPE_DEG | 35 | 25 to 40 | deg | REQ-CTL-17 | |
| VERT_LAND_MIN_SLOPE_DEG | 40 | 35 to 60 | deg | REQ-CTL-17 | fountain and mini quarter returns land at 40 to 51 deg |
| VERT_ASSIST_MIN_SLOPE_DEG | 70 | 60 to 80 | deg | REQ-VRT-01 | |
| WALL_MIN_SLOPE_DEG | 80 | 70 to 89 | deg | REQ-CTL-20 | |
| VERT_ASSIST_MAX_LATERAL | 0.4 | 0.25 to 0.6 | ratio | REQ-VRT-01 | |
| VERT_ASSIST_KEEP | 0.15 | 0 to 0.3 | ratio | REQ-VRT-01 | |
| VERT_ASSIST_MIN_OUT_MPS | 0.4 | 0.2 to 0.8 | m/s | REQ-VRT-01 | |
| VERT_ASSIST_MAX_OUT_MPS | 1.0 | 0.6 to 1.5 | m/s | REQ-VRT-01 | |
| FULLPIPE_ASSIST_OUT_MPS | 2.0 | 1.5 to 3.0 | m/s | REQ-VRT-11 | toward-axis speed at the pipe's 4.0 m line |
| LAND_SPEED_RETAIN | 0.96 | 0.85 to 1.0 | ratio | REQ-CTL-07 | |
| LAND_PREDICT_AHEAD_S | 0.25 | 0.1 to 0.5 | s | REQ-CTL-09 | |
| LAND_PREDICT_EVERY_TICKS | 4 | 1 to 8 | ticks | REQ-CTL-09 | |
| AIR_ORIENT_RATE_DPS | 360 | 240 to 540 | deg/s | REQ-CTL-09 | |
| WALL_BAIL_SPEED_MPS | 5.0 | 3 to 8 | m/s | REQ-CTL-20 | |
| WALL_BAIL_ANGLE_DEG | 45 | 30 to 60 | deg | REQ-CTL-20 | |
| WALL_SLIDE_RETAIN | 0.8 | 0.5 to 1.0 | ratio | REQ-CTL-20 | |
| SKATER_RADIUS_M | 0.35 | 0.3 to 0.45 | m | REQ-CTL-01 | |
| SKATER_HEIGHT_M | 1.8 | 1.6 to 2.0 | m | REQ-CTL-01 | render only; air collision uses one sphere |
| AIR_SPHERE_UP_M | 0.45 | 0.3 to 0.9 | m | REQ-CTL-22 | sphere centre above the feet along skater up |
| COLLECT_RADIUS_M | 0.9 | 0.6 to 1.2 | m | REQ-CTL-15 | around feet + 0.9 m up |
| SPIN_RATE_STICK_DPS | 360 | 270 to 450 | deg/s | REQ-VRT-03 | |
| QUICKSPIN_STEP_DEG | 180 | 180 | deg | REQ-VRT-04 | snaps to 180 |
| QUICKSPIN_RATE_DPS | 720 | 540 to 900 | deg/s | REQ-VRT-04 | |
| SPIN_RATE_CAP_DPS | 900 | 720 to 1080 | deg/s | REQ-VRT-04 | |
| POP_POSE_MS | 150 | 80 to 300 | ms | REQ-SKT-03 | pose "pop" after a pop until an air trick starts (M0 review) |
| SPINE_TRANSFER_HEIGHT_M | 1.5 | 1.0 to 2.0 | m | REQ-VRT-08 | spec |
| SPINE_TRANSFER_LATERAL_M | 1.0 | 0.6 to 1.5 | m | REQ-VRT-08 | |
| SPINE_TRANSFER_PUSH_MPS | 0.4 | 0.3 to 1.5 | m/s | REQ-VRT-08 | minimum outward speed after the mirror |
| SPINE_TRANSFER_ANIM_S | 0.3 | 0.2 to 0.5 | s | REQ-VRT-08 | |
| GRIND_FRICTION_RAIL | 0.10 | 0 to 0.8 | m/s^2 | REQ-GRD-08 | |
| GRIND_FRICTION_LEDGE | 0.30 | 0 to 0.8 | m/s^2 | REQ-GRD-08 | |
| GRIND_FRICTION_COPING | 0.15 | 0 to 0.8 | m/s^2 | REQ-GRD-08 | |
| GRIND_GRAVITY_FACTOR | 0.35 | 0.2 to 1.0 | ratio | REQ-GRD-08 | |
| GRIND_MIN_SPEED | 1.5 | 1.0 to 2.5 | m/s | REQ-GRD-08 | |
| GRIND_MIN_ENTRY_SPEED | 3.0 | 2 to 4 | m/s | REQ-GRD-03 | |
| GRIND_EXIT_POP_M | 0.3 | 0.2 to 0.5 | m | REQ-GRD-08 | stall-out hop |
| GRIND_GROUND_SNAP_MIN_SPEED | 3.0 | 2 to 5 | m/s | REQ-GRD-05 | |
| GRIND_GROUND_SNAP_DY_MIN | -0.2 | -0.5 to 0 | m | REQ-GRD-05 | |
| GRIND_GROUND_SNAP_DY_MAX | 0.7 | 0.4 to 1.0 | m | REQ-GRD-05 | hop = max(0.3, dy + 0.1) |
| GRIND_CORNER_MAX_DEG | 55 | 30 to 90 | deg | REQ-GRD-10 | |
| RAIL_GRID_CELL_M | 8 | 4 to 16 | m | REQ-GRD-14 | |
| LIP_MAGNET_M | 0.55 | 0.4 to 0.8 | m | REQ-LIP-01 | |
| LIP_MAX_VY | 3.0 | 2 to 5 | m/s | REQ-LIP-01 | |
| LIP_EXIT_SPEED | 3.5 | 2.5 to 5 | m/s | REQ-LIP-03 | |
| LIP_EXIT_POP_M | 0.25 | 0.1 to 0.4 | m | REQ-LIP-03 | halved in the exit formula |
| LIP_MIN_HOLD_MS | 150 | 100 to 300 | ms | REQ-LIP-03 | 18 ticks |
| LIP_EXIT_OFFSET_M | 0.15 | 0.1 to 0.3 | m | REQ-LIP-03 | exit position off the face |
| MANUAL_FRICTION | 0.35 | 0.2 to 0.8 | m/s^2 | REQ-MAN-04 | |
| MANUAL_MIN_SPEED | 1.0 | 0.5 to 2.0 | m/s | REQ-MAN-05 | |
| MANUAL_SWAP_COOLDOWN_MS | 600 | 400 to 1000 | ms | REQ-INP-18 | 72 ticks |
| MANUAL_SWAP_MAX_PER_RUN | 3 | 2 to 5 | count | REQ-INP-18 | per manual run |
| MANUAL_SWAP_MIN_HOLD_TICKS | 4 | 2 to 8 | ticks | REQ-INP-18 | second direction of the pair |
| DIR_MIN_DWELL_TICKS | 3 | 1 to 6 | ticks | REQ-INP-03 | a Dir8 held shorter never enters the ring |
| REVERT_SPEED_RETAIN | 0.85 | 0.7 to 1.0 | ratio | REQ-REV-04 | |
| GRAB_MIN_POSE_MS | 250 | 150 to 400 | ms | REQ-SM-03 | |
| GRAB_RELEASE_BEFORE_LAND_MS | 120 | 80 to 200 | ms | REQ-SM-03 | |
| FLIP_TIER_STEP | 50 | 25 to 100 | points | REQ-SCR-09 | tiers 100/150/200/250 |
| FLIP_ANIM_MS_T1 | 380 | 300 to 500 | ms | REQ-SCR-09 | T2 450, T3 520, T4 600 |
| FLIP_ANIM_MS_T2 | 450 | 350 to 600 | ms | REQ-SCR-09 | |
| FLIP_ANIM_MS_T3 | 520 | 400 to 700 | ms | REQ-SCR-09 | |
| FLIP_ANIM_MS_T4 | 600 | 450 to 800 | ms | REQ-SCR-09 | |
| ENHANCED_ANIM_EXTRA_MS | 120 | 80 to 200 | ms | REQ-SCR-11 | double_tre_flip 720 fits a full ollie |
| ENHANCED_GRAB_BONUS | 50 | 25 to 100 | points | REQ-SCR-11 | spec: +1 tier = FLIP_TIER_STEP; Tweaked grabs 200 |
| STANCE_SWITCH_MULT | 1.2 | 1.1 to 1.4 | ratio | REQ-SCR-02 | spec |
| NOLLIE_FAKIE_MULT | 1.1 | 1.0 to 1.2 | ratio | REQ-SCR-10 | |
| SPIN_MULT_PER_180 | 0.5 | 0.25 to 1.0 | multiplier | REQ-SCR-03 | spec |
| SPIN_MODE | "multiplier" | "multiplier" or "base" | enum | REQ-SCR-03 | spec preset |
| SPIN_BASE_PER_180 | 100 | 50 to 200 | points | REQ-SCR-03 | used only in "base" mode |
| DEGRADATION_PRESET | "thps1" | "thps1" or "thps3" | enum | REQ-DEG-02 | spec |
| DEGRADATION_THPS1 | [1, 0.9, 0.75, 0.5, 0.25] | fixed | ratios | REQ-DEG-01 | spec |
| DEGRADATION_THPS3 | [1, 0.75, 0.5, 0.25, 0.1] | fixed | ratios | REQ-DEG-02 | spec |
| SICK_THRESHOLD | 10000 | 5000 to 20000 | points | REQ-SCR-08 | spec |
| INSANE_THRESHOLD | 50000 | 25000 to 100000 | points | REQ-SCR-08 | spec |
| MACGUFFIN_BASE | 2500 | 2500 | points | REQ-SCR-06 | spec |
| BASE_GRAB | 150 | 100 to 250 | points | REQ-SCR-09 | spec; hold 100/s |
| HOLD_GRAB | 100 | 50 to 150 | points/s | REQ-SCR-09 | spec |
| BASE_FIFTY_FIFTY | 100 | 80 to 150 | points | REQ-SCR-09 | spec; hold 80/s |
| HOLD_FIFTY_FIFTY | 80 | 50 to 120 | points/s | REQ-SCR-09 | spec |
| HOLD_GRIND_DIRECTIONAL | 90 | 60 to 130 | points/s | REQ-SCR-09 | spec |
| BASE_MANUAL | 50 | 30 to 100 | points | REQ-SCR-09 | spec; hold 40/s |
| HOLD_MANUAL | 40 | 20 to 80 | points/s | REQ-SCR-09 | spec |
| BASE_LIP | 150 | 100 to 250 | points | REQ-SCR-09 | spec; hold 100/s |
| HOLD_LIP | 100 | 50 to 150 | points/s | REQ-SCR-09 | spec |
| BASE_REVERT | 100 | 50 to 200 | points | REQ-SCR-09 | spec |
| HOLD_SPECIAL | 150 | 100 to 250 | points/s | REQ-SCR-09 | spec (900ms Inference, CUDA Slide) |
| HOLD_CONTEXT_WINDOW | 60 | 40 to 120 | points/s | REQ-SCR-09 | spec |
| SPECIAL_FULL_BASE | 6000 | 4000 to 9000 | points | REQ-SPC-01 | spec |
| SPECIAL_IDLE_DELAY_S | 3.0 | 2 to 5 | s | REQ-SPC-02 | spec |
| SPECIAL_DRAIN_PER_S | 0.04 | 0.02 to 0.08 | ratio/s | REQ-SPC-02 | spec |
| SPECIAL_GLOW_OFF | 0.85 | 0.6 to 0.95 | ratio | REQ-SPC-03 | |
| INFERENCE_TIME_SCALE | 0.6 | 0.4 to 0.8 | ratio | REQ-SPC-05 | spec |
| INFERENCE_MIN_HOLD_MS | 900 | 600 to 1200 | ms | REQ-SPC-05 | |
| SPECIAL_HOLD_GOAL_S | 3.0 | 2 to 5 | s | REQ-WSH-06 | spec (Woodshed goal 9) |
| BAL_K0 | 0.5 | 0.3 to 1.0 | 1/s^2 | REQ-BAL-01 | |
| BAL_ELEMENT_GAIN | 0.12 | 0.06 to 0.20 | ratio | REQ-BAL-01 | spec |
| BAL_SAME_OBJECT_MULT | 1.6 | 1.2 to 2.0 | ratio | REQ-BAL-04 | spec |
| BAL_RECENTER | 0.35 | 0.2 to 0.5 | ratio | REQ-BAL-02 | spec |
| BAL_INPUT_ACCEL | 2.0 | 1.2 to 3.0 | 1/s^2 | REQ-BAL-01 | |
| BAL_DAMP | 1.5 | 0.5 to 3.0 | 1/s | REQ-BAL-01 | |
| BAL_START_OFFSET | 0.05 | 0 to 0.15 | needle | REQ-BAL-02 | |
| CONTEXT_WINDOW_DRIFT_MULT | 2.0 | 1.5 to 3.0 | ratio | REQ-BAL-01 | spec |
| STAT_FACTOR_BASE | 0.7 | 0.5 to 0.8 | ratio | REQ-CTL-13 | factor = base + per x stat |
| STAT_FACTOR_PER | 0.05 | 0.03 to 0.08 | ratio | REQ-CTL-13 | |
| STAT_SPEED | 6 | 0 to 10 | stat | REQ-CTL-13 | spec |
| STAT_AIR | 6 | 0 to 10 | stat | REQ-CTL-13 | spec |
| STAT_BALANCE | 6 | 0 to 10 | stat | REQ-CTL-13 | spec |
| STAT_SWITCH | 4 | 0 to 10 | stat | REQ-CTL-13 | spec |
| STAT_SPIN | 6 | 0 to 10 | stat | REQ-CTL-13 | spec |
| SWITCH_POP_PENALTY | 0.15 | 0.05 to 0.3 | ratio at stat 4 | REQ-CTL-13 | spec |
| SWITCH_DRIFT_MULT | 1.35 | 1.0 to 1.6 | ratio at stat 4 | REQ-CTL-13 | CR-19: spec-literal 1.25 (tolerance x0.8) -> 1.35 so the hands-off time really drops 20% under the damped needle |
| CAM_BACK_M | 6.0 | 3 to 8 | m | REQ-CAM-01 | spec 4.2; CR-45 |
| CAM_UP_M | 2.3 | 1 to 3 | m | REQ-CAM-01 | spec 1.6; CR-45 |
| CAM_LOOKAHEAD_M | 1.5 | 0.5 to 3 | m | REQ-CAM-01 | spec |
| CAM_OMEGA | 8 | 4 to 14 | 1/s | REQ-CAM-01 | spec |
| CAM_VERT_BACK_EXTRA_M | 2.5 | 1 to 4 | m | REQ-CAM-02 | was 2.0; CR-45 |
| CAM_VERT_UP_EXTRA_M | 1.8 | 0.5 to 3 | m | REQ-CAM-02 | was 1.5; CR-45 |
| CAM_VERT_BLEND_S | 0.3 | 0.1 to 0.6 | s | REQ-CAM-02 | |
| CAM_ORBIT_RATE_DPS | 180 | 90 to 300 | deg/s | REQ-CAM-03 | |
| CAM_ORBIT_RETURN_S | 1.2 | 0.5 to 2.5 | s | REQ-CAM-03 | spec |
| CAM_MOUSE_DEG_PER_PX | 0.15 | 0.05 to 0.4 | deg/px | REQ-CAM-03 | keyboard fallback, pointer lock |
| CAM_FOV_DEG | 70 | 60 to 85 | deg | REQ-CAM-04 | |
| CAM_FOV_KICK_DEG | 6 | 3 to 10 | deg | REQ-CAM-04 | spec |
| CAM_FOV_KICK_SPEED | 0.85 | 0.7 to 0.95 | ratio of vmax | REQ-CAM-04 | spec |
| SPEED_TIER_CRUISE_RATIO | 0.3 | 0.1 to 0.6 | ratio of vmax | REQ-CAM-04 | SpeedTier cruise from here; fast from CAM_FOV_KICK_SPEED (M0 review) |
| CAM_FOV_LERP | 4 | 2 to 8 | 1/s | REQ-CAM-04 | |
| CAM_COLLIDE_PAD_M | 0.3 | 0.1 to 0.6 | m | REQ-CAM-05 | |
| CAM_MIN_BOOM_M | 1.2 | 0.8 to 2.0 | m | REQ-CAM-05 | below it the camera rises instead |
| CAM_MIN_BOOM_RISE | 1.5 | 1.0 to 3.0 | ratio | REQ-CAM-05 | rise = (1.2 - hit) x 1.5 |
| CAM_SHAKE_BAIL_AMP_M | 0.12 | 0.05 to 0.25 | m | REQ-CAM-06 | |
| CAM_SHAKE_BAIL_S | 0.35 | 0.2 to 0.6 | s | REQ-CAM-06 | |
| HITSTOP_MACGUFFIN_MS | 60 | 30 to 120 | ms | REQ-FX-03 | spec; floor to 7 ticks |
| FLASH_MACGUFFIN_MS | 120 | 60 to 250 | ms | REQ-FX-03 | |
| SPARK_RATE_PER_S | 240 | 100 to 600 | particles/s | REQ-FX-01 | |
| DUST_BURST_COUNT | 24 | 8 to 64 | particles | REQ-FX-02 | |
| RUMBLE_GRIND_WEAK | 0.25 | 0 to 0.6 | ratio | REQ-INP-05 | 100 ms pulses |
| RUMBLE_GRIND_PULSE_MS | 100 | 50 to 200 | ms | REQ-INP-05 | |
| RUMBLE_BAIL_STRONG | 0.8 | 0.4 to 1.0 | ratio | REQ-INP-05 | 250 ms |
| RUMBLE_BAIL_MS | 250 | 150 to 400 | ms | REQ-INP-05 | |
| RUMBLE_GAP_STRONG | 0.5 | 0.2 to 0.8 | ratio | REQ-INP-05 | 120 ms |
| RUMBLE_GAP_MS | 120 | 60 to 200 | ms | REQ-INP-05 | |
| RUMBLE_MACGUFFIN_STRONG | 0.6 | 0.3 to 1.0 | ratio | REQ-INP-05 | 200 ms |
| RUMBLE_MACGUFFIN_MS | 200 | 100 to 300 | ms | REQ-INP-05 | |
| LAND_TEXT_S | 0.6 | 0.3 to 1.2 | s | REQ-HUD-04 | |
| GAP_SPLASH_S | 1.2 | 0.6 to 2.0 | s | REQ-HUD-04 | |
| MACGUFFIN_SPLASH_S | 1.5 | 1.0 to 2.5 | s | REQ-HUD-01 | |
| NPC_DIALOG_S | 4.0 | 2 to 8 | s | REQ-NPC-02 | |
| TALK_TRIGGER_M | 2.0 | 1.5 to 3.0 | m | REQ-NPC-02 | spec |
| UNLOCK_WOODSHED_GOALS | 6 | 1 to 10 | goals | REQ-GOL-03 | spec |
| STREET_HIGH / PRO / SICK / COMBO | 15000 / 40000 / 80000 / 10000 | fixed | points | REQ-STR-06 | spec |
| WOODSHED_HIGH / PRO / SICK / COMBO | 25000 / 60000 / 120000 / 15000 | fixed | points | REQ-WSH-06 | spec |
| RENDER_EXPOSURE | 1.0 | 0.5 to 2.0 | ratio | REQ-REN-01 | |
| BLOOM_THRESHOLD | 0.9 | 0.6 to 1.0 | ratio | REQ-REN-04 | |
| VIGNETTE | 0.25 | 0 to 0.5 | ratio | REQ-REN-04 | |
| CHROMATIC_ABERRATION | 0.0008 | 0 to 0.006 | ratio | REQ-REN-04 | glowing only (0.002 -> 0.0008, CR-64) |
| RAIL_EMISSIVE_RIM | 0.05 | 0.02 to 0.12 | ratio | REQ-MAT-02 | spec |
| SHADOW_BOX_M | 30 | 20 to 60 | m | REQ-REN-03 | |
| FPS_PROBE_S | 2 | 1 to 4 | s | REQ-REN-05 | spec |
| PIXEL_RATIO_CAPS | [1.0, 1.25, 1.5, 2.0] | fixed | ratio | REQ-REN-05 | spec Low/Med/High/Ultra |
| SHADOW_MAP_SIZES | [1024, 2048, 2048, 4096] | fixed | px | REQ-REN-05 | |
| POSE_BLEND_MS | 80 | 40 to 160 | ms | REQ-SKT-03 | |
| TURNTABLE_DPS | 12 | 6 to 30 | deg/s | REQ-LAB-01 | |
| MAX_STICKERS | 6 | 6 | count | REQ-LAB-01 | spec |
| MUSIC_BPM_STREET | 94 | 80 to 160 | bpm | REQ-AUD-02 | CR-41 |
| MUSIC_BPM_WOODSHED | 170 | 120 to 170 | bpm | REQ-AUD-02 | CR-41 |
| JS_GZIP_MAX_KB | 1500 | 1500 | KB | REQ-DEP-04 | spec |
| MENU_FLYTHROUGH_S | 40 | 20 to 90 | s | REQ-MNU-01 | |
| GAP bases | see G.1 and G.2 (MS-G01 to MS-G12, WS-G01 to WS-G12) | 200 to 2000 | points | REQ-STR-04, REQ-WSH-06 | authored in level data, not tuning.ts |
| Trick bases | see D.2 | per category | points | REQ-SCR-09 | authored in tricks.ts |

---

## N. REQ index

Generated from every REQ row above (ID, one-line requirement, SPEC source, verification). "mine" = a gap the spec left open, filled here.

| ID | Requirement | SPEC | Verified by |
|---|---|---|---|
| REQ-TIM-01 | Simulation runs at a fixed 120 Hz tick with an accumulator; render frames interpolate between the two latest sim states. | §7 | tests/loop.test: 1000 frames of random dt produce the same tick cou... |
| REQ-TIM-02 | Input is sampled once per render frame; the sim consumes the latest snapshot each tick. Button press and release edge... | §7 | input.test: two presses within one frame produce two press events |
| REQ-TIM-03 | Every timing window is measured in sim ticks via ticks(ms) = Math.ceil(ms * SIM_HZ / 1000 - 1e-9) and compared half-o... | §7, AGENTS | grep test: no Date/performance in src/sim; tuning.test: ticks(200)... |
| REQ-TIM-04 | Accumulator catch-up is capped at 0.1 s per render frame (12 ticks); beyond that the sim drops time rather than spiral. | mine | loop.test |
| REQ-TIM-05 | Window lengths in ticks: coyote 11, grind pre-buffer 24, revert pre 18, revert post 22, revert-to-manual 24, manual l... | §7 | tuning.test: each window key converts to the listed tick count |
| REQ-INP-01 | The map above is the only binding set in MVP; keyboard is a fallback and every action is reachable on a pad. | §5 | input.test: every Action has a pad binding |
| REQ-INP-02 | Dir8 comes from D-pad OR left stick: stick deadzone 0.35, 8 sectors of 45 deg centred on the cardinals; if both are n... | §5 | input.test: 16 stick angles + 8 dpad states map to expected Dir8 |
| REQ-INP-03 | A DirEnter event fires when Dir8 changes to a non-neutral value that is then held for at least DIR_MIN_DWELL_TICKS (3... | §5, CR-11 | input.test: Up,Neutral,Down yields 2 events; a 120 ms rim sweep Up... |
| REQ-INP-04 | Double-tap: the same flip or grab (same button AND same Dir8) pressed again within 250 ms while in Air upgrades the p... | §5 | input.test: two kickflip presses 200 ms apart = Double Kickflip once |
| REQ-INP-05 | Rumble via gamepad.vibrationActuator: grind contact light (weak 0.25, 100 ms pulses while grinding), bail medium (str... | §5 | manual check + rumble.test: calls are no-ops without an actuator |
| REQ-INP-06 | Glyph set from gamepad.id: contains "Xbox" -> Xbox glyphs; contains "054c" or "DualSense" or "Wireless Controller" ->... | §5 | input.test: three ids |
| REQ-INP-07 | Keyboard flip/grab direction = held WASD/arrow direction at the moment J/K is pressed; keyboard steer and Dir8 share... | §5 | input.test |
| REQ-INP-08 | Gamepad connect/disconnect mid-run auto-pauses with the message "Controller disconnected"; reconnect resumes on any b... | §12 | e2e smoke: simulated disconnect event shows the overlay |
| REQ-INP-09 | A "Click or press any button to start" gate precedes the menu so audio and gamepad activate. | §12 | e2e smoke |
| REQ-INP-10 | The parser is a pure function of (state, glowing, snapshot, ring, buffers) and applies the priority table above in or... | CR-11, CR-12 | input.test: table rows as cases |
| REQ-INP-11 | CR-11: DirEnter events consumed by a special are removed from the manual readers; a landed Kernel Panic (U,D + Circle... | CR-11 | input.test: U,D,Circle then land on flat -> no manual |
| REQ-INP-12 | Specials are only parsed while glowing; the same sequence while not glowing falls through to the normal trick (U,D +... | CR-11 | input.test |
| REQ-INP-13 | CR-12: in Grind, two directions within 250 ms + Triangle while glowing = CUDA Slide; otherwise a single direction + T... | CR-12 | input.test: U,D(200ms),Triangle glowing -> gpu_slide; not glowing ... |
| REQ-INP-14 | Context Window: in Manual, L,R within 250 ms + Triangle while glowing; otherwise Triangle in Manual falls through to... | CR-10 | input.test |
| REQ-INP-15 | Grind press while crouched is buffered from the pop tick; a grind press in Air with no candidate stays valid 24 ticks... | §7 | input.test, stateMachine.test |
| REQ-INP-16 | R2 in Air is a spine transfer only when the transfer condition holds; otherwise it is a revert pre-buffer. A transfer... | §9.2 | stateMachine.test |
| REQ-INP-17 | Every pair reader measures the gap as H[-1].tEnter - H[-2].tExit (leave-to-enter); DirEnter entries record both stamps. | mine | input.test: Up held 2 s then Down within 100 ms -> MANUAL |
| REQ-INP-18 | Manual swaps are rate-limited: second direction held >= 4 ticks, 600 ms cooldown, at most 3 swaps per manual run; bal... | mine | balance.test: 20 alternating taps over 4 s produce at most 3 swaps |
| REQ-TIM-06 | Coyote: a Cross press within 90 ms (11 ticks, half-open) after leaving a ledge, rail end or coping edge pops as if th... | CR-14 | stateMachine.test |
| REQ-TIM-07 | Revert pre-buffer: R2 pressed up to 150 ms before a vert contact fires the revert on the contact tick. | CR-03 | stateMachine.test "pre-buffer fires on contact" |
| REQ-TIM-08 | Manual entry on land: the Up->Down pair completed within 140 ms before flat contact (row 7, on the contact tick) or a... | §7 | stateMachine.test |
| REQ-TIM-09 | Revert to manual: 200 ms from entering RevertWindow; pair events pressed during the revert animation are retained. | CR-03 | stateMachine.test |
| REQ-TIM-10 | Get-up lockout 0.85 s: no input is parsed in GetUp except pause and camera. | §7 | stateMachine.test |
| REQ-TIM-11 | LandWindow timer: 17 ticks after a flat landing (MANUAL_LAND_WINDOW_MS) or 22 ticks after a vert landing (REVERT_POST... | §7, CR-18 | stateMachine.test rows 9 to 9h; "R2 at 170 ms after a vert landing... |
| REQ-SM-01 | The state machine is a pure, table-driven module (src/sim/stateMachine.ts) with no rendering imports; every row above... | §8 | stateMachine.test: one test per row 1 to 41 including lettered rows |
| REQ-SM-02 | Combo is alive only in Air, Grind, Lip, Manual, RevertWindow, LandWindow; entering Grounded banks, entering Bail disc... | §6, CR-18 | stateMachine.test |
| REQ-SM-03 | Landing bail conditions: yaw off-axis > 28 deg, or tilt > 40 deg, or an unfinished flip/grab/special animation at con... | §6, §8 | stateMachine.test row 10; "grab released 100 ms before contact bail... |
| REQ-SM-04 | Revert toggles stance and yaws the board 180 deg; the fakie flag is recomputed from velocity versus nose after the pi... | CR-04 | stateMachine.test "revert toggles stance" |
| REQ-SM-05 | Bail: combo discarded, special meter set to 0, 0.6 s tumble then 0.85 s GetUp lockout. | §6 | scoring.test, stateMachine.test |
| REQ-SM-06 | Grind rail end and a grind-switch press on the same tick: rail end wins, the press is dropped. | mine | stateMachine.test |
| REQ-SM-07 | Landing with Cross held is not a linker: the combo banks (or nothing if none), then Crouch begins at the contact tick... | mine | stateMachine.test rows 12, 13 |
| REQ-SM-08 | Manual ends (banks) when speed < 1.0 m/s or, climbing a bank (not a transition), the surface slope reaches 35 deg; up a transition the manual rides on and leaves the lip into the air (CR-55). | mine | stateMachine.test rows 30, 31; integrationManualLine.test |
| REQ-SM-09 | At 0:00 mid-combo the clock freezes and the run ends when the combo resolves; landed banks, bail loses; a 30 s overti... | §15 | stateMachine.test row 40 |
| REQ-SM-10 | Bail during RevertWindow is only possible from a head-on wall hit. | mine | stateMachine.test row 17 |
| REQ-SM-11 | Physics never changes state on its own: the controller emits events (contact, railEnd, wallHit, stall, leftSurface) a... | §19 | grep test: src/sim/controller has no state assignment |
| REQ-SM-12 | Every way off a surface is a row: Grounded, Crouch, Manual and LandWindow each have a leftSurface row (37, 37b, 33b,... | mine | stateMachine.test rows 37, 37b, 33b, 9h |
| REQ-SM-13 | Pump versus crouch: Cross held on a transition while descending is a pump (state stays Grounded, no charge, release f... | mine | stateMachine.test rows 1, 1b, 1c: a bowl pump release does not hop |
| REQ-SM-14 | Grind has wall rows: head-on = Bail, glancing = clamp along the rail; Lip cannot hit a wall. | §8 | stateMachine.test rows 22b, 22c |
| REQ-CTL-01 | Kinematic capsule controller with three-mesh-bvh raycasts; no rigidbody engine. | §4 | grep test: no cannon/rapier/ammo import |
| REQ-CTL-02 | Surface classes flat / bank / transition / near-vertical / wall are computed from tag and slope exactly as the vocabu... | mine | controller.test: 6 normals classify as listed |
| REQ-CTL-03 | Ground steering at 150 deg/s at rest falling linearly to 75 deg/s at vmax; velocity follows heading with no slip; man... | mine | controller.test: a 180 deg manual turn at 7.5 m/s spans 7.2 m |
| REQ-CTL-04 | Auto-push at 4.5 m/s^2 while stick forward and v < 70% vmax; rolling friction 0.25 m/s^2; brake 6.0 m/s^2; pivot inst... | §15 | controller.test: 0 to 7.7 m/s in 1.71 s within 1 tick; stick back i... |
| REQ-CTL-05 | Ollie height 0.9 m tap to 1.6 m at 0.6 s charge, linear in charge; v_pop = sqrt(2gh); pop direction blends normal and... | §15, §8 | controller.test: apex 0.9 / 1.6 m within 1 cm |
| REQ-CTL-06 | Gravity 22 m/s^2 in air; max speed 11 m/s (+8% glowing); over-speed decays at 4 m/s^2. | §15 | controller.test |
| REQ-CTL-07 | Landing keeps 0.96 of the tangential speed and discards the normal component; yaw snaps to the nearest 180 within 100... | mine | controller.test |
| REQ-CTL-08 | No fall damage. | mine | controller.test: 10 m drop lands clean |
| REQ-CTL-09 | Auto-orientation toward the predicted landing normal at 360 deg/s; prediction ray 0.25 s ahead, refreshed every 4 ticks. | mine | controller.test: launching from flat onto a 60 deg bank lands with... |
| REQ-CTL-10 | Yaw off-axis and tilt off-axis are computed exactly as defined in the vocabulary table; land quality: clean < 15, OK... | §6 | scoring.test, controller.test |
| REQ-CTL-11 | On surfaces tagged transition the along-surface gravity is g x 0.45; pump adds 4.0 m/s^2 while Cross is held on the w... | mine | controller.test: 11 m/s reaches a 3.6 m coping at 7.05 m/s within 0.1 |
| REQ-CTL-12 | Rolling onto a transition converts velocity to the surface tangent with no loss; leaving the top edge of a transition... | mine | controller.test |
| REQ-CTL-13 | Stats mapping: statFactor(s) = 0.7 + 0.05 x s (6 -> 1.0). speed scales vmax; air scales ollie height; balance divides... | §15, CR-19 | scoring.test, balance.test: switch stance bails 20% sooner (within... |
| REQ-CTL-14 | Pop out of Grind / Manual / Lip uses the same charge curve (hold Cross while on the linker, pop on release); a tap gi... | §8 | stateMachine.test |
| REQ-CTL-15 | The skater collects letters and MacGuffins when the collect point (feet + 0.9 m world up) is within 0.9 m (COLLECT_RA... | mine | levels.test |
| REQ-CTL-16 | Sim uses the seedable RNG only (needle start sign, spark seeds); no Math.random in src/sim. | AGENTS | grep test |
| REQ-CTL-17 | Slope thresholds: FLAT_MAX_SLOPE 35, VERT_LAND_MIN_SLOPE 40, VERT_ASSIST_MIN_SLOPE 70, WALL_MIN_SLOPE 80 deg. | mine | controller.test |
| REQ-CTL-18 | On a transition below the coping with v < 0.5 m/s the skater rolls back down (no stall); reversing direction on a tra... | mine | controller.test |
| REQ-CTL-19 | The render transform interpolates the last two sim states; sim positions are never written by the renderer. | §7 | grep test |
| REQ-CTL-20 | Wall hit: contact with a wall (slope >= 80, not transition) at speed >= 5.0 m/s and incidence angle <= 45 deg between... | §8 | controller.test: 6 m/s at 30 deg bails; 6 m/s at 60 deg slides |
| REQ-CTL-21 | Pump: Cross held on a transition while descending adds 4.0 m/s^2 along the surface with no crouch and no hop on relea... | mine | controller.test: a bowl pump-and-release leaves the surface never |
| REQ-CTL-22 | Air collision uses one sphere r 0.35 at 0.45 m above the feet along the skater up; the head is never collided; rail a... | mine | controller.test: a full-pipe air at 11 m/s with a full pop never in... |
| REQ-VRT-01 | Vert assist as defined above: perpendicular horizontal component x0.15 clamped to [0.4, 1.0] m/s outward, along-copin... | CR-15 | controller.test: exit at 8.5 m/s up a 2.4 QP lands on the same face... |
| REQ-VRT-02 | Pop on a face with slope >= 45 deg is scaled by 0.6 and blended 45 deg toward up, giving the air table above. | mine | controller.test: every row of the air table within 3% |
| REQ-VRT-03 | Stick spin: yaw rate 360 deg/s x statFactor(spin) from the horizontal stick axis (analog, proportional to deflection... | §5 | controller.test |
| REQ-VRT-04 | Quick spin: each L1/R1 press queues a 180 deg burst at 720 deg/s (0.25 s); holding repeats bursts back to back; burst... | CR-01 | input.test, controller.test |
| REQ-VRT-05 | Spin credit at the end of an air (landing, grind snap, lip snap or transfer) = round(abs(total yaw in this air) / 180... | §6 | scoring.test: 170 deg lands as 1 spin, 80 deg as 0; a 180 into a gr... |
| REQ-VRT-06 | Landing on vert: with the skater basis (nose0 = launch tangent, up the face) an even number of 180s (including zero)... | CR-04 | stateMachine.test; controller.test: 180 spin on a 90 deg wall lands... |
| REQ-VRT-07 | Multiple airs in one combo accumulate spin credit (multiplier +0.5 per 180 total). | §6 | scoring.test |
| REQ-VRT-08 | Spine transfer, implemented as SPEC §9.2 says (rotate 180 deg around the edge's axis = a mirror). Condition: state Ai... | §9.2, CR-15 | stateMachine.test row 11; controller.test: transfer pressed 0.4 s a... |
| REQ-VRT-10 | Coyote pop after leaving a transition at slope >= 70: pop direction = up, then the assist clamp is re-applied; the po... | mine | controller.test: 11 m/s up the QP, Cross released 50 ms after leavi... |
| REQ-VRT-11 | Full-pipe launch: at the 4.0 m line the toward-axis horizontal speed is set to FULLPIPE_ASSIST_OUT_MPS (2.0) instead... | mine | controller.test: 11 m/s full pop in WS-FP1 clears the wall and land... |
| REQ-VRT-12 | Spin uses the skater basis (yawTotal about up_s, nose0 = launch tangent); the 28 deg rule and the fakie flag read tha... | mine | controller.test: 180 spin on a 90 deg wall lands forward with off-a... |
| REQ-VRT-09 | Landing quality text: clean < 15 deg, OK 15 to 28 deg, SICK when the banked combo >= 10,000, INSANE >= 50,000 (SICK/I... | §6 | hud.test |
| REQ-CAM-01 | Chase camera: 4.2 m behind, 1.6 m up, look-at target 1.5 m ahead along velocity (or heading at rest), critically damp... | §10 | camera.test: step response settles within 2% in 0.8 s, no overshoot |
| REQ-CAM-02 | In vert air (assist active) the offset grows by 2.0 m back and 1.5 m up over 0.3 s so the ramp stays framed; returns... | §10 | camera.test |
| REQ-CAM-03 | Right stick orbits at 180 deg/s; 1.2 s after release the camera springs back behind the skater. Keyboard: mouse with... | §10, §5 | camera.test: 100 px of mouse motion orbits 15 deg and springs back |
| REQ-CAM-04 | Base FOV 70 deg; +6 deg kick above 85% of vmax, lerped at 4/s; speed lines start at the same threshold. The sim's speed tier enters "fast" SIM_SPEED_TIER_HYST (0.03) above the threshold and leaves below it (CR-56). | §10 | camera.test; integrationSpeedTier.test |
| REQ-CAM-05 | Camera collision: a ray from the target to the desired position shortens the boom to the hit distance minus 0.3 m, bu... | mine | camera.test: a 3 m corridor keeps the boom >= 1.2 m |
| REQ-CAM-06 | Bail shake: 0.12 m amplitude decaying over 0.35 s. | §10 | camera.test |
| REQ-CAM-07 | Never first-person or shoulder by default; the camera reads the interpolated sim state only. | §2 | manual |
| REQ-SCR-01 | FINAL = floor(COMBO_BASE x MULTIPLIER) with COMBO_BASE and MULTIPLIER as in D.1; the D.3 example produces exactly 15504. | §6, §14-D | scoring.test "worked example" |
| REQ-SCR-02 | Switch stance multiplies the base by 1.2 for every element added while the stance flag is switch; hold accruals are not multiplied (SPEC §6 applies stance in trickValue only). | §6, CR-05 | scoring.test: switch_manual base 60, its 1.5 s accrual 60 |
| REQ-SCR-03 | Spin adds +0.5 to the multiplier per 180 (SPIN_MODE "multiplier"); preset "base" instead adds 100 points x 180s to th... | CR-08 | scoring.test "spin adds 0.5" |
| REQ-SCR-04 | Hold accruals are added un-degraded and un-multiplied by stance at holdRate x seconds, rounded to the nearest point wh... | §6 | scoring.test |
| REQ-SCR-05 | Named gaps add base and +1 and never degrade; each gap can be earned once per combo, any number of times per run. | §6 | scoring.test "gaps never degrade" |
| REQ-SCR-06 | MacGuffin pickup = 2500, +1, never degrades, once per career (it stays collected). | §6 | scoring.test |
| REQ-SCR-07 | Bail discards the whole combo and sets the special meter to 0. | §6 | scoring.test "bail" |
| REQ-SCR-08 | Land text thresholds: SICK 10,000, INSANE 50,000 on the banked FINAL. | §6 | hud.test |
| REQ-SCR-09 | Trick data lives in src/data/tricks.ts with the schema of SPEC §9.1 and the exact bases of D.2. | §9.1 | tricks.test: every base matches this table |
| REQ-SCR-10 | Nollie / fakie variants (L2 held) are distinct IDs with base x1.1 (NOLLIE_FAKIE_MULT). | §5 | scoring.test |
| REQ-SCR-11 | Enhanced tricks replace the pending element (never two elements); enhanced base = base + FLIP_TIER_STEP (flips and gr... | §5 | scoring.test; tricks.test: no enhanced anim exceeds 740 ms |
| REQ-DEG-01 | Degradation per run keyed by trick ID: 1.00, 0.90, 0.75, 0.50, 0.25 (5th and later 0.25). Reset at run start. | §6, CR-07 | scoring.test "degradation table" |
| REQ-DEG-02 | Preset DEGRADATION_PRESET = "thps1" (default) or "thps3" (1.00, 0.75, 0.50, 0.25, 0.10), selectable in tuning. | CR-07 | scoring.test |
| REQ-DEG-03 | Switch, nollie, fakie and enhanced variants have separate histories from the base trick. | CR-05 | scoring.test "switch variant separate history" |
| REQ-DEG-04 | The count increments when the element is added to the combo line, whether or not the combo later banks. | mine | scoring.test |
| REQ-DEG-05 | A grind-type switch is a new element with its own history; switching to the current type is ignored. | §6 | scoring.test |
| REQ-SPC-01 | Special meter in [0, 1]; each completed element adds (trickValue + accrual) / 6000 (SPECIAL_FULL_BASE), clamped. | §6 | special.test |
| REQ-SPC-02 | Idle drain 4% per second after 3.0 s without a completed element; drain pauses while a combo is alive. | §6 | special.test |
| REQ-SPC-03 | Glowing turns on at meter >= 1.0 and off below 0.85 (hysteresis); glowing enables specials and +8% vmax. | §6 | special.test |
| REQ-SPC-04 | Bail sets the meter to 0 and ends glowing immediately. | §6 | special.test |
| REQ-SPC-05 | Holdable specials accrue at their hold rate; 900ms Inference scales sim time by 0.6 while held (the render loop advan... | §9.1 | special.test: 0.6 s of dilated sim advances the run clock 1.0 s |
| REQ-SPC-06 | Specials require glowing at the press tick only; the meter is not spent by a special. | §9.1 | special.test |
| REQ-BAL-01 | Needle in [-1, 1]; bail at abs >= 1. Per tick: nv += (k x sign(needle) - input x 2.0) x dt; nv x= (1 - 1.5 x dt); nee... | §6, CR-06 | balance.test "drift grows with element count", "same object x1.6" |
| REQ-BAL-02 | Each new grind/lip/manual element sets needle = 0.35 x sign(previous needle) (0.05 x a seeded random sign for the fir... | CR-06 | balance.test "re-center on new element" |
| REQ-BAL-03 | Balance input axis: manual = vertical stick/dpad (Up = input -1 pushes the needle negative = nose down), grind and li... | CR-02 | balance.test: both axes and both signs |
| REQ-BAL-04 | Same object = the previous grind element in this combo was on the same rail id (a polyline is one object). Not compou... | §6 | balance.test |
| REQ-BAL-05 | elements in the drift formula counts the +1 elements already in the combo when the linker starts, excluding the linke... | CR-06 | balance.test: first grind k = 0.5, second element k = 0.56 |
| REQ-BAL-06 | The HUD balance meter reads the needle directly: horizontal arc over the head for grind/lip, vertical bar beside the... | §17 | hud.test |
| REQ-GRD-01 | Rails are explicit polylines {id, points, kind: rail / ledge / coping, tags, name} authored in level data; the builde... | §9.2 | levels.test: every rail id has geometry and every ledge/coping top... |
| REQ-GRD-02 | Magnet: closest point on each segment, radius 0.55 m, horizontal entry angle <= 55 deg between velocity and the rail... | §7, §14-E | grind.test: 8 geometric cases |
| REQ-GRD-03 | Snap: 80 ms position blend to the rail, velocity set to tan3D x max(dot(v, tan3D), 3.0) m/s, needle re-centred, eleme... | §14-E | grind.test: an ollie snapped while rising at 4 m/s vertical enters... |
| REQ-GRD-04 | Pre-buffer: a Triangle press in Air stays valid 200 ms and snaps the moment a candidate appears; a press with no cand... | §7 | grind.test, stateMachine.test |
| REQ-GRD-05 | Ground snap: Triangle while Grounded, LandWindow or Manual at >= 3.0 m/s with a rail within the magnet and rail heigh... | §1 rule 5 | grind.test: dy 0.6 hops 0.7 m; dy 0.8 is refused |
| REQ-GRD-06 | Grind types and their Dir8 per D.2; Boardslide/Lipslide chosen by the toe-side rule; the type is fixed at snap unless... | §9.1 | grind.test: toe-side cases for regular, switch, fakie |
| REQ-GRD-07 | Type switch: Dir8 + Triangle in Grind, new type differs, 100 ms cooldown; +1 element with its own history; needle re-... | §6, §8 | grind.test, scoring.test |
| REQ-GRD-08 | Rail motion: friction by kind (0.10 rail, 0.30 ledge, 0.15 coping) and 0.35 g along-rail slope component; below 1.5 m... | mine | grind.test: 8 m/s lasts > 20 s on a flat rail; 9 m/s entering MS-P1... |
| REQ-GRD-09 | Rail end: state Air with the tangent velocity (vertical component included on sloped rails); coyote 90 ms applies. | §8, CR-14 | stateMachine.test |
| REQ-GRD-10 | Polyline corners with a direction change > 55 deg act as rail ends. | mine | grind.test |
| REQ-GRD-11 | Same object detection uses the rail id (one polyline = one id, kinked ledges included). | §6 | balance.test |
| REQ-GRD-12 | Every rail and coping renders a faint emissive rim (0.05) and shows sparks while grinding; sparks are GPU points with... | §10 | e2e screenshot review |
| REQ-GRD-13 | A hold-accrual of holdRate x seconds (no stance factor, no degradation) is added when the grind element ends (exit, switch or bail excluded). | §6 | scoring.test |
| REQ-GRD-14 | Rails are spatially hashed (cells 8 m) so the magnet query touches at most the 9 cells around the board. | mine | grind.test perf: 1000 queries < 5 ms |
| REQ-GRD-15 | Grind wall handling: head-on (REQ-CTL-20) = Bail, glancing = tangential speed x0.8 clamped along the rail; the level... | §8 | stateMachine.test rows 22b, 22c; levels.test "no rail ends at a wall" |
| REQ-MAN-01 | Manual entry on flat from Grounded (pair within 250 ms, speed >= 1.0, slope < 35) starts a combo with element +1. | §8 | stateMachine.test row 4 |
| REQ-MAN-02 | Manual as a landing linker within the 140 ms window keeps the combo (also from RevertWindow within 200 ms). | §7, §8 | stateMachine.test "manual within 140 ms keeps combo" |
| REQ-MAN-03 | Nose/normal swap by the opposite pair is +1 with its own history and re-centres the needle. | §8 | scoring.test |
| REQ-MAN-04 | Manual balance uses the vertical axis; needle dynamics per REQ-BAL-01; manual friction 0.35 m/s^2. | CR-02 | balance.test |
| REQ-MAN-05 | Manual exits: pop (Cross), bail (needle, wall), stop (< 1.0 m/s), slope (>= 35) as in the state table rows 27 to 34. | §8 | stateMachine.test |
| REQ-MAN-06 | The combo survives a manual: grind -> manual -> grind banks as one combo (quality gate). | §19 | stateMachine.test, e2e |
| REQ-MAN-07 | A manual entered from RevertWindow on a transition continues down the face; row 31 ends a manual only when it climbs... | mine | stateMachine.test: revert-manual on the QP face rolls out onto the... |
| REQ-REV-01 | Revert requires a landing on slope >= 40 deg and R2 within [-150, +180) ms of contact (pre-buffer before, LandWindow... | CR-03, CR-04 | stateMachine.test rows 8, 9c, 15, 16 |
| REQ-REV-02 | Manual inputs pressed during the revert animation are buffered, not dropped; a pair completed within 200 ms enters Ma... | CR-03 | stateMachine.test "revert to manual inside 200 ms" |
| REQ-REV-03 | Timeout of the window banks the combo. | §8 | stateMachine.test "timeout kills it" |
| REQ-REV-04 | Revert speed x0.85 and yaw 180 deg; the fakie flag is recomputed. | mine | controller.test |
| REQ-REV-05 | The quality gate case: land on vert with R2 pressed 100 ms early, then Up,Down at 150 ms -> Manual with the combo ali... | §19 | stateMachine.test |
| REQ-LIP-01 | MVP ships Axle Stall (neutral) and Rock to Fakie (Down), base 150, +100/s, entered as defined above. | CR-13 | stateMachine.test row 6, lip.test |
| REQ-LIP-02 | Lip versus coping grind is decided by the approach angle to the coping tangent (<= 55 grind, > 55 lip); a rail or led... | mine | grind.test |
| REQ-LIP-03 | Lip exit: position = coping + 0.15 m along the face normal, v = faceDown x 3.5 + up x 0.5 x sqrt(2 x 22 x 0.25); the... | §8 | lip.test: exit on the QP contacts the face within 0.4 s at slope >= 40 |
| REQ-LIP-04 | Lip balance uses the horizontal axis and the shared needle rules. | CR-02 | balance.test |
| REQ-STR-01 | Market Street is built from data exactly as the feature and rail tables above (positions within 0.05 m). | §9.2 | levels.test: spot-check 12 coordinates |
| REQ-STR-02 | The four lines are skateable as described: each line's rail feeds are within 3.5 m / 1.2 m / 0.5 m lateral or bridged... | §9.2 | levels.test: feed distances and hop simulation; e2e scripted line 1 |
| REQ-STR-03 | Letters and the Laptop at the listed coordinates; the Laptop fails the max-ollie check at spawn and the 12 spawnArea... | §9.2 | levels.test "MacGuffin not spawn-ollie reachable" |
| REQ-STR-04 | The 12 named gaps with the listed conditions and bases; each gap is a start/end trigger pair or an element-sequence r... | §9.2 | levels.test, scoring.test |
| REQ-STR-05 | SAM at (50, 27, 0.8) with a 2 m trigger, the line above (no em dash), splash and toast. | §9.2, AGENTS | levels.test: text has no U+2014 |
| REQ-STR-06 | The 10 goals with the listed conditions; 6 of 10 unlocks Woodshed. | §9.2 | goals.test |
| REQ-STR-07 | Street plays as a street park: 10 ledges (L1 to L8, R8, R9), 9 rails (R1, R2, R3, R4, R6, R7, P1, P2, P3), 5 copings... | §19 "parks play identically" | levels.test: primitive census |
| REQ-WSH-01 | Woodshed is built from data exactly as the feature and rail tables above. | §9.2 | levels.test |
| REQ-WSH-02 | Rail spacing: every listed feed is within 3.5 m horizontal, 1.2 m up and 0.5 m lateral (WS-RA->RB, WS-RE->RF, FB1->FB... | §9.2 | levels.test "Woodshed rail spacing" |
| REQ-WSH-03 | The 20 s chain in the table is holdable by a scripted competent input (balance held at the needle sign, manual turns... | §9.2, §19 | e2e "woodshed rail chain" with scripted input asserts duration and... |
| REQ-WSH-04 | Spine transfer works on WS-SP1 from both sides and on WS-VW1 onto the deck. | §9.2 | e2e scripted transfer; stateMachine.test |
| REQ-WSH-05 | Letters and the Drive at the listed coordinates; the Drive fails the max-ollie check at spawn and the 12 spawnArea po... | §9.2 | levels.test: MacGuffin unreachable; letter reach simulation |
| REQ-WSH-06 | The 12 gaps, DARIO, splash and toast, the 10 goals as listed. | §9.2 | levels.test, goals.test |
| REQ-WSH-07 | Woodshed plays as a transition park: 2 bowls, 1 spine, 1 full-pipe, 1 vert wall, 2 quarter-pipes, 1 snake run, 1 hump... | §19 | levels.test: primitive census differs from Street |
| REQ-LVL-01 | Levels are TypeScript data in src/levels/*.ts with the schema at the top of section G; the builder produces meshes, B... | §9.2 | levels.test |
| REQ-LVL-02 | Rails are explicit polylines {id, points, kind, tags?, name?}; kinds rail / ledge / coping; tags include transfer. | §9.2 | levels.test |
| REQ-LVL-03 | Validation: every eligible grind line has a rail within 0.1 m. Eligible lines are (a) the coping line of every qp, bo... | §9.2 | levels.test "rail coverage": fails when MS-L7 is removed, passes wi... |
| REQ-LVL-04 | Validation: no decal quad overlaps a rail within 0.15 m. | §9.2 | levels.test "decals off rails" |
| REQ-LVL-05 | Validation: a simulated straight-up max ollie (1.6 m + 0.9 m reach) at spawn and at a 3 x 4 grid of 12 points over th... | §9.2 | levels.test "MacGuffin unreachable" |
| REQ-LVL-06 | Validation: every listed feed (Woodshed per REQ-WSH-02, Street scaffold per G.1) is <= 3.5 m horizontal, <= 1.2 m up... | §9.2 | levels.test |
| REQ-LVL-07 | Named gaps are data: {id, name, base, rule} where rule is one of airBoxToBox, grindSpan, grindDistance, grindSequence... | §9.2 | scoring.test: one test per rule kind |
| REQ-LVL-08 | Trigger volumes for letters (0.9 m collect radius) and NPC talk (2.0 m). | §9.2 | levels.test |
| REQ-LVL-09 | Every rideable curved surface primitive is tagged transition by the builder; boxes and banks are not. | mine | levels.test |
| REQ-LVL-10 | Validation: levels.test simulates each listed feed as a straight-line hop (no air steer) at the recorded exit speed w... | mine | levels.test "feed hop simulation": P3 -> R7 passes at 6.0 m/s, fail... |
| REQ-LVL-11 | Rail and coping pipe meshes are excluded from the movement BVH; the builder emits four boundary walls (h 12) at the s... | mine | levels.test: a ray through a flat bar at ground level hits nothing;... |
| REQ-LVL-12 | No rail end lies within 0.5 m of a wall along its exit tangent. | mine | levels.test "no rail ends at a wall" |
| REQ-GOL-01 | Career runs are 2:00 (RUN_LENGTH_S 120), the default session; Free Skate has no clock (CR-42). | §2, §19 | goals.test, e2e |
| REQ-GOL-02 | Ten goals per park with the exact conditions listed; goal state persists per career; goals referencing elements count... | §9.2 | goals.test |
| REQ-GOL-03 | Woodshed unlocks at 6 completed Street goals. | §9.2 | goals.test |
| REQ-GOL-04 | Both MacGuffins collected -> Lab Circuit stamp on the main menu. | §9.2 | goals.test, e2e |
| REQ-GOL-05 | Letters reset per run; C-O-D-E requires all four in one run; the HUD tray shows collected letters. | §9.2 | goals.test |
| REQ-GOL-06 | At 0:00 the clock freezes; a live combo may still bank; the results card follows. | §15 | stateMachine.test row 40 |
| REQ-GOL-07 | Results card shows score, best combo, goals completed this run, nearest uncompleted goal with distance, Retry and Par... | §14-B | e2e |
| REQ-NPC-01 | NPCs are primitive-built low-poly figures with no facial likeness; SAM: hoodie, empty laptop sleeve; DARIO: contest j... | §9.2, §11 | screenshot review |
| REQ-NPC-02 | Talk trigger: rolling within 2 m opens the dialog box in the HUD with the NPC line; closes after 4 s or on any confir... | §9.2 | e2e |
| REQ-NPC-03 | NPC names and lines read from src/data/brands.ts for the parody/real switch (Sam / Dario stay; titles differ). | §11 | brands.test |
| REQ-NPC-04 | No em dashes in any NPC line, toast or splash. | AGENTS | levels.test: text scan |
| REQ-HUD-01 | HUD shows: clock (top centre, red pulse under 0:10), run score, combo ticker (names joined by " + ", live base x mult... | §17 | hud.test (DOM), e2e screenshot |
| REQ-HUD-02 | The HUD is a DOM/CSS overlay over the canvas, reads a read-only view of the sim, and never writes sim state. | §4 | grep test |
| REQ-HUD-03 | Combo ticker updates within one render frame of an element being added; the running total shows COMBO_BASE x MULTIPLI... | §17 | hud.test |
| REQ-HUD-04 | Land text: clean shows nothing, OK shows "OK", SICK / INSANE per thresholds, shown 0.6 s. Gap splash 1.2 s with "+base". | §6, §17 | hud.test |
| REQ-HUD-05 | Button glyphs in HUD hints and menus follow the detected pad (REQ-INP-06). | §5 | e2e |
| REQ-HUD-06 | No em dashes in any HUD string; system font stack only. | AGENTS | text scan test |
| REQ-MNU-01 | Main menu: Title with the animated park flythrough, Career, Free Skate, Board Lab, Options, Credits; Lab Circuit stam... | §17 | e2e screenshot "menu" |
| REQ-MNU-02 | Every menu is fully navigable with D-pad/stick + confirm (Cross/A) + back (Circle/B); keyboard mirrors with arrows/En... | §17, §19 | e2e: scripted pad input reaches every screen |
| REQ-MNU-03 | Pause (Options/Menu/Esc) freezes the sim, shows the goal list with completion state, Resume, Restart run, Options, Qu... | §5, §17 | e2e |
| REQ-MNU-04 | Options: quality preset, music and SFX volume, load-own-music folder picker (files never bundled), controls view, Res... | §15, §17 | e2e |
| REQ-MNU-05 | Menus are code-split from the game bundle (separate chunk). | §12 | build size test |
| REQ-MNU-06 | Results card after each run per REQ-GOL-07. | §14-B | e2e |
| REQ-LAB-01 | Board Lab: 3D board on a turntable; tabs Deck Graphic, Grip, Trucks (colour), Wheels (colour and durometer label), Un... | §17 | e2e screenshot "board lab" |
| REQ-LAB-02 | All Lab art is procedural CanvasTexture; selections persist in localStorage and appear on the in-game board (top = gr... | §17, §10 | e2e, save.test |
| REQ-LAB-03 | Sticker placement is controller-complete: a cursor moved by the stick, place with confirm, remove with X/Square. | §19 | e2e pad script |
| REQ-REN-01 | WebGLRenderer with outputColorSpace SRGB, toneMapping AgX (fallback ACESFilmic), exposure tunable (RENDER_EXPOSURE 1.... | §10 | render.test (unit on config), screenshot |
| REQ-REN-02 | IBL: PMREM from the three Sky shader (Street, sun elevation 18 deg, late afternoon) and RoomEnvironment plus a warm f... | §10 | screenshot |
| REQ-REN-03 | One directional sun with a 2048^2 PCFSoft shadow map whose ortho frustum (30 m box) follows the skater and is texel-s... | §10 | screenshot; render.test: frustum centre tracks the skater |
| REQ-REN-04 | Post chain: AO -> bloom (threshold 0.9, only emissive) -> SMAA -> vignette (0.25) -> chromatic aberration (0.002, onl... | §10 | render.test: pass order; the SSAO fallback case |
| REQ-REN-05 | Quality presets Low/Med/High/Ultra: shadow 1024/2048/2048/4096, AO off/on/on/on, pixel ratio cap 1.0/1.25/1.5/2.0, bl... | §10 | quality.test |
| REQ-REN-06 | Targets: 60 fps at 1080p on an RTX 3060 / M1 class at High; 30+ fps on integrated at Low. | §10 | manual measurement recorded in DEPLOY.md |
| REQ-REN-07 | Fill the window; resize handled; pixel ratio capped by preset. | §15 | e2e resize |
| REQ-MAT-01 | Maple plywood: Canvas2D grain (layered noise + ring stretch), seams every 2.4 m, clearcoat 0.3, roughness 0.45. | §10 | screenshot Woodshed |
| REQ-MAT-02 | Steel coping and rails: metalness 1, roughness 0.25, anisotropic streak normal map, emissive rim 0.05 on every rail a... | §10 | screenshot; materials.test: rail material emissive = 0.05 |
| REQ-MAT-03 | Concrete, marble (domain-warped veins), asphalt with the painted crosswalk, glass towers (high reflect, low roughness... | §10 | screenshot Street |
| REQ-MAT-04 | Sponsor signage: CanvasTexture wordmarks from the brand table in original typography; emissive neon boxes; never on r... | §10, §11 | levels.test |
| REQ-MAT-05 | Zero downloaded assets: no network fetches at runtime, no CDN fonts; optional CC0 HDRIs only under public/optional/ a... | §4 | build test: no external URLs in dist; e2e network log empty |
| REQ-SKT-01 | Procedural low-poly skater (2k to 4k tris) from capsules/boxes with a bone hierarchy (hips, spine, head, 2 arms, 2 le... | §10 | screenshot; skater.test: triangle count |
| REQ-SKT-02 | Board: concave extruded outline with kicks, trucks, wheels; top = Lab grip, bottom = Lab graphic and stickers. | §10 | screenshot Board Lab |
| REQ-SKT-03 | Pose library of at least 12 keyframed poses: push, crouch, pop, air-neutral, 8 grab poses, flip, 50-50, 5-0, nosegrin... | §10 | skater.test: every pose id resolves |
| REQ-SKT-04 | Board flip rotation axis per trick: kickflip/heelflip roll, shove-it yaw, impossible pitch wrap, varial = roll + yaw,... | §10 | skater.test: axis table |
| REQ-SKT-05 | Auto-orientation (REQ-CTL-09) drives the rig root; spin drives yaw; the revert plays a 180 pivot over the window. | mine | skater.test |
| REQ-FX-01 | Grind sparks: GPU points, additive, gravity, 240 particles/s at the contact point, seeded. | §10 | screenshot mid-grind |
| REQ-FX-02 | Wheel dust on landing (burst of 24), speed lines + FOV kick above 85% vmax, board motion trail during specials, green... | §10, §9.1 | screenshot; fx.test: triggers fire on events |
| REQ-FX-03 | MacGuffin pickup: screen flash 120 ms + 60 ms hitstop (render holds, sim pauses floor(60 x 120 / 1000) = 7 ticks) + r... | §10 | fx.test |
| REQ-FX-04 | Bail: camera shake (REQ-CAM-06) + medium rumble. | §10 | fx.test |
| REQ-AUD-01 | Web Audio only, everything synthesized: roll (filtered noise scaled by speed), push, pop, land thud, grind (band-pass... | §4, §15 | audio.test: every event has a synth voice; no audio files in dist |
| REQ-AUD-02 | Music: a synthesized Y2K breakbeat loop per park (94 BPM Street, 170 BPM Woodshed, CR-41; kick/snare/hat from oscillators +... | §15 | e2e: music toggles |
| REQ-AUD-03 | Audio starts only after the start gate (user gesture). | §12 | e2e |
| REQ-SAV-01 | Persistence in localStorage wrapped in try/catch: career goals, letters state per park (per run only), MacGuffins, be... | §4, §15 | save.test: round trip; save.test: storage throwing does not crash |
| REQ-SAV-02 | Reset career clears everything except options and Board Lab. | §15 | save.test |
| REQ-SAV-03 | Save writes happen at run end, on menu changes and on Lab changes; never inside the sim tick. | mine | grep test |
| REQ-BRD-01 | src/data/brands.ts holds both tables and is the only file allowed to hold real company or person names; BRANDS is a... | §11, AGENTS | brands.test: grep the tree; REQ-BRD-04 proves the drop |
| REQ-BRD-02 | Mode chosen at build time by VITE_BRAND_MODE, default parody; npm run build:private sets real. | §11 | build test |
| REQ-BRD-03 | No logo artwork in either mode; real uses plain-text names; parody uses original marks (North Star, Canticle, Vidia,... | §11 | screenshot review |
| REQ-BRD-04 | The public build's bundle contains none of: the real names, "Tony Hawk", "Neversoft", "Activision", "Warehouse", "Sch... | §1, §19 | build test scans dist |
| REQ-BRD-05 | NPCs never attempt a real likeness in either mode. | §11 | review |
| REQ-DEP-01 | vite.config.ts uses base: "./"; npm run build emits dist/ that runs from any static subpath. | §12 | e2e against vite preview on a subpath |
| REQ-DEP-02 | DEPLOY.md gives copy-paste steps for GitHub Pages (.github/workflows/deploy.yml on push to main), Vercel/Netlify (pre... | §12 | file exists; workflow lints |
| REQ-DEP-03 | First load: menus code-split from the game; first playable < 5 s on broadband. | §12 | manual timing in DEPLOY.md |
| REQ-DEP-04 | Total gzipped JS <= 1.5 MB, checked by a script in CI. | §12 | size test |
| REQ-DEP-05 | Start gate and controller disconnect handling (REQ-INP-08, 09). | §12 | e2e |
| REQ-DEP-06 | No console errors on load in the built output. | §19 | e2e smoke |
| REQ-DEP-07 | Dev tuning panel (~ / Share / View) exposes live sliders for every TUNING key with its range from TUNING_META; dev bu... | §1, §13 | e2e dev build |
| REQ-TST-01 | Vitest suites: scoring, stateMachine, input, balance, levels, plus loop, tuning, controller, grind, lip, special, goa... | §13 | npm test |
| REQ-TST-02 | Playwright e2e/smoke.spec.ts with SwiftShader flags: boots to the menu with no console errors; calls debug.unlockAll(... | §13 | CI |
| REQ-TST-03 | Definition of done per milestone: npm run typecheck && npm test && npm run build pass. | §13 | CI |
| REQ-TST-04 | Source-grep tests strip comments before matching so an explanatory comment can never satisfy a rule. | AGENTS lessons | tests/grep.test self-check |
| REQ-TST-05 | The worked example (D.3) is stored as data in tests/fixtures/workedExample.ts and asserted to equal 15504. | §13 | scoring.test |

Total: 239 requirements across 31 areas (TIM 11, INP 18, SM 14, CTL 22, VRT 12, CAM 7, SCR 11, DEG 5, SPC 6, BAL 6, GRD 15, MAN 7, REV 5, LIP 4, STR 7, WSH 7, LVL 12, GOL 7, NPC 4, HUD 6, MNU 6, LAB 3, REN 7, MAT 5, SKT 5, FX 4, AUD 3, SAV 3, BRD 5, DEP 7, TST 5).
