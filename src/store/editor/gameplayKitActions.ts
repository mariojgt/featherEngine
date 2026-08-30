import type { StoreApi } from 'zustand';
import { findCreatorGameplayKit, type CreatorGameplayKitId } from '../../creator/gameplayKits';
import type { UIElement, Vector3Tuple } from '../../types';
import type { EditorState } from '../editorStore';
import { selectActiveObjects } from './storeHelpers';
import { uiVariableRef } from './ui';

type GetState = StoreApi<EditorState>['getState'];

export interface CreatorGameplayKitResult {
  ok: boolean;
  kitId: string;
  objectIds: string[];
  uiDocumentId?: string;
  error?: 'unknown-kit' | 'creator-action-failed';
}

const ensureGround = (get: GetState, created: string[]): string => {
  const existing = selectActiveObjects(get()).find((object) => object.name === 'Ground' && object.kind === 'plane');
  if (existing) return existing.id;
  const id = get().createObjectWithProps('plane', {
    name: 'Ground',
    position: [0, 0, 0],
    color: '#39414F',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: false },
  });
  // Feather's plane primitive is authored in the XY plane. Lay kit ground flat just like the
  // starter-project ground so both its rendered surface and fixed collider face upward.
  get().updateTransform(id, 'rotation', [-Math.PI / 2, 0, 0]);
  get().updateTransform(id, 'scale', [30, 30, 1]);
  created.push(id);
  return id;
};

const ensurePlayer = (get: GetState, created: string[]): string | undefined => {
  const existing = selectActiveObjects(get()).find((object) => object.creatorRoleId === 'player' || (object.character?.enabled && object.character.cameraFollow));
  if (existing) return existing.id;
  const result = get().createRoleObject('player', { position: [0, 1.1, 4] });
  if (result.objectId) created.push(result.objectId);
  return result.objectId;
};

const hasScoreBinding = (element: UIElement): boolean =>
  element.bindings.some((binding) => binding.target === 'text' && binding.expression.includes('Score')) ||
  element.children.some(hasScoreBinding);

const ensureScoreHud = (get: GetState): string => {
  let score = get().variables.find((variable) => variable.name === 'Score');
  if (!score) {
    const id = get().createVariable('Score', 'number', true);
    get().updateVariable(id, { defaultValue: 0 });
    score = get().variables.find((variable) => variable.id === id);
  }

  let document = get().uiDocuments.find((item) => item.name === 'Creator HUD');
  if (!document) {
    const id = get().createUIDocument('Creator HUD', 'screen');
    document = get().uiDocuments.find((item) => item.id === id);
  }
  const documentId = document!.id;
  get().updateUIDocument(documentId, { visibleOnStart: true, surface: 'screen' });
  const latest = get().uiDocuments.find((item) => item.id === documentId)!;
  if (!hasScoreBinding(latest.root)) {
    const elementId = get().addUIElement(documentId, undefined, 'text');
    get().updateUIElement(documentId, elementId, {
      name: 'Score Counter',
      text: 'Score: 0',
      anchor: { h: 'right', v: 'top', offsetX: 24, offsetY: 22 },
      style: {
        color: '#ffffff',
        fontSize: '20px',
        fontWeight: '800',
        custom: { textShadow: '0 2px 8px rgba(0,0,0,0.7)' },
      },
    });
    get().setUIBinding(documentId, elementId, 'text', `'Score: ' + ${uiVariableRef(score?.name ?? 'Score')}`);
  }
  return documentId;
};

const createRoles = (
  get: GetState,
  roleId: string,
  positions: Vector3Tuple[],
  created: string[],
): boolean => {
  for (const position of positions) {
    const result = get().createRoleObject(roleId, { position });
    if (!result.ok || !result.objectId) return false;
    created.push(result.objectId);
  }
  return true;
};

/** Add a small playable setup by composing the same public store actions used by Creator UI/Agent. */
export const applyCreateCreatorGameplayKit = (
  get: GetState,
  kitId: string,
): CreatorGameplayKitResult => {
  if (!findCreatorGameplayKit(kitId)) return { ok: false, kitId, objectIds: [], error: 'unknown-kit' };
  const created: string[] = [];
  ensureGround(get, created);
  if (!ensurePlayer(get, created)) return { ok: false, kitId, objectIds: created, error: 'creator-action-failed' };

  let ok = true;
  let uiDocumentId: string | undefined;
  switch (kitId as CreatorGameplayKitId) {
    case 'third-person-starter':
      break;
    case 'collectible-game':
      ok = createRoles(get, 'collectible', [[-4, 1, 0], [-2, 1, 0], [0, 1, 0], [2, 1, 0], [4, 1, 0]], created);
      uiDocumentId = ensureScoreHud(get);
      break;
    case 'combat-starter':
      ok = createRoles(get, 'enemy', [[-5, 1, -4], [0, 1, -6], [5, 1, -4]], created) &&
        createRoles(get, 'destructible', [[0, 1, -2]], created);
      break;
    case 'platformer-starter':
      ok = createRoles(get, 'moving-platform', [[-4, 1.5, 0], [0, 3, -3], [4, 4.5, -6]], created) &&
        createRoles(get, 'collectible', [[-4, 2.5, 0], [0, 4, -3], [4, 5.5, -6]], created);
      uiDocumentId = ensureScoreHud(get);
      break;
    case 'interaction-starter':
      ok = createRoles(get, 'door', [[0, 1, -3]], created);
      break;
  }

  return ok
    ? { ok: true, kitId, objectIds: created, uiDocumentId }
    : { ok: false, kitId, objectIds: created, uiDocumentId, error: 'creator-action-failed' };
};
