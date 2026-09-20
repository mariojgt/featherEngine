# Lighting, weather and reflections

Feather's editor, Play mode and exported player share the same scene-light renderer. Blackthorn Keep and [Neon Afterlight](NEON_AFTERLIGHT.md) in the Asset Store are complete editable examples of the controls below. These features are reusable in ordinary projects.

## Shape the light

Select a light and open its Inspector. Point and spot lights expose intensity in candelas and a falloff exponent (2 gives inverse-square falloff). A rectangular area light exposes width, height and luminance in nits. Large rectangles produce broad highlights on PBR materials; rotate the light so its local **−Z axis** faces the subject. Rectangles do not cast shadows in this renderer.

For spots and directional lights, enable **Aim with rotation** to use that same local −Z direction. Existing projects keep their previous world-origin aiming until this is enabled. The spot penumbra now renders consistently in the editor and player.

**Shadow tuning** exposes near/far clipping, depth bias, normal bias and directional coverage. Keep coverage close to the subject for sharper shadows; increasing coverage stretches the same shadow map over a larger area. Quality presets determine resolution, and Low disables shadows.

**Scene Settings → Exposure (stops)** controls a multiplier: +1 doubles exposure, −1 halves it. Existing stored exposure values remain compatible. In **Post-Processing**, ambient occlusion has an enable switch, strength and radius. Lower its strength/radius in dense grass to avoid excessively dark contact shadows. AO runs on High and Epic.

## Light surfaces from the sky

Choose **Scene Settings → Reflection lighting → Live sky and weather**. The procedural sky now supplies filtered HDR environment lighting to rough and glossy PBR materials. Changing the sky color, sun or cloud cover changes this lighting; moving clouds and lightning can change reflections too. Environment intensity controls its contribution.

| Quality | Sky capture face size | Cloud-motion refresh |
| --- | --- | --- |
| Low | 32 px | 2 seconds |
| Medium | 64 px | 1 second |
| High | 64 px | 0.75 seconds |
| Epic | 128 px | 0.5 seconds |

Lighting/weather edits refresh faster, capped at 10 updates per simulation second; editing a paused frame also refreshes it. GPU targets are reused. A capture contains the sky, not nearby geometry. Use Lux local reflections/probes for local surroundings, planar water reflections for water, and Epic screen-space reflections for visible scene detail. An imported environment image takes precedence over the procedural lighting mode. Older scenes keep their studio environment unless changed.

## Make a storm affect materials

In **Scene Settings → Wind & Weather**:

- **Surface wetness** is the minimum water amount. It darkens porous surfaces and lowers roughness without overwriting the source material.
- **Puddle coverage** controls the patchy smooth coating on upward-facing surfaces. This is a surface shader, not extra water geometry.
- **Rain wets surfaces** lets rainfall accumulate water and lets it dry gradually. The simulation clock controls accumulation, pause and replay.
- **Rain intensity** drives falling rain, puddle ripples at High/Epic, and existing water-surface rain ripples. A water object's stronger manually authored rain strength still takes precedence.

Weather affects opaque Standard/Physical materials. Transmissive glass, transparent effects and alpha-tested foliage retain their authored response. A material's `userData.weatherResponse` (glTF material extras) can scale its coating from 0 to 1; 0 opts out. This is scene-wide weather: it does not simulate runoff, drainage, roof shelter or a fluid volume. Keep interior materials excluded where needed.

`set_scene_environment` and the Set Environment Blueprint node expose wetness, puddle coverage and automatic accumulation. `set_light` exposes rectangle dimensions, rotation aiming, falloff and shadow settings. `set_render_settings` exposes AO strength/radius/enabling. Scene lighting mode is also available through `set_scene_environment`.

## Reflections and cost

**Volumetric Fog → Local light scatter** adds colored mist around nearby point, spot and area lights. Medium uses up to two lights, High four and Epic six, ranked by influence near the camera. Moving and parented lights update in world space. This opt-in approximation does not shadow local fog through walls; rectangles use an area-weighted directional approximation. Default 0 disables local scattering. Neon Afterlight demonstrates these controls with signs and a drone searchlight.

Local lights integrate over their actual visible sphere/cone interval, using 12/16/24 deterministic samples per light at Medium/High/Epic. Samples concentrate around the light's inverse-square peak, removing the salt-and-pepper noise caused by skipping narrow beams with long, jittered world-space steps. Camera extinction uses the exact exponential height-density integral; ambient fog no longer needs a noisy march. Sun shafts still use the quality tier's shadow samples, with depth decoding matched to the current Three shadow packing. Existing hidden lights respond on the first frame of a visibility cue, and parented cameras use their world position. These changes do not add local-light shadowing or temporal reprojection.

Epic enables screen-space reflections. Feather adapts the bundled SSR normal/roughness pass to the current Three shaders and shares the wet material's roughness and ripple normals with that pass. It retains texture UV transforms and cutout alpha masks. Missed traces use the base material's sky/probe lighting, avoiding a second sharp sky reflection washing out matte materials. The effect is retained across cinematic camera ticks instead of repeatedly allocating its render targets, and is disposed when removed.

Reflection traces now reject missed rays instead of stretching their last screen sample. The compatibility layer uses the bundled effect's actual option names (the wrapper's older `rayStep`, `STRETCH_MISSED_RAYS` and `temporalResolveMix` props did not control it). Traces use 80 steps over 40 world units, eight refinement steps and a 0.12-unit final depth tolerance. Packed depth and normals use nearest filtering, and reflected history is no longer fed back as a second bounce. Camera cuts, teleports and projection changes discard reflection history; the remaining temporal filter keeps accepting fresh radiance when lights change under a stationary camera.

Water captures use linear HDR color and 32-bit depth. Epic captures a full-resolution planar mirror every frame with 4× MSAA; High uses half resolution every second frame, forcing a refresh at camera cuts. Water binds the current capture immediately before drawing, after the cinematic camera has updated. Rain ripples fade below their pixel footprint and use a subtler normal/foam response, so distant water does not become a grid of bright rings. A surface at a different height from the dominant capture plane uses its sky fallback rather than the wrong reflected plane. Epic's clearer captures increase GPU time and render-target memory.

Screen-space reflections can only resolve geometry visible to the camera. They can miss off-screen objects and remain approximate at moving silhouettes; they are not ray tracing. Area lights and sky lighting improve surface response but do not provide arbitrary multi-bounce global illumination. High is the default Blackthorn movie preset; `--quality Epic` enables the heavier reflection pass when rendering a comparison.

## Reproduce the checks

Start `FEATHER_CAPTURE=1 npm run dev -- --host 127.0.0.1 --port 17421`, then:

```sh
node scripts/e2e/cinematic-lighting.mjs
node scripts/e2e/blackthorn.mjs
node scripts/e2e/cinematic-reflections.mjs path/to/embedded-game.json
node scripts/e2e/reflection-quality.mjs
node scripts/e2e/local-fog.mjs
node scripts/e2e/fog-beams.mjs
npm run cinematic:blackthorn:preview -- --quality Epic --times 19,33.5,45
npm test
npm run build
```

The lighting fixture compares actual GPU pixels for dry/wet materials, animated ripple normals, a rectangular light and changing sky reflections. It also checks shader errors and repeated-capture texture counts. The reflection lifecycle test switches High/Epic repeatedly and checks that GPU texture counts return to their previous budget. The Asset Store test imports the actual package, checks all embedded asset hashes, and runs its weather/destruction Blueprint. Capture reports record texture, geometry and program counts; these are resource counts, not an FPS benchmark. Render speed and visual results depend on the GPU.

The reflection-quality GPU fixture verifies that stretched misses are disabled in the actual effect, a valid neon reflection still appears, a stationary reflection follows a changing sign color, and the first frame after a cut exactly matches the fresh reflection buffer. Offline film capture warms the renderer at time zero until assets and GPU resources settle before recording.

The beam fixture compares all three fog tiers against dense GPU integration, including a thin cone, small camera moves, axial views, a hemisphere and a reversed light. It checks image residuals, a fully occluding foreground plane and shader errors. Separate GPU checks compare height extinction with numerical integration and verify shadow decoding against Three's own depth encoder. This is an accuracy check, not a real-time performance benchmark.
