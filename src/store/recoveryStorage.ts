const DB_NAME = 'feather-recovery';
const STORE_NAME = 'snapshots';
const CURRENT_KEY = 'current';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Recovery storage is not available in this browser.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    let blocked = false;
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open recovery storage.'));
    request.onblocked = () => { blocked = true; reject(new Error('Recovery storage is blocked by another window.')); };
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      let result: T;
      // Request success precedes transaction commit. A later quota/abort must still reject the save.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('Recovery storage transaction was aborted.'));
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Recovery storage request failed.'));
    });
  } finally { database.close(); }
}

// Opening databases is asynchronous. Queue the whole operation, so a delayed old write can never
// run after a later clear/read just because its database connection opened last.
let operations: Promise<unknown> = Promise.resolve();
function queue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}
export const readStoredRecovery = (): Promise<unknown | undefined> => queue(() => transaction('readonly', (store) => store.get(CURRENT_KEY)));
export const writeStoredRecovery = (value: unknown): Promise<IDBValidKey> => queue(() => transaction('readwrite', (store) => store.put(value, CURRENT_KEY)));
export const clearStoredRecovery = (): Promise<undefined> => queue(() => transaction('readwrite', (store) => store.delete(CURRENT_KEY)));
