# Production export — shipping a playable game

The engine ships finished games two ways, both driven from one staged bundle:

- **Portable web folder** — a copy of the player runtime with the game baked in.
  Runs by opening `index.html` in any browser; host it on any static server.
- **Native app (current OS)** — the same folder wrapped in the Tauri "player"
  target, producing a real `.app`/`.dmg` (macOS), `.msi`/`.exe` (Windows), or
  `.AppImage`/`.deb` (Linux) for the OS you build on.

## How it fits together

1. **Editor → "Production" button** ([Toolbar.tsx](../src/components/Toolbar.tsx)) calls
   `exportProduction()` ([projectStore.ts](../src/store/projectStore.ts)). It builds a
   self-contained bundle (assets inlined as data URLs via
   [exportGame.ts](../src/project/exportGame.ts)), then:
   - **Desktop:** prompts for a destination folder (`platform.pickDirectory`), then runs the
     full build immediately. `platform.buildProduction` invokes the Rust command
     `run_production_build` ([lib.rs](../src-tauri/src/lib.rs)), which stages the bundle, runs
     `npm run export:production -- --out <dir>` from the engine root, and streams each output
     line back as a `production-build-progress` event — shown in the build-progress overlay.
     The portable web folder (`<slug>-web/`) and copied native installers (`<slug>-native/`)
     both land in the chosen folder.
     Requires running from source (the Rust command finds the engine folder by walking up to
     `package.json`) with `npm` on PATH; a packaged editor that isn't beside the source tree
     falls back to the error toast.
   - **Web:** stages `game.json` (download) and the toast shows the CLI command to finish.
2. **`scripts/export-production.mjs`** takes that `game.json` and:
   - runs `npm run build:player` → `dist-player/`,
   - writes `game-bundle.js` (`window.__NODEFORGE_GAME__ = {...}`) and patches
     `index.html` so the player boots from the global with no `fetch` (works from
     `file://`),
   - assembles the portable web folder under `exports/<slug>-web/`,
   - with `--native`, bakes the bundle into `dist-player/` and runs
     `tauri build --config src-tauri/tauri.player.conf.json`.
3. **Player boot order** ([Player.tsx](../src/player/Player.tsx)):
   `window.__NODEFORGE_GAME__` → `fetch('./game.json')` → manual file picker.

## Commands

```bash
npm run export:web          # portable browser folder only
npm run export:production    # portable folder + native app for the current OS
node scripts/export-production.mjs --bundle "<path>" --name "My Game" --zip
```

Native installers land in `src-tauri/target/release/bundle/`.

## Cross-platform reach

A given machine only builds a native app for **its own** OS (Tauri can't easily
cross-compile). To produce Windows + macOS + Linux from one push, run
`export-production.mjs --native` on a GitHub Actions matrix (macos/windows/ubuntu
runners) — a clear follow-up. The portable web folder, by contrast, already runs
everywhere.

## Packaged-editor caveat

The one-click desktop build shells out to `npm`/`cargo` from the Rust command, so it
needs the engine source tree (it walks up to `package.json`) and a working toolchain on
PATH — true when running via `npm run tauri:dev` or `tauri:build` from the repo. A
standalone editor installed elsewhere has no source tree to build from; there the button
surfaces a clear error and the web/CLI path (`npm run export:production`) is the fallback.
A fully self-contained packaged build would embed the player template + toolchain as
resources — a larger follow-up.
