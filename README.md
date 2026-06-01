# NodeForge Engine

A browser-based 3D game engine editor with a node-based visual scripting system. Build scenes, attach physics, wire up gameplay logic with a blueprint-style graph, and preview it all live — no compilation, no plugins, just the web.

![NodeForge Engine](https://img.shields.io/badge/status-experimental-orange) ![React](https://img.shields.io/badge/React-18-61dafb) ![Three.js](https://img.shields.io/badge/Three.js-r171-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6)

## Features

- **3D Viewport** — Real-time scene rendering powered by [Three.js](https://threejs.org/) via [@react-three/fiber](https://github.com/pmndrs/react-three-fiber).
- **Physics** — Rigid bodies, colliders, gravity, and damping through [@react-three/rapier](https://github.com/pmndrs/react-three-rapier).
- **Visual Scripting** — A node graph editor (built on [@xyflow/react](https://reactflow.dev/)) for wiring gameplay logic: events, branching, math, runtime actions, physics forces, and audio — no code required.
- **Scene Hierarchy & Inspector** — Manage scene objects (cubes, spheres, capsules, planes, lights, cameras) with editable transform, mesh renderer, and physics components.
- **Asset Browser** — Import and organize models, images, and audio.
- **Live Runtime Preview** — Hit play to run your graph in real time with keyboard input, per-frame ticks, and event dispatch.
- **Project Save/Load** — Serialize the full scene, assets, blueprints, and graphs as a portable project file.

## Visual Scripting Nodes

The graph supports a growing palette of nodes across several categories:

| Category | Nodes |
|----------|-------|
| **Events** | Start, Update, Key Down, Key Up, Custom Event, Collision Enter |
| **Logic** | Branch, Compare, And, Or |
| **Math** | Add, Clamp, Lerp |
| **Values** | Vector3 |
| **Actions** | Translate, Rotate, Apply Force, Fire Event, Spawn Object, Play Sound |

## Tech Stack

- **[React 18](https://react.dev/)** + **[TypeScript](https://www.typescriptlang.org/)**
- **[Vite](https://vitejs.dev/)** — dev server and build tooling
- **[Three.js](https://threejs.org/)** / **[@react-three/fiber](https://github.com/pmndrs/react-three-fiber)** / **[@react-three/drei](https://github.com/pmndrs/drei)** — 3D rendering
- **[@react-three/rapier](https://github.com/pmndrs/react-three-rapier)** — physics
- **[@xyflow/react](https://reactflow.dev/)** — node graph editor
- **[Zustand](https://github.com/pmndrs/zustand)** — state management
- **[Tailwind CSS](https://tailwindcss.com/)** — styling
- **[Framer Motion](https://www.framer.com/motion/)** — animation

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm

### Installation

```bash
git clone https://github.com/mariojgt/NodeForgeEngine.git
cd NodeForgeEngine
npm install
```

### Development

Start the dev server (accessible on your local network):

```bash
npm run dev
```

Then open the URL printed in the terminal (default [http://localhost:5173](http://localhost:5173)).

### Build

```bash
npm run build    # type-check + production build into dist/
npm run preview  # preview the production build locally
```

## Project Structure

```
src/
├── App.tsx                          # Editor shell + runtime preview loop
├── main.tsx                         # React entry point
├── types.ts                         # Core scene, component & graph types
├── store/
│   └── editorStore.ts               # Zustand store: scene, runtime & graph state
└── components/
    ├── Toolbar.tsx                  # Top toolbar (play/stop, save/load)
    ├── HierarchyPanel.tsx           # Scene object tree
    ├── Viewport.tsx                 # 3D viewport (fiber + rapier)
    ├── InspectorPanel.tsx           # Component editor for selected object
    ├── AssetBrowser.tsx             # Imported assets
    ├── VisualScriptingPanel.tsx     # Node graph editor
    └── NodeForgeGraphNode.tsx       # Custom graph node renderer
```

## Status

NodeForge Engine is an **experimental** project under active development. APIs, the project file format, and the node palette may change.

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.
