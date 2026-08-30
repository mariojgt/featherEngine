# Steam Publishing

Feather's desktop editor can preview and upload one existing Steam depot through Valve's local
SteamPipe tools. Open **Export → Upload to Steam…** after producing and testing a build.

This first release is an upload assistant, not a replacement for Steamworks onboarding. Your app,
depot, build account, permissions, store page, pricing, and release checklist must already exist in
Steamworks.

## Before the first upload

1. Download the Steamworks SDK from your Steamworks account. Feather does not bundle or redistribute
   it.
2. Make sure the build account has permission to edit the app and publish the depot.
3. Run SteamCMD from the SDK's `tools/ContentBuilder` directory and sign in once with
   `+login <account>`. Complete Steam Guard in that terminal, then quit. Feather reuses SteamCMD's
   local authenticated session; it never asks for or stores a password, API key, or Steam Guard code.
4. Prepare one **unpacked, depot-ready folder** containing exactly the files players should receive.
   Do not choose a zip, DMG, MSI, installer directory, or the broad production-export root unless
   that directory itself is the intended depot content.

Valve documents the SDK layout, SteamCMD sign-in, App/Depot VDF files, preview mode, and build
upload flow in the [SteamPipe Uploading documentation](https://partner.steamgames.com/doc/sdk/uploading?l=english).

## Upload flow

1. Build and test the game with **Export → Production**.
2. Open **Export → Upload to Steam…**.
3. Select the Steamworks SDK root or `tools/ContentBuilder`, enter the build-account name, and let
   Feather validate SteamCMD.
4. Select the exact unpacked content folder. Enter the Steam App ID, Depot ID, description, and an
   optional private beta branch.
5. Keep **Preview only** enabled for the first run. Preview validates the SteamPipe build without
   uploading content.
6. Review preflight, then run the preview. When it succeeds, turn preview off and upload.
7. Feather shows sanitized SteamCMD output and the BuildID when SteamCMD reports one. Use
   **Open in Steamworks** to inspect the build.

Leaving the branch blank uploads the build without changing which branch is live. A named private
beta branch adds SteamPipe's `SetLive` instruction after a real upload. Feather deliberately blocks
`default` and `public`: promote a tested build to the public branch manually in Steamworks. Valve's
documentation also notes that `SetLive` cannot set the default branch.

## What Feather validates

- SteamCMD exists in a supported ContentBuilder layout and is executable.
- App ID and Depot ID are valid positive 32-bit identifiers.
- The description, account, and branch contain only supported values.
- The content root exists, is non-empty, is not a filesystem root, and contains no symbolic links.
- Generated AppBuild and DepotBuild VDF files use an isolated local job directory.
- Concurrent Steam publish jobs are rejected instead of sharing mutable build state.
- SteamCMD output displayed in the editor has the account name redacted.

The SDK path and account name are stored only in this editor's local webview storage. App ID, Depot
ID, and branch are stored per local Feather project. Passwords and tokens are never accepted.

## Current scope

- Desktop editor only; SteamCMD runs on the local computer.
- One existing app and one depot per operation.
- A local, already-prepared depot folder; Feather does not yet transform installer outputs into a
  Windows Steam depot automatically.
- Preview or upload, with optional assignment to a private beta branch.
- No first-release activation, public/default promotion, store-page editing, pricing, achievements,
  matchmaking, cloud saves, or runtime Steamworks SDK integration.
- No cancellation, upload queue/history, CI credential flow, multi-depot manifest, or Epic Games
  Store provider yet.

Runtime Steam features are a separate integration from SteamPipe publishing. Adding the Steamworks
runtime SDK to a game should be treated as its own project, including licensing, platform-specific
binaries, initialization, offline behavior, and exported-player parity.

## Troubleshooting

- **SteamCMD not found:** choose the SDK root or its `tools/ContentBuilder` folder, not a downloaded
  archive.
- **Steam Guard/login failure:** sign in manually with the same account in SteamCMD, complete the
  prompt, quit SteamCMD, and retry Feather.
- **Permission denied:** verify the account's app/depot permissions in Steamworks and that SteamCMD
  is executable on macOS/Linux.
- **Wrong files in the preview:** select a narrower unpacked folder. Feather maps that folder
  recursively to the depot root.
- **Upload succeeds but players do not see it:** inspect the BuildID and branch in Steamworks. A
  blank branch is upload-only, and public promotion remains manual.
