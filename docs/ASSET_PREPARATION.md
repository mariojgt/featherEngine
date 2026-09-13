# Asset preparation and runtime geometry

Feather prepares reusable LOD index buffers for eligible static GLB meshes during import and production export. The full mesh remains in the GLB. The optional `FEATHER_mesh_lods` extension points to the reduced levels and their geometric errors; ordinary glTF viewers can ignore it and show the original.

The runtime chooses a prepared level by projected error in pixels, camera distance, object scale, viewport height and quality. Hysteresis prevents rapid level changes near a threshold. Repeated static models are split into 32-unit spatial cells so instanced groups outside the camera frustum can be culled separately.

## Automatic settings

| Preset | First/second triangle targets | Texture maximum when compression is enabled |
| --- | --- | --- |
| Desktop | 50% / 20% | 4096 px |
| Web | 40% / 12% | 2048 px |
| Mobile | 30% / 8% | 1024 px |

Simplification respects border locking and an error limit, so actual counts can be higher. Tiny meshes, skinning, morph targets, non-triangle primitives and unsupported compressed geometry keep the original geometry. Meshopt-compressed inputs can be decoded; Draco preparation is skipped with a warning. Skinned models still render normally.

Texture compression is optional because it changes quality. Embedded PNG, JPEG and WebP textures can be resized and encoded as KTX2. Existing KTX2 textures keep their current resolution. With geometry preparation enabled, existing generated LODs are removed before texture processing and rebuilt afterwards so changed accessor references remain valid. With geometry preparation disabled, prepared models keep their texture payload. Per-asset warnings explain skipped preparation. Imported models normally receive their texture preparation before LOD generation.

## Cached variants and file loading

The cook cache includes source bytes, target preset, options, backend and cook version in its key. Output checksums reject corrupted cache entries. Original project assets are not overwritten by production cooking. If optional preparation fails, export retains the original bytes and reports the warning.

With **Stream assets** enabled, `game.json` references content-hashed files under `game-assets/`. Identical files are deduplicated within a build, and unused runtime resources load when requested rather than expanding all asset bytes from JSON at startup. This is asset-file loading, not virtual texture paging, Nanite cluster streaming or world partitioning. LOD index data is loaded with its model.

Adding LODs can slightly increase download size while reducing rendered triangles. The build receipt therefore reports both byte sizes and triangle counts. The geometry system is intended to reduce authoring work and runtime cost within Feather's WebGL renderer; it does not claim Nanite's virtualized geometry pipeline.

CLI caches can be removed from `.feather-cache` to reclaim disk space. Browser cache storage is optional: a storage error or full quota does not prevent a build. Repeated source exports also reuse a fingerprinted player runtime; changed engine source or output files invalidate reuse.

## Validation

`npm test` exercises real GLB preparation/loading, preserved full geometry, target variants, screen error selection, spatial grouping and corrupt-cache recovery. `npm run test:cache` checks runtime cache invalidation. `npm run test:production` exercises the assembled player in Chrome. `npm run test:runner` launches a prepared host runner after `npm run prepare:runtime`.
