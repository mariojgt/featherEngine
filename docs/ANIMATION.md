# Animation system

How Feather Engine turns animation assets into a posed skeleton: the Animator Controller state
machine, blend spaces, and the live debug readout.

## Purpose

Game code should describe *what the character is doing* — a speed, a direction, whether it is
grounded — and let the animation system decide which clips play and at what weight. Feather models
this the way Unreal and Unity do: an **Animator Controller** is a reusable state machine of
**parameters**, **states** and **transitions**, and a state can be a **blend space** that mixes
several clips continuously instead of playing exactly one.

The payoff is that no gameplay code names a clip. The built-in character controller writes `speed`,
`moveX`, `grounded` and friends; the controller turns those into a pose.

## Architecture

```
Animator component (per object)
  └─ Animator Controller (reusable asset)
       ├─ Parameters ── driven by a source (speed / grounded / a project variable / scripts)
       ├─ Base machine
       │    ├─ States ────── one clip, or a 1D/2D blend space
       │    └─ Transitions ─ conditions + crossfade duration (+ optional exit time)
       └─ Layers ─────── the same machine again, masked to part of the skeleton
                              │
                              ▼
                     Blend weights (blendSpace.ts)
                              │
                              ▼
                   Bone masking (boneMask.ts) ── base excluded from layer bones
                              │
                              ▼
                Three.js AnimationMixer actions ── SkinnedModel
                              │
                              ▼
              Procedural pass: foot IK, aim/look-at IK
                              │
                              ▼
                        Final skeleton pose
```

| Piece | File |
| --- | --- |
| Asset + component types | [`src/types/animation.ts`](../src/types/animation.ts) |
| Controller lookup caches | [`src/store/editor/animatorRuntime.ts`](../src/store/editor/animatorRuntime.ts) |
| Blend-space weighting maths | [`src/three/blendSpace.ts`](../src/three/blendSpace.ts) |
| Bone masking for layers | [`src/three/boneMask.ts`](../src/three/boneMask.ts) |
| Root motion extraction | [`src/three/rootMotion.ts`](../src/three/rootMotion.ts) |
| Root motion transport | [`src/runtime/rootMotion.ts`](../src/runtime/rootMotion.ts) |
| Mixer binding + crossfades | [`src/three/SkinnedModel.tsx`](../src/three/SkinnedModel.tsx) |
| Debug snapshot | [`src/store/editor/animatorDebug.ts`](../src/store/editor/animatorDebug.ts) |
| Graph editor + debug panel | [`src/components/AnimatorEditorPanel.tsx`](../src/components/AnimatorEditorPanel.tsx), [`AnimatorDebugView.tsx`](../src/components/AnimatorDebugView.tsx) |
| Foot / aim IK | [`src/three/footIK.ts`](../src/three/footIK.ts), [`src/three/aimIK.ts`](../src/three/aimIK.ts) |
| Prebuilt locomotion controller | [`src/store/editor/characterPawn.ts`](../src/store/editor/characterPawn.ts) |

Skeletons are shared by **signature** (a hash of the bone hierarchy), so one `SkeletonAsset` can back
several `SkeletalMeshAsset`s and every `AnimationAsset` targeting that skeleton is playable on all of
them. Clips are rebound to a mesh's bones by name, which is why a clip can live in a different GLB
from the mesh that plays it.

## Blend spaces

A blend space state replaces "play one clip" with "mix these clips by these parameters".

**1D** — samples on one axis, e.g. `Speed`:

```
Idle        Walk         Jog            Run
  ●───────────●────────────●──────────────●
  0           2            5              8
```

The two samples bracketing the parameter are interpolated linearly; outside the authored range the
end sample is held.

**2D** — samples on a plane, e.g. `MoveX` × `MoveY`:

```
                Run Forward
                     ●
              Walk Forward
                     ●
   Walk L ●     ● Idle      ● Walk R
                     ●
              Walk Backward
```

The samples are Delaunay-triangulated once, then the triangle containing the parameter point supplies
barycentric weights. **At most three clips ever contribute**, and a sample stops contributing entirely
once the parameter leaves its neighbourhood — so sprinting forward does not bleed "walk backward" into
the pose. Outside the sample hull the point is projected onto the nearest edge, so crossing the
boundary stays continuous. Sample sets that cannot be triangulated (fewer than three samples, or all
collinear) fall back to 1D interpolation along their dominant axis.

### Phase sync

Blending clips of different lengths is what makes locomotion slide: a 1.0s walk against a 0.7s run
drifts apart within a stride, so one foot plants while the other is still swinging. Setting `syncPhase`
on a blend-space state retimes every sample onto the weighted mean cycle length — longer clips speed
up, shorter ones slow down — so their footfalls stay locked. The samples already start in phase
(entering a state resets them together), so holding their cycle lengths equal keeps them there, and
because the mean moves continuously with the weights the retiming never snaps.

The correction is clamped to 0.5x–2x. Sync assumes the samples are the same motion at different
speeds; a blend space that also holds a long idle loop would otherwise drag a stride into slow motion
as it fades in past the idle. **Leave sync off for blend spaces mixing genuinely different cycle
lengths** — it is opt-in for exactly that reason, and off by default so existing blend spaces are
unchanged.

Two properties matter for smoothness and are guaranteed by tests:

- **Weights always sum to 1**, everywhere on the plane and far outside the hull.
- **The set of playing clips is constant** for the lifetime of the state. Every sample gets an entry
  (weight 0 when inactive), so crossing a sample boundary changes weights only — it never restarts an
  action, which is what would make locomotion visibly stutter.

## Animation layers

A layer is a second state machine that drives only part of the skeleton, on top of the base one. This
is what lets a character run and aim at the same time: the base owns the legs and hips, an upper-body
layer owns the spine, arms and head.

```
Base layer      Locomotion blend space        → hips, legs
Upper Body      Rest ⇄ Aim (on IsAiming)      → Spine and below-in-hierarchy
```

A layer holds its own `states`, `transitions` and `defaultStateId` and runs through the **same
evaluator** as the base (`stepStateMachine`), so everything a base state can do a layer state can do
too — blend spaces, exit time, any-state transitions. Parameters are **shared** with the controller,
so one `isAiming` drives the base and every layer at once.

### Masking, and why it is mandatory

`maskRootBones` names the bones a layer takes over. Each named bone brings its **whole subtree**, so
`["Spine"]` is the upper body without listing forty bones. An empty mask means the whole skeleton (a
full-body override).

Masking is not a convenience. three's `AnimationMixer` blends every action targeting the same property
and normalizes by total weight, so two actions both driving `Spine.quaternion` at weight 1 produce the
**average** of the two poses — a half-aiming, half-running spine. Layers therefore need disjoint track
sets: the layer plays only its bones' tracks, and the base is masked out of exactly those bones. Each
property then has one contributor at full weight.

When a layer is only partly faded in, the base contributes to the layer's bones as well, at
`1 - layerWeight`, so those bones land on a clean linear blend. Without that the bone would blend
against whatever it held last frame — a lag filter rather than a blend.

**Keep layer masks disjoint.** A bone claimed by two partly-faded layers receives a base contribution
from each, so overlapping masks blend only approximately.

### Weight

Either a static `weight` (0..1) or a `weightParameterId`, which drives it instead: a bool parameter
gates the layer on and off, a float fades it. A non-finite value resolves to 0 rather than sending NaN
into the mixer. A layer at zero weight is kept out of the mixer entirely.

### Editor workflow

The Animator panel's **machine selector** (left rail) switches the graph between "Base (full body)"
and each layer. Everything follows the selection — the node graph, both inspectors, entry state,
deletes, and the live-play highlight, which tracks the selected layer's state. Layer name, mask bones,
weight and weight parameter are edited in the same card. The **Animation Debug** readout lists every
layer with its state, weight and contributing clips, which is how you tell a zero weight from a mask
that matches no bone in this rig from a stuck layer state — all three look identical from outside.

## Root motion

Most clips are authored **in place**: the character runs on the spot and the engine moves it. A clip
authored **with root motion** instead translates the root bone, so the travel is baked into the
animation. Root motion means using that travel to drive the character, which guarantees the feet
cover exactly the ground the animator authored — the definitive fix for foot sliding.

Set `animator.rootMotion` to one of:

| Mode | Behaviour |
| --- | --- |
| `disabled` (default) | The clip poses the root as authored; nothing is measured. In-place clips are unaffected either way. |
| `extract` | The root is pinned back to its rest position each frame, so the mesh cannot drift off its object origin, and the travel is measured and published. Movement still comes from code. |
| `apply` | As `extract`, and the measured speed replaces the character controller's move speed. |

`apply` changes exactly one number — the controller's target speed. Direction, camera-relative input,
the acceleration ramp, facing, gravity, jumping, mantling, sliding and lock-on are all untouched,
which is what makes it safe to bolt onto a controller with this many interacting features.

Only **horizontal** travel is used. Gravity and jumping own the Y axis, and a clip fighting them is
precisely how root motion destabilises a character, so vertical displacement stays with the clip.

### The feedback loop, and `inputSpeed`

Blending a locomotion space on the `speed` source (which is *measured* speed) while root motion
supplies that same speed is a loop, and it settles at a standstill: idle produces no travel, so speed
reads zero, so idle keeps playing and the character never starts.

Use the **`inputSpeed`** source instead when applying root motion. It is the speed the input is
*asking* for — move speed times gait, before acceleration and before root motion — so the animation
choice is driven by intent and the travel by the animation. `inputSpeed` is worth using on its own as
the "desired speed" most locomotion systems blend on.

### Why the transport looks the way it does

The pose is produced in the **render loop** (the mixer, inside `SkinnedModel`) and movement is applied
in the **runtime tick**. `src/runtime/rootMotion.ts` bridges them as a module singleton, the same
pattern as `ragdollState` and `boneRegistry`.

The renderer *accumulates* distance alongside the animation time it covers, and the tick *drains*.
Publishing a velocity would be wrong: the loops run at unrelated rates, so several render frames may
land between ticks or none at all. Summing both numbers and dividing on drain gives the correct
average for the interval whatever the ratio, and draining guarantees each frame is consumed exactly
once. A tick that drains nothing means "no reading", not "speed zero" — the authored speed is kept,
or the character would stutter whenever the loops interleave unevenly.

A looping clip wraps the root from the end of its cycle back to the start. That frame is a
discontinuity, not travel, and applying it would teleport the character; a wrap is hundreds of units
per second while a sprint is under ten, so a fixed ceiling separates them with room to spare.

## Public API

Runtime weighting — pure functions, safe to call every frame:

```ts
import { blend1D, blend2D, sumBlendWeights } from './three/blendSpace';

// One weight per sample, in input order, summing to 1.
blend1D(samples, speed);
blend2D(samples, moveX, moveY);

// Collapse samples onto mixer actions before writing weights (two samples can share a clip).
sumBlendWeights(blend, resolveAction, scratchMap);
```

Debug snapshot — pure derived view of a live animator:

```ts
import { buildAnimatorDebugSnapshot } from './store/editor/animatorDebug';

const snapshot = buildAnimatorDebugSnapshot(controller, runtimeAnimators[objectId], animations);
// → { stateName, timeInState, blend: { xName, x, yName, y }, parameters, clips, montage, live }
```

Authoring from the AI assistant or a plugin goes through the store actions the editor uses —
`set_blendspace(controllerId, stateId, parameterName, samples)` with an optional `parameterNameY`
plus a `y` per sample for 2D. Passing empty samples clears the blend space and returns the state to a
single clip.

## Editor workflow

1. Import a rigged GLB. The importer creates the Skeleton, Skeletal Mesh and Animation assets, reusing
   an existing Skeleton when the bone hierarchy matches.
2. Open the **Animator** panel and create a controller (or let `create_character_pawn` build one).
3. Add parameters in the left rail and give each a **source** — `speed`, `moveX`, `grounded`, a project
   variable, or `manual` for script/AI control.
4. Add states, then drag between them to author transitions. Drag from **Any State** for global ones.
   Select a transition to set its conditions, crossfade duration and optional exit time.
5. Select a state and add **blend samples** to turn it into a blend space: pick the X parameter, add a
   Y parameter for 2D, then assign a clip and coordinates per sample. A **blend space graph** appears
   above the sample list — samples plotted on their axes, draggable to reposition (snapped to 0.05),
   each sized by the weight it is currently contributing, with a ring marking the live parameter
   position. The numeric fields remain the precise input; the graph is for seeing and roughing out the
   layout.
6. Press **Play** and watch the **Animation Debug** card in the left rail: active state, time in state,
   blend-axis values, every parameter's live value, and the clips in the pose with weight bars. A blend
   that looks wrong is usually visible here immediately — a parameter stuck at 0, or a sample holding
   weight it should have released.

## Serialization format

Controllers are project-level assets stored verbatim in `project.json` under `animatorControllers`
(see [`src/project/serialize.ts`](../src/project/serialize.ts)). Blend spaces are three optional
fields on a state, so projects saved before blend spaces existed load unchanged:

```json
{
  "id": "ctrl-loco",
  "name": "Locomotion",
  "parameters": [{ "id": "p-speed", "name": "Speed", "type": "float", "defaultValue": 0, "source": "speed" }],
  "states": [
    {
      "id": "s-loco",
      "name": "Locomotion",
      "speed": 1,
      "loop": true,
      "blendParameterId": "p-speed",
      "blendParameterIdY": "p-mx",
      "blendSamples": [
        { "animationId": "a-idle", "value": 0, "y": 0 },
        { "animationId": "a-run", "value": 0, "y": 2 }
      ]
    }
  ],
  "defaultStateId": "s-loco",
  "transitions": [
    { "id": "t1", "from": "s-idle", "to": "s-loco", "conditions": [{ "parameterId": "p-speed", "op": ">", "value": 0.1 }], "duration": 0.2 }
  ]
}
```

`blendParameterIdY` absent means 1D. Layers live under an optional `layers` array on the controller,
each with the same `states` / `transitions` / `defaultStateId` shape plus `maskRootBones`, `weight` and
an optional `weightParameterId`:

```json
"layers": [
  {
    "id": "l-upper",
    "name": "Upper Body",
    "maskRootBones": ["Spine"],
    "weight": 1,
    "weightParameterId": "p-aiming",
    "states": [{ "id": "ls-aim", "name": "Aim", "animationId": "a-aim", "speed": 1, "loop": true }],
    "defaultStateId": "ls-aim",
    "transitions": []
  }
]
```

 Parameter ids are remapped when a controller is packaged into a
prefab ([`src/project/package.ts`](../src/project/package.ts)), and
[`src/project/runtimeCompatibility.ts`](../src/project/runtimeCompatibility.ts) reports blend samples
pointing at missing animations. The round trip is covered by
[`animatorSerialization.test.ts`](../src/project/__tests__/animatorSerialization.test.ts).

## Example: locomotion driven only by movement

```ts
// No clip names anywhere in gameplay code — the controller owns that mapping.
const controller = {
  parameters: [
    { id: 'p-speed', name: 'Speed', type: 'float', defaultValue: 0, source: 'speed' },
    { id: 'p-grounded', name: 'Grounded', type: 'bool', defaultValue: true, source: 'grounded' },
  ],
  states: [
    {
      id: 's-loco',
      name: 'Locomotion',
      speed: 1,
      loop: true,
      blendParameterId: 'p-speed',
      blendSamples: [
        { animationId: idleId, value: 0 },
        { animationId: walkId, value: 2 },
        { animationId: jogId, value: 5 },
        { animationId: runId, value: 8 },
      ],
    },
    { id: 's-fall', name: 'Fall', animationId: fallId, speed: 1, loop: true },
  ],
  defaultStateId: 's-loco',
  transitions: [
    { id: 't-fall', from: 'any', to: 's-fall', conditions: [{ parameterId: 'p-grounded', op: '==', value: false }], duration: 0.15 },
    { id: 't-land', from: 's-fall', to: 's-loco', conditions: [{ parameterId: 'p-grounded', op: '==', value: true }], duration: 0.2 },
  ],
};
```

For a directional strafe blend, set `strafe: true` on the character controller so it faces the camera
and moves eight-way, then build a 2D blend space over the `moveX` / `moveY` parameter sources.

Those two sources are the local move direction **scaled by speed** relative to the character's
`moveSpeed`, so the blend point travels out from the origin as the character accelerates. Author them
the way the bundled pawn does: idle at `(0, 0)` and the directional clips out at radius 1. Sprinting
pushes the point past radius 1 and therefore outside the sample hull, where the blend clamps to the
nearest edge — the full-speed pose.

## Limitations

- **Phase sync has no per-sample opt-out.** It is on or off for the whole state; Unreal's per-sample
  sync-group membership (which is how an idle is normally excluded) is not implemented, which is why
  the correction is clamped instead.
- **One blend space per state.** A state is either a single clip or one blend space; nested blend
  spaces are not supported.
- **Overlapping layer masks are approximate.** A bone claimed by two partly-faded layers gets a base
  contribution from each. Disjoint masks are exact; overlapping ones drift.
- **Layers are override, not additive.** A layer replaces the base pose on its bones rather than
  adding to it, so an additive recoil that rides on top of an aim pose is not expressible yet (three
  supports additive blend modes, but nothing authors them here).
- **Root motion rotation is not extracted.** Only translation is read, so a clip that turns the
  character through its root track will not steer it; the controller still owns facing.
- **Root motion needs a root track to measure.** A rig whose motion is baked into the hips of an
  in-place clip has nothing to extract, and all three modes look identical.
- **Masks are authored as bone names.** There is no picker reading the bound skeleton, so a mask
  naming a bone the rig does not have silently shrinks — the Animation Debug readout is what surfaces
  that.
- **No root motion.** Movement comes from the character controller or physics; clips are treated as
  in-place. Root-motion extraction is not implemented.
- **2D blend spaces need a 2D sample layout.** Collinear samples degrade to 1D by design; a blend
  space authored as a straight line on the plane will not produce triangulated blending.
- **IK is per-feature, not a general solver.** Foot planting and aim/look-at exist; there is no generic
  two-bone IK rig or hand-target system.
- **Triangulation is recomputed when the sample array changes identity.** Editing a blend space
  re-triangulates on the next frame, which is fine at authoring scale (a handful of samples) but the
  maths is not intended for hundreds of samples.
