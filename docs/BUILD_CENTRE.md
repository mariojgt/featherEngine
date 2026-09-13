# Build Centre

Open **Export → Build Centre**. Local builds use the existing Build Report: review the
saved profile, choose installed target runtimes, cook assets, package and run the local
native launch check. The latest result links to its folder and Steam publishing.
The web editor can download a playable web game; cloud builds require Feather desktop.

## Connect GitHub once

1. Put this Feather revision in a GitHub repository you can write to. Commit
   `.github/workflows/feather-build-centre.yml`, `scripts/package-runtime-game.mjs`, and
   the engine sources it uses. The workflow must exist on the repository's default
   branch and on the branch/tag selected in the editor. Enable GitHub Actions.
2. Install [GitHub CLI](https://cli.github.com/) and authenticate with `gh auth login`.
   The account needs repository write access and permission to dispatch Actions.
   Credentials remain with GitHub CLI; the editor does not save tokens or passwords.
3. Enter `owner/repository` and an engine branch/tag, then **Check connection**.
   The editor shows repository visibility and the resolved engine commit.
4. Stop Play, then **Prepare game package**. This embeds assets and checks runtime
   references. Review its destination, name, size and warnings. The cloud package is
   limited to 512 MB and includes the saved profile with Windows/macOS/Linux/Web targets.
5. **Upload package and start builds** uploads this exact snapshot to a uniquely named
   draft release in the selected repository and dispatches its workflow. Later scene
   edits are not included. If the engine branch changes after review, prepare again.

Choose a private repository when the game package must remain private. GitHub Actions
usage counts against that repository's allowance. This is an explicit editor action;
the AI tools can prepare the review but cannot dispatch uploads.

## Build, test and collect

Each matrix job builds the player and a host-native standalone runner from the reviewed
engine commit. It downloads the reviewed game package, checks its SHA-256, validates
runtime compatibility, prepares assets, packages a portable game and runs `--smoke-test`.
The smoke test must confirm that the launch scene loaded and rendered. It does not
validate a whole playthrough, controller support, achievements or multiplayer.

The editor shows job and launch-step results, links to logs, and offers cancellation,
rebuilding the same package and **Collect artifacts**. Downloads go into a fresh folder;
existing files are not overwritten. Refresh recovers remote status after closing or
reopening the editor. Each project keeps the latest 20 request records locally.

Artifacts contain a `.tar.gz` game archive (preserves Unix executable permissions) and
`launch-test.json` with platform/CPU, input/runtime hashes, prepared-asset reports,
file checksums, signature status and launch outcome. Failed launch checks still upload
the report. Linux also produces a web archive; serve it over HTTP and browser-test it.
Extract a native archive before selecting its game folder in Steam publishing.
Architecture matches the selected GitHub runner, not every CPU available for that OS.

Artifacts expire after 14 days. Input draft releases remain so the same package can be
rebuilt. After a run completes, **Remove uploaded input package** deletes only its owned
draft; it disables retries without deleting existing run artifacts. If setup fails before
a run registers, refresh first, then inspect/remove the orphan draft in GitHub Releases.
The editor refuses cleanup while a run is active or has not registered yet.

## Signing

Windows/Linux archives are unsigned. macOS uses an ad-hoc signature for the launch check,
without notarization. Reports state this explicitly. Build Centre provides guidance;
it does not install certificates or silently claim that public release signing is complete.
Use [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) and
[Windows signing guide](https://v2.tauri.app/distribute/sign/windows/) to configure your
own release signing pipeline. The portable packager currently performs ad-hoc signing;
adding certificate secrets alone does not change it into a notarized release pipeline.

## Implementation and checks

- `src/store/buildCentreStore.ts`: explicit configuration, check, prepare, start and
  request-management actions; immutable reviewed bytes and per-project history.
- `src-tauri/src/build_centre.rs`: bounded GitHub CLI processes, exact request/run matching,
  repository checks, draft ownership checks and separate upload/dispatch/download operations.
- `scripts/package-runtime-game.mjs`: checksum-verified runner packaging, per-target asset
  cooking, portable archives and real native launch evidence.
- `build_centre` AI tool: open/configure/check/prepare/status; no implicit remote mutations.

Local validation includes store/protocol tests, browser UI checks and macOS packaging
and launch. A real authenticated GitHub matrix run requires your configured repository;
Windows/Linux execution and public signing must be verified there before release.
