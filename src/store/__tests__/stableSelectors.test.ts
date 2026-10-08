import { describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../types';
import { useEditorStore } from '../editorStore';
import { nonVfxObjectsSignature, structuralObjectsSignature, vfxObjectsSignature } from '../stableSelectors';

type State = ReturnType<typeof useEditorStore.getState>;
const object = (id: string, name = id): SceneObject => ({
  id, name, kind: 'cube',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
});
const stateWith = (objects: SceneObject[], isPlaying: boolean): State => {
  const initial = useEditorStore.getState();
  return { ...initial, isPlaying, activeSceneId: 'selector-test', scenes: [{ ...initial.scenes[0], id: 'selector-test', objects }] };
};

describe('panel scene subscriptions', () => {
  it('reuses unchanged scene snapshots across multiple panel subscriptions', () => {
    const actor = object('shared');
    const readId = vi.fn(() => 'shared');
    Object.defineProperty(actor, 'id', { get: readId, enumerable: true });
    const state = stateWith([actor], true);
    for (const selector of [structuralObjectsSignature, nonVfxObjectsSignature, vfxObjectsSignature]) {
      const signature = selector(state);
      readId.mockClear();
      for (let subscriber = 0; subscriber < 20; subscriber++) expect(selector(state)).toBe(signature);
      expect(readId).not.toHaveBeenCalled();
    }
  });

  it('ignores pure runtime motion but refreshes component edits and edit-mode transforms', () => {
    const actor = object('moving');
    const before = structuralObjectsSignature(stateWith([actor], true));
    const moved = { ...actor, transform: { ...actor.transform, position: [3, 0, 0] as [number, number, number] } };
    expect(structuralObjectsSignature(stateWith([moved], true))).toBe(before);
    const renamed = { ...moved, name: 'Renamed' };
    const renamedSignature = structuralObjectsSignature(stateWith([renamed], true));
    expect(renamedSignature).not.toBe(before);
    const stopped = structuralObjectsSignature(stateWith([renamed], false));
    const edited = { ...renamed, transform: { ...renamed.transform, position: [8, 0, 0] as [number, number, number] } };
    expect(structuralObjectsSignature(stateWith([edited], false))).not.toBe(stopped);
  });

  it('keeps authored panels stable when effects spawn and updates each list when its members disappear', () => {
    const actor = object('actor');
    const effect: SceneObject = {
      ...object('spark'), effect: { kind: 'impact', life: 1, maxLife: 1, color: '#ffffff', count: 4 },
    };
    const authored = nonVfxObjectsSignature(stateWith([actor], true));
    const emptyEffects = vfxObjectsSignature(stateWith([actor], true));
    const spawned = stateWith([actor, effect], true);
    expect(nonVfxObjectsSignature(spawned)).toBe(authored);
    expect(vfxObjectsSignature(spawned)).not.toBe(emptyEffects);
    expect(vfxObjectsSignature(stateWith([actor], true))).toBe(emptyEffects);
    expect(nonVfxObjectsSignature(stateWith([], true))).not.toBe(authored);
  });
});
