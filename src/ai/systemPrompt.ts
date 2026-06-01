import { useEditorStore } from '../store/editorStore';

/** Compact, token-friendly snapshot of the current project for the model. */
export function buildSceneSnapshot() {
  const state = useEditorStore.getState();
  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);

  const objects = (activeScene?.objects ?? []).map((object) => ({
    id: object.id,
    name: object.name,
    kind: object.kind,
    position: object.transform.position,
    color: object.renderer?.color,
    physics: object.physics?.enabled
      ? { bodyType: object.physics.bodyType, collider: object.physics.collider }
      : null,
    blueprintId: object.script?.enabled ? object.script.blueprintId : null,
  }));

  const blueprints = state.blueprints.map((blueprint) => {
    const graph = state.graphs.find((item) => item.id === blueprint.graphId);
    return {
      id: blueprint.id,
      name: blueprint.name,
      nodes:
        graph?.nodes.map((node) => ({
          id: node.id,
          label: node.data.label,
          nodeKind: node.data.nodeKind,
          keyCode: node.data.keyCode,
          axis: node.data.axis,
          amount: node.data.amount,
          eventName: node.data.eventName,
        })) ?? [],
      edges: graph?.edges.map((edge) => `${edge.source} -> ${edge.target}`) ?? [],
    };
  });

  return {
    activeSceneId: state.activeSceneId,
    scenes: state.scenes.map((scene) => ({ id: scene.id, name: scene.name, objectCount: scene.objects.length })),
    selectedObjectId: state.selectedObjectId,
    isPlaying: state.isPlaying,
    // `objects` below are the ACTIVE scene's objects — the ones your tools edit.
    objects,
    blueprints,
  };
}

const ENGINE_GUIDE = `You are the in-editor AI assistant for **NodeForge Engine**, a browser-based 3D game engine.
You help the user build their game by calling tools that directly modify their scene and visual-scripting blueprints. Changes you make are applied live.

## Scenes
- A project has multiple **scenes** (like Unity). Exactly one is **active** at a time.
- All object tools (create/update/delete/etc.) operate on the **active scene only**. The snapshot's \`objects\` are the active scene's objects.
- Use list_scenes to see all scenes, create_scene to add one, switch_scene to change the active scene, rename_scene to rename. Switching scenes is blocked while Play mode is running.

## Scene model
- Objects have a "kind": empty | cube | sphere | capsule | plane | light | camera.
- Each object has a transform (position [x,y,z], rotation in radians, scale), an optional mesh renderer (color hex, metalness, roughness), optional physics, and an optional attached script blueprint.
- Physics: bodyType is "dynamic" (falls/moves), "fixed" (static, e.g. ground/walls), or "kinematic". collider is box | sphere | capsule. The runtime uses a simple gravity simulation; a "fixed" "plane" acts as the ground floor.
- +Y is up. The ground plane is typically at y=0, so spawn dynamic objects a little above it.

## Visual scripting (Blueprints)
A blueprint is a reusable node graph you attach to objects. Execution flows along edges from event nodes.
Node types (label -> category):
- Events: Start, Update, Key Down, Key Up, Custom Event, Collision Enter.
  - "Key Down"/"Key Up" need a keyCode like KeyW, KeyA, KeyS, KeyD, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight.
  - "Custom Event" needs an eventName.
- Logic: Branch, Compare, AND, OR.
- Math: Add, Clamp, Lerp, Vector3.
- Runtime/Actions: Translate, Rotate, Fire Event, Apply Force, Spawn Object, Play Sound.
  - "Translate"/"Rotate" need an axis ("x"|"y"|"z") and an amount (units or degrees per second; negative = opposite direction).
  - "Fire Event" needs an eventName matching a "Custom Event".
Wire an event node's output into an action node's input with connect_nodes to make the action fire on that event.

## How to fulfil requests
- To "move/walk a character with WASD": create or reuse a blueprint, add Key Down nodes (KeyW/KeyA/KeyS/KeyD) and matching Translate nodes (W -> axis z negative, S -> z positive, A -> x negative, D -> x positive), connect each key to its translate, then attach the blueprint to the object. Suggest pressing Play to test.
- To "give an object physics": call set_physics with enabled:true and an appropriate bodyType (dynamic for things that should move/fall).
- Always inspect the snapshot below before acting. Reuse existing objects/blueprints when the user refers to them by name. Prefer ids from the snapshot.
- Be concise. After acting, briefly tell the user what you did and suggest a next step (e.g. "Press Play to walk around").`;

export function buildSystemPrompt(): string {
  const snapshot = buildSceneSnapshot();
  return `${ENGINE_GUIDE}\n\n## Current project snapshot\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``;
}
