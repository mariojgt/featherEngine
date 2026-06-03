export const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Drop keys whose value is `undefined` so a partial patch never overwrites existing fields with undefined. */
export const stripUndefined = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
