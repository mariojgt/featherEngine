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

export const buildContactIndex = (events: PhysicsContactEvent[]): ContactIndex => {
  const byObject = new Map<string, Set<string>>();
  const touchesByObject = new Map<string, Set<string>>();
  const firstOtherByObject = new Map<string, string>();

  for (const event of events) {
    addContact(byObject, event.objectId, event.otherObjectId);
    addContact(touchesByObject, event.objectId, event.otherObjectId);
    addContact(touchesByObject, event.otherObjectId, event.objectId);
    if (!firstOtherByObject.has(event.objectId)) firstOtherByObject.set(event.objectId, event.otherObjectId);
  }

  return { byObject, touchesByObject, firstOtherByObject };
};

export const contactMatches = (index: ContactIndex, objectId: string, otherObjectId?: string): boolean =>
  otherObjectId ? Boolean(index.byObject.get(objectId)?.has(otherObjectId)) : index.byObject.has(objectId);

export const contactTouches = (index: ContactIndex, objectId: string): boolean =>
  index.touchesByObject.has(objectId);

export const contactOthers = (index: ContactIndex, objectId: string): ReadonlySet<string> | undefined =>
  index.touchesByObject.get(objectId);

export const firstContactOther = (index: ContactIndex, objectId: string): string | undefined =>
  index.firstOtherByObject.get(objectId);
