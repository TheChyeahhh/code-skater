# AGENTS.md: house law for every agent working on CODE SKATER

Read this before touching anything. It is short on purpose.

## Where you are
- Repo: the folder that holds this file (branch `main`).
- Node 24 and npm 11. Playwright's Chromium (or an installed Chrome) runs the screenshot script and the e2e tests.
- On Windows with Git Bash, arguments that start with `//` or look like POSIX paths can get rewritten. Set `MSYS_NO_PATHCONV=1` if a path argument arrives mangled.

## Source of truth, in order
1. `SPEC.md`: the original build prompt (real company and person names removed). Its §3 corrections are approved.
2. `DESIGN.md`: the implementable restatement with REQ IDs and the Locked numbers table.
3. `ARCHITECTURE.md`: module contracts, data flow, file ownership, dev ports.
If they disagree, SPEC wins, then DESIGN. Changes to a locked number go into DESIGN.md §L as `CHANGE-REQUEST: <id> old -> new, reason`, written by the integration track (tracks submit them under `requests`). The field names in DESIGN §G's level-format paragraph are prose: the level schema is `src/levels/types.ts`.

## Code rules
- TypeScript strict. No magic numbers: every tunable lives in `src/core/tuning.ts` or your track's `src/core/tuning/<track>.ts`, with a comment citing its REQ ID and range. Systems read `TUNING` live each tick (the dev panel edits it at runtime), never cache values.
- The sim is pure and deterministic: no rendering imports in `src/sim/**`, no `Math.random` in sim (use the seedable RNG), no wall-clock time (sim time only).
- Zero downloaded assets: all geometry procedural, all textures generated (Canvas2D or shaders), all audio synthesized. No CDN fonts, no remote URLs at runtime. System font stacks only.
- Write the minimum code that meets the spec well. No speculative features beyond SPEC's MVP column.

## Names and copy
- Real company or person names (the real column of SPEC §11) may appear ONLY in `src/data/brands.ts`. Every other file reads names from that table. The default build is parody.
- `tests/brands.test.ts` enforces it: it greps every file in src/, tests/, dev/, e2e/, scripts/ (plus index.html, ARCHITECTURE.md, package.json, .env*) for every real-mode string in brands.ts (company, person, product, MacGuffin and special names of the real table) and the banned franchise names, case-insensitive, substring, comments included. So never write a MacGuffin, special, company or person name as a literal, not even in a comment or a test: read it from `BRANDS`. Watch generic words that contain a banned name (a loading-dock sign, a code comment about a tool).
- Never use licensed skate game franchise, studio, publisher or level names (the banned list lives in `scripts/lib/brandScan.mjs`), any real pro skater's name, or licensed music.
- In-game, user-facing text never uses em dashes (founder rule). Use periods, commas or colons. Code comments are exempt.

## Git
- No attribution of any kind in commits: no `Co-Authored-By`, no "Generated with", no session links. Plain descriptive messages.
- Commit only when your task says so, and then stage ONLY the paths you own (`git add <your paths>`), never `git add -A` during a parallel phase. If `index.lock` exists, wait a few seconds and retry.
- Never run commands that rewrite the shared working tree: no `git checkout -- .`, `git stash`, `git reset --hard`, `git clean`.

## Shared working tree (parallel phases)
- Several agents edit this tree at the same time. Edit ONLY files your track owns (see ARCHITECTURE.md ownership table). If you need a change in a file you do not own, do not edit it; list it under `requests` in your final output.
- New tunables go only in your own file `src/core/tuning/<track>.ts` (entry format in ARCHITECTURE.md section 7; META comes from the same entry). Never edit `src/core/tuning.ts`: it already assembles every track file.
- Do not run `npm install` or add dependencies during a parallel phase. Ask via `requests`.
- Whole-project `tsc` may show errors in other tracks' files while they work. Filter to your own files; make your own files clean.
- Run only your own tests (`npx vitest run tests/<yours>`), and your own dev harness on your assigned port (`npx vite --port <port> --strictPort`). Kill any server you start before you finish.
- A DOM test puts `// @vitest-environment happy-dom` on line 1; everything else runs in plain node.
- Another track's function may still throw notImplemented: call it through `tryImplemented` with a fallback, and never write a test that fails only because another track is unfinished (ARCHITECTURE.md section 10).
- A changed locked number or DESIGN rule goes under `requests` as `CHANGE-REQUEST: <id> old -> new, reason`; the integration track writes it into DESIGN.md §L.

## Proof
- Never claim something works without running it. Report the exact commands you ran and whether they passed.
- For anything visual, take a screenshot (`node scripts/shot.mjs <url> <out.png>`) and look at it with your Read tool before calling it done. Say what you saw.
