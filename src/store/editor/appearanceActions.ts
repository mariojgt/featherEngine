import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import { defaultRenderer, defaultTransform } from './defaults';
import { makeId } from './ids';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';
import { separateHistoryAction } from '../history';

/** Replace only this object's visible mesh. Its collision/input/script root remains untouched. */
export function applyReplaceObjectAppearance(set: StoreApi<EditorState>['setState'], get: StoreApi<EditorState>['getState'], objectId: string, assetId: string | null): { ok: boolean; objectId?: string; error?: string } {
  const state = get();
  const objects = selectActiveObjects(state);
  const object = objects.find((item) => item.id === objectId);
  if (!object?.renderer) return { ok: false, error: 'Select an object with a visible mesh.' };
  if (object.animator?.enabled || object.model?.enabled) return { ok: false, error: 'Use the Skeleton or Model Forge editor to replace this animated/model rig while retaining its mappings.' };
  const asset = state.assets.find((item) => item.id === assetId && item.type === 'model');
  if (assetId && !asset) return { ok: false, error: 'Choose an imported model from Assets.' };
  const previous = objects.find((item) => item.parentId === objectId && item.creatorAppearanceFor === objectId);
  if (!assetId && previous && objects.some((item) => item.parentId === previous.id)) {
    return { ok: false, error: 'Move the appearance object’s children to the gameplay root before restoring the original mesh.' };
  }
  separateHistoryAction();
  if (!assetId) {
    if (!previous) return { ok: true, objectId };
    set({ ...mapActiveSceneObjects(state, (items) => items.filter((item) => item.id !== previous.id).map((item) => item.id === objectId ? { ...item, creatorOriginalRendererEnabled: undefined, renderer: { ...item.renderer!, enabled: item.creatorOriginalRendererEnabled ?? true } } : item)), isDirty: true });
    return { ok: true, objectId };
  }
  // The child can be rescaled independently without changing the collision root's transform.
  const id = previous?.id ?? makeId('obj');
  const dimensions = asset?.modelInspection?.stats?.dimensions;
  const scale = dimensions && Math.max(...dimensions) > 0 ? 1 / Math.max(...dimensions) : 1;
  const visual = { ...previous, id, name: `${object.name} — Appearance`, kind: 'cube' as const, parentId: objectId, creatorAppearanceFor: objectId, transform: previous?.transform ?? { ...defaultTransform(), scale: [scale, scale, scale] as [number, number, number] }, renderer: { ...defaultRenderer('cube'), modelAssetId: assetId, overrideMaterial: false } };
  set({ ...mapActiveSceneObjects(state, (items) => [
    ...items.filter((item) => item.id !== previous?.id).map((item) => item.id === objectId ? { ...item, creatorOriginalRendererEnabled: item.creatorOriginalRendererEnabled ?? item.renderer!.enabled, renderer: { ...item.renderer!, enabled: false } } : item), visual,
  ]), isDirty: true });
  return { ok: true, objectId: id };
}
