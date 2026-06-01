import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

// `BUILD_TARGET=player vite build` produces the standalone game player into dist-player/.
const isPlayer = process.env.BUILD_TARGET === 'player';

/** Emit the player entry as index.html so an exported game opens by default. */
function renamePlayerEntry(): Plugin {
  return {
    name: 'rename-player-entry',
    closeBundle() {
      const from = resolve(__dirname, 'dist-player/player.html');
      const to = resolve(__dirname, 'dist-player/index.html');
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

// Tauri expects a fixed dev server port (see src-tauri/tauri.conf.json devUrl).
export default defineConfig({
  plugins: [react(), ...(isPlayer ? [renamePlayerEntry()] : [])],
  clearScreen: false,
  // Relative base so the exported player runs from any folder (or file://).
  ...(isPlayer ? { base: './' } : {}),
  build: isPlayer
    ? {
        outDir: 'dist-player',
        emptyOutDir: true,
        rollupOptions: { input: resolve(__dirname, 'player.html') },
      }
    : {},
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
  },
});
