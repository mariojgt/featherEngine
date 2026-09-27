import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';
import { worldMatrixOf } from '../utils/transformHierarchy';

export const SPROUTWATCH_MARKER = 'sproutwatch-v1';
export const DEFAULT_GARDEN_SEED = 2718;
export const gardenController = (objects: readonly SceneObject[]) => objects.find(o => o.kind === 'empty' && o.variables?.gameTemplate === SPROUTWATCH_MARKER);
/** Place procedural actors in the same coordinate system as their editable garden scenery. */
export function gardenMatrix(objects: readonly SceneObject[]) {
  return worldMatrixOf(new Map(objects.map(object => [object.id, object])), gardenController(objects)?.id ?? '');
}
export function gardenSeed(objects: readonly SceneObject[]): number {
  const seed = gardenController(objects)?.variables?.seed;
  return typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : DEFAULT_GARDEN_SEED;
}
export function useTowerDefenseActive() {
  return useEditorStore(s => s.isPlaying && Boolean(gardenController(selectActiveObjects(s))));
}
