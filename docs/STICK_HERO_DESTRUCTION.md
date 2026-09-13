# Destruction improvements adapted from Stick Hero

Feather now reuses the blast and debris-management ideas from the local
`stick-hero` / Stick World project (source revision `afd61ec`). The implementation
runs through Feather's existing scene objects, Rapier world, Blueprint nodes and
exported player.

## What changed

- Explosions use Stick Hero's quadratic pressure falloff. Force remains an impulse:
  heavy bodies move less, and existing velocity is preserved. Blast-induced speed
  and spin are bounded at 36 units/s and 9 radians/s; already faster bodies keep
  their higher ceiling. Fast bodies enable continuous collision detection (CCD).
- Fracture pieces inherit the source body's linear velocity as well as their own
  outward burst. Disable **Inherit velocity** for stationary break effects.
- Generated pieces expire after **Debris lifetime (s)**, defaulting to 12 seconds
  (range 0.1–120). Above 256 live fracture pieces, the oldest are recycled first.
  Authored props do not consume that allowance and are never recycled.
- Raw fragment geometry is released on expiry, deletion, scene transition and Stop.
  Stop restores the original objects as before.
- Uniform grids retain the source rotation, including objects inside parents.
  Voronoi pieces now rotate around their own centres, and hit directions use the
  object's rotated local space.

## Try it

1. Add a **Destructible** gameplay object, or add the Destructible component to a prop.
2. Open **Inspector → Destructible**. Set **Debris lifetime (s)** and **Inherit velocity**.
3. Enable dynamic physics for a moving prop. Set **Break on impact**, give the prop
   health and damage it, or connect a one-shot event to the **Fracture** Blueprint node.
4. Press Play. The pieces continue moving, spread apart, and are removed after the
   configured lifetime. Stop returns the scene to its authored state.

The assistant's existing `set_fracture` tool accepts `debrisLifetime` and
`inheritVelocity`; both also appear in the scene snapshot. For example:

```json
{
  "id": "your-object-id",
  "pattern": "chunks",
  "pieces": 3,
  "strength": 3,
  "impactThreshold": 6,
  "debrisLifetime": 8,
  "inheritVelocity": true
}
```

## Scope and source references

Adapted from `src/physics/blast.ts`, `src/physics/looseBudget.ts`, and the momentum
and lifetime handling in `src/physics/fragments.ts` in Stick Hero. Feather retains
its existing mesh fracture system. It does not copy the game's city, quests,
characters, or its imperative renderer.

The limit bounds live fracture debris, not all physics bodies or mesh-cutting work
within one frame. Voronoi CSG still runs when an object breaks: keep detail modest
on complex imported models. Debris is removed at expiry rather than fading.

Behaviour is covered by the blast physics and fracture debris tests, including
real Rapier momentum transfer, burst preservation, lifetime expiry, oldest-first
recycling, mesh cleanup and Stop restoration.
