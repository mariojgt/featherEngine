# Authored woodland trees

Bundled under [CC0](https://polyhaven.com/license):

- [Tree Small 02](https://polyhaven.com/a/tree_small_02), Rico Cilliers.
- [Island Tree 02](https://polyhaven.com/a/island_tree_02), Rob Tuytel and Rico Cilliers.

Feather does not claim authorship of the source scans or models. `provenance.json` pins every downloaded source by URL and MD5, records the resulting GLB SHA-256, and lists each detail level's triangle count.

The GLB contains two tree forms, each with three detail levels. Trunk and branch geometry is simplified; individual source leaves are fitted to cards in their original atlas UV coordinates, retaining their placement and species textures. Lower levels retain a deterministic subset with coverage compensation. Roots extend 0.25 m below the placement plane to meet sloping terrain. Root-space height is approximately 7.5 m; existing terrain model scatter applies its authored scale multiplier.

Albedo and leaf alpha are 1024 px; OpenGL normal and packed AO/roughness/metallic maps are 512 px. Everything is embedded and works offline. Scene/node extras opt into the authored-tree renderer; ordinary imported models retain the existing path.

Reproduce from the repository root with `node scripts/prepare-woodland-trees.mjs`. It validates pinned source checksums, caches source files in `/tmp/feather-woodland-sources`, and writes the bundled GLB. Optional arguments override the cache directory and output file. Dependencies are already in the project.

## Woodland ground cover

`woodland-ground-cover.glb` bundles three further CC0 sources:

- [Fern 02](https://polyhaven.com/a/fern_02), Rico Cilliers (modeling), Rob Tuytel (scanning). Four plant variants, alpha-cutout fronds.
- [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01), Kless Gyzen. Six rock variants.
- [Tree Stump 01](https://polyhaven.com/a/tree_stump_01), Rob Tuytel. Decayed wood with exposed roots.

The 3.22 MB library contains three detail levels per variant, embedded 1024 px albedo/alpha and 512 px OpenGL normal/ARM maps. Layout offsets are removed so each mesh is placed at its own rooted local origin. Ferns are scaled to 0.3–0.64 m, rocks to half source size, before scatter variation. Nodes carry `featherGroundCoverKind` and authored-renderer metadata. Rocks and wood are rigid; ferns use leaf lighting and bounded wind.

`ground-cover-provenance.json` pins all source URLs/MD5 values and the output SHA-256. Rebuild with `node scripts/prepare-ground-cover.mjs [cache-directory] [output.glb]`; source downloads are only needed during asset preparation. Game saves, packages, and exports embed the finished library and need no connection to Poly Haven.
