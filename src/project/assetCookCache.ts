import type { AssetCookCache, CookAssetResult } from './cookAssets';

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('feather-prepared-assets', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('assets'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }).catch((error) => { database = undefined; throw error; });
  return database;
}

/** Optional persistent build cache. Export still succeeds if storage is unavailable or full. */
export const browserAssetCookCache: AssetCookCache = {
  async get(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('assets', 'readonly').objectStore('assets').get(key);
      request.onsuccess = () => resolve((request.result as CookAssetResult | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  },
  async put(key, value) {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite'); transaction.objectStore('assets').put(value, key);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  },
};
