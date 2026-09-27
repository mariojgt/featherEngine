# Sunlit Reach — one shared valley

Version 1.1 replaces the three separate zone scenes with **Sunlit Vale**, one 192 × 192 metre landscape. The playable bounds are 188 × 188 metres. A north road connects the starting village, woodland and ruined keep without scene transitions. It reuses Feather's bundled animated character and sword; armor colors, trim and headpieces customize that stylized character. This is an original fantasy starter.

## Play in Feather

1. Install **Titan — Game Backend** from the Asset Store, then **Sunlit Reach — Mini MMO**, or open it from **Titan Backend**.
2. Press Play, choose a name, class and appearance, then **Play solo practice**. Returning characters keep their saved appearance and class; choices on this screen create a new character only.
3. For multiplayer, open **Titan Backend → Connect**, choose **Demo accounts**, then **Test → Play the game**. The managed local server starts automatically. Join from two separate browser profiles to create independent characters.
4. For your Titan backend, use the same **API base URL** and **Game key** as the Unreal plugin. Test and save the connection. The Feather REST adapter uses the existing backend; the Unreal C++ module is not loaded into Feather.

No website publishing is part of creating the template. Online exports still require a hosted realm address; see the Publish step and [Titan setup](TITAN_MMO_STARTER.md).

## Your character

Pick Warrior, Ranger or Mage, five armor colors, four trim colors, and an uncovered head, crest or crown. Each animated avatar owns its material instances, so changing one hero's appearance does not recolor other players or NPCs. The realm validates appearance against an allowlist, replicates it to nearby players, and includes it in disk saves and Titan checkpoints. A reconnect or server restart restores the saved selection. Old saves receive default appearance.

This creator customizes the included armored mannequin. It does not include human face sculpting, skin/hair assets or interchangeable body meshes.

## Controls and adventure

- **WASD/arrows:** move; **right-drag:** orbit; **wheel:** zoom.
- **1 / Space:** class basic attack. **2:** class ability (Cleave, Volley or Flame ring).
- **3:** drink a tonic. **4:** Second Wind, restoring 30% maximum health on a 14-second cooldown. The server enforces range, line of sight, damage and cooldowns.
- **E:** talk, gather or shop. **I:** inventory. **L:** quest log. **Enter:** realm chat.

Speak to Warden Elara in the village, gather three sun shards, defeat two wisps, return and equip the reward. Continue north to Hermit Wren's woodland quest, then Captain Idris and the Ashen Warden. The map marks your position and these landmarks. Existing equipment, XP, vendor, boss telegraphs and quest rewards remain server-controlled.

## World authoring

`examples/titan-mmo/server/valley.mjs` owns terrain samples and solid prop bounds. `src/titan/sunlitReach.ts` creates the corresponding native Feather terrain and editable scenery. Both sides use the same height interpolation. Server movement slides along cottage walls, tree trunks, rocks and keep pillars using small collision steps; enemies use the same movement checks. The camera stays above terrain. Nearby actor replication bounds snapshot size, while realm chat reaches the whole area.

Edit terrain heights and collision footprints in the shared source, then regenerate the store and rebuild client and server together. Moving scenery or sculpting the native terrain in the editor does **not** automatically update the server's collision data. The runtime marker and `Realm zone · sunlit-valley` marker must remain present. Gameplay and HUD changes currently require source edits.

The server uses simple collision and pursuit, not a general navmesh/pathfinding service. Camera obstruction against buildings, jumping, swimming, trading, guilds, sharding and production account/session hardening are outside this starter. The 32-player connection cap is not load-tested capacity. Disk saves remain authoritative; Titan receives a cloud checkpoint. The game does not mirror its quest/item definitions into the backend dashboard.

## Verification

```sh
npm run test:titan
npx vitest run src/titan
npm run build:store
npm run build
FEATHER_E2E_ANGLE=default E2E_BASE_URL=http://127.0.0.1:17439 node scripts/e2e/sunlit-reach.mjs
```

Start the dev server on port 17439 before running the browser check. `FEATHER_E2E_ANGLE=default` uses the system graphics backend; omit it to use the harness's software renderer.

The server tests exercise two real WebSocket clients, appearance synchronization, chat, movement, save/restart, collision and skill validation. Browser verification covers the actual store package, character creation and gameplay.
