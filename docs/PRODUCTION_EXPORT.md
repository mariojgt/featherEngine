# Production Export

Feather Engine can ship a finished game as:

- **Portable web build**: a folder and optional zip that runs by opening `index.html` or by hosting it on any static web server.
- **Native app for the current OS**: the same game wrapped with the Tauri player target, producing installers for the machine you build on.

## Recommended Flow

1. Open the project in the desktop editor.
2. Click **Production** in the toolbar.
3. Pick an output folder.
4. Wait for the build overlay to finish.
5. Share the generated `<game>-web` folder or `<game>-web.zip`, or install from `<game>-native`.

The desktop editor runs the native + web build automatically when it is launched from the source tree and `npm`, Rust, and platform build tools are available on PATH.

## CLI Commands

These commands read `exports/staging/game.json` by default. The editor writes that staged bundle when you use the Production flow.

```bash
npm run ship          # web folder + zip, then open the output folder
npm run ship:native   # web folder + zip + native Tauri app for this OS
npm run ship:fast     # rebuild player without TypeScript checking, then zip
npm run ship:reuse    # reuse existing dist-player, fastest for content-only re-exports
```

Lower-level commands are still available:

```bash
npm run export:web
npm run export:production
node scripts/export-production.mjs --bundle "path/to/game.json" --name "My Game" --zip --open
```

## Speed Guide

- Use `npm run ship:native` for the final build you give players.
- Use `npm run ship:fast` while iterating on packaging. It still rebuilds the player, but skips the TypeScript project check.
- Use `npm run ship:reuse` when only the exported game data changed and the player code did not. This reuses `dist-player/` and is the fastest path.
- Use `npm run build:player` after changing player/runtime code so `ship:reuse` has a fresh player to copy.

## How It Works

1. The editor creates a self-contained `game.json` bundle with embedded resources.
2. `scripts/export-production.mjs` checks the bundle inventory and warns about missing resources.
3. The script builds or reuses `dist-player/`.
4. It copies the player into `<out>/<game>-web`, writes `game-bundle.js`, and injects it into `index.html`.
5. With `--native`, it temporarily bakes the bundle into `dist-player/`, runs `tauri build --config src-tauri/tauri.player.conf.json`, copies installers into `<out>/<game>-native`, then restores `dist-player/`.

The restore step keeps repeated native exports from leaving game-specific generated files in the reusable player build.

## Output

- Portable web build: `exports/<game>-web/` unless `--out <dir>` is passed.
- Zip, when requested: `exports/<game>-web.zip`.
- Native installers copied for sharing: `exports/<game>-native/`.
- Raw Tauri bundle output: `src-tauri/target/release/bundle/`.

## Cross-Platform Native Builds

Tauri builds native apps for the current operating system. Build on Windows for Windows installers, macOS for macOS apps, and Linux for Linux packages. To produce all three from one project, run the same export command on a CI matrix with Windows, macOS, and Linux runners.

The portable web build runs everywhere.

## Packaged Editor Caveat

The one-click desktop build shells out to the local source tree, so it expects this repository, `node_modules`, `npm`, Rust, and platform build tools to be available. A standalone installed editor that is not beside the source tree should export `game.json` and use the CLI flow from the source folder.
