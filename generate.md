# Feather Engine
### MVP v2 – Browser-Based Visual Game Engine

## Vision

Feather is a modern browser-based game engine built with:

- Three.js (3D rendering)
- React
- TypeScript
- React Flow (visual scripting)
- Rapier (physics)
- Tailwind CSS
- Zustand (state management)

The goal is to create a professional-looking visual game engine that allows users to build real games directly in the browser and export them as standalone web projects.

---

# Core Principles

## 1. Beautiful UI

The editor should look closer to modern professional tools such as:

- Unity
- Unreal Engine
- Blender
- Figma
- Framer

Not like a developer dashboard.

### Design Language

Theme:

- Dark
- Glassmorphism
- Subtle gradients
- Soft shadows
- Smooth animations

Colors:

```css
Background: #0F1117
Panel: #171A23
Panel Light: #1D2230
Primary: #5B8CFF
Success: #3DDC97
Warning: #F7B955
Danger: #FF6B6B
Text: #F3F4F6
Secondary Text: #9CA3AF
```

Typography:

- Inter
- Geist
- SF Pro

Spacing:

- 8px system

Animations:

- Framer Motion
- Smooth panel transitions
- Animated node connections
- Hover effects

---

# High-Level Architecture

```text
Editor
 ├ Scene Editor
 ├ Hierarchy
 ├ Inspector
 ├ Asset Browser
 ├ Visual Scripting
 └ Exporter

Runtime
 ├ ECS
 ├ Renderer
 ├ Physics
 ├ Audio
 └ Node Execution
```

---

# Main Layout

```text
+------------------------------------------------+
| Toolbar                                        |
+------------------------------------------------+
|Hierarchy|           Viewport         |Inspector|
|         |                            |         |
|         |                            |         |
|         |                            |         |
+---------+----------------------------+---------+
| Assets                                     |
+--------------------------------------------+
```

---

# Editor Modules

---

## Module 1 — Three.js Viewport

Purpose:

Render the game world.

Features:

- Orbit controls
- Grid helper
- Transform gizmos
- Camera controls

User can:

- Move camera
- Select objects
- Drag objects
- Rotate objects
- Scale objects

Default scene:

```text
Directional Light
Camera
Ground Plane
```

---

## Module 2 — Scene Hierarchy

Tree view:

```text
Scene
 ├ Player
 ├ Ground
 ├ Enemy
 └ Light
```

Features:

- Create object
- Rename
- Duplicate
- Delete
- Drag hierarchy ordering

Right-click menu:

```text
Create Empty
Cube
Sphere
Capsule
Plane
Light
Camera
```

---

## Module 3 — Inspector

Displays selected object.

### Transform

```text
Position
Rotation
Scale
```

### Renderer

```text
Mesh
Material
Color
```

### Physics

```text
RigidBody
Collider
Mass
Gravity
Friction
```

### Scripts

Attached node graph.

---

## Module 4 — Asset Browser

Supports:

```text
.glb
.gltf
.png
.jpg
.jpeg
.mp3
.wav
```

Features:

- Drag and drop upload
- Asset preview
- Search assets
- Asset folders

Storage:

```json
{
  "assets": []
}
```

---

# Physics System

Using Rapier.

---

## Physics Components

### Rigid Body

Properties:

```text
Dynamic
Fixed
Kinematic
```

Settings:

```text
Mass
Gravity Scale
Linear Damping
Angular Damping
```

---

## Colliders

### Box

```text
Width
Height
Depth
```

### Sphere

```text
Radius
```

### Capsule

```text
Radius
Height
```

---

# Visual Scripting System

Built with React Flow.

---

## Graph Structure

```text
Start
  ↓
Update
  ↓
Move Forward
```

---

## Event Nodes

```text
Start
Update
Key Down
Key Up
Collision Enter
Collision Exit
Timer
```

---

## Logic Nodes

```text
Branch
AND
OR
NOT
Compare
```

---

## Value Nodes

```text
Number
Boolean
String
Vector3
```

---

## Math Nodes

```text
Add
Subtract
Multiply
Divide
Clamp
Lerp
```

---

## Transform Nodes

```text
Get Position
Set Position
Get Rotation
Set Rotation
Translate
Rotate
```

---

## Physics Nodes

```text
Apply Force
Apply Impulse
Set Velocity
Get Velocity
Raycast
```

---

## Game Nodes

```text
Spawn Object
Destroy Object
Enable Object
Disable Object
```

---

## Audio Nodes

```text
Play Sound
Stop Sound
Set Volume
```

---

# Runtime Engine

Responsible for executing graphs.

---

## Runtime Loop

```typescript
while(running)
{
  updatePhysics();
  executeGraphs();
  render();
}
```

---

# ECS System

Entity Component System.

---

## Entity

```typescript
Entity
```

Contains:

```typescript
id
name
components
children
```

---

## Components

```text
Transform
MeshRenderer
Camera
Light
RigidBody
Collider
AudioSource
ScriptGraph
```

---

# Save System

Project format:

```json
{
  "scene": {},
  "assets": [],
  "graphs": []
}
```

Extension:

```text
.nforge
```

---

# Export System

One-click export.

Button:

```text
Export Game
```

Output:

```text
dist/
 ├ index.html
 ├ runtime.js
 ├ assets/
 └ game.json
```

Deployable to:

- Vercel
- Netlify
- GitHub Pages

---

# Example Game Requirement

Before release, the engine must be capable of building:

### Physics Platformer

Features:

- Player movement
- Jumping
- Collision detection
- Collectible coins
- Win condition

If this game can be created without writing code, MVP v2 is complete.

---

# Technical Stack

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS
- Framer Motion

Rendering:

- Three.js

Visual Scripting:

- React Flow

Physics:

- Rapier

State:

- Zustand

Serialization:

- JSON

---

# Future Roadmap (Post-MVP)

Version 3:

- Animation system
- Prefabs
- Material editor
- Particle system
- Terrain tools

Version 4:

- Multiplayer
- Shader graph
- AI behavior trees
- Mobile export

Version 5:

- Marketplace
- Plugin system
- Cloud projects

---

# Success Criteria

The MVP is successful when a user can:

1. Create a scene.
2. Add 3D objects.
3. Add physics.
4. Create gameplay using nodes.
5. Press Play.
6. Save project.
7. Export standalone game.
8. Deploy exported game online.

At that point, Feather is a real visual game engine rather than a demo.
