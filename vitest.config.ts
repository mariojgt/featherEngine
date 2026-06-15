import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Headless test harness. jsdom gives the store + react-flow helpers a DOM to import against;
// tests drive the Zustand store directly (no rendering) so they stay fast and deterministic.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Rapier kicks off a WASM init on import; give slow first-load a little headroom.
    testTimeout: 20000,
  },
});
