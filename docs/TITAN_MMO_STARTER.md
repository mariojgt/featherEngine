# Titan and Ember Meadow

Install **Asset Store → Titan — Game Backend** (`feather.titan`). Open **View → Extensions → Titan Backend**, or search **Open Titan Backend** in the command palette. Choose **Open starter** to create an Ember Meadow project. The separate **Ember Meadow — MMO Starter** store listing also opens it directly.

The setup panel opens automatically when the plugin and an unconfigured Ember Meadow scene are both installed.

The panel includes a numbered dashboard-to-field walkthrough, example URL, first-character checklist, cloud-save confirmation, and troubleshooting. Publish explains which address belongs to Titan and which belongs to the hosted realm.

## Connect → Test → Publish

1. **Connect:** choose Demo accounts to explore without a key. For Titan accounts, open your Titan dashboard project → **Connect your game → Feather Engine**. Copy **API base URL** and **Game key** into the plugin, then press **Test & save**. This checks the game key against the authenticated configuration endpoint without creating a player. The API field starts with Unreal's example default, `https://yourproject.supabase.co`; an existing custom URL is kept. Use your project's actual URL for live accounts. These are the same values as Unreal's API Base URL and Game Key. Use the Titan game key, never a Supabase service-role key.
2. **Test:** press **Play the game → Join realm**. Feather starts the server automatically, reuses it when the connection matches, and restarts it when the connection changes. Desktop builds include a standalone executable: users need no Node installation, terminal commands or environment files. Source development uses the same panel through a localhost Vite bridge. Open another browser profile for an independent adventurer. **Stop realm** keeps saved characters; **Restart with saved settings** applies connection changes. Solo practice remains available in editor Play.
3. **Publish:** choose Solo game or Online game. For Online, enter the hosted HTTPS realm address and your game website's origin (for example `https://play.example.com`, without a path). Desktop-only releases can leave the website empty. **Export configured server** prepares deployment before the game build; **Test hosted realm** checks identity and account mode. **Build game** opens Feather's normal build review.

Save your Feather project to retain the connection settings. **Game setup** on the editor login screen returns to this panel. Published games show only the player's login or Begin adventure; players never enter game keys or server addresses.

An online build automatically includes a **realm-server/** folder with `realm.cjs`, `realm-config.json`, Dockerfile, license and deployment instructions. This applies to browser downloads, desktop exports, CLI exports and Build Centre packages. The generated configuration contains the game identity, Titan connection and allowed origins. Deploy that folder to a Docker-compatible host, expose port 8787 behind HTTPS/WSS, and attach a persistent volume at `/data`. Hosting is a separate deployment; building a game does not provision a server. A Node 22+ host can also run the bundled `realm.cjs` without npm installation. Solo exports need no server.

Hosted browser editors can configure connections and export packages; managed local realms require the desktop app or a localhost source editor. Older installers without Titan runtime support cannot activate it from the manifest alone.

## The sample game

WASD/arrows move; E talks and gathers; Space/1 attacks; 2 drinks a tonic; I opens inventory. Talk to Warden Elara, collect three sun shards, defeat two wisps and return for Warden's blade. Equip it, save, leave and reconnect. The scene reuses the bundled animated UAL1 character, Sword and editable Pixel Art Trees recipes.

`Ember Meadow · Realm runtime` is the named empty scene marker enabling the sample runtime. ID remapping preserves it. `TitanWorld` renders actors and controls the camera in editor Play and exported Player; `TitanHUD` supplies the shared login and gameplay UI. Renaming/deleting the marker disables the sample. Removing the setup plugin does not remove runtime support from exported games.

The authoritative [world.mjs](../examples/titan-mmo/server/world.mjs) runs both solo and the server. Clients submit intentions, never positions, damage or rewards. Attacks validate timing and distance; equipment requires ownership; rewards are granted once. Movement clamps bounds and expires stale input. Enemies are shared; gathering and quest progress are per player. Edit the rules and rebuild client and server together. Scenery is editable in Feather; custom gameplay/HUD rules currently require source edits.

Solo saves stay on the device under the application identifier. Local desktop realms save in Feather's application data, separated by game and Titan connection. Source realms use `.feather-cache/titan/`. Hosted Docker realms save at `/data/players.json`; other Node deployments default to `~/.feather-realms/<hashed-game-id>/players.json`. Autosave runs every ten seconds, on disconnect, shutdown and explicit save. Keep one process per save file and back it up.

Titan-connected explicit saves also write an `ember-meadow` cloud checkpoint. The realm restores authoritative disk state; player-writable cloud slots are not trusted to grant equipment. There is no cross-mode migration. This sample uses its own item/quest definitions, rather than mirroring the dashboard's economy tables.

This is one flat zone with cosmetic scenery and a 32-player connection cap, without mesh collisions, trading, chat, guilds, sharding or a production account/session service. The cap is not a load-tested capacity claim.

## Plugin and client API

[client.ts](../src/titan/client.ts) uses the existing Unreal-compatible REST endpoints, normalizes `functions/v1`, sends `X-Game-Key` and player headers, and decodes JSON-string saves. It includes authentication, inventory/wallet reads, quests, config and cloud saves. Player tokens stay in memory and never enter project settings.

`api.titan` exposes `settings`, `configure`, `openStarter`, `startRealm`, `stopRealm`, `realmStatus`, `play`, `edit`, `exportServer` and `build`. Configuration includes `realmUrl`, `baseUrl`, `gameKey`, `publishMode` (`practice`/`online`) and `gameOrigin`. Local preview addresses are transient and never overwrite a hosted release address. The plugin registers configure/open-starter/start-realm/stop-realm/export-server tools for AI/MCP. See [Plugin SDK](PLUGIN_SDK.md).

## Source validation and packaging

```sh
npm run build:titan-runtime
node --test scripts/tests/titan-runtime.test.mjs
npm run test:titan
npm test
npm run build
node scripts/e2e/titan-connection.mjs
E2E_BASE_URL=http://127.0.0.1:17430 node scripts/e2e/titan.mjs
npx vite-node scripts/build-titan-demo.mts
node scripts/export-production.mjs --bundle exports/titan/game.json --targets web --out exports/titan/web --skip-build
```

The native runtime build requires Bun (CI pins the tested version). End users do not need Bun or Node. `prepare:runtime` bundles the native executable with editor resources. The server package is built alongside the player; exporters verify its file checksums before copying it.

The connection browser test runs Test & save with native browser fetch against a local HTTP backend, checking both successful setup and rejected keys. The gameplay browser test installs actual store packages, completes the quest through gameplay controls, equips/saves/rejoins, opens the setup wizard, starts a managed realm and logs in online. Native tests run the standalone server without PATH, check guest login, shutdown and disk restore. Server tests use real HTTP/WebSocket connections and a controlled Titan backend. The opt-in `scripts/e2e/titan-live.mjs` test uses real Titan credentials from the file named by `TITAN_E2E_CREDENTIALS` (JSON containing `baseUrl` and `gameKey`). Keep this file outside the repository. It creates/reuses two anonymous test players and checks store installation, key rejection, automatic startup, shared movement, the quest, equipment, live cloud readback, reconnect and restart. Guest tokens are kept in a private sibling `.sessions` file for retries. No key is embedded in the script or public demo. Public deployment capacity still needs validation against the intended hosting.

For a real production-path test, run `TITAN_E2E_CREDENTIALS=/private/credentials.json npx vite-node scripts/e2e/titan-live-production.mts` after building the player and native runtime. It exports to a temporary private directory, runs the packaged server behind a local HTTPS/WebSocket proxy, tests guest and email accounts against the real Titan backend, rejects a wrong password, saves and reads cloud data, restarts the server, and repeats login/save with the standalone desktop executable and an empty PATH. It reuses the private guest tokens and creates one email test account at `example.invalid`; no email delivery is involved. The browser trusts a temporary certificate only for this test. No public deployment is performed, and private exported configuration is deleted afterward. The two live tests together create two anonymous players and one email player in the supplied Titan project.

The catalog includes an advanced source server ZIP with README, optional environment template, license, launcher, rules and tests. Users of the panel do not need that source ZIP. Website updates live in `FeatherEngineWebsite/src/pages/titan.astro` and `TitanShowcase.tsx`; use its `scripts/sync-titan.mjs` after exporting the reviewed demo. Integration and asset licenses are described in the [server README](../examples/titan-mmo/README.md).
