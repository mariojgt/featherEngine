import type { PhysicsContactEvent } from '../../runtime/physicsWorld';

export interface ContactIndex {
  byObject: Map<string, Set<string>>;
  touchesByObject: Map<string, Set<string>>;
  firstOtherByObject: Map<string, string>;
}

const addContact = (map: Map<string, Set<string>>, objectId: string, otherObjectId: string) => {
  const existing = map.get(objectId);
  if (existing) existing.add(otherObjectId);
  else map.set(objectId, new Set([otherObjectId]));
};

// Contact arrays are identity-stable across idle frames (the tick's keepArray guards), so the index
// is cached on the array's identity — most frames reuse last frame's Maps instead of rebuilding.
// Consumers only READ the index (the helpers below), which is what makes sharing safe.
const EMPTY_CONTACT_INDEX: ContactIndex = {
  byObject: new Map(),
  touchesByObject: new Map(),
  firstOtherByObject: new Map(),
};
const contactIndexCache = new WeakMap<PhysicsContactEvent[], ContactIndex>();

export const buildContactIndex = (events: PhysicsContactEvent[]): ContactIndex => {
  if (events.length === 0) return EMPTY_CONTACT_INDEX;
  const cached = contactIndexCache.get(events);
  if (cached) return cached;
  const byObject = new Map<string, Set<string>>();
  const touchesByObject = new Map<string, Set<string>>();
  const firstOtherByObject = new Map<string, string>();

  for (const event of events) {
    addContact(byObject, event.objectId, event.otherObjectId);
    addContact(touchesByObject, event.objectId, event.otherObjectId);
    addContact(touchesByObject, event.otherObjectId, event.objectId);
    if (!firstOtherByObject.has(event.objectId)) firstOtherByObject.set(event.objectId, event.otherObjectId);
  }

  const index = { byObject, touchesByObject, firstOtherByObject };
  contactIndexCache.set(events, index);
  return index;
};

// Read-only Set views of id arrays (runtimeGrounded & co), cached on array identity for the same
// reason as the contact index — the arrays only change identity when their content changes.
const EMPTY_ID_SET: ReadonlySet<string> = new Set();
const idSetCache = new WeakMap<readonly string[], ReadonlySet<string>>();
export const toIdSet = (ids: readonly string[]): ReadonlySet<string> => {
  if (ids.length === 0) return EMPTY_ID_SET;
  let set = idSetCache.get(ids);
  if (!set) {
    set = new Set(ids);
    idSetCache.set(ids, set);
  }
  return set;
};

/** Like {@link toIdSet} but lowercases entries — for the fired-event-name queue. */
const lowerSetCache = new WeakMap<readonly string[], ReadonlySet<string>>();
export const toLowerCaseSet = (names: readonly string[]): ReadonlySet<string> => {
  if (names.length === 0) return EMPTY_ID_SET;
  let set = lowerSetCache.get(names);
  if (!set) {
    const next = new Set<string>();
    for (const name of names) next.add(name.toLowerCase());
    set = next;
    lowerSetCache.set(names, set);
  }
  return set;
};

export const contactMatches = (index: ContactIndex, objectId: string, otherObjectId?: string): boolean =>
  otherObjectId ? Boolean(index.byObject.get(objectId)?.has(otherObjectId)) : index.byObject.has(objectId);

export const contactTouches = (index: ContactIndex, objectId: string): boolean =>
  index.touchesByObject.has(objectId);

export const contactOthers = (index: ContactIndex, objectId: string): ReadonlySet<string> | undefined =>
  index.touchesByObject.get(objectId);

export const firstContactOther = (index: ContactIndex, objectId: string): string | undefined =>
  index.firstOtherByObject.get(objectId);
