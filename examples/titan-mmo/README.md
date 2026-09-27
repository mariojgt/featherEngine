# Ember Meadow / Sunlit Reach realm server

A free, original fantasy RPG starter for Feather Engine and Titan. The same server runs the single-zone Ember Meadow starter and the continuous-valley Sunlit Reach — Mini MMO template (see the engine's docs/SUNLIT_REACH_MMO.md). The local server is a learning example with a 32-player connection cap, authoritative movement/combat/rewards, and disk persistence. This is not a tested production MMO service.

## First five minutes

1. Install **Asset Store → Titan — Game Backend** in a Titan-enabled Feather build and open its panel.
2. Choose **Open starter**. In **Connect**, use Demo accounts or paste your Titan project's API base URL and game key, then press **Test & save**.
3. In **Test**, press **Play the game → Join realm**. Play starts or reuses the included local server automatically; no Node installation or terminal is needed. Source development provides the same panel on localhost.
4. Open another browser profile/private window to join as a second adventurer. Tabs in one profile share a character.
5. In **Publish**, choose Online, enter your HTTPS realm address and game website origin, and export the configured server. Production builds include it automatically. Deploy its Docker folder behind HTTPS/WSS with a persistent volume at `/data`. Save your Feather project. Players only see login, with no setup fields.

This ZIP is the **advanced source distribution**, for developers changing server rules. To run it independently, install Node 22+, then `npm install` and `npm start`. In the engine source, use `npm run demo:titan`. These commands are unnecessary when using the managed plugin workflow. An exported configured server runs `realm.cjs` without npm installation.

Move with WASD/arrows (right-drag orbits the camera); press E near Elara to accept the quest. Gather three golden shards with E, defeat two purple wisps using Space/1 (2 is your class ability), and return to Elara. Open I and equip Warden’s blade. Use 3 for a tonic, or return to the village to heal. Save progress, leave, and reconnect to verify your inventory. In the Sunlit Reach template the north waystone continues to Thornwood and Cinder Keep.

The server accepts an allowlist of origins. Defaults include Feather at `http://localhost:17420`, `http://127.0.0.1:17420`, and the desktop app. For another dev/export port, add that exact origin to `ALLOWED_ORIGINS`.

## Connect your existing Titan backend

The plugin normally handles this in **Connect** using the values from your dashboard project's **Connect your game → Feather Engine** section. For the advanced source server only, copy `.env.example` to `.env`. Set `TITAN_URL` to the Supabase base URL and `TITAN_GAME_KEY` to the project's **game key**, the same values used by the Unreal plugin. Start with:

```sh
node --env-file=.env server/launch.mjs
```

The server enables Titan anonymous, email login and registration when both variables are present. Choose the corresponding account option in the game. Passwords are sent to Titan and not written to the realm save file. Titan player tokens stay in server memory for email logins; guest resume credentials stay in that browser's local storage, scoped to the realm URL. Treat guest browser storage as a credential. Use a fresh browser profile for an independent player.

**Save progress** writes the authoritative realm save to disk and, when connected to Titan, a JSON checkpoint to Titan's `game-saves/ember-meadow` slot. Autosave every 10 seconds and disconnect saves go to disk. The realm always restores disk state: client-writable cloud slots are not trusted as inventory authority. Back up the realm data directory. Solo practice has separate local storage and is never uploaded to the realm.

Use the existing backend migrations and deployment steps. No database migration or payment setup is required for the local demo. The Unreal plugin keeps its existing setup and endpoints.

## Advanced source configuration

Generated `realm-config.json` takes precedence over Titan/origin environment values. `HOST`, `PORT` and `REALM_DATA` remain deployment overrides. Managed local realms use an ephemeral localhost port and project-specific persistent storage.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` inside a container behind a TLS proxy. |
| `PORT` | `8787` | HTTP and WebSocket port. |
| `REALM_DATA` | `~/.feather-realms/<hashed-game-id>/players.json` | Persistent file; configured Docker exports use `/data/players.json`. |
| `ALLOWED_ORIGINS` | Local Feather origins | Comma-separated exact browser origins. |
| `TITAN_URL` | empty | Titan/Supabase base URL. |
| `TITAN_GAME_KEY` | empty | Titan project game key, never the Supabase service-role key. |

Hosted clients need HTTPS + WSS, an exact origin allowlist, and a persistent volume. `/health` reports the auth mode and player count. `/auth` exchanges credentials for a one-use 30-second ticket. The WebSocket `/realm` authenticates with its first message; credentials never enter URL query strings. Requests and frames have size/rate limits. A stale movement command stops after 400 ms. Chat is limited to one message per 1.2 s and 140 characters. `/health` reports `protocol: 2`.

## Extend the sample

`server/world.mjs` is the authority for classes, items, enemies, zones (NPC, gather, spawn and waystone coordinates), quests, movement bounds and combat rules. Change it together with the copy shipped in the engine, and rebuild both client and server. The client sends intentions (`move`, `attack`, `ability`, `interact`, `equip`, `unequip`, `potion`, `buy`, `say`); it cannot send gold, damage, coordinates, or inventory grants. The `join` message may name a class for a new character and the zones the client build contains; waystones to zones the build lacks are refused with a message. Scenery is cosmetic; this flat sample does not perform mesh collision or obstacle pathfinding. Keep scenery outside the walkable path or add authoritative collision when extending it.

In the Feather source, `src/titan/TitanHUD.tsx` and `TitanWorld.tsx` provide the login, HUD and actors. `src/titan/starter.ts` authors editable scenery. `src/titan/client.ts` is the reusable REST adapter for Titan auth, inventory reads, quests, config, and cloud saves. Runtime support is compiled into both editor and exported player; the gallery plugin adds setup tools. Removing the editor plugin does not remove runtime support from existing games.

Run `npm test` for the actual HTTP/WebSocket integration and world-rule tests. Do not run multiple server instances against the same save file. Before operating publicly, replace this single-process reference with your production session, storage, anti-abuse and observability design; capacity and scaling have not been load-tested.

## Assets and license

The new server and integration code use MIT (see LICENSE). The starter reuses the engine's bundled Quaternius Universal Animation Library `UAL1.glb`, existing `Sword.glb`, and Pixel Art Trees recipes. Original asset licenses and attribution continue to apply; the package does not relicense third-party assets. No World of Warcraft assets, names, music or artwork are included. “Free” describes this downloadable starter; hosted Titan/service costs are separate.
