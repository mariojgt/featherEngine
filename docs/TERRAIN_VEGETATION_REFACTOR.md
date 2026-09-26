# Terrain, trees, and vegetation

Implemented in the shared editor/player renderer. This is a substantial foundation upgrade within Feather's Three.js renderer; it does not implement Nanite, Lumen, virtualized geometry, or an Unreal-equivalent rendering pipeline.

## Try it

1. Create or select a terrain actor and open **Terrain → Foliage**.
2. Choose **Landscape preset → Natural Woodland**, **Wild Meadow**, or **Alpine Grove**.
3. Adjust tree spacing, slope, density, and optional minimum/maximum local elevation. Alpine exposes editable species weights; Woodland/Meadow use the bundled authored model library. Sculpting, painted layer IDs, and foliage exclusion masks remain intact.
4. In the surface controls, assign albedo/normal assets and tune texture scale, normal strength, and roughness. Choose **Grass Mesh → Natural blades** for curved geometric grass. In Tree Builder, choose **Natural leaves / needles** and a **Natural** surface for branch-attached cutouts and PBR bark.

Woodland and Meadow now use two authored, textured tree forms with three detail levels. Alpine keeps its editable conifer/birch mix. The presets bundle CC0 moss, leaf litter, mud, and rock from [Poly Haven](https://polyhaven.com/license), with source authors, URLs, and checksums in `src/terrain/surfaces/provenance.json` and `src/terrain/models/provenance.json` / `ground-cover-provenance.json`. The tree model library is 16.35 MB; Woodland adds a separate 3.22 MB fern/rock/wood library, with all bark/leaf/albedo/normal/roughness/alpha textures embedded. Textures load from local application files and become ordinary embedded image/model assets, so saved projects and exported games work offline. Applying a preset commits the loaded assets, reusable tree specs, and terrain settings together; load failure leaves the terrain unchanged. Existing specs with the same preset ID retain user edits. Undo restores terrain and species; the embedded source assets remain in the asset library, following the editor's existing imported-asset undo policy. Only referenced assets enter packages.

The assistant supports the same workflow through `apply_terrain_biome`, `update_terrain`, `update_terrain_layer`, and `update_tree_spec`. The local assistant router, activity labels, compact/long guides, and scene snapshots include these capabilities.

## Delivered behavior

| Area | Behavior |
| --- | --- |
| Terrain surfaces | Up to eight smoothly blended layers, albedo and normal textures, per-layer scale/strength/roughness, and signed slope projection. Two WebGL2 texture arrays provide isolated mip chains, avoiding cross-layer bleeding at distance. Albedo is 1024×1024 on High/Epic and 512×512 on Low/Medium; normals use 512×512. Arrays allocate only the active layer count. Per-layer texture variation continuously warps a single sample with matching normal UVs, avoiding the previous double-image blur. Restrained macro tint breaks repetition. |
| Natural art | Curved, tapered grass blades with anchored roots, wind, actor interaction, and matching shadow deformation. Camera distance uses nested 24/12/6 blade subsets (120/60/30 triangles), with quality-dependent ranges and hysteresis. Per-patch frustum/fade culling limits submitted geometry; only the near tier casts shadows. Movement and projection gates avoid rebuilding static partitions. Opt-in leaf geometry attaches to fine branches. Four natural tree presets measure about 16.4k–26.5k triangles at full detail; distant leaf cards keep their centres and expand to preserve crown coverage. |
| Automatic surfaces | Ground distribution uses seeded spatial grass/moss and soil patches, with a broad soil-to-rock slope transition and summit rock. Natural grass thins with turf coverage and stays off painted soil/rock. Legacy elevation bands remain selectable; painted layers override either mode. |
| Terrain detail | Authored resolution remains around the camera's physics radius and during brush editing. Distant interiors use reduced grids stitched to full-resolution borders. Border positions, normals, and material weights interpolate consistently, including non-divisor resolutions. |
| Edit invalidation | Geometry and surface signatures exclude the global edit version. Sculpt/paint overrides invalidate affected chunks; texture and roughness edits update the shared material. Foliage has its own local signatures and cache. |
| Vegetation | Opt-in Woodland distribution groups trees into coherent seeded groves/clearings and thins/shortens grass under accepted canopies across chunk boundaries. Existing terrains default to uniform scatter. Deterministic per-region generation, stable species/variant identity, up to four weighted species, minimum tree spacing across region borders, elevation/slope constraints, and existing painted masks. Generation processes at most two new regions per frame with a soft 4 ms scheduling target. |
| Budgets | Quality controls total grass/tree/flower instances and active regions: Low 25, Medium 49, High 81, Epic 121 nearest regions. Each terrain cache retains at most 128 entries and 160,000 weighted instances. Grass generation is restricted to its visible distance plus travel padding. |
| Authored model trees | Woodland/Meadow share two tree forms with actual bark/leaf atlases, alpha cutouts, normal and packed roughness/AO maps. Complete canopies contain approximately 72k triangles nearby, 35k at the middle level, and 9k at distance. All model-tree regions share one forest batch (up to 18 material/detail parts), capped at 180 placements. Stable placement hashes choose variants; camera distance, scale, quality, and hysteresis choose detail. Leaves use wrapped diffuse and back transmission from shadow-attenuated direct lights, with no constant emission; bark stays unchanged. Wind, alpha masks, and optional world-space fade match visible/depth/distance passes. Cached loader geometry/textures remain shared; only owned material clones are released. |
| Woodland ground cover | Four fern forms, six mossy rocks and decayed wood from a 3.22 MB embedded CC0 library. Three detail levels, scale/rotation variation, slightly buried rock/root contact, rigid stones/wood and wind-animated ferns. A stable global grid respects terrain bounds, masks, slopes, elevation and painted rock exclusions. Quality caps at 400/800/1100/1400 instances; world-space fade/culling bounds visible cover. UI and assistant share distribution and ground-cover density controls. |
| Parametric tree rendering | Referenced specs resolve consistently for placed/scattered trees and chopping. Geometry leases are shared and released on unmount; up to 48 unused geometries remain cached. Distance/scale/quality select compact LOD subsets with hysteresis. Surviving branches and leaf centres keep their authored positions. |
| Materials and wind | Opt-in PBR bark, distinct birch bark, and filtered procedural individual-leaf/needle cutouts. Wind and interaction deform visible/depth/distance passes consistently; pixel foliage shadows use the viewing camera's billboard basis. Bounds account for deformation and billboard movement. Legacy stylized materials remain available. |
| Portability and undo | Terrain species dependencies are collected/remapped in packages and checked at runtime. Deleting a placed-tree species preserves its latest inline shape across scenes/prefabs; a terrain-referenced species cannot be deleted. Prefab detachment participates in undo. Felled geometry bakes complete parent transforms, including shear and mirroring. |

The default sun position now uses the same 80-unit extent as its shadow camera, keeping the light above typical hilly terrain. Presets preserve existing lighting; the reference scene uses a sky-lit hemisphere, directional daylight, and a tighter 55-unit shadow extent. Existing v1/v2 embedded assets remain untouched; reapply Natural Woodland for the current groves and ground-cover pass. Existing saved distributions remain unchanged until explicitly selected.

## Validation

Regression tests cover deterministic scatter, masks and elevation, spacing across borders, cache invalidation/eviction, budgets, surface weights, terrain/physics agreement, mixed-LOD border attributes, compact stable tree LODs, geometry leases, linked specs, grouped chopping, package dependencies, and undo.

Run:

```sh
npm test
npm run build
E2E_BASE_URL=http://127.0.0.1:17422 node scripts/e2e/terrain-surfaces.mjs
E2E_BASE_URL=http://127.0.0.1:17422 node scripts/e2e/terrain-vegetation.mjs
```

Verified in this worktree:

- **1,010 tests across 146 files passed**, followed by five focused ground-contact checks after the final placement adjustment. Production editor/player builds and runtime-cache verification passed.
- All eight surface layers produced their expected colors in Chrome, with no shader errors.
- The editor selector and assistant tool applied Woodland. Six WebP surfaces plus the complete tree and ground-cover GLBs survived actual manifest save/reopen and package remapping with their embedded bytes.
- Repeated camera travel exercised both authored variants and all three detail levels. Returning to the same region stabilized at **58 textures / 91 GPU geometries / 42 programs**. Parametric geometry leases remained zero for this authored-model scene.
- The authored tree and ground-cover GLBs were regenerated from pinned CC0 source checksums and matched their bundled SHA-256 values exactly. Ground-cover family counts stayed within the global budget after instance-buffer resizing and repeated camera travel.
- A standalone web export opened the actual forest with eight assets and no runtime/shader errors. Landscape, walking-height, and fern close-up screenshots were inspected. The local sample averaged 48.9 fps, compared with 36.7 fps before this pass, over 180 RAF intervals at 1920×1069 on Apple M3 Pro / ANGLE Metal (median 16.7 ms, p95 33.4 ms). This short headless Chrome sample is not a GPU timer measurement or a target-hardware guarantee; stable 60 fps remains unverified.

Build output retained existing large-bundle and browser-externalization warnings; tests retained the existing multiple-Three.js warning.

Browser checks exercise the real shader compiler, all eight texture layers, a fixed woodland capture, package/save round trips, repeated camera travel, and resource release. The standalone player is rebuilt by `npm run build` and checked with the generated woodland bundle.

## Practical limits

- Woodland/Meadow trees and ground now use authored/scanned CC0 assets. Grass and Alpine trees remain procedural. Art direction, biome variety, and target-hardware profiling still matter; no Unreal visual parity is claimed.
- Ground-cover instances are decorative and do not create individual physics colliders. Far grass casts no shadows. Ground cover fades by stable instance coverage; individual plants can still visibly disappear.
- Tree LOD changes use hysteresis and stable centres, without crossfades or impostors. Natural leaf cards grow as their count falls to retain coverage; individual branches/cards can still change at a transition. Geometry generation still builds the authored tree before compacting each LOD.
- Region generation runs on the main thread. One expensive region can exceed the soft scheduling target; instance/cell caps bound work but do not guarantee a frame time. Spatial batches trade additional draw calls for culling. Imported model vegetation keeps conservative global limits. Authored libraries opt into wind/LOD; other imported models keep their existing materials.
- Terrain surfaces use two texture arrays: approximately 20 MiB including mipmaps for a three-layer High/Epic landscape (53 MiB for eight layers), or 8/21 MiB on Low/Medium. Very large streamed worlds need further profiling on the intended hardware.
- Terrain rotation/parent transforms remain an existing limitation of terrain sampling, brushing, and physics. Tree hierarchy transforms are handled independently.

Primary implementation files: `src/terrain/terrainGeometry.ts`, `terrainChunks.ts`, `vegetation.ts`, `vegetationCache.ts`, `vegetationRules.ts`, `biomes.ts`, and `src/three/terrainSurface.ts`, `TerrainFoliage.tsx`, `TreeMesh.tsx`, `treeRenderResources.ts`.

## Reproducing the visuals

`terrain-vegetation.mjs` creates an actual woodland scene through the assistant tool, captures the landscape and walking-height grass, checks embedded asset persistence/package remapping, moves the camera, and verifies stable GPU resource counts. `terrain-surfaces.mjs` checks all eight texture-array layers against expected pixel values. `scripts/prepare-woodland-trees.mjs` and `scripts/prepare-ground-cover.mjs` rebuild the libraries from pinned public-domain source files; details are in `src/terrain/models/README.md`.

Screenshots are actual engine output. Authored model loading is asynchronous and can stall on first use; main-thread region generation and parametric tree generation also remain possible sources of frame spikes.
