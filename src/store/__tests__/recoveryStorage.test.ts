import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let storage: typeof import('../recoveryStorage');
let transactions: Array<{ tx: any; request: any }>;
let opens: number;

describe('durable IndexedDB recovery transactions', () => {
  beforeEach(async () => {
    vi.resetModules(); transactions = []; opens = 0;
    vi.stubGlobal('indexedDB', { open: () => {
      opens += 1;
      const database = { objectStoreNames: { contains: () => true }, close: vi.fn(), transaction: () => {
        const request = { result: 'current', error: null, onsuccess: null, onerror: null };
        const tx = { error: null, oncomplete: null, onabort: null, objectStore: () => ({
          put: () => request, get: () => request, delete: () => request,
        }) };
        transactions.push({ tx, request }); return tx;
      } };
      const request = { result: database, onsuccess: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.()); return request;
    } });
    storage = await import('../recoveryStorage');
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reports success only after the transaction commits', async () => {
    const completed = vi.fn(); const save = storage.writeStoredRecovery({ name: 'A' }).then(completed);
    await vi.waitFor(() => expect(transactions).toHaveLength(1));
    transactions[0].request.onsuccess(); await Promise.resolve(); expect(completed).not.toHaveBeenCalled();
    transactions[0].tx.oncomplete(); await save; expect(completed).toHaveBeenCalledOnce();
  });

  it('rejects a quota abort even after the request succeeds', async () => {
    const save = storage.writeStoredRecovery({ name: 'A' });
    const expected = expect(save).rejects.toThrow('Quota exceeded');
    await vi.waitFor(() => expect(transactions).toHaveLength(1));
    transactions[0].request.onsuccess();
    transactions[0].tx.error = new DOMException('Quota exceeded', 'QuotaExceededError'); transactions[0].tx.onabort();
    await expected;
  });

  it('queues clear after the old write commit regardless of connection timing', async () => {
    const save = storage.writeStoredRecovery({ name: 'Old' }); const clear = storage.clearStoredRecovery();
    await vi.waitFor(() => expect(transactions).toHaveLength(1)); expect(opens).toBe(1);
    transactions[0].request.onsuccess(); transactions[0].tx.oncomplete(); await save;
    await vi.waitFor(() => expect(transactions).toHaveLength(2));
    transactions[1].request.onsuccess(); transactions[1].tx.oncomplete(); await clear;
  });

  it('allows later operations after an earlier storage failure', async () => {
    const save = storage.writeStoredRecovery({ name: 'Old' }); const failed = expect(save).rejects.toThrow('aborted');
    const clear = storage.clearStoredRecovery();
    await vi.waitFor(() => expect(transactions).toHaveLength(1)); transactions[0].tx.onabort(); await failed;
    await vi.waitFor(() => expect(transactions).toHaveLength(2));
    transactions[1].request.onsuccess(); transactions[1].tx.oncomplete(); await clear;
  });
});
