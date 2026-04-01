// IndexedDB-backed key/value cache with TTL expiry.
// Used by the storefront bundle to avoid redundant API calls on page load.

const DB_NAME = 'adhoc_verify_cache';
const DB_VERSION = 1;
const STORE_NAME = 'cache';

let dbPromise: Promise<IDBDatabase> | null = null;

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        try {
          (e.target as IDBOpenDBRequest).result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        } catch (_) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number;
}

export async function dbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const entry = await idbRequest<CacheEntry<T> | undefined>(tx.objectStore(STORE_NAME).get(key));
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.value;
  } catch (_) {
    return null;
  }
}

export async function dbSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await idbRequest(
      tx.objectStore(STORE_NAME).put({ key, value, expiresAt: Date.now() + ttlMs }),
    );
  } catch (_) {}
}

export async function dbDel(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await idbRequest(tx.objectStore(STORE_NAME).delete(key));
  } catch (_) {}
}
