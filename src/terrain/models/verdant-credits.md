# Verdant scene accents

Five additional embedded GLBs are extracted offline from `woodland-ground-cover.glb` and `woodland-trees.glb`:

- `verdant-rock-shelf.glb`: Rock Moss Set 01, source variant 0, 1,800 triangles.
- `verdant-rock-crag.glb`: Rock Moss Set 01, source variant 3, 1,800 triangles.
- `verdant-rock-boulder.glb`: Rock Moss Set 01, source variant 5, 1,800 triangles.
- `verdant-shrub.glb`: Island Tree 02, source LOD2, 9,030 triangles, rescaled into low broadleaf undergrowth, with broadened leaf cards and matte olive leaf materials. This is a reuse of the tree form, not a new scanned shrub species.
- `verdant-fern-bank.glb`: Fern 02, source variants 0, 1 and 3, grouped at different scales and rotations; 4,614 triangles total.

[Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) is by **Kless Gyzen**.
[Fern 02](https://polyhaven.com/a/fern_02) is by **Rico Cilliers** (modeling) and **Rob Tuytel** (scanning).
[Island Tree 02](https://polyhaven.com/a/island_tree_02) is by **Rob Tuytel and Rico Cilliers**.
All three sources are **[CC0](https://polyhaven.com/license)**. Feather authored the extraction, arrangement and scene placement, not the scans.
The original woodland tree, stump and terrain-surface credits continue to apply; see the adjacent README and `../surfaces/README.md`.

Reproduce from the repository root with `node scripts/prepare-verdant-assets.mjs`.
The script uses only Node built-ins and the existing pinned ground-cover/tree libraries, verifies their SHA-256 hashes,
and writes these five assets plus `verdant-provenance.json`. No download is needed.
That provenance file includes original download URLs/MD5s, the input SHA-256,
the tree-source SHA-256, and each output's SHA-256, size, mesh count and triangle count.

Each GLB retains embedded albedo, OpenGL normal and packed AO/roughness/metallic maps
(1024 px albedo, 512 px data maps). Fern alpha is embedded; colors receive a restrained olive tint.
No external buffers, images, runtime services, or AI-rendered imagery are used.
The five assets add 5,129,764 bytes before package compression.

The scene places 36 rock objects in nine asymmetric outcrops and deterministic fern/shrub banks.
The preparation script also derives `verdant-tree-clearance.json`: conservative solid-wood
bounds per half-metre height slab across both tree forms and all LODs, pinned to the source hash.
Camera routes and frame-rate path tests use those bounds with a wind/near-plane margin.
Rock, shrub and bank objects use the engine's existing static model instancing; each fern bank contains three mesh parts and each shrub has three material parts.
These accents are static. The original nearby ground-cover ferns and tree foliage retain their existing wind/LOD renderer.
The scene retains two broadleaf tree forms; it does not contain authored pines or claim parity with the conifer references.

The complete film has **16 assets: 13 visuals and 3 original audio assets**.
The shareable visual archive has **13 visual assets and no audio**, with these credits included.
