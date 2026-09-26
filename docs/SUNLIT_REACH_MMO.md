# Sunlit Reach — Mini MMO template and Titan integration tutorial

The Sunlit Reach is a free, three-zone MMO template for Feather Engine built on the **Titan — Game Backend** plugin. It is the bigger sibling of the single-zone [Ember Meadow starter](TITAN_MMO_STARTER.md) and shares its runtime, server and connection settings. Install the plugin, open the template, paste the two values from your Titan project, press Play. Everything else is already wired.

| | |
| --- | --- |
| Zones (scenes) | Ember Meadow (hub village, chapter 1), Thornwood (forest, chapter 2, level 2), Cinder Keep (ruined keep, chapter 3, level 4) |
| Classes | Warrior (Strike / Cleave), Ranger (Quick shot / Volley), Mage (Ember bolt / Flame ring) |
| Systems | XP levels 1–8, equipment slots (weapon, armor, trinket), vendor, three chapter quests, waystone travel, zone chat, a boss with a telegraphed ember burst, saved progress, Titan guest or email accounts |
| Cinematics | An autoplay login vista in the hub and a short entry sweep for each zone; all editable in Film Mode |
| Multiplayer | One authoritative realm per build; 32-player connection cap; Feather starts the local realm for you |

This is a learning template and integration example, not a production MMO: one process, no sharding, no trading or guilds, cosmetic scenery without mesh collision.

## 1. Ten-minute setup

1. **Install the plugin.** Asset Store → search **Titan** → install **Titan — Game Backend**. The Titan Backend panel opens (or use View → Extensions → Titan Backend / command palette “Open Titan Backend”).
2. **Open the template.** In the panel choose **Sunlit Reach — Mini MMO → Open**. Feather creates a new project with the three zone scenes. The setup panel reopens automatically because the project is not connected yet.
3. **Connect.** Pick **Demo accounts** to try everything without a key, or **Titan accounts** and paste:
   - **API base URL** — Titan dashboard → your project → *Connect your game* → *Feather Engine* (the Unreal tab shows the same value).
   - **Game key** — same card. Never a Supabase service-role key; the field refuses those.
   Press **Test & save**. Feather checks the key against your project’s remote-config endpoint without creating a player.
4. **Test.** Press **Play the game**. Feather starts (or reuses) the bundled local realm with your saved connection, and the login vista cinematic plays behind the login card. Enter a name, choose a class, press **Join realm**. Open another browser profile (or a second desktop window) for a second adventurer.
5. **Publish.** Choose **Solo game** (no server, progress on the player’s device) or **Online game** (enter your hosted HTTPS realm address and the game website origin). **Export configured server** downloads a ready Docker folder; **Build game** includes it automatically as `realm-server/`.
6. **Save the Feather project.** The connection lives in project variables (`TitanAPIURL`, `TitanGameKey`, `TitanRealmURL`, `TitanPublishMode`, `TitanGameOrigin`). Player tokens and passwords never enter the project.

## 2. Play through the three chapters

Controls: **WASD** move (relative to the camera) · **right-drag** orbits · **wheel** zooms · **Space / 1** attack · **2** class ability · **3** tonic · **E** talk, gather, travel · **I** inventory and shop · **L** quest log · **Enter** chat · **Esc** close panels or skip a cinematic.

1. **Ember Meadow.** Talk to **Warden Elara** (yellow “!”) at the beacon. Gather three sun shards, defeat two wild wisps, return for **Warden’s blade**, 50 gold and 100 XP — that is level 2. **Quartermaster Bram** sells tonics for 12 gold. Walk north past the trail to the **Thornwood waystone** and press E.
2. **Thornwood.** **Hermit Wren** asks for four moonpetals (they glow under the canopy) and three thornback boars. Boars hit harder and chase; briar wisps lurk between the trees. Reward: the **Thornwood cloak** (−4 damage per hit), tonics, 220 XP. The southern waystone opens at level 4.
3. **Cinder Keep.** **Captain Idris** camps by the gate. Two cinder wisps guard the approach. **The Ashen Warden** waits in the inner courtyard: 700 health, heavy strikes, and every 11 seconds an **ember burst** — the ground ring glows red for 1.6 seconds; step outside radius 5 or lose 45 health. Everyone who damaged the boss shares 60 gold, 250 XP and an ember core. Turn in for the **Ashen greatblade** and the **Crown of Embers** (+15% damage).

Dying returns you to the zone’s sanctuary with everything you own. Sanctuaries heal quickly and enemies never enter them. **Save progress** writes to the realm’s disk (and, with Titan accounts, a checkpoint to the `ember-meadow` cloud save slot).

## 3. How it fits together

```
Your game (Feather player)  →  Realm server (realm.cjs)  →  Titan API (your Supabase project)
sends intentions only          movement, combat, loot,      accounts, cloud checkpoints,
(move, attack, interact…)      quests, chat, zone travel    remote config, inventory tables
```

- **Scenes are zones.** Each scene carries two empty objects: `Ember Meadow · Realm runtime` (turns the Titan runtime on — keep it) and `Realm zone · <zoneId>` (which zone this scene renders). The client switches scenes when the server moves your hero to another zone, using the same path as the Load Scene node. The single-zone Ember Meadow starter has no zone marker and is treated as the home zone.
- **Rules live in one file.** [`examples/titan-mmo/server/world.mjs`](../examples/titan-mmo/server/world.mjs) defines classes, items, enemies, zones (NPC, gather, spawn and waystone coordinates), quests and every rule. Solo practice runs the same module in the browser; the realm server runs it in Node. Clients never send positions, damage, gold or items.
- **Server.** [`server.mjs`](../examples/titan-mmo/server/server.mjs) handles login tickets, WebSocket sessions, zone-scoped snapshots at 20 Hz, zone chat, autosave and the Titan checkpoint. `/health` reports `protocol: 2`.
- **Client.** `src/titan/TitanWorld.tsx` renders heroes, NPCs, enemies, waystones and effects for the current zone and owns the orbit camera (it yields to a scene cinematic while one plays). `src/titan/TitanHUD.tsx` is the login, class picker, frames, action bar, inventory, shop, quest log and chat. `src/titan/session.ts` is the connection and the solo simulation.

## 4. Make it yours

- **Scenery.** Every prop is an ordinary scene object. Move cottages, add trees with Pixel Art Trees, relight a zone in Scene Settings, retune the fog. Keep the corridor between a waystone and the zone spawn clear — there is no mesh collision.
- **Cinematics.** Open Film Mode. The hub’s “Login vista” shows behind the login card; each zone’s entry sweep plays when you arrive. Retime keyframes, change title cards, or add a fade. A sequence longer than 8 s is treated as a login vista and is skipped on later returns to that zone.
- **A new quest.** In `world.mjs`, add an entry to `QUESTS` (objectives are `gather` by item or `kill` by enemy kind), give an NPC in `ZONES[...].npcs` `role: 'quest'` and `quest: '<id>'`, and add any new item to `ITEMS`. The HUD tracker, markers and rewards follow the data.
- **A new enemy or boss.** Add a kind to `ENEMIES` (optionally with `burst`), then spawn it in a zone’s `spawns`. The client draws unknown kinds as wisps until you give them a look in `TitanWorld.tsx`.
- **A fourth zone.** Add it to `ZONES` with bounds, spawn, sanctuary, NPCs and waystones (a portal in each direction), then author a scene in `src/titan/sunlitReach.ts` with the two marker objects and rebuild the store package (`npm run build:store`). Rebuild client and server together; both import the same module.
- **Tuning.** Damage = weapon × class multiplier × (1 + 6% per level) × (1 + trinket power). Armor subtracts flat damage. Level thresholds are `LEVEL_XP`.

## 5. Deploy an online realm

1. In **Publish**, choose **Online game**, enter `https://realm.yourgame.com` and (for web builds) `https://play.yourgame.com`.
2. **Export configured server** (or just **Build game**): the `realm-server/` folder contains `realm.cjs`, `realm-config.json` (game id, Titan connection, allowed origins), a Dockerfile and instructions.
3. Run it on any Docker host behind HTTPS with WebSocket support, port 8787, persistent volume at `/data`. A Node 22+ host can run `node realm.cjs` directly.
4. **Test hosted realm** checks identity, protocol and account mode. Players only ever see the login screen.

## 6. The same project in Unreal Engine

The Unreal plugin (`TheDevRealm-backend`) and Feather use identical credentials and endpoints. Configure Unreal in **Project Settings → Plugins → DevRealm Backend**: paste the same API Base URL and Game Key, press **Test Connection**. Players created in either engine appear in the same Titan project; cloud saves, inventory and quests are per player.

| Unreal | Feather |
| --- | --- |
| API Base URL | Connect → API base URL |
| Game Key | Connect → Game key |
| Quick Anonymous Login (remembered on device) | Guest login through the realm; resume credential in browser storage |
| Quick Save / Quick Load Save | `titan.save(slot, data)` / `titan.load(slot)` in `src/titan/client.ts`; the realm writes `ember-meadow` |
| Quick Get Inventory / Quests / Config | `titan.inventory()`, `titan.quests()`, `titan.config()` |

## 7. Troubleshooting

- **“Use the Titan project game key”** — you pasted a Supabase key. Copy the Game key from *Connect your game*.
- **Test & save fails** — the URL is still the example `https://yourproject.supabase.co`, or the key belongs to another project.
- **Only solo practice is offered** — return to Test and press Play the game; Join realm appears when the local realm is ready. Hosted browser editors need a deployed realm.
- **“This character is already connected”** — leave the first session or use another browser profile.
- **“This world does not include Thornwood yet”** — you are in the single-zone Ember Meadow starter; open the Sunlit Reach template for all three zones.
- **The camera does not move during a cinematic** — expected: the cinematic owns the camera; press Esc to skip.

## 8. Validate from source

```sh
npm run test:titan                      # authoritative rules, HTTP/WebSocket, chat, migration, boss
npx vitest run src/titan                # client session, package round-trip, release config
npm run build:store                     # regenerates public/store (catalog + .nfpack files)
npm run build                           # type-check + player + editor
E2E_BASE_URL=http://127.0.0.1:17430 node scripts/e2e/titan.mjs   # with `npm run dev -- --port 17430`
```
