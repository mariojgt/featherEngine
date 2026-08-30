# Production Export

Feather Engine can ship a finished game to **six platforms**:

| Platform | Output | How |
| --- | --- | --- |
| Web | hosted folder + optional zip (`<game>-web/`) | build on any supported OS; serve from a static host |
| Windows | `.msi` / `.exe` (`<game>-windows/`) | build on Windows, or CI |
| macOS | `.app` / `.dmg` (`<game>-macos/`) | build on macOS, or CI |
| Linux | `.AppImage` / `.deb` (`<game>-linux/`) | build on Linux, or CI |
| Android | debug `.apk` or release `.aab` (`<game>-android/`) | Tauri mobile shell (any OS with the Android SDK/NDK) |
| iOS | `.ipa` / Xcode project (`<game>-ios/`) | Tauri mobile shell (macOS + Xcode only) |

Run **`npm run doctor`** at any time for a per-platform readiness report on the current
machine — it lists exactly what is installed, what is missing, and the command that fixes
each gap. The desktop editor shows the same report as the platform picker in the export
dialog.

Games are automatically playable on touch devices: Play mode overlays a virtual
joystick + look zone + SPRINT/USE/JUMP/FIRE buttons that feed the engine's standard
input pipes, so existing templates and key bindings work on phones with no per-game work.

## Recommended Flow

1. Open the project in the desktop editor.
2. Click **Export → Production** in the toolbar.
3. Choose the build profile metadata (product name, stable reverse-DNS application id,
   version/build number, launch scene, Release/Development, window size) and tick exactly
   the platforms you want. Web is an ordinary optional target. Missing local toolchains show what
   to install; targets that require another operating system produce a runner-ready staging folder.
4. Pick an output folder and wait for the build overlay to finish.
5. Share `<game>-web.zip`, install from the OS-named desktop folder, use the Android package,
   or finish iOS signing in Xcode.

For an existing Steam app, the desktop editor also provides **Export → Upload to Steam…**. It
previews or uploads one unpacked depot folder with the Steamworks SDK installed locally; it does
not upload an installer or promote a build to the public branch. See the
[Steam Publishing guide](STEAM_PUBLISHING.md) for setup, authentication, safeguards, and current
limitations.

The chosen profile is saved in the project and snapshotted into the artifact. Its application id
does not change when the project/display name changes, so game save slots and installed upgrades
keep the same identity.

The desktop editor runs builds when it is launched from the source tree and `npm`, Rust,
and platform build tools are available on PATH.

## CLI Commands

These commands read `exports/staging/game.json` by default. The editor writes that staged bundle when you use the Production flow.

```bash
npm run doctor         # per-platform toolchain report (add --json for machines)
npm run export:production # exact targets saved in the staged bundle/profile
npm run ship           # web folder + zip, then open the output folder
npm run ship:native    # web folder + zip + native Tauri app for this OS
npm run export:android # web + Android release AAB (Tauri mobile; needs SDK/NDK)
npm run export:ios     # web + iOS build (macOS only; generates the Xcode project)
npm run ship:fast      # rebuild player without TypeScript checking, then zip
npm run ship:reuse     # reuse existing dist-player, fastest for content-only re-exports
```

Flags compose: `node scripts/export-production.mjs --native --android --zip` builds this
desktop OS and Android in one run.

For exact target selection use the production form directly:

```bash
node scripts/export-production.mjs --bundle exports/staging/game.json --targets web,macos,android --zip
node scripts/export-production.mjs --bundle exports/staging/game.json --targets linux
```

Packaging `windows`, `macos`, and `linux` requires the matching build host. When another desktop
OS (or iOS off macOS) is selected, the exporter writes `<game>-<target>-staging/` with the canonical
bundle, immutable profile, and exact runner command instead of pretending it cross-compiled an app.
`--native` remains as a compatibility shortcut for the current host's exact desktop id.

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

1. The editor refuses to snapshot while Play is running, then creates a self-contained,
   current-schema `game.json` with embedded resources, the chosen profile, and a runtime contract.
2. `scripts/export-production.mjs` runs the same loader/migrations used by the player and rebuilds a
   canonical bundle. It blocks malformed profiles, missing Blueprint/widget/animation/cinematic
   references, unknown runtime features, referenced missing resources, and external glTF dependencies.
3. The script takes an exclusive export lock, clears prior outputs for the selected targets, then
   builds or reuses `dist-player/`. Concurrent editor/CLI exports cannot cross-pair game data.
4. When Web is selected, it copies the player into `<out>/<game>-web`, writes the canonical
   `game-bundle.js`, and injects it before the player module in `index.html`.
5. For native/mobile targets it generates a temporary per-game Tauri config from the build profile,
   temporarily bakes the same canonical bundle into `dist-player/`, builds, copies artifacts into the
   exact target folder, and restores the reusable player.
6. Every output includes the final `build-report.json` with its project/bundle versions, selected
   profile, built/staged/failed targets, required runtime features, content inventory, and warnings.

The restore step keeps repeated native exports from leaving game-specific generated files in the reusable player build.

## Output

- Hosted web build: `exports/<game>-web/` unless `--out <dir>` is passed. Serve the whole folder over HTTP(S); browsers do not reliably run module-based games by double-clicking `index.html` (`file://`).
- Zip, when requested: `exports/<game>-web.zip`.
- Native installers copied for sharing: `exports/<game>-windows/`, `<game>-macos/`, or `<game>-linux/`.
- Cross-OS handoff: `exports/<game>-<target>-staging/` (canonical game/profile + runner command).
- Raw per-game Tauri/Cargo output: `src-tauri/target/nodeforge-exports/<application-id>/`.
- Machine-readable provenance/parity report: `exports/<game>-build-report.json` and a copy beside each artifact.

The web zip is a deployment artifact, not a standalone executable. Upload/extract it on any static
host (or test locally with a small HTTP server). Tauri desktop/mobile outputs are the standalone
application targets and do not require the player to start a separate web server.

## Cross-Platform Desktop Builds (CI)

Tauri builds desktop apps for the current operating system only. To ship all three desktop
targets from one project, use the bundled GitHub Actions workflow
[.github/workflows/export-desktop.yml](../.github/workflows/export-desktop.yml):

1. Push the engine repo to GitHub.
2. In the Actions tab, run **Export Desktop Installers**, passing a `bundle_url` that points
   at your exported `game.json` (a GitHub release asset, gist raw URL, etc.) — or commit the
   staged bundle with `git add -f exports/staging/game.json` and leave the input empty.
3. Download the `game-windows`, `game-macos`, `game-linux`, and `game-web` artifacts.

The hosted web build runs in modern browsers; the native artifacts are standalone applications.

## Mobile Builds

Both mobile targets wrap the same player build in the Tauri 2 mobile shell. Generated native
projects are cached per stable application id under
`src-tauri/target/nodeforge-mobile/<application-id>/`. The build swaps that cache into Tauri's
`src-tauri/gen/` location temporarily, then restores the engine scaffold. Exporting another game
therefore cannot reuse or overwrite the first game's package id/signing project.

**Android** (`npm run export:android`, or the Android checkbox in the editor):

- Needs: Android SDK platform, Build-Tools, Platform-Tools, accepted licenses, and NDK
  (Android Studio's SDK Manager, or `ANDROID_HOME`/`NDK_HOME`),
  JDK 17+, and the Rust targets
  (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`).
  The export script auto-detects a standard Android Studio install even without env vars.
- Output: Development profiles produce a sideloadable `.apk`; Release profiles produce an `.aab`
  for store delivery. Play Store uploads need a release keystore/signing configuration.

**iOS** (`npm run export:ios`, or the iOS checkbox — macOS only):

- Needs: Xcode with an iOS Simulator runtime installed under **Xcode → Settings → Components**,
  CocoaPods (`brew install cocoapods`), and
  `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.
- Packaging an `.ipa` needs an Apple code-signing identity and team (a free Apple ID works for
  on-device development builds; App Store releases need distribution signing). If the
  command-line build stops at signing, open
  `src-tauri/target/nodeforge-mobile/<application-id>/apple` in Xcode, pick your team under
  Signing & Capabilities, and export again.

On macOS, the exporter always verifies the finished `.app` with `codesign --deep --strict`. It uses
`APPLE_SIGNING_IDENTITY` (or an installed **Developer ID Application** identity) when available;
otherwise it applies a valid ad-hoc signature for local testing. Public distribution still requires
Developer ID signing and Apple notarization.

Generated artifacts are not automatically store-publishable: Windows Authenticode, macOS
notarization, Android release-keystore signing, and store credentials remain release-operator
responsibilities. The final build report records these checks as warnings rather than claiming a
local-test artifact is store-ready.

## Play-to-Build Parity

Editor Play and the standalone player mount the same `GameView`, runtime overlays, frame/input
driver, Zustand runtime state, Blueprint/FeatherScript execution, Rapier physics, UI renderers,
audio, cinematics, and gameplay systems. The editor no longer maintains a second Play renderer.

The runtime contract inventories every authored subsystem used by the project (Blueprints,
FeatherScript, DOM/WebGL/world widgets, physics, characters, vehicles, navigation, terrain, trees,
water, cloth, cables, particles, animation, cinematics, audio, materials, prefabs, inventory,
destruction, reflection probes, persistence, timelines, and post-processing). A player that does
not know a required feature rejects the bundle instead of silently dropping it. The production
browser smoke test also executes Start/Update Blueprint paths, UI bindings and button events,
physics, embedded assets, water/cloth/cable rendering, cinematics, launch-scene selection, and
legacy migration in the assembled player.

The shared code path guarantees engine behavior parity. Pixel output can still vary slightly with
the browser/WebView, GPU driver, operating system, display scale, and platform audio stack.

## Packaged Editor Caveat

The one-click desktop build shells out to the local source tree, so it expects this repository, `node_modules`, `npm`, Rust, and platform build tools to be available. A standalone installed editor that is not beside the source tree should export `game.json` and use the CLI flow from the source folder.
