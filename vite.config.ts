import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `BUILD_TARGET=player vite build` produces the standalone game player into dist-player/.
const isPlayer = process.env.BUILD_TARGET === 'player';

/** Finalize the standalone player without shipping editor-only starter content. */
function finalizePlayerBuild(): Plugin {
  return {
    name: 'finalize-player-build',
    closeBundle() {
      const from = resolve(__dirname, 'dist-player/player.html');
      const to = resolve(__dirname, 'dist-player/index.html');
      if (existsSync(from)) renameSync(from, to);

      // Vite copies all of public/ by default. Starter projects and the marketplace need these
      // directories in the editor, but exported games embed their own referenced assets in
      // game-bundle.js. Keeping the editor catalogs makes every player needlessly huge.
      rmSync(resolve(__dirname, 'dist-player/templates'), { recursive: true, force: true });
      rmSync(resolve(__dirname, 'dist-player/store'), { recursive: true, force: true });
    },
  };
}

/**
 * Dev-only sink for `?exportTemplate=<key>` (see src/dev/exportTemplate.ts).
 *
 * The starter templates are imperative builders that fetch real multi-megabyte models and use
 * browser-only APIs, so the only faithful way to turn one into a `.nfpack` is to run it in a real
 * browser and post the result back out. This receives that JSON and writes it into public/store/.
 */
function templateExportSink(): Plugin {
  return {
    name: 'feather-template-export-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__feather/export-template', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        // The body is the finished `.nfpack` archive (binary), so the slug travels in the query.
        const slug = new URL(req.url ?? '', 'http://localhost').searchParams.get('slug') ?? '';
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('bad or missing slug');
            const bytes = Buffer.concat(chunks);
            if (!bytes.length) throw new Error('empty body');
            // Templates are kind:project, so they land in the projects folder (see KIND_DIRS in
            // scripts/build-store-catalog.mts — the catalog generator reads them back from there).
            const dir = resolve(__dirname, 'public/store/packages/projects');
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${slug}.nfpack`), bytes);
            const mb = (bytes.length / 1048576).toFixed(1);
            server.config.logger.info(
              `[template-export] wrote public/store/packages/projects/${slug}.nfpack (${mb} MB)`,
            );
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, slug }));
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}

// Tauri expects a fixed dev server port (see src-tauri/tauri.conf.json devUrl).
export default defineConfig({
  plugins: [react(), templateExportSink(), ...(isPlayer ? [finalizePlayerBuild()] : [])],
  clearScreen: false,
  // Relative base so a hosted export can live under any URL path and Tauri can use the same build.
  // Browsers block module applications launched directly through file://; see PRODUCTION_EXPORT.md.
  ...(isPlayer ? { base: './' } : {}),
  // ktx2-encoder's Basis wasm loader (dist/basis/basis_encoder.js) contains a top-level `await`
  // inside a NODE-only guard (`if (ENVIRONMENT_IS_NODE) { await import('module') }`). esbuild's
  // dep pre-bundler rejects that statically under Vite's default es2020 target. Bump the per-file
  // transform target AND tell the dep optimizer's esbuild to accept top-level await (Vite merges
  // `optimizeDeps.esbuildOptions.supported` into its own defaults — see runOptimizeDeps).
  esbuild: { target: 'es2022' },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
      supported: { 'top-level-await': true },
    },
  },
  build: isPlayer
    ? {
        target: 'es2022',
        outDir: 'dist-player',
        emptyOutDir: true,
        rollupOptions: { input: resolve(__dirname, 'player.html') },
      }
    : { target: 'es2022' },
  server: {
    host: '0.0.0.0',
    // 17420, not Tauri's default 1420 — that collides with any other Tauri app's dev server (and the
    // sibling MomentumCup/MyAge projects). Keep this in sync with src-tauri/tauri.conf.json devUrl.
    port: 17420,
    strictPort: true,
  },
  // Collapse the duplicate `three` module copies in tests. three-bvh-csg / three-mesh-bvh resolve
  // three through their own interop, and with two copies the CSG brushes end up in separate three
  // worlds and fail to build bounds trees ("Cannot read properties of undefined (reading 'array')").
  // `test` is vitest's config field; vite's own UserConfig doesn't type it, hence the cast.
  ...({ test: { resolve: { dedupe: ['three', 'three-mesh-bvh'] } } } as object),
});
