# Beginner and production delivery record

Implemented on 7 September 2026, starting from `053fac5`. The working tree contains the changes and generated starter/player files. The existing `bun.lockb` modification was preserved.

| Area | Delivered behavior |
| --- | --- |
| 1. UI | Offline recommended Platformer, resumable five-step first-game guide, explicit Play/Stop state, responsive toolbar, repaired workspace/status-bar layout, and retained import/build feedback. |
| 2. Beginner programming | Editable rule cards with recipes, enable/disable/duplicate/delete, named sound/animation pickers, transactional compilation and undo, shared-Blueprint isolation, custom-source protection, and built-in player input preservation. Graph/FeatherScript now support once-per-press keyboard events, including short taps. AI tools mirror the new actions. |
| 3. Templates | Versioned learning metadata for four starters. Cloudstep Garden has editable start/help, pause/resume, restart, and play-again UI using ordinary Blueprints and game variables. The local builder and shipped store package include the same content. |
| 4. Models | Three matching Model Forge props: gift crate, sprout lantern, garden gate. Metadata inspection works independently of GPU/texture decoder setup; glTF sidecars pack into a portable GLB. Import reports show geometry/material/animation statistics and limitations. Optimized imports retain originals. Replacing a mesh preserves its gameplay/collision root; restore, clone, save, and package import retain ownership. Model/tree definitions now travel with dependent packages and receive fresh IDs. |
| 5. Physics | Forgiving platformer and grounded third-person presets, labeled movement/surface controls, configurable stairs/slope/snap handling, reduced jump-apex cadence bias, and a correction for double-applied ground snap above 60 FPS. Legacy jump settings remain the default for existing projects. |
| 6. Production | Platform → project checks → build → test guidance; explicit downloaded/staged/built/failed outcomes; retained logs and output paths. Browser saves embed imported asset bytes. Build reports include source revision/fingerprint, bundle and output hashes, content inventory, and supplied model copyright credits. CI runs the beginner browser journey and retains its artifacts. |

## Validation

- Baseline: 86 test files, 551 tests passed before changes.
- Current unit suite: **90 files, 573 tests passed**. This includes real Rapier travel/jump checks at 30/60/120/144 Hz, stairs, landing/pause/hitches, existing moving-platform/physics tests, rule ownership and undo, package installation, model metadata, and keyboard tap/hold behavior.
- Editor production build and TypeScript checking pass. The standalone player is rebuilt from the same source. Vite still reports the existing large-bundle warning; the build succeeding is not a measured startup/performance budget.
- **Passed:** `npm run test:beginner`, including the Creator smoke test and the complete browser/export journey. **Passed:** `npm run test:production`, including WebGL, embedded assets, physics, Blueprint/HUD behavior, water/cloth/cable, cinematic overlay, migrations, and portable file-hash checks (28 files, 10.3 MB smoke artifact). The regenerated shipped catalog also passes its 13 installation tests.
- The browser acceptance script checks the offline launcher and usable 1280×720 workspace, rule editing, real Model Forge GLB baking/inspection/replacement, actual project download and reopen, export dialogs at 1440×900, and the exported player's movement and menus at root and nested URLs. The acceptance game includes an ordinary Blueprint/UI position probe and a win-screen trigger. The clean output omits those probes.
- Native macOS packaging has produced an `.app` and `.dmg`; the exporter verifies the app's code signature. This local build uses ad-hoc signing. Public distribution still requires the appropriate signing/notarization and target-machine acceptance.
- Final release verification: **27 web and 6 macOS file hashes match their reports**; the release player JavaScript matches the browser-tested bytes. The web zip is approximately **4.9 MB**, and the Apple Silicon macOS DMG is approximately **10.9 MB**. Build/test logs are retained in `exports/cloudstep-release/validation/`.

Repeat the current checks using the commands in [the quickstart](BEGINNER_QUICKSTART.md). Browser screenshots, downloaded projects, clean/acceptance web builds, and their reports are generated under `exports/beginner-acceptance/`. Final clean web/macOS builds and archives are under `exports/cloudstep-release/`. These are local, ignored artifacts; the CI browser job uploads its acceptance folder.

## Release validation still required

The original roadmap includes work that requires people, devices, or additional content production:

- Beginner usability sessions, keyboard/enlarged-text accessibility review, and measured completion-time goals.
- GPU/device-specific load time, frame-time, memory, and download budgets. Headless acceptance uses Low quality for software-rendered Chrome and does not establish a 60 FPS desktop or 30 FPS phone claim.
- Independent Windows/Linux builds and installs, plus macOS launch/gameplay acceptance on a clean machine and public signing/notarization.
- Android SDK/NDK and iOS simulator/signing setup, followed by real-device touch, lifecycle, memory, and performance checks.
- A full rendering fixture matrix for FBX, Draco, meshopt, KTX2, and animated rigs. Current coverage includes compressed-format metadata, external glTF packing, and a real baked GLB; synthetic metadata fixtures do not certify every decoder or source exporter.
- Expansion of the complete lesson/game loop to the remaining templates, additional rule recipes/object-target pickers, richer animation-rig mapping, and a larger art kit. Existing specialist editors remain the path for those advanced tasks.

The physics worker remains disabled. Replacing static appearance preserves collision rather than automatically fitting a new collider, and animated/model-linked objects require their existing rig/model editors. These boundaries keep this implementation usable with current projects while the broader roadmap continues.
