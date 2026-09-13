# Production Export

The installed desktop editor packages games using the player and native runner shipped with it. Desktop/web exports do not require an engine source checkout, Node, Rust or a compiler.

## Build from the editor

1. Open **Export → Production**, choose platforms, game name and launch scene.
2. Review project checks. **Prepare geometry** adds reusable mesh LODs. Optional **Compress textures** prepares smaller texture variants. **Stream assets** moves asset bytes into separate files loaded when used. Original project assets stay intact.
3. Build into an output folder. Each build gets a unique directory, preserving earlier builds.
4. Feather launches the local native artifact and waits for its start scene to load and render. Review the result, cache hits and largest assets. Other operating systems still need their own launch test.
5. Choose **Continue to Steam** to use the exact unpacked artifact folders and configure the depots. See [Steam publishing](STEAM_PUBLISHING.md).

| Target | Installed editor output | Requirement |
| --- | --- | --- |
| Web | Complete static-host folder; browser editor downloads a complete zip | Included player runtime |
| Windows | Portable folder with `.exe` and game files | Windows runner pack; system WebView2 |
| macOS | `.app` inside its depot folder | macOS runner pack and macOS host for ad-hoc signing |
| Linux | Portable executable and game folder | Linux runner pack; system WebKitGTK dependencies |
| Android/iOS | Existing source/CI packaging flow | Platform SDK, native build host and signing tools |

The platform picker reports installed runtime availability. **Install platform runtime** accepts a Feather runner pack folder containing `runner.json` and its checksum-verified executable. Editor releases include the host runner; CI publishes additional platform/architecture packs as workflow artifacts. Packs must match the editor's CPU architecture; a pack for a different CPU is not substituted silently. Installing a pack does not install operating-system WebView dependencies.

`build-report.json` lives above the game folders. It records the immutable profile, engine source hash, asset preparation, exact depot roots, file checksums and launch results. Rechecking before connected publishing rejects game files changed after packaging. A launch check covers loading and rendering the start scene, not a complete gameplay playthrough.

Web exports must be served over HTTP(S). Upload the whole folder, including `game-assets`, to a static host. The browser editor can make this zip directly. Other browser-selected platforms download a source build package with instructions.

Installed macOS exports use an ad-hoc signature for local testing. Public signing/notarization and store onboarding remain separate. The source CLI below can produce installers and use configured signing identities. This is not a hosted cloud build service.

## Asset and player caches

Prepared asset variants are cached by source bytes, preparation version, target preset and settings. Browser/desktop UI builds use IndexedDB; CLI builds use `.feather-cache/assets`. Invalid cache bytes are rebuilt. Build receipts show cache hits, file sizes, triangle counts and warnings. See [Asset preparation](ASSET_PREPARATION.md) for eligibility and limits.

`npm run build:player` fingerprints source/configuration inputs and validates every cached runtime file before reuse. `--force` rebuilds it. `--verify-only` rejects stale or edited output; production `--skip-build` uses that check. `npm run build` builds both the reusable player and editor. Engine maintainers run `npm run prepare:runtime` to also compile and package the native host runner before distributing the editor.

## Source/CI exporter

The following commands are the advanced source workflow, including installer and mobile builds. Their toolchain requirements are reported by `npm run doctor`; the installed editor's runtime picker has a different purpose.

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
npm run ship:reuse     # reuse a verified dist-player; rejects stale source or changed runtime files
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
   Reports also record the engine revision, dirty/source fingerprint, bundle SHA-256, and output-file
   hashes. `ASSET-CREDITS.txt` carries model copyright metadata when supplied. File hashes exclude the
   report itself to avoid a circular checksum. Metadata credits do not establish an asset’s license.

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

### Tag-Triggered Desktop Releases

When the goal is releasing a version of the **editor itself** (not a player game bundle),
[.github/workflows/release-desktop.yml](../.github/workflows/release-desktop.yml) builds the
Tauri desktop app for Windows, macOS and Linux and attaches the installers to a GitHub Release
every time a version tag is pushed:

```bash
git tag v0.1.0        # must match src-tauri/tauri.conf.json version
git push origin v0.1.0
```

1. GitHub Actions runs a 4-job matrix, each on its own runner (Tauri cannot cross-compile):
   - `windows-latest` → NSIS installer (`*.exe`) + MSI (`*.msi`)
   - `macos-latest` → `.app` + `.dmg` for **Apple Silicon**
   - `macos-latest` → `.app` + `.dmg` for **Intel** (x86_64 cross-target)
   - `ubuntu-22.04` → Linux installers
2. `tauri-action` runs `npm run prepare:runtime` (via `beforeBuildCommand`), then `cargo` builds the
   Rust shell and bundles the installers.
3. The action creates a **draft** GitHub Release named after the tag with all installers
   attached; review and publish it from the Releases page.

Notes:

- Releases are unsigned unless code-signing secrets are configured in the repo
  (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID` / `APPLE_PASSWORD` for macOS,
  plus any Windows signing keys). Unsigned macOS builds ship as ad-hoc signed and can be
  blocklisted by Gatekeeper.
- A new tag push requires the push account to have the GitHub `workflow` scope (used when
  the workflow file itself was first added/updated): `gh auth refresh -s workflow`.
- Draft releases let you smoke-test installers before making them public; mark it as a
  prerelease (or publish) once verified.

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
