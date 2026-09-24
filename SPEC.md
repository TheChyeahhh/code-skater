# CODE SKATER — Claude Code Build Prompt (v2, research-corrected)

> Paste this whole file into Claude Code (Opus 5.5) at the root of an empty folder.
> Target: a browser-playable arcade skate game you can deploy to a public URL in one session.

---

## 0. ROLE + MISSION

You are a lead designer, systems designer, feel engineer, and technical director who has shipped arcade extreme-sports games in the THPS lineage (THPS2 combo grammar + THPS3 / THPS 1+2 remake grammar: manuals, reverts, grind balance, special meter, degradation, named gaps, 2-minute runs).

You are **designing AND building** CODE SKATER in this repository, end to end, in one session.

- It is a clone of THPS **systems and feel**. It is NOT a licensed product of any skate game franchise, studio or publisher.
- Deliverables, in order:
  1. `DESIGN.md` — the implementable design (sections A–K, §14). Tables, formulas, state machines, REQ IDs. No vibe essays.
  2. A working game in this repo that runs with `npm run dev` and builds to a static site with `npm run build`.
  3. Tests that prove the combo rules (§13), plus a screenshot smoke test.
  4. `DEPLOY.md` with exact steps to put it online (§12).
- Work autonomously. Do not stop to ask me questions. Where something is ambiguous, use the default in §15 and log it in `DESIGN.md › Open Questions`.

---

## 1. HARD RULES

1. Tables, formulas, state machines, REQ IDs over prose.
2. Every mechanic in DESIGN.md: PURPOSE, PLAYER FEEL, INPUTS, OUTPUTS, FAILURE STATE, EDGE CASES, TUNABLES (value + range + rationale).
3. No magic numbers in code. Every tunable lives in `src/core/tuning.ts` with a comment citing its REQ ID and range. A dev panel (`~` key / `Select` button) exposes live sliders for all of them.
4. **Combo continuity is the product.** Any system that doesn't feed the combo line must justify itself.
5. **Grinding is first-class.** If a player can see an edge, the grind button snaps to it. Both parks are grind instruments.
6. **Controller is the tune target** (Gamepad API, PlayStation + Xbox layouts). Keyboard is a fallback. A mechanic that only works on keyboard is a bug.
7. Always split scope: MVP / Vertical Slice / v1.0 / Later.
8. Real skate lexicon is fine. Never use: Tony Hawk, Neversoft, Activision, Warehouse, School II, The Hangar, licensed THPS music, or any real pro skater's name or likeness.
9. Brand/person handling: see §11. **Public builds default to parody mode.**
10. Never write "it depends" without a default.
11. Do not silently change a locked number. Changes go in DESIGN.md as `CHANGE-REQUEST: <id> — old → new — reason`. The ones already approved are listed in §3.
12. Git: commit at every milestone with plain descriptive messages. **No Claude attribution in commits or PRs** — no `Co-Authored-By` trailer, no "Generated with Claude Code" line, no session link.

---

## 2. DESIGN DNA — STEAL / REFUSE

**Steal from THPS2:** manuals (Up→Down / Down→Up) keep combos alive on flat; manual balance meter; 2:00 runs; letter collectibles + a hidden MacGuffin as sacred goals; named gaps that add score AND +1 multiplier and never degrade; 10 goals per park.

**Steal from THPS3 / THPS 1+2 remake:** revert on vert landing; revert → manual as the core glue; grind + lip balance meters with partial re-center on each new element; special meter (fill by scoring, glow = specials + speed buff, bail empties it); switch stance bonus; trick degradation; grind-type switching mid-rail; nollie/fakie modifier; L1/R1 quick-spin; double-tap flip/grab for enhanced versions. Spine transfer, acid drop, wallplant are later-era moves the remake includes — spine transfer is MVP on Woodshed only; the rest are v1.0.

**Steal the feel:** sticky arcade grind magnetism; charged ollie (hold to crouch, release to pop); third-person chase cam with look-ahead; readable, slightly cartoon bails that always dump combo + special; levels are toyboxes of lines; "one more run."

**Refuse:** realistic board physics; stick-as-deck sim; first-person or shoulder cam default; open-world career; 20-minute default sessions; licensed music or pros; battle pass / energy; grind as optional; turning the tech theme into a typing/coding minigame; sponsor decals over grind edges.

---

## 3. RESEARCH CORRECTIONS — APPLIED TO THE ORIGINAL SPEC

These were verified against THPS guides and wikis. Treat them as approved CHANGE-REQUESTs.

| ID | Original spec | Correction | Reason |
|----|---------------|-----------|--------|
| CR-01 | Input map had no shoulder spin | Add **L1/R1 (LB/RB) = quick spin left/right** in air | THPS 1+2 maps fast spin to L1/R1. Stick-only spin feels slow on a pad. |
| CR-02 | "Left stick = balance" (one axis) | **Manual/nose manual balance = forward/back axis. Grind and lip balance = left/right axis.** | That's how THPS meters work; mixing axes breaks muscle memory. |
| CR-03 | Revert only accepted 0–180 ms *after* vert land | Keep the 180 ms post-land window, **add a 150 ms pre-land buffer** (press R2 before contact, it fires on contact). Manual inputs pressed during the revert animation are buffered, not dropped. | The remake buffers these inputs; players spam R2 then Up/Down. A post-only window reads as broken. |
| CR-04 | Revert only kept the combo | **Revert also toggles stance** (regular ↔ switch). Subsequent tricks score as switch. | In THPS 1+2 R2 is "revert / switch." It's what makes revert-manual lines score. |
| CR-05 | Switch = +20% base | Keep +20%. **"Switch Kickflip" is a distinct trick ID for degradation** (separate history from "Kickflip"). | Matches remake behavior; rewards stance changes. |
| CR-06 | Same object ground twice → wobble ×1.6 | Keep, but the **primary** difficulty curve is: balance drift speed scales with the number of grind/manual/lip elements already in the combo, and each *new* element partially re-centers the needle (to 35% of max offset). | THPS3 introduced the re-center-on-new-element rule; that's what makes long combos learnable yet finite. |
| CR-07 | Degradation 100/90/75/50/25 per run | **Keep as locked** — this is exactly THPS1's per-level table. Document that THPS3 used 100/75/50/25/10; expose both as a tuning preset. | Verified. Just making the lineage explicit. |
| CR-08 | +0.5 multiplier per 180° | **Keep** (THPS1/2 rule). Note later games moved spin into trick base instead; expose as preset `SPIN_MODE = "multiplier" \| "base"`. | Verified for early games. |
| CR-09 | Specials base 4000–9000 | **1500–4500.** | With High Score = 15,000, one glowing Kernel Panic at ×3 clears Pro Score alone. A special should be a combo *finisher*, worth ~10–30× a basic trick, not the whole run. |
| CR-10 | "Context Window: Left, Right + Manual" | Manual isn't a button. **New input: while in Manual, Left→Right + Triangle/Y.** | Undefined input. |
| CR-11 | Special input "Up, Down + Grab" collides with manual entry (Up, Down) near landing | **Input arbitration:** a direction pair consumed by a special is removed from the manual buffer. Specials are only parsed while glowing. | Otherwise every Kernel Panic that lands becomes an accidental manual (or vice versa). |
| CR-12 | VIDA Slide "Up, Down + Grind" collides with grind-type switch (direction + Triangle) | **Parser priority:** two-direction sequence within 250 ms + Triangle (while glowing) → special grind; otherwise single direction + Triangle → grind switch. | Deterministic parse. |
| CR-13 | Lips listed as v1.0, but `Lip` is in the MVP state machine and combo-alive list | **MVP ships 2 lip tricks** (Axle Stall = neutral, Rock to Fakie = Down) so the state is real; full lip catalog in v1.0. | Remove the contradiction. |
| CR-14 | "Ollie buffer pre-lip 90 ms" | Renamed **late-ollie (coyote) window off edges/coping: 90 ms (70–120)**. | Describes what it actually does. |
| CR-15 | Vert air behavior unspecified | **Vert assist:** when leaving a quarter-pipe near-vertical, strip the horizontal velocity component perpendicular to the ramp face so the skater returns to the same ramp. Spine transfer disables this for one air. | This is the core THPS vert feel; without it players fly off ramps. |
| CR-16 | Engine: Godot 4 | **Three.js + TypeScript + Vite** (see §4). | Goal is "one-shot in Claude Code, playable online." |

---

## 4. TECH STACK (CHANGE-REQUEST CR-16)

**Why not Godot 4:** building in Claude Code with no editor means hand-writing `.tscn` scenes, and web export needs export templates plus careful threading/header config on static hosts. A TypeScript web build is testable headless, deploys as plain static files, and iterates fastest for an agent.

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript (strict) | |
| Bundler | Vite | `npm run dev`, `npm run build` → `dist/` |
| Renderer | three.js (latest), `WebGLRenderer` | WebGPU optional later |
| Post | `postprocessing` (pmndrs) | bloom, SMAA, vignette, chromatic aberration (subtle) |
| AO | N8AO (or `postprocessing` SSAO) | quality-preset gated |
| Collision | `three-mesh-bvh` raycasts against level meshes | **No rigidbody engine.** Arcade kinematic controller. |
| Audio | Web Audio API, fully synthesized | no audio files required |
| UI | DOM/CSS overlay over the canvas | crisp text, easy menus |
| Tests | Vitest (logic), Playwright (smoke + screenshots) | |
| Persistence | `localStorage` wrapped in try/catch | career progress, board lab, best scores |

**Assets policy:** the build must work with zero downloaded assets. All geometry is procedural/authored in code, all textures are generated (Canvas2D / shaders). If the network allows it, CC0 assets (e.g. Poly Haven HDRIs) may be added under `public/optional/` but must not be required.

---

## 5. LOCKED INPUT MAP (controller first)

| Action | PlayStation | Xbox | Keyboard fallback |
|--------|-------------|------|-------------------|
| Ollie / crouch-charge | ✕ hold→release | A | Space |
| Flip (8-way) | □ + dir | X + dir | J |
| Grab (8-way, holdable) | ○ + dir | B + dir | K |
| Grind / Lip / (Wallride v1.0) | △ | Y | L |
| Revert (+ stance toggle) | R2 | RT | Shift |
| Nollie / fakie modifier | L2 | LT | Ctrl |
| Quick spin L / R | L1 / R1 | LB / RB | Q / E |
| Manual | Up→Down | Up→Down | W→S |
| Nose manual | Down→Up | Down→Up | S→W |
| Steer / air spin / balance | Left stick + D-pad | Left stick + D-pad | WASD / arrows |
| Camera | Right stick | Right stick | Mouse (pointer lock) |
| Pause / goals | Options | Menu | Esc |
| Dev tuning panel | Share / View | View | ~ |

- Directions come from **both** D-pad and left stick (stick deadzone 0.35, 8-way sectors of 45°). THPS players use the D-pad for sequences.
- Double-tap the same flip/grab direction within 250 ms in air → enhanced version (Double Kickflip, etc.), +1 flip tier of base.
- Rumble (`gamepad.vibrationActuator` when available): light on grind contact, medium on bail, short pulse on gap / MacGuffin. Fail silently if unsupported.
- Show button glyphs matching the connected pad (detect "Xbox"/"054c"/"DualSense" in `gamepad.id`; default to Xbox glyphs).

---

## 6. LOCKED COMBO + SCORING RULES

Combo is ALIVE in: `Air, Grind, Lip, Manual, RevertWindow`.
Combo DIES when: `Grounded` rolling (all four wheels, outside manual/revert windows) OR `Bail`.

```
trickValue_i  = base_i × stance_i × degradation_i            (stance = 1.2 if switch)
COMBO_BASE    = Σ trickValue_i  (+ hold-time accruals for grabs/grinds/manuals/lips)
MULTIPLIER    = (#elements) + 0.5 × (total 180° spins)        (SPIN_MODE="multiplier")
FINAL         = COMBO_BASE × MULTIPLIER                        (landed only)
```

- Elements that add +1.0: each flip, grab, grind TYPE, manual, lip, revert, named gap, MacGuffin pickup, special.
- Grind-type switch mid-rail = new element (+1, own degradation history).
- Bail: discard entire combo, empty special meter, get-up lockout 0.85 s.
- **Degradation per RUN**, keyed by trick ID (switch variants separate): 1st 100% · 2nd 90% · 3rd 75% · 4th 50% · 5th+ 25%. Gaps and MacGuffins never degrade.
- Land quality text: `OK` (off-axis 15–28°), clean (<15°), `SICK` (combo ≥ 10k), `INSANE` (combo ≥ 50k). Off-axis >28° = bail.

**Base values** (structure locked, numbers tunable):

| Category | Base | Hold rate |
|----------|------|-----------|
| Flip | 100–250 by difficulty tier | — |
| Grab | 150 | +100/s |
| Grind 50-50 | 100 | +80/s |
| Grind directional | 120–180 | +90/s |
| Manual / nose manual | 50 | +40/s |
| Lip | 150 | +100/s |
| Revert | 100 | — |
| Named gap | 200–2000 | — |
| Special (CR-09) | 1500–4500 | holdables +150/s |
| Secret Laptop / Secret Drive | 2500 | no degradation |

**Special meter:** fills from landed COMBO_BASE (not multiplier), 0→full ≈ 6,000 base; idle drain 4%/s after 3 s without a landed trick; glowing = specials enabled + 8% max speed; bail = instant empty.

**Balance (CR-02, CR-06):** needle ∈ [-1, 1], bail at |needle| ≥ 1. Drift acceleration = `k0 × (1 + 0.12 × elementsInCombo)` × (1.6 if same object as previous grind). Player input pushes opposite. Each new grind/lip/manual starts the needle at ±0.35 × current offset sign. Balance input axis: manual = vertical, grind/lip = horizontal.

---

## 7. LOCKED TIMING WINDOWS (value, tune range)

| Window | Value | Range | Note |
|--------|-------|-------|------|
| Late-ollie (coyote) off edges | 90 ms | 70–120 | CR-14 |
| Grind magnet radius | 0.55 m | 0.40–0.80 | arcade sticky |
| Grind entry max angle | 55° | 45–70 | angle between velocity and rail tangent |
| Grind button pre-buffer | 200 ms | 120–300 | press △ early in air, snaps when in magnet |
| Revert pre-land buffer | 150 ms | 100–200 | CR-03 |
| Revert window after vert land | 180 ms | 140–220 | |
| Revert → manual buffer | 200 ms | 160–260 | inputs during revert anim are kept |
| Manual entry on land | 140 ms | 100–180 | Up/Down pressed within this before or after contact |
| Landing forgiveness off-axis | 28° | 22–35 | beyond = bail |
| Get-up lockout | 0.85 s | 0.60–1.10 | |
| Special sequence window | 250 ms | 200–350 | between the two directions |

Simulate at a **fixed 120 Hz tick** with an accumulator; render interpolated. All windows are measured in sim time so they're frame-rate independent.

---

## 8. LOCKED STATE MACHINE

States: `Grounded, Crouch, Air, Grind, Lip, Manual, RevertWindow, Bail, GetUp`

| From | Event / condition | To | Combo |
|------|-------------------|----|-------|
| Grounded | hold ✕ | Crouch | — |
| Crouch | release ✕ | Air (pop height ∝ hold 0.1–0.6 s) | starts |
| Grounded | Up→Down / Down→Up | Manual / Nose Manual | starts |
| Air | △ (or buffered) & rail in magnet & angle ≤ max | Grind | lives, +1 |
| Air | △ at coping, near-vertical | Lip | lives, +1 |
| Air | land, off-axis ≤ 28°, flat, manual input in window | Manual | lives, +1 |
| Air | land on vert, R2 in pre/post window | RevertWindow | lives, +1, stance toggles |
| Air | land, no linker, off-axis ≤ 28° | Grounded | **banks & dies** |
| Air | land off-axis > 28° or mid-flip/grab animation | Bail | **lost** |
| RevertWindow | manual input within 200 ms | Manual | lives, +1 |
| RevertWindow | timeout | Grounded | **banks & dies** |
| Grind | ✕ | Air | lives |
| Grind | dir + △ | Grind (new type) | lives, +1 |
| Grind | rail end | Air (keeps velocity) | lives |
| Lip | ✕ or release | Air (back into ramp) | lives |
| Manual | ✕ | Air | lives |
| Manual | Up→Down again (other direction) | Manual (nose/normal swap) | lives, +1 |
| Grind / Lip / Manual | \|needle\| ≥ 1 | Bail | **lost** |
| Any | collision into wall at speed > bail threshold head-on | Bail | **lost** |
| Bail | anim end | GetUp | — |
| GetUp | 0.85 s | Grounded | — |

"Banks" = FINAL added to run score. Implement as a pure, table-driven module (`src/sim/stateMachine.ts`) with no rendering imports so it's unit-testable.

---

## 9. CONTENT

### 9.1 Trick catalog (data-driven, `src/data/tricks.ts`)

Schema:
```ts
type Trick = {
  id: string;            // "kickflip", "switch_kickflip" is derived, not authored
  name: string;          // display name
  category: "flip"|"grab"|"grind"|"manual"|"lip"|"revert"|"special"|"gap"|"macguffin";
  input: { button: "flip"|"grab"|"grind"|"ollie"|"none"; dir?: Dir8; seq?: [Dir8, Dir8] };
  base: number;
  holdRate?: number;     // points per second while held
  animMs?: number;       // must finish before landing or bail
  requiresSpecial?: boolean;
  balanceAxis?: "h"|"v";
  reqId: string;
};
```

Flips (□): L Kickflip · R Heelflip · U Impossible · D Pop Shove-It · UL Varial Kickflip · UR Varial Heelflip · DL Hardflip · DR 360 Flip.
Grabs (○): U Nosegrab · D Tailgrab · L Indy · R Melon · UL Japan · UR Stalefish · DL Benihana · DR Crossbone.
Grinds (△): none 50-50 · U Nosegrind · D 5-0 · L/R Boardslide (Lipslide if approaching backside) · UL Crooked · UR Overcrook · DL Feeble · DR Smith.
Lips (MVP, CR-13): neutral Axle Stall · D Rock to Fakie.
Specials (glowing only):

| Name | Input | Type | Base (CR-09) | Juice |
|------|-------|------|--------------|-------|
| Kernel Panic | U,D + ○ | air grab-spin | 3000 | board flashes blue-screen texture mid-air |
| Token Overflow | L,R + □ | flip | 2800 | deck stickers peel off as particles |
| 900ms Inference | D,U + ○ | slow-mo air, holdable | 4500 (+150/s) | time dilation 0.6×, hard to land |
| VIDA Slide | U,D + △ on rail | special grind | 500 + 150/s | green light ribbon along the rail |
| Context Window | in Manual: L,R + △ (CR-10) | special manual | 1400 (+60/s) | balance drift ×2 while held |

### 9.2 Levels

Levels are authored in TypeScript as data (`src/levels/*.ts`): a list of primitives (box, ramp quarter-pipe with radius/height, bowl, spine, hubba, stairs) plus **rails as explicit polylines with tags** (`{ id, points: Vec3[], kind: "rail"|"ledge"|"coping", name? }`). The builder generates meshes, colliders, and rail splines from the same data, so every visible edge meant for grinding has a rail entry. Named gaps are trigger volumes pairs (`start` → `end` within one combo).

Automated level validation (runs in tests): every coping/ledge top edge in the mesh has a rail within 0.1 m; no decal quad overlaps a rail within 0.15 m; MacGuffin not reachable by a max-height ollie from spawn without a grind/transfer (simulate a straight-up max ollie at spawn and at 12 points on the spawn plaza; must fail to collect).

**LEVEL A — MARKET STREET** (downtown, glass towers, server-closet alleys, plaza, loading docks, scaffolding). ~120 × 120 m.
- Grind density: marble hubba ledges, stair handrails, scaffold pipes, long bus-stop bar, loading-dock rail, rooftop rail (Laptop).
- Lines: (1) spawn plaza → marble ledge → stair rail → manual across crosswalk → QP revert; (2) alley dock → rail → rooftop-access QP → billboard gap; (3) fountain as mini-vert → revert-manual → plaza hubba; (4) scaffold rails climb → rooftop laptop.
- Letters C-O-D-E, one per line.
- NPC **SAM** at spawn plaza (hoodie, empty laptop sleeve): "Hey — I lost my laptop. It's got all my code on it. Grab it before the demo." → Goal: Secret Laptop on far rooftop rail above scaffold line; requires transfer + grind. Splash `SECRET LAPTOP`. Toast "Nice. Don't open README.md."
- Goals: High 15,000 · Pro 40,000 · Sick 80,000 · High Combo 10,000 · C-O-D-E · Secret Laptop · Grind the Bus Stop Bar · Transfer the Billboard Gap · Manual the Crosswalk · 5,000 in one combo over the fountain. **6/10 unlocks Woodshed.**

**LEVEL B — WOODSHED** (X-Games-style indoor wood park: honey maple, steel coping, rainbow rails, bowls, full-pipe, center spine, humps, euro shoulders). ~90 × 70 m.
- Grind density: rainbow rails, flat bars, hubbas, pool coping, snake-run edges, transfer rails, spine-peak rail (Drive).
- Pass bar: a competent player holds a 20 s combo on rails + manuals alone. Put this in the smoke-test notes and design the rail spacing so rail ends feed rail starts within one ollie (≤ 3.5 m horizontal, ≤ 1.2 m up).
- Lines: (1) bowl pump → spine transfer → rainbow rail → manual → QP revert; (2) street-course flat bar → hubba → euro gap → bowl drop-in; (3) full-pipe air → revert → manual → snake-run coping; (4) vert wall → transfer to over-vert rail (Drive).
- NPC **DARIO** at contest booth with coffee: "The next model is on this hard drive. Please get it before anyone else does." → Goal: Secret Drive on spine-peak rail; needs speed + transfer. Splash `SECRET DRIVE`. Toast "Thank you. Do not inference this."
- Goals: High 25,000 · Pro 60,000 · Sick 120,000 · High Combo 15,000 · C-O-D-E · Secret Drive · Spine Transfer the Center · Grind the Rainbow · Hold a 3-second special · 2 revert-manuals in one combo.
- Both MacGuffins → "Lab Circuit" stamp on the main menu.

Spine transfer (MVP, Woodshed only): R2 while airborne within 1.5 m above a spine/tagged transfer edge → rotate 180° around the edge's axis and fly to the far side (disables vert assist for this air, CR-15), awards named gap "Spine Transfer".

NPC figures: stylized low-poly characters built from primitives (no facial likeness of any real person). Talk by rolling into a 2 m trigger; dialog box in the HUD.

---

## 10. GRAPHICS — "BEST WE CAN GET" SPEC

Target look: late-90s/Y2K skate video meets modern real-time polish. Stylized-realistic, saturated, readable silhouettes. 60 fps at 1080p on a mid-range GPU (RTX 3060 / M1 class); 30+ fps on integrated at Low.

**Renderer**
- `renderer.outputColorSpace = SRGB`, `toneMapping = AgX` (fallback ACESFilmic), exposure tunable.
- Image-based lighting: PMREM from a procedural sky (three `Sky` shader for Street at late afternoon; `RoomEnvironment` + warm fill for Woodshed interior).
- One directional sun with a 2048² shadow map whose frustum **follows the skater** (tight ortho box, texel-snapped to kill shimmer), PCFSoft; plus baked-looking fake AO via vertex colors on level primitives.
- Post chain (pmndrs `postprocessing`): N8AO/SSAO → bloom (threshold high so only emissive signage, sparks, special glow bloom) → SMAA → subtle vignette → subtle chromatic aberration only while special-glowing.
- Quality presets Low/Med/High/Ultra (shadow res, AO on/off, pixel ratio cap 1.0/1.25/1.5/2.0, bloom). Auto-pick by a 2-second FPS probe on first load.

**Materials (all procedural, `src/render/materials.ts`)**
- Maple plywood: Canvas2D wood grain (layered noise + ring stretch), sheet seams every 2.4 m, clearcoat 0.3, roughness 0.45.
- Steel coping & rails: metalness 1, roughness 0.25, anisotropic streak via normal map noise; **coping/rail edges get a faint emissive rim (0.05) so grind lines read at distance** — a visibility rule, not decoration.
- Concrete, marble (veins via domain-warped noise), asphalt with painted crosswalk, glass towers (high-reflect, low-roughness, env-mapped), scaffold pipes.
- Sponsor signage: CanvasTexture wordmarks in original typography; emissive for neon boxes. Decals are never placed on rail/coping geometry (validated in tests).

**Skater**
- Procedural low-poly character (~2–4k tris) built from capsules/boxes with a simple bone hierarchy (hips, spine, head, arms, legs), hoodie + cap + baggy pants silhouette, flat-shaded with rim light.
- Board: proper deck shape (concave extruded outline, kicks), trucks, wheels; deck top uses the Board Lab grip, bottom uses the chosen graphic.
- Animation: procedural pose library (keyframed joint rotations per trick + blend), ~12 core poses: push, crouch, pop, air-neutral, each grab pose, flip (board rotates on its axis, feet leave), 50-50/5-0/nosegrind/boardslide/smith/feeble stances, manual/nose-manual lean, lip stall, bail ragdoll-lite (scripted tumble), get-up. Board flip rotations must be physically plausible per trick (kickflip = roll axis, shove-it = yaw, impossible = pitch wrap).

**FX / juice**
- Grind sparks (GPU points, additive, gravity), wheel dust on landing, speed lines + FOV kick (+6°) above 85% max speed, motion trail on the board during specials, green ribbon for VIDA Slide, screen flash + 60 ms hitstop on MacGuffin pickup, camera shake on bail.
- Chase camera: 4.2 m back, 1.6 m up, look-ahead 1.5 m along velocity, critically damped spring (ω ≈ 8); in vert air it pulls back and up to frame the ramp; right stick orbits and springs back after 1.2 s.

**Screenshots:** after each visual milestone, run the Playwright smoke test to capture `screenshots/*.png` (menu, Street spawn, Street mid-grind, Woodshed bowl, Board Lab) and **open them yourself with your image-reading tool** to critique readability: can you see rail edges, is the HUD legible, is anything black/untextured. Fix before moving on.

---

## 11. BRANDS, REAL PEOPLE, PARODY MODE

The fantasy riffs on two real AI labs, a real chip maker and two real lab leaders. Those are trademarks and real people, and this build will be public on the internet. (Their real names are left out of this public copy of the prompt.)

- Implement a single brand table `src/data/brands.ts` with two modes: `parody` and `real`.
- Selected at **build time** via `VITE_BRAND_MODE`; **default `parody`**. `npm run build` produces parody. A separate `npm run build:private` sets `real` for local/private use.
- Never reproduce actual logo artwork in either mode. `real` mode uses plain-text names in original typography; `parody` uses original marks.
- NPCs never attempt a real person's likeness in either mode.

| Real (private build) | Parody (default/public) |
|----------------------|-------------------------|
| Lab leader A | Sam, lab director at North Star |
| Lab leader B | Dario, safety lead at Canticle |
| AI lab A | North Star |
| AI lab B / its assistant | Canticle |
| Chip maker / its GPU platform | Vidia / VIDA Slide |
| Secret Laptop | North Star Laptop |
| Secret Drive | Canticle Weights Drive |

Special trick names that reference marks (VIDA Slide) read from the table too.

---

## 12. PLAYABLE ONLINE — DEPLOY

"Online" = playable in a browser at a public URL (single-player). Online multiplayer is a Later item.

- `vite.config.ts` uses `base: "./"` so the build works from any subpath (GitHub Pages, itch.io).
- Provide all three in `DEPLOY.md` with copy-paste commands:
  1. **GitHub Pages** — include `.github/workflows/deploy.yml` (build on push to `main`, upload `dist/`).
  2. **Vercel / Netlify** — framework preset Vite, output `dist`.
  3. **itch.io** — `npm run zip` creates `code-skater-web.zip` from `dist/` for an HTML5 upload.
- First load must be small: code-split menus from the game, gzip total JS ≤ 1.5 MB, first playable in < 5 s on broadband.
- "Click / press any button to start" gate (needed for audio + gamepad activation in browsers).
- Handle `gamepadconnected` / disconnect mid-run (auto-pause with "Controller disconnected").

---

## 13. TESTS + VERIFICATION (do not skip)

Vitest, pure logic (no WebGL):
- `scoring.test.ts`: the §14-D worked example produces the exact number; degradation table per run; switch variant has separate history; gaps/MacGuffins never degrade; bail discards combo and empties special; spin adds +0.5 per 180.
- `stateMachine.test.ts`: every row in §8 as a test; revert pre-buffer fires on contact; revert→manual inside 200 ms keeps combo; timeout kills it; manual input in 140 ms window on flat keeps combo.
- `input.test.ts`: CR-11 and CR-12 arbitration cases; double-tap enhanced flips; D-pad and stick produce identical Dir8.
- `balance.test.ts`: re-center on new element; drift grows with element count; same-object ×1.6.
- `levels.test.ts`: validation rules from §9.2 (rail coverage, decals off rails, MacGuffins not spawn-ollie reachable, Woodshed rail spacing).

Playwright (`e2e/smoke.spec.ts`), launched with `--use-gl=swiftshader` / `--enable-unsafe-swiftshader` so WebGL works headless:
- Boots to menu with no console errors; starts Free Skate on both parks; injects scripted input (expose `window.__codeSkater.debug` in dev builds only) to ollie, grind a known rail for 2 s, land — asserts the combo banked > 0; captures screenshots.

Definition of done for each milestone: `npm run typecheck && npm test && npm run build` all pass.

---

## 14. DESIGN.md — OUTPUT CONTRACT

Write `DESIGN.md` first (before code), in this order. Keep it tight; this spec is the source, DESIGN.md is its implementable restatement with REQ IDs.

- **A. One-page pitch** (tagline "Compile the line. Fetch the drive.")
- **B. Core loops** — moment-to-moment (including a grind), 2:00 run, career, one-more-run hook
- **C. Input + state machine** — §5, §7, §8 with REQ IDs
- **D. Scoring sheet + worked example** — must include a grind, a grind-type switch, a revert-manual, a spin, and a named gap; show every intermediate number; this exact example becomes a unit test
- **E. Grind bible** — types, magnet math (closest point on segment, angle test, snap + tangent velocity), anti-cheese (same-object ×1.6, degradation), named rails per park
- **F. Vertical slice contents**
- **G. Park one-pagers** — Street + Woodshed, top-down ASCII layout with rails, lines, letters, MacGuffin, gaps
- **H. Board Lab + main menu wireframes** (ASCII)
- **I. Risk register** — 8 risks, likelihood/impact/mitigation
- **J. Build plan** — the milestones in §16 with what's testable at each
- **K. Open questions** — max 8, each with the default you used

---

## 15. DEFAULTS FOR ANYTHING UNSPECIFIED

| Question | Default |
|----------|---------|
| Regular or goofy default stance | Regular |
| Skater stats (speed, air, balance, switch, spin) | All 6/10; switch 4/10 (switch penalty = −15% pop, −20% balance drift tolerance) |
| Push behavior | Auto-push when stick held forward below 70% max speed; ✕ tap on flat does nothing extra |
| Max speed | 11 m/s (glowing +8%) |
| Gravity | 22 m/s² (arcade floatier than real) |
| Ollie height | 0.9 m tap → 1.6 m full charge |
| Run end mid-combo | Combo can still be landed after the timer hits 0:00; banks if landed |
| Music | Synthesized Y2K breakbeat loop per park via Web Audio; volume slider; option to load the player's own MP3 folder via file picker (not bundled) |
| Career save | localStorage; "Reset career" in Options |
| Resolution | Fill window, pixel-ratio capped by quality preset |

---

## 16. BUILD MILESTONES (execute in order, commit after each)

| # | Milestone | Done when |
|---|-----------|-----------|
| M0 | Scaffold: Vite + TS strict + three + postprocessing + vitest + playwright, lint, `tuning.ts`, fixed-tick loop | blank scene renders, tests run |
| M1 | Input layer (gamepad + keyboard, Dir8, buffers, arbitration) + dev overlay showing raw/parsed input | input tests pass |
| M2 | Pure state machine + scoring + degradation + special meter + balance | all logic tests pass |
| M3 | Kinematic controller: ground, ramps/quarter-pipes, vert assist, landing angle checks, bail; test box level | can skate, ollie, land, bail |
| M4 | Rails: data format, magnet snap, grind types, switching, ends, sparks; manual + revert wiring | can hold a grind→manual→revert combo in the test level |
| M5 | Market Street built from data + validation tests + C-O-D-E + Sam + Laptop + gaps + goals | Street goals completable |
| M6 | Woodshed + spine transfer + lips + Dario + Drive + goals; 20-second rail combo check | Woodshed goals completable |
| M7 | Rendering pass: materials, lighting, shadows, post, skater rig + pose animations, FX, camera polish, quality presets | screenshots reviewed and fixed |
| M8 | HUD, main menu, career (6/10 unlock), Board Lab, pause/goal list, Options (quality, audio, remap view), synthesized audio | full loop from title to Lab Circuit stamp |
| M9 | Deploy config (Pages workflow, zip script), `DEPLOY.md`, parody build check, bundle-size check, final smoke test | `npm run build` output runs from a static server |

If you run low on budget, protect in this order: M2 logic → M4 grinding → M5 Street → M7 visuals → M6 Woodshed → M8 menus. A grind that feels right beats a menu that looks right.

---

## 17. HUD + MENUS

- **HUD:** 2:00 clock (top center, pulses red under 0:10), run score, combo ticker (trick names separated by " + ", base × multiplier live), special bar (glows/animated gradient when full), balance meter (horizontal arc over head for grind/lip, vertical bar beside skater for manual), land text (OK / SICK / INSANE), gap splashes, `SECRET LAPTOP` / `SECRET DRIVE` full-width splash, goal peek (last completed / next), letter tray C-O-D-E.
- **Main menu:** Title (animated park flythrough behind), Career, Free Skate, Board Lab, Options, Credits. Lab Circuit stamp appears when both MacGuffins are collected.
- **Board Lab:** 3D board on a turntable; tabs Deck Graphic · Grip · Trucks (color) · Wheels (color/durometer label) · Underside Stickers (drag to place up to 6, from sponsor sheets: brand sheets via §11 table + wafer / PCB / token-stream / inference sheets). All art procedurally generated. Selection persists and appears in-game.
- Full controller navigation for every menu (D-pad/stick move, ✕/A confirm, ○/B back).

---

## 18. SCOPE SPLIT

| MVP / Vertical Slice (this session) | v1.0 | Later |
|---|---|---|
| 1 preset skater, 2 parks, full grind/manual/revert, 2 lips, spine transfer on Woodshed, scoring + degradation + special, 5 specials, 2 NPC MacGuffin goals, C-O-D-E, 10 goals/park, main menu, Board Lab, web deploy | 8 fictional skaters, create-a-skater, full lip catalog, wallrides, wallplants, acid drops, flatland tricks, local split-screen, more parks, Nintendo glyphs | lab-campus park, online leaderboards, online multiplayer (HORSE / Trick Attack), more sponsor sheets |

Non-goals now: realistic stance analog, create-a-skater, online leaderboards, licensed soundtrack, coding minigame, >2 parks, open world.

---

## 19. QUALITY GATE — the build FAILS if any are true

- [ ] Combo does not survive a manual
- [ ] Vert landing cannot revert into a manual (including with R2 pressed slightly early)
- [ ] Revert doesn't toggle stance
- [ ] Scoring is flat addition with no multiplier
- [ ] Rails need sim-perfect alignment; a visible grindable edge doesn't snap
- [ ] Default session is not a 2:00 run
- [ ] No C-O-D-E letters, no Secret Laptop on Street, no Secret Drive on Woodshed
- [ ] Gaps or MacGuffins degrade
- [ ] Bail doesn't dump both combo and special
- [ ] Grind is weak or only on one map; Woodshed can't sustain a 20 s rail combo
- [ ] Anything is keyboard-only; controller can't reach every menu
- [ ] Balance axes are wrong (manual not vertical, grind not horizontal)
- [ ] L1/R1 quick spin missing
- [ ] A special input can accidentally trigger a manual or grind switch
- [ ] Licensed THPS track, THPS level name, or real pro skater leaked in
- [ ] Public build ships in `real` brand mode, or any real logo artwork is reproduced
- [ ] Decals cover coping or rails
- [ ] Physics exists without the table-driven state machine
- [ ] Parks play identically
- [ ] `npm run build` output doesn't run from a static host, or console has errors on load

BEGIN: write DESIGN.md, then execute M0 → M9.
