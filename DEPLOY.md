# DEPLOY.md: putting CODE SKATER online

CODE SKATER is a static site: `npm run build` writes `dist/`, and `dist/` runs from any host and
any subpath (`vite.config.ts` uses `base: "./"`, REQ-DEP-01). Every deploy path below runs the two
gates first:

- `npm run check:parody`: fails if the public build contains any real brand, person or banned
  franchise name (REQ-BRD-04, SPEC §19). Never publish a build that fails it.
- `npm run check:size`: fails if the gzipped JS is over 1500 KB (REQ-DEP-04).

Requirements: Node 24 and npm 11. Everything below is copy-paste from the repo root.

```sh
npm ci
npm test
npm run build
npm run check:parody
npm run check:size
```

`npm run build:private` makes the real-names build for private use only. It is expected to FAIL
`check:parody`; never upload it anywhere public.

## 1. GitHub Pages

The workflow `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

1. Push the repo to GitHub.
2. In the repo: Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Push to `main` (or run the workflow by hand: Actions > Deploy to GitHub Pages > Run workflow).

The workflow runs `npm ci`, the typecheck, the unit tests, `npm run build`, `check:parody`,
`check:size` and the production-build smoke test from a subpath (`npx playwright test --project=static`),
then uploads `dist/` with `actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`.
The site appears at `https://<user>.github.io/<repo>/`; the relative base makes the subpath work
with no config.

## 2. Vercel or Netlify

Both detect Vite. Settings, if asked:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build && npm run check:parody && npm run check:size` |
| Output directory | `dist` |
| Node version | 24 |

Vercel from the command line:

```sh
npx vercel --prod
```

Netlify from the command line (after `npm run build` and the two checks):

```sh
npx netlify deploy --prod --dir=dist
```

No redirects or rewrites are needed: the game is a single `index.html` with relative asset paths.

## 3. itch.io (HTML5 upload)

```sh
npm run build
npm run check:parody
npm run check:size
npm run zip
```

`npm run zip` writes `code-skater-web.zip` with `index.html` at the zip root (itch.io requires it).
On itch.io: Create new project > Kind of project: **HTML** > Upload files: `code-skater-web.zip` >
tick "This file will be played in the browser" > Embed options: viewport 1280 x 720, tick
"Fullscreen button". Leave "Automatically start on page load" off or on as you like: the game shows
its own start gate either way, because browsers only start audio and gamepads after a press.

## 4. Check a build locally

```sh
npm run build
npm run preview          # http://localhost:4173/
npx playwright test --project=static   # the built output from a subpath, clean console
```

## 5. Measurements (REQ-REN-06, REQ-DEP-03)

Recorded 2026-09-23, polish round 1, production build served by `vite preview` on localhost,
Playwright Chromium with hardware ANGLE (D3D11), fresh profile each run.

### First playable (REQ-DEP-03: under 5 s on broadband)

Fast path: click the start gate at once, then ArrowDown, Enter, Enter until the run is on screen,
plus 5 frames. RTX 5070, 1280 x 720 at device pixel ratio 2, quality "auto".

| Build | Runs | First playable | Main menu visible after the gate |
|---|---|---|---|
| before polish round 1 (27ee374) | 3 | 4.09, 4.11, 4.10 s | about 2.0 s |
| after polish round 1 | 3 | 4.13, 4.08, 4.08 s | 0.30 s |

An earlier audit on the same machine (14 runs, some with a 10 Mbps / 40 ms throttle) saw 3.9 to
10.2 s, median 5.7 s, with the variance coming from main-thread shader links; the network was never
the limit (every chunk had arrived by 1.4 s). Polish round 1 moved the run's shader programs to
`compileAsync` (KHR_parallel_shader_compile) before the first frame, so the main thread is free
while they link, and the main menu now paints before the game chunk starts its park build.
Still open: procedural texture generation (about 0.8 s) and the environment bake (about 0.5 s)
run on the main thread; moving texture generation to a Worker is the next step if a slower
machine misses the budget.

### Frame rate (REQ-REN-06: 60 fps at 1080p High on an RTX 3060 / M1 class; 30+ fps at Low on integrated)

| Machine | Setting | Scene | Median frame | p95 | p99 |
|---|---|---|---|---|---|
| RTX 5070 | auto (probe picked Ultra), 2560 x 1440 physical, vsync on | Market Street run | 16.7 ms (60 fps) | 16.8 ms | 16.8 ms |
| RTX 5070 | High, 1920 x 1080, vsync off (render track) | Woodshed | 0.8 ms | | 1.2 to 1.3 ms |
| RTX 5070 | High, 1920 x 1080, vsync off (render track) | Market Street | 1.0 ms | | 1.4 to 1.7 ms |
| RTX 5070 | High, 1920 x 1080, vsync on (render track) | both parks | 16.7 ms (60.0 fps) | | 16.8 ms |

Not yet measured: a real RTX 3060 (DESIGN L CR-33 waits on it) and an integrated GPU at Low.

### Quality probe (REQ-REN-05)

"auto" now waits until the scene on screen has drawn 30 frames (INT_PROBE_WARM_FRAMES), measures the
median frame over FPS_PROBE_S and ignores frames over 100 ms (INT_PROBE_DROP_FRAME_MS); the result is
kept in localStorage (`code-skater.probedQuality`), so it runs on the first load only. On the RTX 5070
at device pixel ratio 2 it picked Ultra in 3 of 3 fresh-profile runs (before: Low in every run,
because the park build stalled inside the 2 s window).
