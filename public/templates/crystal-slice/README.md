# Crystal Slice

One intact turquoise block is clamped above a pool. A chrome blade cuts the actual mesh at runtime,
generating closed cut faces with interpolated outer normals. Each piece stays attached until the
edge crosses the block's bottom, then becomes a Rapier rigid body with its own convex collider and
volume-proportional mass. Pieces tip off the rear support, collide with each other and the floor,
and generate water splashes and ripples on entry. There are no piece animation tracks.

Choose **Crystal Slice** in the launcher's quick starts, then press **Play**. The Cinematics panel
contains the camera and mechanical blade actuator tracks. The 12-second cycle replenishes the
stock under a short fade; it does not simulate the fallen pieces reassembling. This is convex
rigid-body cutting, not soft-body gel deformation or a fluid solver. Water uses the engine's
buoyancy, drag and impact shaders. All geometry and materials are native; no downloaded assets.

For a full-screen development preview, run `npm run dev -- --port 17421` and open
`http://localhost:17421/crystal-slice.html`. Tap a released slice to push it. **Nudge pieces** applies a radial impulse; Pause and
Restart are also available. With the server running, `npm run test:crystal` verifies live cutting,
falling pieces, water entry, tapping, Nudge, Pause, Restart and cycle replenishment.

`npm run cinematic:crystal:preview` captures stills, a portable game bundle and a render report
into `exports/cinematics/crystal-slice/`. `npm run cinematic:crystal:render` exports a 12-second,
1080p, 60fps MP4 (requires ffmpeg). Epic quality enables water reflections and refraction;
performance depends on the GPU.

Code and authored scene: MIT, matching the project.
