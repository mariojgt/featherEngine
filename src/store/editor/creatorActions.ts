import type { StoreApi } from 'zustand';
import { CREATOR_ROLES, findCreatorRole, type CreateRoleObjectOptions, type CreatorRoleActionResult } from '../../creator/roles';
import type { ColliderType, SceneObject, SceneObjectKind } from '../../types';
import type { EditorState } from '../editorStore';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

const objectById = (state: EditorState, objectId: string): SceneObject | undefined =>
  selectActiveObjects(state).find((object) => object.id === objectId);

const defaultColliderForKind = (kind: SceneObjectKind): ColliderType => {
  if (kind === 'sphere') return 'sphere';
  if (kind === 'capsule') return 'capsule';
  return 'box';
};

const CREATOR_MANAGED_TAGS = new Set(CREATOR_ROLES.flatMap((role) => role.tags ?? []));

const authoredSignature = (state: EditorState, objectId: string): string =>
  JSON.stringify({
    object: objectById(state, objectId),
    variables: state.variables.map((variable) => [
      variable.id,
      variable.name,
      variable.type,
      variable.defaultValue,
      variable.persistent,
    ]),
    blueprintIds: state.blueprints.map((blueprint) => blueprint.id),
    graphIds: state.graphs.map((graph) => graph.id),
  });

/** Apply a high-level game role using the same public store operations exposed to the rest of Feather. */
export const applyMakeObjectRole = (
  set: SetState,
  get: GetState,
  objectId: string,
  roleId: string,
): CreatorRoleActionResult => {
  const role = findCreatorRole(roleId);
  if (!role) return { ok: false, roleId, created: false, changed: false, error: 'unknown-role' };

  const object = objectById(get(), objectId);
  if (!object) {
    return { ok: false, roleId, objectId, created: false, changed: false, error: 'object-not-found' };
  }
  if (role.compatibleKinds && !role.compatibleKinds.includes(object.kind)) {
    return { ok: false, roleId, objectId, created: false, changed: false, error: 'incompatible-kind' };
  }

  const before = authoredSignature(get(), objectId);
  let blueprintId: string | undefined;

  if (role.behaviorPresetId) {
    blueprintId = get().attachBehaviorPreset(objectId, role.behaviorPresetId);
    if (!blueprintId) {
      return { ok: false, roleId, objectId, created: false, changed: false, error: 'behavior-attach-failed' };
    }
    // A prior Player role must not continue reading movement input underneath a scripted role.
    const scriptedObject = objectById(get(), objectId);
    if (scriptedObject?.character?.enabled) get().toggleCharacterController(objectId);
  } else if (role.character) {
    // Character auto-input is the existing runtime path for a no-code player. A script deliberately
    // switches that controller into graph-driven mode, so changing an object into a Player detaches
    // its previous role script while leaving the reusable blueprint itself intact in the project.
    if (objectById(get(), objectId)?.script) get().detachScript(objectId);
    const current = objectById(get(), objectId);
    if (!current?.character || !current.character.enabled) get().toggleCharacterController(objectId);
    get().updateCharacterController(objectId, role.character);
    // Built-in character motion owns the transform. Keep an authored rigid body available under
    // Advanced, but disable it so a fixed/dynamic body from the object's previous role cannot fight it.
    if (objectById(get(), objectId)?.physics?.enabled) get().updatePhysics(objectId, { enabled: false });
  }

  if (role.physics) {
    const current = objectById(get(), objectId);
    if (!current?.physics) get().togglePhysics(objectId);
    // Preserve an authored collider. If the behavior just seeded physics for an object that had none,
    // choose the primitive's natural collider instead of inheriting togglePhysics's generic box.
    const collider = role.physics.collider ?? object.physics?.collider ?? defaultColliderForKind(object.kind);
    get().updatePhysics(objectId, { ...role.physics, enabled: true, collider });
  }

  for (const [key, value] of Object.entries(role.variables ?? {})) {
    get().setObjectVariable(objectId, key, value);
  }

  if (role.tags?.length) {
    const tagged = objectById(get(), objectId);
    const currentTags = typeof tagged?.variables?.tags === 'string'
      ? tagged.variables.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
    const tags = Array.from(new Set([
      ...currentTags.filter((tag) => !CREATOR_MANAGED_TAGS.has(tag)),
      ...role.tags,
    ]));
    get().setObjectVariable(objectId, 'tags', tags.join(','));
  }

  if (role.fracture) get().setObjectFracture(objectId, role.fracture);

  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((item) => (item.id === objectId ? { ...item, creatorRoleId: role.id } : item)),
    ),
  );

  return {
    ok: true,
    roleId: role.id,
    objectId,
    blueprintId,
    created: false,
    changed: before !== authoredSignature(get(), objectId),
  };
};

/** Create a normal Feather object, then apply the same role composition used by Make It. */
export const applyCreateRoleObject = (
  set: SetState,
  get: GetState,
  roleId: string,
  options: CreateRoleObjectOptions = {},
): CreatorRoleActionResult => {
  const role = findCreatorRole(roleId);
  if (!role) return { ok: false, roleId, created: false, changed: false, error: 'unknown-role' };

  const kind = options.kind ?? role.create.kind;
  if (role.compatibleKinds && !role.compatibleKinds.includes(kind)) {
    return { ok: false, roleId, created: false, changed: false, error: 'incompatible-kind' };
  }

  const objectId = get().createObjectWithProps(kind, {
    name: options.name ?? role.create.name,
    position: options.position,
    color: options.color ?? role.create.color,
    parentId: options.parentId,
    physics: options.physics,
  });
  const applied = applyMakeObjectRole(set, get, objectId, role.id);
  if (!applied.ok) {
    get().deleteObject(objectId);
    return { ...applied, objectId, created: false };
  }
  return { ...applied, created: true, changed: true };
};
