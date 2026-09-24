import { defineConfig } from 'vite';

/**
 * Build config (integration track).
 *
 * - base "./" so dist/ runs from any static subpath (REQ-DEP-01).
 * - The entry (src/main.ts) only paints the start gate. Everything else is reached through
 *   a dynamic import() after the gate, so the first paint is tiny (REQ-DEP-03, REQ-MNU-05).
 * - The heavy libraries go into one "vendor" chunk that only the dynamic chunks import,
 *   so the browser fetches it after the gate is pressed.
 * - Brand mode comes from VITE_BRAND_MODE: ".env" (committed) says parody, ".env.private"
 *   (committed) says real and is loaded only by "vite build --mode private" (REQ-BRD-02).
 * - Dev harness pages under dev/ are served by the dev server only; the build input is index.html.
 */
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules[\\/](three|postprocessing|n8ao|three-mesh-bvh)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
