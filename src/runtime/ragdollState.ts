/**
 * Which character objects are currently ragdolling. A plain module singleton (like boneRegistry /
 * mouseLook) so the render layer (RagdollRig in SkinnedModel) and the runtime tick can both read/write
 * it without routing through Zustand every frame. Cleared when Play stops.
 */
const ragdolling = new Set<string>();
// World-space position of each ragdoll's root (pelvis) bone, published by RagdollRig each frame so the
// runtime can keep the character's transform — and therefore the follow camera — tracking the limp body.
const rootPositions = new Map<string, [number, number, number]>();

export function isRagdoll(objectId: string): boolean {
  return ragdolling.has(objectId);
}

export function setRagdoll(objectId: string, on: boolean) {
  if (on) ragdolling.add(objectId);
  else {
    ragdolling.delete(objectId);
    rootPositions.delete(objectId);
  }
}

export function toggleRagdoll(objectId: string) {
  setRagdoll(objectId, !ragdolling.has(objectId));
}

export function clearRagdolls() {
  ragdolling.clear();
  rootPositions.clear();
}

/** RagdollRig publishes the simulated root-bone world position here each frame. */
export function setRagdollRoot(objectId: string, position: [number, number, number]) {
  rootPositions.set(objectId, position);
}

/** The latest simulated root position, or null if this object isn't ragdolling yet. */
export function getRagdollRoot(objectId: string): [number, number, number] | null {
  return rootPositions.get(objectId) ?? null;
}
